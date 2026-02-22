/**
 * Wraps Effect Platform WebSocket with typed Kargadan envelope routing: correlates request/response pairs via Deferred-keyed pending map.
 * Event envelopes fan out to an unbounded Queue; decode failures log a warning and do not interrupt the connection.
 */
import * as Socket from '@effect/platform/Socket';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Data, Deferred, Duration, Effect, HashMap, Layer, Match, Option, Queue, Ref, Schema as S } from 'effect';
import { HarnessConfig } from './config';

// --- [ERRORS] ----------------------------------------------------------------

class SocketRequestTimeoutError extends Data.TaggedError('SocketRequestTimeout')<{
    readonly requestId: string;
}> {static readonly of = (requestId: string) => new SocketRequestTimeoutError({ requestId });}

// --- [SCHEMA] ----------------------------------------------------------------

const _decodeInbound = S.decodeUnknown(S.parseJson(Kargadan.InboundEnvelopeSchema));
const _encodeOutbound = S.encode(S.parseJson(Kargadan.OutboundEnvelopeSchema));
const _inboundDecoder = new TextDecoder();

// --- [SERVICES] --------------------------------------------------------------

class KargadanSocketClient extends Effect.Service<KargadanSocketClient>()('kargadan/SocketClient', {
    effect: Effect.gen(function* () {
        const socket = yield* Socket.Socket;
        const writer = yield* socket.writer;
        const pending = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<Kargadan.InboundEnvelope>>());
        const events = yield* Queue.unbounded<Kargadan.EventEnvelope>();
        const _writeEnvelope = (envelope: Kargadan.OutboundEnvelope) => _encodeOutbound(envelope).pipe(Effect.flatMap((json) => writer(json)),);
        const request = Effect.fn('kargadan.socket.request')((envelope: Kargadan.OutboundEnvelope) =>
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
        const start = Effect.fn('kargadan.socket.start')(() => socket.run(_dispatchChunk));
        const takeEvent = Effect.fn('kargadan.socket.takeEvent')(() => Queue.take(events));
        return {
            lifecycle: { start         },
            read:      { takeEvent     },
            write:     { request       },
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const KargadanSocketClientLive = Layer.unwrapEffect(
    HarnessConfig.resolveSocketUrl.pipe(
        Effect.map((socketUrl) => Layer.provide(
            KargadanSocketClient.Default,
            Layer.mergeAll(Socket.layerWebSocketConstructorGlobal, Socket.layerWebSocket(socketUrl)),
        )),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { KargadanSocketClient, KargadanSocketClientLive, SocketRequestTimeoutError };
