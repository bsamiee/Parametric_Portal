/**
 * WebSocket service: bidirectional real-time, rooms, cross-instance pub/sub.
 * Redis-backed presence, EventBus-driven message fan-out, schema-validated protocol.
 */
import type { Socket } from '@effect/platform';
import { Clock, Duration, Effect, HashMap, HashSet, Match, Metric, Option, Ref, Schedule, Schema as S, Stream } from 'effect';
import { CacheService } from './cache.ts';
import { Context } from '../context.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [ERRORS] ----------------------------------------------------------------

class WsError extends S.TaggedError<WsError>()('WsError', {
	cause: S.optional(S.Unknown),
	reason: S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message'),
	socketId: S.optional(S.String),
}) {
	static readonly _props = {
		invalid_message: { retryable: false, terminal: true },
		not_in_room: { retryable: false, terminal: false },
		room_limit: { retryable: false, terminal: false },
		send_failed: { retryable: true, terminal: false },
	} as const;
	static readonly from = (reason: WsError['reason'], socketId?: string, cause?: unknown) => new WsError({ cause, reason, socketId });
	static readonly toPayload = (error: unknown): { readonly _tag: 'error'; readonly reason: string } => ({ _tag: 'error', reason: error instanceof WsError ? error.reason : 'invalid_message' });
	get isRetryable(): boolean { return WsError._props[this.reason].retryable; }
	get isTerminal(): boolean { return WsError._props[this.reason].terminal; }
}

// --- [SCHEMA] ----------------------------------------------------------------

const _Config = { maxRoomsPerSocket: 10 } as const;
const _PresencePayload = S.Struct({ connectedAt: S.Number, userId: S.String });
const _InboundMsg = S.Union(
	S.Struct({ _tag: S.Literal('join'), roomId: S.String }),
	S.Struct({ _tag: S.Literal('leave'), roomId: S.String }),
	S.Struct({ _tag: S.Literal('send'), data: S.Unknown, roomId: S.String }),
	S.Struct({ _tag: S.Literal('ping') }),
	S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, targetSocketId: S.String }),
	S.Struct({ _tag: S.Literal('meta.set'), metadata: S.Record({ key: S.String, value: S.Unknown }) }),
	S.Struct({ _tag: S.Literal('meta.get') }),
);
const _OutboundMsg = S.Union(
	S.Struct({ _tag: S.Literal('pong') }),
	S.Struct({ _tag: S.Literal('error'), reason: S.String }),
	S.Struct({ _tag: S.Literal('room.message'), data: S.Unknown, roomId: S.String }),
	S.Struct({ _tag: S.Literal('direct.message'), data: S.Unknown, fromSocketId: S.String }),
	S.Struct({ _tag: S.Literal('meta.data'), metadata: S.Record({ key: S.String, value: S.Unknown }) }),
	S.Struct({ _tag: S.Literal('heartbeat'), serverTime: S.Number }),
);
const _encodeOutbound = S.encode(S.parseJson(_OutboundMsg));
const _decodeInbound = S.decodeUnknown(S.parseJson(_InboundMsg));

// --- [SERVICE] ---------------------------------------------------------------

class WebSocketService extends Effect.Service<WebSocketService>()('server/WebSocket', {
	dependencies: [CacheService.Default, EventBus.Default, MetricsService.Default],
		scoped: Effect.gen(function* () {
			const cache = yield* CacheService;
			const eventBus = yield* EventBus;
			const metrics = yield* MetricsService;
			const redis = cache._redis;
			const socketsRef = yield* Ref.make(HashMap.empty<string, { socket: Socket.Socket; rooms: Ref.Ref<HashSet.HashSet<string>>; tenantId: string; userId: string }>());
			const labels = MetricsService.label({ service: 'websocket' });
			const _eventLabels = (direction: 'error' | 'inbound' | 'outbound', messageType: string) => MetricsService.label({ direction, message_type: messageType, service: 'websocket' });
			const _trackRtcEvent = (direction: 'error' | 'inbound' | 'outbound', messageType: string) => Metric.increment(Metric.taggedWithLabels(metrics.rtc.events, _eventLabels(direction, messageType)));
			const _presence = {
			getAll: (tenantId: string) =>
				Effect.tryPromise(() => redis.hgetall(`presence:${tenantId}`)).pipe(
					Effect.flatMap((data) => Effect.forEach(Object.entries(data), ([socketId, json]) =>
						S.decode(S.parseJson(_PresencePayload))(json).pipe(Effect.map((payload) => ({ socketId, ...payload })), Effect.option),
						{ concurrency: 'unbounded' })),
					Effect.map((items) => items.flatMap(Option.toArray)),
					Effect.orElseSucceed(() => []),
				),
			refresh: (tenantId: string) => Effect.tryPromise(() => redis.expire(`presence:${tenantId}`, 120)).pipe(Effect.ignore),
			remove: (tenantId: string, socketId: string) => Effect.tryPromise(() => redis.hdel(`presence:${tenantId}`, socketId)).pipe(Effect.ignore),
			set: (tenantId: string, socketId: string, data: { userId: string; connectedAt: number }) =>
				Effect.tryPromise(() => redis.multi()
					.hset(`presence:${tenantId}`, socketId, JSON.stringify(data))
					.expire(`presence:${tenantId}`, 120)
					.exec()).pipe(Effect.ignore),
		} as const;
			const _emit = (tenantId: string, action: string, extra?: { data?: unknown; fromSocketId?: string; roomId?: string; targetSocketId?: string; userId?: string }) =>
				Context.Request.withinSync(tenantId, eventBus.publish({
					aggregateId: extra?.roomId ? `${tenantId}:${extra.roomId}` : tenantId,
					payload: { _tag: 'ws' as const, action, ...extra },
					tenantId,
				}));
			const _roomKey = (tenantId: string, roomId: string) => `room:${tenantId}:${roomId}`;
			const _metaKey = (socketId: string) => `ws:meta:${socketId}`;
			const _deliverLocal = (tenantId: string, roomId: string, data: unknown) => Telemetry.span(
				Effect.gen(function* () {
					const memberIds = yield* cache.sets.members(_roomKey(tenantId, roomId));
					const sockets = yield* Ref.get(socketsRef);
					const encoded = yield* _encodeOutbound({ _tag: 'room.message', data, roomId });
					yield* _trackRtcEvent('outbound', 'room.message');
					yield* Effect.forEach(memberIds, (socketId) =>
						Option.match(HashMap.get(sockets, socketId), {
							onNone: () => Effect.void,
							onSome: (entry) => entry.socket.writer.pipe(Effect.flatMap((writer) => writer(encoded)), Effect.ignore),
						}),
						{ concurrency: 'unbounded', discard: true },
					);
				}),
				'websocket.deliverLocal',
				{ metrics: false, 'websocket.room_id': roomId },
			);
			const _deliverDirect = (targetSocketId: string, data: unknown, fromSocketId: string) =>
				Telemetry.span(
					Ref.get(socketsRef).pipe(
						Effect.flatMap((sockets) => Option.match(HashMap.get(sockets, targetSocketId), {
							onNone: () => Effect.void,
							onSome: (entry) => _encodeOutbound({ _tag: 'direct.message', data, fromSocketId }).pipe(
								Effect.tap(() => _trackRtcEvent('outbound', 'direct.message')),
								Effect.flatMap((encoded) => entry.socket.writer.pipe(Effect.flatMap((writer) => writer(encoded)))),
								Effect.ignore,
							),
						})),
					),
					'websocket.deliverDirect',
					{ metrics: false, 'websocket.from_socket_id': fromSocketId, 'websocket.target_socket_id': targetSocketId },
				);
		yield* Effect.forkScoped(
			eventBus.subscribe(
				'ws.room.message',
				S.Struct({ data: S.Unknown, roomId: S.String }),
				(event, payload) => Effect.scoped(_deliverLocal(event.tenantId, payload.roomId, payload.data)).pipe(Effect.ignore),
			).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain),
		);
		yield* Effect.forkScoped(
			eventBus.subscribe(
				'ws.direct.message',
				S.Struct({ data: S.Unknown, fromSocketId: S.String, targetSocketId: S.String }),
				(_event, payload) => Effect.scoped(_deliverDirect(payload.targetSocketId, payload.data, payload.fromSocketId)).pipe(Effect.ignore),
			).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain),
		);
		yield* Effect.forkScoped(
			Effect.repeat(
				Effect.gen(function* () {
					const sockets = yield* Ref.get(socketsRef);
					const serverTime = yield* Clock.currentTimeMillis;
					const encoded = yield* _encodeOutbound({ _tag: 'heartbeat', serverTime });
					yield* Effect.forEach(HashMap.values(sockets), (entry) =>
						entry.socket.writer.pipe(Effect.flatMap((writer) => writer(encoded)), Effect.ignore),
						{ concurrency: 'unbounded', discard: true },
					);
				}),
				Schedule.spaced(Duration.seconds(30)),
			).pipe(Effect.ignore),
		);
			const accept = (socket: Socket.Socket, userId: string, tenantId: string) => Telemetry.span(
				Effect.gen(function* () {
				const socketId: string = crypto.randomUUID();
				const roomsRef = yield* Ref.make(HashSet.empty<string>());
				yield* Effect.all([
					Ref.update(socketsRef, HashMap.set(socketId, { rooms: roomsRef, socket, tenantId, userId })),
					MetricsService.gauge(metrics.stream.active, labels, 1),
					Metric.increment(Metric.taggedWithLabels(metrics.rtc.connections, labels)),
				_presence.set(tenantId, socketId, { connectedAt: yield* Clock.currentTimeMillis, userId }),
				_emit(tenantId, 'presence.online', { userId }),
			], { discard: true });
			yield* Effect.addFinalizer(() => Effect.gen(function* () {
				yield* Ref.update(socketsRef, HashMap.remove(socketId));
				yield* MetricsService.gauge(metrics.stream.active, labels, -1);
				const rooms = yield* Ref.get(roomsRef);
				yield* Effect.forEach(HashSet.toValues(rooms), (roomId) => cache.sets.remove(_roomKey(tenantId, roomId), socketId), { discard: true });
				yield* _presence.remove(tenantId, socketId).pipe(Effect.ignore);
				yield* cache.kv.del(_metaKey(socketId));
				yield* _emit(tenantId, 'presence.offline', { userId }).pipe(Effect.ignore);
			}));
				const write = yield* socket.writer;
				const sendOutbound = (payload: typeof _OutboundMsg.Type) =>
					_encodeOutbound(payload).pipe(
						Effect.tap(() => _trackRtcEvent('outbound', payload._tag)),
						Effect.flatMap(write),
						Effect.mapError((error) => WsError.from('send_failed', socketId, error)),
					);
			const ensureRoom = (roomId: string) => Ref.get(roomsRef).pipe(Effect.filterOrFail((rooms) => HashSet.has(rooms, roomId), () => WsError.from('not_in_room', socketId)), Effect.asVoid);
			const decode = (data: string | Uint8Array) => _decodeInbound(typeof data === 'string' ? data : new TextDecoder().decode(data)).pipe(Effect.mapError((error) => WsError.from('invalid_message', socketId, error)));
			const joinRoom = (roomId: string) =>
				Ref.get(roomsRef).pipe(
					Effect.flatMap((rooms) => Match.value({ alreadyIn: HashSet.has(rooms, roomId), atLimit: HashSet.size(rooms) >= _Config.maxRoomsPerSocket }).pipe(
						Match.when({ alreadyIn: true }, () => Effect.void),
						Match.when({ atLimit: true }, () => Effect.fail(WsError.from('room_limit', socketId))),
						Match.orElse(() => Effect.all([
							Ref.update(roomsRef, HashSet.add(roomId)),
							cache.sets.add(_roomKey(tenantId, roomId), socketId),
						], { discard: true })),
					)),
				);
			const leaveRoom = (roomId: string) =>
				Effect.all([
					Ref.update(roomsRef, HashSet.remove(roomId)),
					cache.sets.remove(_roomKey(tenantId, roomId), socketId),
				], { discard: true });
				const handle = (msg: typeof _InboundMsg.Type) =>
					_trackRtcEvent('inbound', msg._tag).pipe(
						Effect.andThen(Match.value(msg).pipe(
							Match.tag('join', (message) => joinRoom(message.roomId)),
							Match.tag('leave', (message) => leaveRoom(message.roomId)),
							Match.tag('send', (message) => ensureRoom(message.roomId).pipe(Effect.andThen(send({ _tag: 'room', roomId: message.roomId }, message.data, tenantId)))),
							Match.tag('ping', () => _presence.refresh(tenantId).pipe(Effect.andThen(sendOutbound({ _tag: 'pong' }).pipe(Effect.ignore)))),
							Match.tag('direct', (message) => send({ _tag: 'direct', socketId: message.targetSocketId }, message.data, tenantId, socketId)),
							Match.tag('meta.set', (message) => cache.kv.set(_metaKey(socketId), message.metadata, Duration.hours(2))),
							Match.tag('meta.get', () => cache.kv.get(_metaKey(socketId), S.Record({ key: S.String, value: S.Unknown })).pipe(
								Effect.flatMap(Option.match({
									onNone: () => sendOutbound({ _tag: 'meta.data', metadata: {} }).pipe(Effect.ignore),
									onSome: (metadata) => sendOutbound({ _tag: 'meta.data', metadata }).pipe(Effect.ignore),
							})),
						)),
							Match.exhaustive,
						)),
					);
				return yield* socket.runRaw((data) => Telemetry.span(
					decode(data).pipe(
						Effect.flatMap(handle),
						Effect.tapError(() => _trackRtcEvent('error', 'dispatch')),
						Effect.catchAll((error) => sendOutbound(WsError.toPayload(error)).pipe(Effect.ignore)),
					),
					'websocket.readDispatch',
					{ metrics: false, 'websocket.socket_id': socketId },
				));
				}),
				'websocket.accept',
				{ metrics: false, 'websocket.tenant_id': tenantId, 'websocket.user_id': userId },
			);
			const send = (target: WebSocketService.Target, data: unknown, tenantId: string, fromSocketId = 'server') => Telemetry.span(Match.value(target).pipe(
				Match.when({ _tag: 'room' }, ({ roomId }) => _emit(tenantId, 'room.message', { data, roomId })),
				Match.when({ _tag: 'direct' }, ({ socketId }) => _emit(tenantId, 'direct.message', { data, fromSocketId, targetSocketId: socketId })),
				Match.when({ _tag: 'broadcast' }, () => Ref.get(socketsRef).pipe(
					Effect.flatMap((sockets) => _encodeOutbound({ _tag: 'room.message', data, roomId: '__broadcast__' }).pipe(
						Effect.tap(() => _trackRtcEvent('outbound', 'room.message')),
						Effect.flatMap((encoded) => Effect.forEach(HashMap.values(sockets), (entry) =>
							entry.socket.writer.pipe(Effect.flatMap((writer) => writer(encoded)), Effect.ignore),
							{ concurrency: 'unbounded', discard: true },
						)),
					)),
				)),
				Match.exhaustive,
			), 'websocket.send', { metrics: false, 'websocket.target': target._tag });
		yield* Effect.logInfo('WebSocketService initialized');
		return {
			accept,
			presence: {
				getAll: (tenantId: string) => _presence.getAll(tenantId),
				roomMembers: (tenantId: string, roomId: string) => cache.sets.members(_roomKey(tenantId, roomId)),
			},
			send,
		};
	}),
}) {
	static readonly Config = _Config;
	static readonly PresencePayload = _PresencePayload;
	static readonly ErrorReason = S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message');
	static readonly InboundMsg = _InboundMsg;
	static readonly OutboundMsg = _OutboundMsg;
	static readonly encodeOutbound = _encodeOutbound;
	static readonly decodeInbound = _decodeInbound;
	static readonly Error = WsError;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebSocketService {
	export type Error = InstanceType<typeof WebSocketService.Error>;
	export type ErrorReason = Error['reason'];
	export type Message = typeof WebSocketService.InboundMsg.Type;
	export type Target =
		| { readonly _tag: 'room'; readonly roomId: string }
		| { readonly _tag: 'direct'; readonly socketId: string }
		| { readonly _tag: 'broadcast' };
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebSocketService };
