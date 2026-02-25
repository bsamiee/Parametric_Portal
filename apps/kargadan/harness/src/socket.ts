import { homedir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import * as Socket from '@effect/platform/Socket';
import { Data, Deferred, Duration, Effect, HashMap, Layer, Option, Queue, Ref, Schedule, Schema as S } from 'effect';
import { EnvelopeSchema } from './protocol/schemas';
import { HarnessConfig } from './config';

// --- [TYPES] -----------------------------------------------------------------

type _SocketClientIssue = Data.TaggedEnum<{ ConnectionStale: { readonly lastMessageAgoMs: number }; Disconnected: { readonly reason: string }; PortFileInvalid: { readonly cause: unknown; readonly path: string }; PortFileNotFound: { readonly path: string }; PortFileStale: { readonly path: string; readonly pid: number }; RequestTimeout: { readonly requestId: string }; TransportFailure: { readonly cause: unknown; readonly stage: string } }>;

// --- [SCHEMA] ----------------------------------------------------------------

const _SocketClientIssue = Data.taggedEnum<_SocketClientIssue>();

// --- [ERRORS] ----------------------------------------------------------------

class SocketClientError extends Data.TaggedError('SocketClientError')<{ readonly issue: _SocketClientIssue }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _readPortFile = Effect.fn('kargadan.portDiscovery.read')(function* () {
    const fs = yield* FileSystem.FileSystem;
    const portFilePath = join(homedir(), '.kargadan', 'port');
    const content = yield* fs.readFileString(portFilePath).pipe(
        Effect.mapError(() => new SocketClientError({ issue: _SocketClientIssue.PortFileNotFound({ path: portFilePath }) })),
    );
    const parsed = yield* S.decodeUnknown(S.parseJson(S.Struct({ pid: S.Int, port: S.Int, startedAt: S.String })))(content).pipe(
        Effect.mapError((cause) => new SocketClientError({ issue: _SocketClientIssue.PortFileInvalid({ cause, path: portFilePath }) })),
    );
    yield* Effect.try(() => process.kill(parsed.pid, 0)).pipe(
        Effect.mapError(() => new SocketClientError({ issue: _SocketClientIssue.PortFileStale({ path: portFilePath, pid: parsed.pid }) })),
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
                    Effect.catchTag('SocketClientError', (error) => Effect.log('kargadan.reconnect: port file unavailable, continuing retry', { issue: error.issue }),),
                ),
            ),
            Schedule.tapOutput(() => Ref.set(connectionState, 'connected')),
        );
        const _requireConnected = Ref.get(connectionState).pipe(
            Effect.filterOrFail(
                (s): s is 'connected' => s === 'connected',
                (s) => new SocketClientError({ issue: _SocketClientIssue.Disconnected({ reason: `state_${s}` }) }),
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
        const pending = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<typeof EnvelopeSchema.Type>>());
        const events = yield* Queue.unbounded<Extract<typeof EnvelopeSchema.Type, {_tag: 'event'}>>();
        const lastMessageAt = yield* Ref.make<Option.Option<number>>(Option.none());
        const decode = S.decodeUnknown(S.parseJson(EnvelopeSchema));
        const encode = S.encode(S.parseJson(EnvelopeSchema));
        const _failAllPending = (reason: string) =>
            Ref.getAndSet(pending, HashMap.empty<string, Deferred.Deferred<typeof EnvelopeSchema.Type>>()).pipe(
                Effect.flatMap((old) => Effect.forEach(HashMap.values(old), (d) => Deferred.die(d, new SocketClientError({ issue: _SocketClientIssue.Disconnected({ reason }) })).pipe(Effect.ignore), { discard: true })),
            );
        const _request = Effect.fn('kargadan.socket.request')((envelope: typeof EnvelopeSchema.Type) => {
            const requestId = envelope.requestId;
            return Effect.gen(function* () {
                const timeoutMs = yield* HarnessConfig.commandDeadlineMs;
                const deferred = yield* Deferred.make<typeof EnvelopeSchema.Type>();
                yield* Ref.update(pending, HashMap.set(requestId, deferred));
                yield* reconnectSupervisor.control.requireConnected;
                const json = yield* encode(envelope).pipe(Effect.mapError((cause) => new SocketClientError({ issue: _SocketClientIssue.TransportFailure({ cause, stage: 'encode' }) })),);
                yield* writer(json).pipe(Effect.mapError((cause) => new SocketClientError({ issue: _SocketClientIssue.TransportFailure({ cause, stage: 'write' }) })),);
                return yield* Deferred.await(deferred).pipe(Effect.timeoutFail({ duration: Duration.millis(timeoutMs), onTimeout: () => new SocketClientError({ issue: _SocketClientIssue.RequestTimeout({ requestId }) }) }),);
            }).pipe(Effect.ensuring(Ref.update(pending, HashMap.remove(requestId))));
        });
        const _dispatchChunk = (chunk: Uint8Array) =>
            Effect.gen(function* () {
                const envelope = yield* decode(new TextDecoder().decode(chunk)).pipe(Effect.mapError((cause) => new SocketClientError({ issue: _SocketClientIssue.TransportFailure({ cause, stage: 'decode' }) })),);
                yield* Ref.set(lastMessageAt, Option.some(Date.now()));
                // Why: event envelopes go to queue; responses resolve pending deferreds via requestId correlation
                return yield* envelope._tag === 'event'
                    ? Queue.offer(events, envelope)
                    : Ref.modify(pending, (entries) => [HashMap.get(entries, envelope.requestId), HashMap.remove(entries, envelope.requestId)] as const).pipe(
                        Effect.flatMap((opt) => Option.isSome(opt) ? Deferred.succeed(opt.value, envelope) : Effect.void),
                    );
            }).pipe(Effect.catchTag('SocketClientError', (error) => Effect.logWarning('kargadan.socket.decode.failed', { issue: error.issue })));
        const _heartbeatStalenessChecker = HarnessConfig.heartbeatTimeoutMs.pipe(Effect.flatMap((timeoutMs) =>
            Ref.get(lastMessageAt).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.void,
                    onSome: (t) => {
                        const elapsed = Date.now() - t;
                        return elapsed > timeoutMs
                            ? _failAllPending('connection_stale').pipe(Effect.zipRight(Effect.fail(new SocketClientError({ issue: _SocketClientIssue.ConnectionStale({ lastMessageAgoMs: elapsed }) }))))
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
