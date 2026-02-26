import { homedir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import * as Socket from '@effect/platform/Socket';
import { Data, Deferred, Duration, Effect, HashMap, Layer, Match, Option, Queue, Ref, Schedule, Schema as S } from 'effect';
import { Envelope } from './protocol/schemas';
import { HarnessConfig } from './config';

// --- [ERRORS] ----------------------------------------------------------------

class SocketClientError extends Data.TaggedError('SocketClientError')<{
    readonly reason: 'connection_stale' | 'disconnected' | 'port_file_invalid' | 'port_file_not_found' | 'port_file_stale' | 'request_timeout' | 'transport_failure';
    readonly details?: unknown;
}> {
    override get message() {
        const prefix = `SocketClient/${this.reason}`;
        return this.details === undefined ? prefix : `${prefix}: ${JSON.stringify(this.details)}`;
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _readPortFile = Effect.fn('kargadan.portDiscovery.read')(function* () {
    const fs = yield* FileSystem.FileSystem;
    const portFilePath = join(homedir(), '.kargadan', 'port');
    const content = yield* fs.readFileString(portFilePath).pipe(
        Effect.mapError(() => new SocketClientError({ details: { path: portFilePath }, reason: 'port_file_not_found' })),
    );
    const parsed = yield* S.decodeUnknown(S.parseJson(S.Struct({ pid: S.Int, port: S.Int, startedAt: S.String })))(content).pipe(
        Effect.mapError((cause) => new SocketClientError({ details: { cause, path: portFilePath }, reason: 'port_file_invalid' })),
    );
    yield* Effect.try(() => process.kill(parsed.pid, 0)).pipe(
        Effect.mapError(() => new SocketClientError({ details: { path: portFilePath, pid: parsed.pid }, reason: 'port_file_stale' })),
    );
    return parsed;
});

// --- [SERVICES] --------------------------------------------------------------

class ReconnectionSupervisor extends Effect.Service<ReconnectionSupervisor>()('kargadan/ReconnectionSupervisor', {
    effect: Effect.gen(function* () {
        const connectionState = yield* Ref.make<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
        const [reconnectBackoffBaseMs, reconnectBackoffMaxMs, reconnectMaxAttempts] = yield* Effect.all([
            HarnessConfig.reconnectBackoffBaseMs,
            HarnessConfig.reconnectBackoffMaxMs,
            HarnessConfig.reconnectMaxAttempts,
        ]);
        const _retrySchedule = Schedule.exponential(Duration.millis(reconnectBackoffBaseMs), 2).pipe(
            Schedule.jittered,
            Schedule.upTo(Duration.millis(reconnectBackoffMaxMs)),
            Schedule.intersect(Schedule.recurs(reconnectMaxAttempts)),
            Schedule.tapInput(() =>
                _readPortFile().pipe(
                    Effect.tap((info) => Ref.set(connectionState, 'reconnecting').pipe(Effect.zipRight(Effect.log('kargadan.reconnect: retrying', { pid: info.pid, port: info.port })))),
                    Effect.catchTag('SocketClientError', (error) => Effect.log('kargadan.reconnect: port file unavailable, continuing retry', { reason: error.reason }),),
                ),
            ),
            Schedule.tapOutput(() => Ref.set(connectionState, 'connected')),
        );
        const _requireConnected = Ref.get(connectionState).pipe(
            Effect.filterOrFail(
                (s) => s === 'connected',
                (s) => new SocketClientError({ details: { state: s }, reason: 'disconnected' }),
            ),
            Effect.asVoid,
        );
        const _supervise = Effect.fn('kargadan.reconnect.supervise')(
            <A, E, R>(connectOnce: (port: number) => Effect.Effect<A, E, R>) =>
                Effect.gen(function* () {
                    const portInfo = yield* _readPortFile();
                    yield* Ref.set(connectionState, 'connected');
                    yield* Effect.log('kargadan.reconnect: connected', { pid: portInfo.pid, port: portInfo.port });
                    return yield* connectOnce(portInfo.port).pipe(
                        Effect.onError(() => Ref.set(connectionState, 'reconnecting').pipe(Effect.zipRight(Effect.log('kargadan.reconnect: disconnected, starting backoff')))),
                        Effect.retry(_retrySchedule),
                    );
                }),
        );
        return { control: { requireConnected: _requireConnected, supervise: _supervise } } as const;
    }),
}) {}
class KargadanSocketClient extends Effect.Service<KargadanSocketClient>()('kargadan/SocketClient', {
    effect: Effect.gen(function* () {
        const socket = yield* Socket.Socket;
        const reconnectSupervisor = yield* ReconnectionSupervisor;
        const writer = yield* socket.writer;
        const pending = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<Envelope.PendingReply>>());
        const events = yield* Queue.unbounded<Envelope.Event>();
        const lastMessageAt = yield* Ref.make<Option.Option<number>>(Option.none());
        const decode = S.decodeUnknown(S.parseJson(Envelope));
        const encode = S.encode(S.parseJson(Envelope));
        const _failAllPending = (cause: string) =>
            Ref.getAndSet(pending, HashMap.empty<string, Deferred.Deferred<Envelope.PendingReply>>()).pipe(
                Effect.flatMap((old) => Effect.forEach(HashMap.values(old), (d) => Deferred.die(d, new SocketClientError({ details: { cause }, reason: 'disconnected' })).pipe(Effect.ignore), { discard: true })),
            );
        const _resolveReply = (reply: Envelope.PendingReply) =>
            Ref.modify(pending, (entries) => [HashMap.get(entries, reply.requestId), HashMap.remove(entries, reply.requestId)] as const).pipe(
                Effect.flatMap((d) => Option.isSome(d) ? Deferred.succeed(d.value, reply) : Effect.void),
            );
        const _request = Effect.fn('kargadan.socket.request')((envelope: Envelope.Outbound) => {
            const requestId = envelope.requestId;
            return Effect.gen(function* () {
                const timeoutMs = yield* HarnessConfig.commandDeadlineMs;
                const deferred = yield* Deferred.make<Envelope.PendingReply>();
                yield* Ref.update(pending, HashMap.set(requestId, deferred));
                yield* reconnectSupervisor.control.requireConnected;
                const json = yield* encode(envelope).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'encode' }, reason: 'transport_failure' })),);
                yield* writer(json).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'write' }, reason: 'transport_failure' })),);
                return yield* Deferred.await(deferred).pipe(Effect.timeoutFail({ duration: Duration.millis(timeoutMs), onTimeout: () => new SocketClientError({ details: { requestId }, reason: 'request_timeout' }) }),);
            }).pipe(Effect.ensuring(Ref.update(pending, HashMap.remove(requestId))));
        });
        const _dispatchChunk = (chunk: Uint8Array) =>
            Effect.gen(function* () {
                const envelope = yield* decode(new TextDecoder().decode(chunk)).pipe(Effect.mapError((cause) => new SocketClientError({ details: { cause, stage: 'decode' }, reason: 'transport_failure' })),);
                yield* Ref.set(lastMessageAt, Option.some(Date.now()));
                return yield* Match.value(envelope).pipe(
                    Match.when({ _tag: 'event' }, (e) => Queue.offer(events, e)),
                    Match.when({ _tag: 'command.ack' },             _resolveReply),
                    Match.when({ _tag: 'handshake.ack' },           _resolveReply),
                    Match.when({ _tag: 'handshake.reject' },        _resolveReply),
                    Match.when({ _tag: 'result' },                  _resolveReply),
                    Match.when({ _tag: 'heartbeat', mode: 'pong' }, _resolveReply),
                    Match.orElse((e) => Effect.logWarning('kargadan.socket.reply.ignored', { requestId: e.requestId, tag: e._tag })),
                );
            }).pipe(Effect.catchTag('SocketClientError', (error) => Effect.logWarning('kargadan.socket.decode.failed', { reason: error.reason })));
        const _heartbeatStalenessChecker = HarnessConfig.heartbeatTimeoutMs.pipe(Effect.flatMap((timeoutMs) =>
            Ref.get(lastMessageAt).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.void,
                    onSome: (t) => {
                        const elapsed = Date.now() - t;
                        return elapsed > timeoutMs
                            ? _failAllPending('connection_stale').pipe(Effect.zipRight(Effect.fail(new SocketClientError({ details: { lastMessageAgoMs: elapsed }, reason: 'connection_stale' }))))
                            : Effect.void;
                    },
                })),
                Effect.schedule(Schedule.fixed(Duration.millis(timeoutMs))),
            ),
        ));
        return {
            lifecycle: {
                stalenessChecker: _heartbeatStalenessChecker,
                start: Effect.fn('kargadan.socket.start')(() => socket.run(_dispatchChunk).pipe(Effect.onError(() => _failAllPending('socket_closed')))),
            },
            read:  { takeEvent: Effect.fn('kargadan.socket.takeEvent')(() => Queue.take(events)) },
            write: { request:   _request },
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const KargadanSocketClientLive = Layer.unwrapEffect(
    _readPortFile().pipe(
        Effect.map((portInfo) => Layer.provide(
            KargadanSocketClient.Default,
            Layer.mergeAll(Socket.layerWebSocketConstructorGlobal, Socket.layerWebSocket(`ws://127.0.0.1:${portInfo.port}`)),
        )),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { KargadanSocketClient, KargadanSocketClientLive, ReconnectionSupervisor };
