/** WebSocket service: rooms, presence, cross-instance pub/sub, Machine lifecycle. */
import type { Socket } from '@effect/platform';
import { Machine } from '@effect/experimental';
import { Array as Arr, Clock, Duration, Effect, Match, Metric, Number as N, Option, Request, Schedule, Schema as S, STM, TMap } from 'effect';
import { apply, constant, flow } from 'effect/Function';
import { CacheService } from './cache.ts';
import { Env } from '../env.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _MODEL = { broadcastRoomId: '__broadcast__', key: { meta: (socketId: string) => `ws:meta:${socketId}`, room: (tenantId: string, roomId: string) => `room:${tenantId}:${roomId}` }, lifecycle: { active: 'active', disconnecting: 'disconnecting' }, metaTtl: Duration.hours(2), roomTtl: Duration.minutes(10) } as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _COMMAND = S.Union(
    S.Struct({ _tag: S.Literal('join'), roomId: S.String }),
    S.Struct({ _tag: S.Literal('leave'), roomId: S.String }),
    S.Struct({ _tag: S.Literal('send'), data: S.Unknown, roomId: S.String }),
    S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, targetSocketId: S.String }),
    S.Struct({ _tag: S.Literal('meta.set'), metadata: S.Record({ key: S.String, value: S.Unknown }) }),
);
const _SCHEMA = {
    Command: _COMMAND,
    InboundMsg: S.Union(
        _COMMAND,
        S.Struct({ _tag: S.Literal('pong') }),
        S.Struct({ _tag: S.Literal('meta.get') })),
    OutboundMsg: S.Union(
        S.Struct({ _tag: S.Literal('error'), reason: S.String }),
        S.Struct({ _tag: S.Literal('ping'), serverTime: S.Number }),
        S.Struct({ _tag: S.Literal('room.message'), data: S.Unknown, roomId: S.String }),
        S.Struct({ _tag: S.Literal('direct.message'), data: S.Unknown, fromSocketId: S.String }),
        S.Struct({ _tag: S.Literal('meta.data'), metadata: S.Record({ key: S.String, value: S.Unknown }) })),
    PresencePayload: S.Struct({ connectedAt: S.Number, userId: S.String }),
    Signal: S.Union(
        S.Struct({ _tag: S.Literal('pong') }),
        S.Struct({ _tag: S.Literal('disconnect') })),
    TransportEnvelope: S.Union(
        S.Struct({ _tag: S.Literal('room'), data: S.Unknown, nodeId: S.String, roomId: S.String, tenantId: S.String }),
        S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, fromSocketId: S.String, nodeId: S.String, targetSocketId: S.String, tenantId: S.String }),
        S.Struct({ _tag: S.Literal('broadcast'), data: S.Unknown, nodeId: S.String, tenantId: S.String }),
    ),
} as const;
const _CODEC = {
    inbound:    { decode: S.decodeUnknown(S.parseJson(_SCHEMA.InboundMsg)) },
    outbound:   { encode: S.encode(S.parseJson(_SCHEMA.OutboundMsg)) },
    transport:  { decode: S.decodeUnknown(S.parseJson(_SCHEMA.TransportEnvelope)),encode: S.encode(S.parseJson(_SCHEMA.TransportEnvelope)) }
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class WsError extends S.TaggedError<WsError>()('WsError', {
    cause: S.optional(S.Unknown),
    reason: S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'disconnecting'),
    socketId: S.optional(S.String),
}) {
    static readonly _props = { disconnecting: { retryable: false, terminal: true }, invalid_message: { retryable: false, terminal: true }, not_in_room: { retryable: false, terminal: false }, room_limit: { retryable: false, terminal: false }, send_failed: { retryable: true, terminal: false } } as const;
    static readonly from = (reason: WsError['reason'], socketId?: string, cause?: unknown) => new WsError({ cause, reason, socketId });
    static readonly mapper = (reason: WsError['reason'], socketId?: string) => (cause: unknown) => new WsError({ cause, reason, socketId });
    static readonly toPayload = (error: unknown): { readonly _tag: 'error'; readonly reason: string } => ({ _tag: 'error', reason: error instanceof WsError ? error.reason : 'invalid_message' });
    get isRetryable(): boolean { return WsError._props[this.reason].retryable; }
    get isTerminal(): boolean { return WsError._props[this.reason].terminal; }
}
class CommandRequest extends Request.TaggedClass('Command')<void, WsError, { readonly command: typeof _SCHEMA.Command.Type }> {}
class SignalRequest extends Request.TaggedClass('Signal')<void, never, { readonly signal: typeof _SCHEMA.Signal.Type }> {}

// --- [SERVICES] --------------------------------------------------------------

class WebSocketService extends Effect.Service<WebSocketService>()('server/WebSocket', {
    dependencies: [CacheService.Default, MetricsService.Default],
    scoped: Effect.gen(function* () {
        const cache = yield* CacheService;
        const metrics = yield* MetricsService;
        const env = yield* Env.Service;
        const tuning = env.websocket;
        const socketRegistry = yield* STM.commit(TMap.empty<string, {
            readonly actor: Machine.Actor<Machine.Machine.Any>;
            readonly lastPong: number;
            readonly phase: typeof _MODEL.lifecycle[keyof typeof _MODEL.lifecycle];
            readonly rooms: ReadonlyArray<string>;
            readonly socket: Socket.Socket;
            readonly tenantId: string;
            readonly userId: string;
        }>());
        type _SocketRegistryEntry = typeof socketRegistry extends TMap.TMap<string, infer Entry> ? Entry : never;
        const nodeId = crypto.randomUUID();
        const broadcastSubscriber = yield* Effect.acquireRelease(
            cache.pubsub.duplicate,
            (connection) => Effect.sync(() => connection.unsubscribe()).pipe(Effect.andThen(Effect.promise(() => connection.quit()))),
        );
        const labels = MetricsService.label({ service: 'websocket' });
        const _trackRtcEvent = (direction: 'error' | 'inbound' | 'outbound', messageType: string) => Metric.increment(Metric.taggedWithLabels(metrics.rtc.events, MetricsService.label({ direction, message_type: messageType, service: 'websocket' })));
        const _reg = {
            addRoom:    (socketId: string, roomId: string) => _reg.update(socketId, (entry) => ({ ...entry, rooms: [...entry.rooms, roomId] })),
            entries:    () => STM.commit(TMap.toArray(socketRegistry)),
            get:        (socketId: string) => STM.commit(TMap.get(socketRegistry, socketId)),
            modify:     (socketId: string, partial: Partial<_SocketRegistryEntry>) => _reg.update(socketId, (entry) => ({ ...entry, ...partial })),
            remove:     (socketId: string) => STM.commit(TMap.remove(socketRegistry, socketId)),
            removeRoom: (socketId: string, roomId: string) => _reg.update(socketId, (entry) => ({ ...entry, rooms: Arr.filter(entry.rooms, (id) => id !== roomId) })),
            set:        (socketId: string, entry: _SocketRegistryEntry) => STM.commit(TMap.set(socketRegistry, socketId, entry)),
            update:     (socketId: string, updateFn: (entry: _SocketRegistryEntry) => _SocketRegistryEntry) => STM.commit(TMap.get(socketRegistry, socketId).pipe(STM.flatMap(Option.match({ onNone: () => STM.void, onSome: (entry) => TMap.set(socketRegistry, socketId, updateFn(entry)) })))),
            values:     () => STM.commit(TMap.values(socketRegistry)),
        } as const;
        const _roomsFor =  (socketId: string) => _reg.get(socketId).pipe(Effect.map(Option.match({ onNone: () => [] as ReadonlyArray<string>, onSome: (entry) => entry.rooms })));
        const _touchRoom = (tenantId: string, roomId: string) => cache.sets.touch(_MODEL.key.room(tenantId, roomId), _MODEL.roomTtl);
        const _fanout =    (entries: ReadonlyArray<_SocketRegistryEntry>, payload: typeof _SCHEMA.OutboundMsg.Type, messageType?: string) => Effect.gen(function* () {
            const encoded = yield* _CODEC.outbound.encode(payload);
            yield* Option.fromNullable(messageType).pipe(
                Option.map(_trackRtcEvent.bind(null, 'outbound')),
                Option.getOrElse(constant(Effect.void)),
            );
            yield* Effect.forEach(
                entries,
                (entry) => entry.socket.writer.pipe(Effect.map(apply(encoded)), Effect.flatten, Effect.ignore),
                { concurrency: 'unbounded', discard: true },
            );
        });
        const _disconnectCleanup = (socketId: string, tenantId: string, rooms: ReadonlyArray<string>) => _reg.get(socketId).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.void,
                onSome: () => Effect.all([
                    _reg.remove(socketId), MetricsService.gauge(metrics.stream.active, labels, -1),
                    Effect.forEach(rooms, (roomId) => cache.sets.remove(_MODEL.key.room(tenantId, roomId), socketId), { discard: true }),
                    CacheService.presence.remove(tenantId, socketId), cache.kv.del(_MODEL.key.meta(socketId)),
                ], { discard: true }),
            })),
        );
        const _cleanupForSocket = (socketId: string, tenantId: string) => _roomsFor(socketId).pipe(Effect.flatMap((rooms) => _disconnectCleanup(socketId, tenantId, rooms)));
        const _publishTransport = (envelope: typeof _SCHEMA.TransportEnvelope.Type) => _CODEC.transport.encode(envelope).pipe(
            Effect.andThen((encoded) => cache.pubsub.publish(tuning.broadcastChannel, encoded)),
            Effect.ignore,
        );
        const _pingUpdate = (socketId: string) => Clock.currentTimeMillis.pipe(Effect.flatMap((now) => _reg.modify(socketId, { lastPong: now, phase: _MODEL.lifecycle.active })));
        const _entriesFor = (socketIds: ReadonlyArray<string>) => Effect.forEach(socketIds, (socketId) => _reg.get(socketId).pipe(Effect.map(Option.toArray)), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
        const _deliverLocal = (tenantId: string, roomId: string, data: unknown) => Telemetry.span(
            Effect.gen(function* () {
                const roomKey = _MODEL.key.room(tenantId, roomId);
                const [socketIds, presence] = yield* Effect.all([
                    cache.sets.members(roomKey),
                    CacheService.presence.getAll(tenantId).pipe(Effect.provideService(CacheService, cache)),
                ], { concurrency: 'unbounded' });
                const activeSocketIds = new Set(presence.map((entry) => entry.socketId));
                const staleSocketIds = socketIds.filter((socketId) => !activeSocketIds.has(socketId));
                const liveSocketIds = socketIds.filter((socketId) => activeSocketIds.has(socketId));
                yield* Effect.when(
                    cache.sets.remove(roomKey, ...staleSocketIds).pipe(
                        Effect.andThen(Effect.logDebug('Pruned stale room members', { roomId, stale: staleSocketIds.length, tenantId })),
                    ),
                    () => staleSocketIds.length > 0,
                );
                const entries = yield* _entriesFor(liveSocketIds);
                yield* _fanout(entries, { _tag: 'room.message', data, roomId }, 'room.message');
            }),
            'websocket.deliverLocal', { metrics: false, 'websocket.room_id': roomId },
        );
        const _deliverDirect = (tenantId: string, targetSocketId: string, data: unknown, fromSocketId: string) => Telemetry.span(
            _reg.get(targetSocketId).pipe(Effect.flatMap(Option.match({
                onNone: () => Effect.void,
                onSome: (entry) => entry.tenantId === tenantId
                    ? _fanout([entry], { _tag: 'direct.message', data, fromSocketId }, 'direct.message')
                    : Effect.logWarning('Cross-tenant direct message blocked', { fromSocketId, targetSocketId, tenantId }),
            }))),
            'websocket.deliverDirect', { metrics: false, 'websocket.from_socket_id': fromSocketId, 'websocket.target_socket_id': targetSocketId },
        );
        const _deliverBroadcastLocal = (tenantId: string, data: unknown) => Telemetry.span(
            _reg.values().pipe(
                Effect.map((entries) => entries.filter((entry) => entry.tenantId === tenantId)),
                Effect.flatMap((entries) => _fanout(entries, { _tag: 'room.message', data, roomId: _MODEL.broadcastRoomId }, 'room.message')),
            ),
            'websocket.deliverBroadcastLocal', { metrics: false },
        );
        const _deliverTransport = (envelope: typeof _SCHEMA.TransportEnvelope.Type) => Match.value(envelope).pipe(
            Match.tag('room', ({ data, roomId, tenantId }) => _deliverLocal(tenantId, roomId, data)),
            Match.tag('direct', ({ data, fromSocketId, targetSocketId, tenantId }) => _deliverDirect(tenantId, targetSocketId, data, fromSocketId)),
            Match.tag('broadcast', ({ data, tenantId }) => _deliverBroadcastLocal(tenantId, data)),
            Match.exhaustive,
        );
        yield* cache.pubsub.subscribe(broadcastSubscriber, tuning.broadcastChannel).pipe(
            Effect.retry(Resilience.schedule('default')),
            Effect.catchAll((error) => Effect.logWarning('WebSocket broadcast pub/sub unavailable', { error: String(error) })),
        );
        broadcastSubscriber.on('message', (channel, raw) => channel === tuning.broadcastChannel && Effect.runFork(
            _CODEC.transport.decode(raw).pipe(
                Effect.flatMap((envelope) => envelope.nodeId === nodeId ? Effect.void : Effect.scoped(_deliverTransport(envelope))),
                Effect.catchAll((error) => Effect.logWarning('Malformed broadcast message', { error: String(error) })),
            ),
        ));
        yield* Effect.forkScoped(Effect.repeat(
            _reg.values().pipe(Effect.flatMap((entries) => Clock.currentTimeMillis.pipe(Effect.flatMap((serverTime) => _fanout(entries, { _tag: 'ping', serverTime }, 'ping'))))),
            Schedule.spaced(Duration.millis(tuning.pingIntervalMs)),
        ).pipe(Effect.ignore));
        yield* Effect.forkScoped(Effect.repeat(
            Effect.all([Clock.currentTimeMillis, _reg.entries()]).pipe(
                Effect.flatMap(([now, entries]) => Effect.forEach(entries, ([socketId, entry]) =>
                    Effect.all([
                        Effect.logWarning('Reaping stale WebSocket connection', { socketId, tenantId: entry.tenantId, userId: entry.userId }),
                        entry.actor.send(new SignalRequest({ signal: { _tag: 'disconnect' } })).pipe(Effect.ignore),
                        _reg.modify(socketId, { phase: _MODEL.lifecycle.disconnecting }),
                        _disconnectCleanup(socketId, entry.tenantId, entry.rooms),
                        _trackRtcEvent('outbound', 'connection.reaped'),
                    ], { discard: true }).pipe(Effect.when(() => now - entry.lastPong > tuning.pongTimeoutMs), Effect.asVoid),
                    { concurrency: 'unbounded', discard: true },
                )),
            ),
            Schedule.spaced(Duration.millis(tuning.reaperIntervalMs)),
        ).pipe(Effect.ignore));
        const _connectionMachine = Machine.makeWith<typeof _MODEL.lifecycle[keyof typeof _MODEL.lifecycle], { readonly socketId: string; readonly tenantId: string; readonly userId: string }>()(
            (input) => {
                const _joinRoom = (roomId: string) => Effect.gen(function* () {
                    const rooms = yield* _roomsFor(input.socketId);
                    yield* Effect.unless(
                        Effect.filterOrFail(
                            Effect.succeed(rooms),
                            flow(Arr.length, N.lessThan(tuning.maxRoomsPerSocket)),
                            constant(WsError.from('room_limit', input.socketId)),
                        ).pipe(
                            Effect.andThen(Effect.all([_reg.addRoom(input.socketId, roomId), cache.sets.add(_MODEL.key.room(input.tenantId, roomId), input.socketId)], { discard: true })),
                            Effect.asVoid,
                        ),
                        constant(Arr.contains(roomId)(rooms)),
                    );
                });
                return Effect.succeed(
                    Machine.procedures.make<typeof _MODEL.lifecycle[keyof typeof _MODEL.lifecycle]>(_MODEL.lifecycle.active, { identifier: `ws:${input.socketId}` }).pipe(
                        Machine.procedures.add<SignalRequest>()('Signal', (context) => Match.valueTags(context.request.signal, {
                            disconnect: () => Effect.succeed([Machine.NoReply, _MODEL.lifecycle.disconnecting] as const),
                            pong: () => _pingUpdate(input.socketId).pipe(
                                Effect.andThen(_roomsFor(input.socketId)),
                                Effect.flatMap(Effect.forEach(_touchRoom.bind(null, input.tenantId), { discard: true })),
                                Effect.andThen(CacheService.presence.refresh(input.tenantId)),
                                Effect.as([Machine.NoReply, context.state] as const),
                            ),
                        })),
                        Machine.procedures.add<CommandRequest>()('Command', (context) => Match.value(context.state).pipe(
                            Match.when(_MODEL.lifecycle.disconnecting, constant(Effect.fail(WsError.from('disconnecting', input.socketId)))),
                            Match.orElse(constant(Match.value(context.request.command).pipe(
                                Match.tag('join', ({ roomId }) => _joinRoom(roomId).pipe(Effect.andThen(_touchRoom(input.tenantId, roomId)))),
                                Match.tag('leave', ({ roomId }) => Effect.all([
                                    _reg.removeRoom(input.socketId, roomId),
                                    cache.sets.remove(_MODEL.key.room(input.tenantId, roomId), input.socketId),
                                ], { discard: true })),
                                Match.tag('send', ({ data, roomId }) => _roomsFor(input.socketId).pipe(
                                    Effect.filterOrFail(Arr.contains(roomId), constant(WsError.from('not_in_room', input.socketId))),
                                    Effect.andThen(_send({ _tag: 'room', roomId }, data, input.tenantId)),
                                    Effect.andThen(_touchRoom(input.tenantId, roomId)),
                                    Effect.ignore,
                                )),
                                Match.tag('direct', ({ data, targetSocketId }) => _send({ _tag: 'direct', socketId: targetSocketId }, data, input.tenantId, input.socketId).pipe(Effect.ignore)),
                                Match.tag('meta.set', ({ metadata }) => cache.kv.set(_MODEL.key.meta(input.socketId), metadata, _MODEL.metaTtl)),
                                Match.exhaustive,
                                Effect.as([undefined, context.state] as const),
                            ))),
                        )),
                    ),
                );
            },
        );
        const accept = (socket: Socket.Socket, userId: string, tenantId: string) => Telemetry.span(
            Effect.gen(function* () {
                const socketId = crypto.randomUUID();
                const connectedAt = yield* Clock.currentTimeMillis;
                const actor = yield* Machine.boot(_connectionMachine, { socketId, tenantId, userId });
                yield* _reg.set(socketId, { actor, lastPong: connectedAt, phase: _MODEL.lifecycle.active, rooms: [], socket, tenantId, userId });
                yield* Effect.all([
                    MetricsService.gauge(metrics.stream.active, labels, 1),
                    Metric.increment(Metric.taggedWithLabels(metrics.rtc.connections, labels)),
                    CacheService.presence.set(tenantId, socketId, { connectedAt, userId }),
                ], { discard: true });
                yield* Effect.addFinalizer(constant(_cleanupForSocket(socketId, tenantId)));
                const write = yield* socket.writer;
                const sendOutbound = (payload: typeof _SCHEMA.OutboundMsg.Type) => _CODEC.outbound.encode(payload).pipe(
                    Effect.tap(_trackRtcEvent('outbound', payload._tag)),
                    Effect.flatMap(write),
                    Effect.mapError(WsError.mapper('send_failed', socketId)),
                );
                const decode = (data: string | Uint8Array) => _CODEC.inbound.decode(typeof data === 'string' ? data : new TextDecoder().decode(data)).pipe(Effect.mapError(WsError.mapper('invalid_message', socketId)));
                const _metaPayload = (metadata: Record<string, unknown>): typeof _SCHEMA.OutboundMsg.Type => ({ _tag: 'meta.data', metadata });
                const _dispatch = {
                    direct: (message: { data: unknown; targetSocketId: string }) => actor.send(new CommandRequest({ command: { _tag: 'direct', data: message.data, targetSocketId: message.targetSocketId } })),
                    join: (message: { roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'join', roomId: message.roomId } })),
                    leave: (message: { roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'leave', roomId: message.roomId } })),
                    'meta.get': constant(cache.kv.get(_MODEL.key.meta(socketId), S.Record({ key: S.String, value: S.Unknown })).pipe(Effect.map(Option.getOrElse(() => ({}))), Effect.map(_metaPayload), Effect.flatMap(sendOutbound), Effect.ignore)),
                    'meta.set': (message: { metadata: Record<string, unknown> }) => actor.send(new CommandRequest({ command: { _tag: 'meta.set', metadata: message.metadata } })),
                    pong: constant(actor.send(new SignalRequest({ signal: { _tag: 'pong' } })).pipe(Effect.ignore)),
                    send: (message: { data: unknown; roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'send', data: message.data, roomId: message.roomId } })),
                };
                const handle = (msg: typeof _SCHEMA.InboundMsg.Type) => _trackRtcEvent('inbound', msg._tag).pipe(Effect.andThen(Match.valueTags(msg, _dispatch)));
                return yield* socket.runRaw((data) => Telemetry.span(
                    decode(data).pipe(
                        Effect.flatMap(handle),
                        Effect.tapError(constant(_trackRtcEvent('error', 'dispatch'))),
                        Effect.catchAll(flow(WsError.toPayload, sendOutbound, Effect.ignore)),
                    ),
                    'websocket.readDispatch',
                    { metrics: false, 'websocket.socket_id': socketId },
                ));
            }),
            'websocket.accept',
            { metrics: false, 'websocket.tenant_id': tenantId, 'websocket.user_id': userId },
        );
        const _send = (
            target:
                | { readonly _tag: 'room'; readonly roomId: string }
                | { readonly _tag: 'direct'; readonly socketId: string }
                | { readonly _tag: 'broadcast' },
            data: unknown,
            tenantId: string,
            fromSocketId = 'server',
        ) => Telemetry.span(Match.value(target).pipe(
            Match.when({ _tag: 'room' }, ({ roomId }) => Effect.all([
                _deliverLocal(tenantId, roomId, data),
                _publishTransport({ _tag: 'room', data, nodeId, roomId, tenantId }),
            ], { discard: true })),
            Match.when({ _tag: 'direct' }, ({ socketId }) => Effect.all([
                _deliverDirect(tenantId, socketId, data, fromSocketId),
                _publishTransport({ _tag: 'direct', data, fromSocketId, nodeId, targetSocketId: socketId, tenantId }),
            ], { discard: true })),
            Match.when({ _tag: 'broadcast' }, () => Effect.all([
                _deliverBroadcastLocal(tenantId, data),
                _publishTransport({ _tag: 'broadcast', data, nodeId, tenantId }),
            ], { discard: true })),
            Match.exhaustive,
        ), 'websocket.send', { metrics: false, 'websocket.target': target._tag });
        yield* Effect.logInfo('WebSocketService initialized');
        return {
            accept,
            presence: {
                getAll: (tenantId: string) => CacheService.presence.getAll(tenantId),
                roomMembers: (tenantId: string, roomId: string) => cache.sets.members(_MODEL.key.room(tenantId, roomId)),
            },
        };
        }),
    }) {
    static readonly PresencePayload = _SCHEMA.PresencePayload;
    static readonly ErrorReason = S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'disconnecting');
    static readonly InboundMsg = _SCHEMA.InboundMsg;
    static readonly OutboundMsg = _SCHEMA.OutboundMsg;
    static readonly Command = _SCHEMA.Command;
    static readonly Signal = _SCHEMA.Signal;
    static readonly TransportEnvelope = _SCHEMA.TransportEnvelope;
    static readonly encodeOutbound = _CODEC.outbound.encode;
    static readonly decodeInbound = _CODEC.inbound.decode;
    static readonly encodeTransport = _CODEC.transport.encode;
    static readonly decodeTransport = _CODEC.transport.decode;
    static readonly keys = _MODEL.key;
    static readonly Error = WsError;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebSocketService {
    export type Error = InstanceType<typeof WebSocketService.Error>;
    export type ErrorReason = Error['reason'];
    export type Message = typeof WebSocketService.InboundMsg.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebSocketService };
