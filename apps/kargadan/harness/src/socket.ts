import * as FileSystem from '@effect/platform/FileSystem';
import * as Socket from '@effect/platform/Socket';
import { Cause, Data, Deferred, Duration, Effect, Fiber, HashMap, Layer, Match, Option, pipe, Queue, Ref, Schedule, Schema as S } from 'effect';
import { Envelope } from './protocol/schemas';
import { HarnessConfig, PORT_FILE_PATH } from './config';

// --- [CONSTANTS] -------------------------------------------------------------

const _decoder = new TextDecoder();
const _TransportSchema = S.Struct({
    pid:          S.Int,
    port:         S.Int,
    sessionToken: S.NonEmptyTrimmedString,
    startedAt:    S.String,
});
const _FaultPolicy = {
    connection_stale:    { terminal: false },
    disconnected:        { terminal: true  },
    port_file_invalid:   { terminal: false },
    port_file_not_found: { terminal: false },
    port_file_stale:     { terminal: false },
    protocol:            { terminal: true  },
    request_timeout:     { terminal: false },
    transport_failure:   { terminal: false },
} as const satisfies Record<string, { terminal: boolean }>

// --- [ERRORS] ----------------------------------------------------------------

class SocketClientError extends Data.TaggedError('SocketClientError')<{
    readonly reason: keyof typeof _FaultPolicy;
    readonly detail?: unknown;
}> {
    get terminal()  { return _FaultPolicy[this.reason].terminal }
    override get message() {
        const prefix = `SocketClient/${this.reason}`;
        return this.detail === undefined ? prefix : `${prefix}: ${JSON.stringify(this.detail)}`;
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const readPortFile = Effect.fn('kargadan.portDiscovery.read')(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(PORT_FILE_PATH).pipe(
        Effect.mapError(() => new SocketClientError({ detail: { path: PORT_FILE_PATH }, reason: 'port_file_not_found' })),
    );
    const parsed = yield* S.decodeUnknown(S.parseJson(_TransportSchema))(content).pipe(
        Effect.mapError((cause) => new SocketClientError({ detail: { cause, path: PORT_FILE_PATH }, reason: 'port_file_invalid' })),
    );
    yield* Effect.try({
        catch: (error) => error as NodeJS.ErrnoException,
        try:   () => process.kill(parsed.pid, 0),
    }).pipe(
        Effect.catchAll((error) => ((error).code === 'EPERM'
            ? Effect.void
            : Effect.fail(error))),
        Effect.mapError(() => new SocketClientError({ detail: { path: PORT_FILE_PATH, pid: parsed.pid }, reason: 'port_file_stale' })),
    );
    return parsed;
});

// --- [SERVICES] --------------------------------------------------------------

class ReconnectionSupervisor extends Effect.Service<ReconnectionSupervisor>()('kargadan/ReconnectionSupervisor', {
    effect: Effect.gen(function* () {
        const connectionState = yield* Ref.make<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
        const config = yield* HarnessConfig;
        const _retrySchedule = Schedule.exponential(Duration.millis(config.reconnectBackoffBaseMs), 2).pipe(
            Schedule.jittered, Schedule.upTo(Duration.millis(config.reconnectBackoffMaxMs)), Schedule.intersect(Schedule.recurs(config.reconnectMaxAttempts)),
            Schedule.tapInput(() => readPortFile().pipe(
                Effect.flatMap(({ pid }) => Effect.try(() => process.kill(pid, 0)).pipe(
                    Effect.catchAll(() => Effect.logWarning('kargadan.reconnect: Rhino process dead. Restart Rhino.')))),
                Effect.catchAll(() => Effect.logWarning('kargadan.reconnect: port file unavailable')),
                Effect.zipRight(Effect.log('kargadan.reconnect: retrying')))),
            Schedule.tapOutput(() => Ref.set(connectionState, 'connected')));
        const _requireConnected = Ref.get(connectionState).pipe(
            Effect.filterOrFail((s) => s === 'connected', (s) => new SocketClientError({ detail: { state: s }, reason: 'disconnected' })),
            Effect.asVoid,
        );
        return {
            requireConnected: _requireConnected,
            supervise: Effect.fn('kargadan.reconnect.supervise')(<A, E, R>(connectOnce: (transport: typeof _TransportSchema.Type) => Effect.Effect<A, E, R>) =>
                readPortFile().pipe(
                    Effect.tap((info) => Ref.set(connectionState, 'connected').pipe(
                        Effect.zipRight(Effect.log('kargadan.reconnect: connected', { pid: info.pid, port: info.port })))),
                    Effect.flatMap(connectOnce),
                    Effect.catchAllCause((cause) => Cause.isInterruptedOnly(cause)
                        ? Effect.failCause(cause)
                        : Ref.set(connectionState, 'reconnecting').pipe(
                            Effect.zipRight(Effect.log('kargadan.reconnect: disconnected, starting backoff')),
                            Effect.zipRight(Effect.failCause(cause)))),
                    Effect.retry(_retrySchedule),
                ),
            ),
        } as const;
    }),
}) {}
class KargadanSocketClient extends Effect.Service<KargadanSocketClient>()('kargadan/SocketClient', {
    effect: Effect.gen(function* () {
        const socket = yield* Socket.Socket;
        const reconnectSupervisor = yield* ReconnectionSupervisor;
        const config = yield* HarnessConfig;
        const writer = yield* socket.writer;
        const closeSignal = yield* Deferred.make<void, never>();
        const pending = yield* Ref.make(HashMap.empty<string, {
            readonly deferred: Deferred.Deferred<Envelope.PendingReply, SocketClientError>;
            readonly tag:      Envelope.Outbound['_tag'];
        }>());
        // why: sliding queue drops oldest events under backpressure — latest-wins semantics for UI-bound observation events
        const events = yield* Queue.sliding<Envelope.Event>(1024);
        const lastMessageAt = yield* Ref.make<Option.Option<number>>(Option.none());
        const decode = S.decodeUnknown(S.parseJson(Envelope));
        const encode = S.encode(S.parseJson(Envelope));
        const _failAllPending = (
            cause:    string,
            detail?:  Readonly<Record<string, unknown>>,
            reason:   keyof typeof _FaultPolicy = 'disconnected',
        ) =>
            Ref.getAndSet(pending, HashMap.empty()).pipe(
                Effect.flatMap((old) => Effect.forEach(HashMap.values(old), (entry) =>
                    Deferred.fail(entry.deferred, new SocketClientError({ detail: { cause, ...detail }, reason })).pipe(Effect.ignore), { discard: true })),
            );
        const _takePending = (requestId: string, retain: (entry: { readonly tag: Envelope.Outbound['_tag'] }) => boolean) =>
            Ref.modify(pending, (entries) => pipe(HashMap.get(entries, requestId), Option.match({
                onNone: () => [Option.none(), entries] as const,
                onSome: (entry) => retain(entry) ? [Option.none(), entries] as const : [Option.some(entry.deferred), HashMap.remove(entries, requestId)] as const,
            })));
        const _resolveReply = (reply: Envelope.PendingReply) =>
            _takePending(reply.requestId, (entry) => entry.tag === 'command' && reply._tag === 'command.ack').pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.succeed(false),
                    onSome: (deferred) => Deferred.succeed(deferred, reply),
                })),
                Effect.asVoid);
        const _resolveRemoteError = (remoteError: Envelope.RemoteError) => {
            const failure = new SocketClientError({ detail: { message: remoteError.message, requestId: remoteError.requestId }, reason: 'protocol' });
            const _failScoped = (requestId: string) =>
                _takePending(requestId, () => false).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => _failAllPending('remote_error', { message: remoteError.message, requestId }, 'protocol').pipe(
                            Effect.zipRight(Effect.logWarning('kargadan.socket.remote.error.unmatched', { message: remoteError.message, requestId }))),
                        onSome: (deferred) => Deferred.fail(deferred, failure).pipe(
                            Effect.zipRight(Effect.logWarning('kargadan.socket.remote.error', { hasRequestId: true, message: remoteError.message, requestId }))),
                    })));
            return Option.fromNullable(remoteError.requestId).pipe(
                Option.match({
                    onNone: () => _failAllPending('remote_error', { message: remoteError.message }, 'protocol').pipe(
                        Effect.zipRight(Effect.logWarning('kargadan.socket.remote.error', { hasRequestId: false, message: remoteError.message }))),
                    onSome: _failScoped,
                }),
            );
        };
        const _request = Effect.fn('kargadan.socket.request')((envelope: Envelope.Outbound) =>
            Effect.gen(function* () {
                const deferred = yield* Deferred.make<Envelope.PendingReply, SocketClientError>();
                yield* Ref.update(pending, HashMap.set(envelope.requestId, { deferred, tag: envelope._tag }));
                yield* reconnectSupervisor.requireConnected;
                const json = yield* encode(envelope).pipe(Effect.mapError((cause) => new SocketClientError({ detail: { cause, stage: 'encode' }, reason: 'transport_failure' })),);
                yield* writer(json).pipe(Effect.mapError((cause) => new SocketClientError({ detail: { cause, stage: 'write' }, reason: 'transport_failure' })),);
                return yield* Deferred.await(deferred).pipe(Effect.timeoutFail({ duration: Duration.millis(config.commandDeadlineMs), onTimeout: () => new SocketClientError({ detail: { requestId: envelope.requestId }, reason: 'request_timeout' }) }),);
            }).pipe(Effect.ensuring(Ref.update(pending, HashMap.remove(envelope.requestId)))),
        );
        const _dispatchChunk = (chunk: Uint8Array) =>
            Effect.gen(function* () {
                const envelope = yield* decode(_decoder.decode(chunk)).pipe(Effect.mapError((cause) => new SocketClientError({ detail: { cause, stage: 'decode' }, reason: 'transport_failure' })),);
                yield* Ref.set(lastMessageAt, Option.some(Date.now()));
                return yield* Match.value(envelope).pipe(
                    Match.when  ({ _tag: 'event' }, (e) => Queue.offer(events, e)),
                    Match.whenOr({ _tag: 'command.ack' }, { _tag: 'handshake.ack' }, { _tag: 'handshake.reject' }, { _tag: 'result' }, { _tag: 'heartbeat', mode: 'pong' as const }, _resolveReply),
                    Match.when  ({ _tag: 'error' }, _resolveRemoteError),
                    Match.orElse((e) => Effect.logWarning('kargadan.socket.reply.ignored', { requestId: e.requestId, tag: e._tag })),
                );
            }).pipe(Effect.catchTag('SocketClientError', (error) => Effect.logWarning('kargadan.socket.decode.failed', { reason: error.reason })));
        const _heartbeatStalenessChecker = Ref.get(lastMessageAt).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.void,
                onSome: (t) => pipe(Date.now() - t, (elapsed) => elapsed > config.heartbeatTimeoutMs
                    ? _failAllPending('connection_stale').pipe(Effect.zipRight(Effect.fail(new SocketClientError({ detail: { lastMessageAgoMs: elapsed }, reason: 'connection_stale' }))))
                    : Effect.void),
            })),
            Effect.schedule(Schedule.fixed(Duration.millis(config.heartbeatTimeoutMs))));
        return {
            close:            writer(new Socket.CloseEvent(1000, 'kargadan-complete')).pipe(
                Effect.catchAll(() => Effect.void),
                Effect.zipRight(Deferred.succeed(closeSignal, undefined)),
                Effect.ignore),
            request:          _request,
            start:            () => Effect.gen(function* () {
                const heartbeatFiber = yield* Effect.forkScoped(_heartbeatStalenessChecker);
                return yield* socket.run(_dispatchChunk).pipe(
                    Effect.raceFirst(Deferred.await(closeSignal)),
                    Effect.ensuring(Fiber.interrupt(heartbeatFiber).pipe(Effect.asVoid)),
                    Effect.onError(() => _failAllPending('socket_closed')),
                );
            }),
            takeEvent:        () => Queue.take(events),
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const KargadanSocketClientLayer = (port: number) => Layer.unwrapEffect(
    HarnessConfig.pipe(
        Effect.map((harnessConfig) => Layer.provide(
            KargadanSocketClient.Default,
            Layer.provide(Socket.layerWebSocket(`ws://${harnessConfig.wsHost}:${port}`), Socket.layerWebSocketConstructorGlobal),
        )),
    ));
const KargadanSocketClientLive = Layer.unwrapEffect(
    readPortFile().pipe(Effect.map(({ port }) => KargadanSocketClientLayer(port))));

// --- [EXPORT] ----------------------------------------------------------------

export { KargadanSocketClient, KargadanSocketClientLayer, KargadanSocketClientLive, readPortFile, ReconnectionSupervisor };
