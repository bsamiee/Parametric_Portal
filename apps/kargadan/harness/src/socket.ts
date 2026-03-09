import * as FileSystem from '@effect/platform/FileSystem';
import * as Socket from '@effect/platform/Socket';
import { Cause, Data, Deferred, Duration, Effect, HashMap, Layer, Match, Option, pipe, Queue, Ref, Schedule, Schema as S } from 'effect';
import { Envelope } from './protocol/schemas';
import { HarnessConfig, PORT_FILE_PATH } from './config';

// --- [CONSTANTS] -------------------------------------------------------------

const _decoder = new TextDecoder();
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
    readonly reason:   keyof typeof _FaultPolicy;
    readonly details?: unknown;
}> {
    get terminal()  { return _FaultPolicy[this.reason].terminal }
    override get message() {
        const prefix = `SocketClient/${this.reason}`;
        return this.details === undefined ? prefix : `${prefix}: ${JSON.stringify(this.details)}`;
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const readPortFile = Effect.fn('kargadan.portDiscovery.read')(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(PORT_FILE_PATH).pipe(
        Effect.mapError(() => new SocketClientError({ details: { path: PORT_FILE_PATH }, reason: 'port_file_not_found' })),
    );
    const parsed = yield* S.decodeUnknown(S.parseJson(S.Struct({ pid: S.Int, port: S.Int, startedAt: S.String })))(content).pipe(
        Effect.mapError((cause) => new SocketClientError({ details: { cause, path: PORT_FILE_PATH }, reason: 'port_file_invalid' })),
    );
    yield* Effect.try(() => process.kill(parsed.pid, 0)).pipe(
        Effect.mapError(() => new SocketClientError({ details: { path: PORT_FILE_PATH, pid: parsed.pid }, reason: 'port_file_stale' })),
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
            Schedule.tapInput (() => Effect.log('kargadan.reconnect: retrying')),
            Schedule.tapOutput(() => Ref.set(connectionState, 'connected')));
        const _requireConnected = Ref.get(connectionState).pipe(
            Effect.filterOrFail((s) => s === 'connected', (s) => new SocketClientError({ details: { state: s }, reason: 'disconnected' })),
            Effect.asVoid,
        );
        return {
            requireConnected: _requireConnected,
            supervise: Effect.fn('kargadan.reconnect.supervise')(<A, E, R>(connectOnce: (port: number) => Effect.Effect<A, E, R>) =>
                readPortFile().pipe(
                    Effect.tap((info) => Ref.set(connectionState, 'connected').pipe(
                        Effect.zipRight(Effect.log('kargadan.reconnect: connected', { pid: info.pid, port: info.port })))),
                    Effect.flatMap((info) => connectOnce(info.port)),
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
        const pending = yield* Ref.make(HashMap.empty<string, {
            readonly deferred: Deferred.Deferred<Envelope.PendingReply, SocketClientError>;
            readonly tag:      Envelope.Outbound['_tag'];
        }>());
        const events = yield* Queue.sliding<Envelope.Event>(1024);
        const lastMessageAt = yield* Ref.make<Option.Option<number>>(Option.none());
        const decode = S.decodeUnknown(S.parseJson(Envelope));
        const encode = S.encode(S.parseJson(Envelope));
        const _failAllPending = (
            cause:    string,
            details?: Readonly<Record<string, unknown>>,
            reason:   keyof typeof _FaultPolicy = 'disconnected',
        ) =>
            Ref.getAndSet(pending, HashMap.empty()).pipe(
                Effect.flatMap((old) => Effect.forEach(HashMap.values(old), (entry) =>
                    Deferred.fail(entry.deferred, new SocketClientError({ details: { cause, ...details }, reason })).pipe(Effect.ignore), { discard: true })),
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
            const failure = new SocketClientError({ details: { message: remoteError.message, requestId: remoteError.requestId }, reason: 'protocol' });
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
                const json = yield* encode(envelope).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'encode' }, reason: 'transport_failure' })),);
                yield* writer(json).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'write' }, reason: 'transport_failure' })),);
                return yield* Deferred.await(deferred).pipe(Effect.timeoutFail({ duration: Duration.millis(config.commandDeadlineMs), onTimeout: () => new SocketClientError({ details: { requestId: envelope.requestId }, reason: 'request_timeout' }) }),);
            }).pipe(Effect.ensuring(Ref.update(pending, HashMap.remove(envelope.requestId)))),
        );
        const _dispatchChunk = (chunk: Uint8Array) =>
            Effect.gen(function* () {
                const envelope = yield* decode(_decoder.decode(chunk)).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'decode' }, reason: 'transport_failure' })),);
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
                    ? _failAllPending('connection_stale').pipe(Effect.zipRight(Effect.fail(new SocketClientError({ details: { lastMessageAgoMs: elapsed }, reason: 'connection_stale' }))))
                    : Effect.void),
            })),
            Effect.schedule(Schedule.fixed(Duration.millis(config.heartbeatTimeoutMs))));
        return {
            request:          _request,
            stalenessChecker: _heartbeatStalenessChecker,
            start:            () => Effect.all([socket.run(_dispatchChunk), _heartbeatStalenessChecker], { discard: true }).pipe(Effect.onError(() => _failAllPending('socket_closed')),),
            takeEvent: () => Queue.take(events),
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const KargadanSocketClientLive = Layer.unwrapEffect(
    Effect.all([readPortFile(), HarnessConfig]).pipe(
        Effect.map(([{ port }, harnessConfig]) => Layer.provide(KargadanSocketClient.Default,
            Layer.provide(Socket.layerWebSocket(`ws://${harnessConfig.wsHost}:${port}`), Socket.layerWebSocketConstructorGlobal)))));

// --- [EXPORT] ----------------------------------------------------------------

export { KargadanSocketClient, KargadanSocketClientLive, readPortFile, ReconnectionSupervisor, SocketClientError };
