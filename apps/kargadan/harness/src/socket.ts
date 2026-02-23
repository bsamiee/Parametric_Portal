/**
 * Wraps Effect Platform WebSocket with typed Kargadan envelope routing: correlates request/response pairs via Deferred-keyed pending map.
 * Event envelopes fan out to an unbounded Queue; decode failures log a warning and do not interrupt the connection.
 * Heartbeat pings fire on a fixed schedule; staleness detection triggers reconnection when no inbound message arrives within the timeout window.
 */
import * as Socket from '@effect/platform/Socket';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Data, Deferred, Duration, Effect, HashMap, Layer, Match, Option, Queue, Ref, Schedule, Schema as S } from 'effect';
import { HarnessConfig } from './config';
import { readPortFile } from './transport/port-discovery';
import { DisconnectedError, ReconnectionSupervisor } from './transport/reconnect';

// --- [CONSTANTS] -------------------------------------------------------------

const _inboundDecoder = new TextDecoder();
const _pendingFailureReason = {
    socketClosed: 'socket closed',
    stale:        'connection stale',
} as const;

// --- [TYPES] -----------------------------------------------------------------

type _PendingFailureReason = typeof _pendingFailureReason[keyof typeof _pendingFailureReason];

// --- [SCHEMA] ----------------------------------------------------------------

const _decodeInbound =  S.decodeUnknown(S.parseJson(Kargadan.InboundEnvelopeSchema));
const _encodeOutbound = S.encode(S.parseJson(Kargadan.OutboundEnvelopeSchema));

// --- [ERRORS] ----------------------------------------------------------------

class SocketRequestTimeoutError extends Data.TaggedError('SocketRequestTimeout')<{
    readonly requestId: string;
}> {static readonly of = (requestId: string) => new SocketRequestTimeoutError({ requestId });}
class ConnectionStaleError extends Data.TaggedError('ConnectionStale')<{
    readonly lastMessageAgoMs: number;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class KargadanSocketClient extends Effect.Service<KargadanSocketClient>()('kargadan/SocketClient', {
    effect: Effect.gen(function* () {
        const socket = yield* Socket.Socket;
        const reconnectSupervisor = yield* ReconnectionSupervisor;
        const writer = yield* socket.writer;
        const pending = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<Kargadan.InboundEnvelope>>());
        const events = yield* Queue.unbounded<Kargadan.EventEnvelope>();
        const lastMessageAt = yield* Ref.make<Option.Option<number>>(Option.none());
        const _touchLastMessage = Ref.set(lastMessageAt, Option.some(Date.now()));
        const _writeEnvelope = (envelope: Kargadan.OutboundEnvelope) =>
            reconnectSupervisor.control.requireConnected.pipe(
                Effect.flatMap(() => _encodeOutbound(envelope)),
                Effect.flatMap((json) => writer(json)),
            );
        const _request = Effect.fn('kargadan.socket.request')((envelope: Kargadan.OutboundEnvelope) =>
            Effect.gen(function* () {
                const timeoutMs = yield* HarnessConfig.commandDeadlineMs;
                const deferred = yield* Deferred.make<Kargadan.InboundEnvelope>();
                const requestId = envelope.identity.requestId;
                const clearPending = Ref.update(pending, (entries) => HashMap.remove(entries, requestId));
                yield* Ref.update(pending, (entries) => HashMap.set(entries, requestId, deferred));
                return yield* _writeEnvelope(envelope).pipe(
                    Effect.zipRight(
                        Deferred.await(deferred).pipe(
                            Effect.timeoutFail({
                                duration: Duration.millis(timeoutMs),
                                onTimeout: () => SocketRequestTimeoutError.of(requestId),
                            }),
                        ),
                    ),
                    Effect.ensuring(clearPending),
                );
            }),
        );
        const _failAllPending = (reason: _PendingFailureReason) =>
            Ref.getAndSet(pending, HashMap.empty<string, Deferred.Deferred<Kargadan.InboundEnvelope>>()).pipe(
                Effect.flatMap((entries) =>
                    Effect.forEach(
                        HashMap.values(entries),
                        (deferred) => Deferred.die(deferred, new DisconnectedError({ reason })).pipe(Effect.ignore),
                        { discard: true },
                    ),
                ),
            );
        const _resolvePending = (value: Kargadan.InboundEnvelope) =>
            Ref.modify(
                pending,
                (entries) =>
                    [
                        HashMap.get(entries, value.identity.requestId),
                        HashMap.remove(entries, value.identity.requestId),
                    ] as const,
            ).pipe(
                Effect.flatMap(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (deferred) => Deferred.succeed(deferred, value).pipe(Effect.asVoid),
                    }),
                ),
            );
        const _dispatchChunk = (chunk: Uint8Array) =>
            _decodeInbound(_inboundDecoder.decode(chunk)).pipe(
                Effect.tap(() => _touchLastMessage),
                Effect.flatMap((envelope) =>
                    Match.value(envelope).pipe(
                        Match.when({ _tag: 'event' }, (eventEnvelope) => Queue.offer(events, eventEnvelope)),
                        Match.orElse((value) => _resolvePending(value)),
                    ),
                ),
                Effect.catchAll((error) =>
                    Effect.logWarning('kargadan.socket.decode.failed', { error: String(error) }),
                ),
            );
        const _heartbeatStalenessChecker = Effect.gen(function* () {
            const timeoutMs = yield* HarnessConfig.heartbeatTimeoutMs;
            return Effect.gen(function* () {
                const last = yield* Ref.get(lastMessageAt);
                yield* Option.match(last, {
                    onNone: () => Effect.void,
                    onSome: (timestamp) => {
                        const elapsed = Date.now() - timestamp;
                        return elapsed > timeoutMs
                            ? _failAllPending(_pendingFailureReason.stale).pipe(
                                Effect.zipRight(Effect.fail(new ConnectionStaleError({ lastMessageAgoMs: elapsed }))),
                            )
                            : Effect.void;
                    },
                });
            }).pipe(Effect.schedule(Schedule.fixed(Duration.millis(timeoutMs))),);
        });
        const _start = Effect.fn('kargadan.socket.start')(() =>
            socket.run(_dispatchChunk).pipe(
                Effect.onError(() => _failAllPending(_pendingFailureReason.socketClosed)),
            ),
        );
        const _takeEvent = Effect.fn('kargadan.socket.takeEvent')(() => Queue.take(events));
        return {
            lifecycle:  { stalenessChecker: _heartbeatStalenessChecker, start: _start },
            read:       { takeEvent: _takeEvent },
            write:      { request: _request },
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const KargadanSocketClientLive = Layer.unwrapEffect(
    readPortFile().pipe(
        Effect.map((portInfo) => Layer.provide(
            KargadanSocketClient.Default,
            Layer.mergeAll(
                Socket.layerWebSocketConstructorGlobal,
                Socket.layerWebSocket(`ws://127.0.0.1:${portInfo.port}`),
            ),
        )),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { ConnectionStaleError, KargadanSocketClient, KargadanSocketClientLive, SocketRequestTimeoutError };
