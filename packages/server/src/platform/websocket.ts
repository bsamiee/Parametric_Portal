/**
 * WebSocket service: bidirectional real-time, rooms, cross-instance pub/sub.
 * Redis-backed presence, EventBus-driven message fan-out, schema-validated protocol.
 */
import type { Socket } from '@effect/platform';
import { Array as A, Effect, HashMap, HashSet, Match, Option, Ref, Schema as S, Stream } from 'effect';
import { CacheService } from './cache.ts';
import { Context } from '../context.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	msg: S.Union(
		S.Struct({ _tag: S.Literal('join'), roomId: S.String }),
		S.Struct({ _tag: S.Literal('leave'), roomId: S.String }),
		S.Struct({ _tag: S.Literal('send'), data: S.Unknown, roomId: S.String }),
		S.Struct({ _tag: S.Literal('ping') }),
	),
	payload: S.Struct({ _tag: S.Literal('ws'), action: S.String, data: S.optional(S.Unknown), roomId: S.optional(S.String), userId: S.optional(S.String) }),
	state: S.Struct({ rooms: S.Array(S.String), socketId: S.String, tenantId: S.String, userId: S.String }),
} as const;

// --- [ERRORS] ----------------------------------------------------------------

const _WsErrorReason = S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message');
const _ErrorProps = {
	invalid_message: { retryable: false, terminal: true },
	not_in_room: { retryable: false, terminal: false },
	room_limit: { retryable: false, terminal: false },
	send_failed: { retryable: true, terminal: false },
} as const satisfies Record<typeof _WsErrorReason.Type, { retryable: boolean; terminal: boolean }>;
class WsError extends S.TaggedError<WsError>()('WsError', {
	cause: S.optional(S.Unknown),
	reason: _WsErrorReason,
	socketId: S.optional(S.String),
}) {
	static readonly from = (reason: typeof _WsErrorReason.Type, socketId?: string, cause?: unknown) => new WsError({ cause, reason, socketId });
	get isRetryable(): boolean { return _ErrorProps[this.reason].retryable; }
	get isTerminal(): boolean { return _ErrorProps[this.reason].terminal; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = { maxRoomsPerSocket: 10 } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _emitWs = (eventBus: EventBus, tenantId: string, action: string, extra?: { data?: unknown; roomId?: string; userId?: string }) =>
	Context.Request.withinSync(tenantId, eventBus.emit({
		aggregateId: extra?.roomId ? `${tenantId}:${extra.roomId}` : tenantId,
		payload: { _tag: 'ws' as const, action, ...extra },
		tenantId,
	}));

// --- [SERVICE] ---------------------------------------------------------------

class WebSocketService extends Effect.Service<WebSocketService>()('server/WebSocket', {
	dependencies: [CacheService.Default, EventBus.Default, MetricsService.Default],
	scoped: Effect.gen(function* () {
		const cache = yield* CacheService;
		const eventBus = yield* EventBus;
		const metrics = yield* MetricsService;
		const socketsRef = yield* Ref.make(HashMap.empty<string, { socket: Socket.Socket; state: Ref.Ref<typeof _SCHEMA.state.Type> }>());
		const labels = MetricsService.label({ service: 'websocket' });
		const _roomKey = (tenantId: string, roomId: string) => `room:${tenantId}:${roomId}`;
		const _roomMembership = {
			add: (tenantId: string, roomId: string, socketId: string) => Effect.tryPromise(() => cache._redis.sadd(_roomKey(tenantId, roomId), socketId)).pipe(Effect.ignore),
			get: (tenantId: string, roomId: string) =>
				Effect.tryPromise(() => cache._redis.smembers(_roomKey(tenantId, roomId))).pipe(
					Effect.map((members) => HashSet.fromIterable(members)),
					Effect.orElseSucceed(() => HashSet.empty<string>()),
				),
			remove: (tenantId: string, roomId: string, socketId: string) => Effect.tryPromise(() => cache._redis.srem(_roomKey(tenantId, roomId), socketId)).pipe(Effect.ignore),
		} as const;
		const _localDeliverOnly = (tenantId: string, roomId: string, data: unknown) => Effect.gen(function* () {
			const sockets = yield* Ref.get(socketsRef);
			const message = JSON.stringify({ data, roomId, type: 'room.message' });
			yield* Effect.forEach(A.fromIterable(HashMap.values(sockets)), (entry) =>
				Ref.get(entry.state).pipe(
					Effect.flatMap((socket) => socket.tenantId === tenantId && socket.rooms.includes(roomId)
						? entry.socket.writer.pipe(Effect.flatMap((writer) => writer(message)), Effect.ignore)
						: Effect.void),
				), { concurrency: 'unbounded', discard: true });
		});
		yield* Effect.forkScoped(eventBus.onEvent().pipe(
			Stream.filter((entry) => S.is(_SCHEMA.payload)(entry.event.payload)),
			Stream.mapEffect((entry) => {
				const payload = entry.event.payload as typeof _SCHEMA.payload.Type;
				return payload.action === 'room.message' && payload.roomId && payload.data ? _localDeliverOnly(entry.event.tenantId, payload.roomId, payload.data) : Effect.void;
			}),
			Stream.runDrain,
		));
		const handleConnection = (socket: Socket.Socket, userId: string, tenantId: string) => Effect.gen(function* () {
			const socketId = crypto.randomUUID() as string;
			const stateRef = yield* Ref.make<typeof _SCHEMA.state.Type>({ rooms: [], socketId, tenantId, userId });
			yield* Effect.all([
				Ref.update(socketsRef, HashMap.set(socketId, { socket, state: stateRef })),
				MetricsService.gauge(metrics.stream.active, labels, 1),
				CacheService.presence.set(tenantId, socketId, { connectedAt: Date.now(), userId }),
				_emitWs(eventBus, tenantId, 'presence.online', { userId }),
			], { discard: true });
			yield* Effect.addFinalizer(() => Effect.gen(function* () {
				yield* Ref.update(socketsRef, HashMap.remove(socketId));
				yield* MetricsService.gauge(metrics.stream.active, labels, -1);
				const state = yield* Ref.get(stateRef);
				yield* Effect.forEach(state.rooms, (rid) => _roomMembership.remove(tenantId, rid, socketId), { discard: true });
				yield* CacheService.presence.remove(tenantId, socketId).pipe(Effect.ignore);
				yield* _emitWs(eventBus, tenantId, 'presence.offline', { userId }).pipe(Effect.ignore);
			}));
			return { socketId, stateRef };
		});
		const accept = (socket: Socket.Socket, userId: string, tenantId: string) => Effect.gen(function* () {
			const { socketId, stateRef } = yield* handleConnection(socket, userId, tenantId);
			const write = yield* socket.writer;
			const send = (payload: unknown) => write(JSON.stringify(payload)).pipe(Effect.mapError((error) => WsError.from('send_failed', socketId, error)));
			const ensureRoom = (roomId: string) => Ref.get(stateRef).pipe(Effect.filterOrFail((state) => state.rooms.includes(roomId), () => WsError.from('not_in_room', socketId)), Effect.asVoid);
			const decode = (data: string | Uint8Array) => Effect.try({ catch: (error) => WsError.from('invalid_message', socketId, error), try: () => JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as unknown }).pipe(Effect.flatMap((raw) => S.decodeUnknown(_SCHEMA.msg)(raw).pipe(Effect.mapError((error) => WsError.from('invalid_message', socketId, error)))));
			const handle = (msg: typeof _SCHEMA.msg.Type) => Match.value(msg).pipe(
				Match.tag('join', (message) => joinRoom(socketId, message.roomId, tenantId)),
				Match.tag('leave', (message) => leaveRoom(socketId, message.roomId, tenantId)),
				Match.tag('send', (message) => ensureRoom(message.roomId).pipe(Effect.andThen(broadcast(message.roomId, message.data, tenantId)))),
				Match.tag('ping', () => CacheService.presence.refresh(tenantId).pipe(Effect.andThen(send({ _tag: 'pong' }).pipe(Effect.ignore)))),
				Match.exhaustive,
			);
			const errPayload = (error: unknown) => ({ _tag: 'error', reason: error instanceof WsError ? error.reason : 'invalid_message' as const });
			return yield* socket.runRaw((data) => decode(data).pipe(Effect.flatMap(handle), Effect.catchAll((error) => send(errPayload(error)).pipe(Effect.ignore))));
		});
		const getPresence = (tenantId: string) => CacheService.presence.getAll(tenantId);
		const getRoomMembers = (tenantId: string, roomId: string) => _roomMembership.get(tenantId, roomId);
		const joinRoom = (socketId: string, roomId: string, tenantId: string) => Ref.get(socketsRef).pipe(
			Effect.flatMap((sockets) => Option.match(HashMap.get(sockets, socketId), {
				onNone: () => Effect.fail(WsError.from('invalid_message', socketId)),
				onSome: (entry) => Ref.get(entry.state).pipe(Effect.flatMap((state) =>
					state.rooms.includes(roomId) ? Effect.void
					: state.rooms.length >= _CONFIG.maxRoomsPerSocket ? Effect.fail(WsError.from('room_limit', socketId))
					: Effect.all([Ref.update(entry.state, (current) => ({ ...current, rooms: [...current.rooms, roomId] })), _roomMembership.add(tenantId, roomId, socketId)], { discard: true }))),
			})));
		const leaveRoom = (socketId: string, roomId: string, tenantId: string) => Ref.get(socketsRef).pipe(
			Effect.flatMap((sockets) => Option.match(HashMap.get(sockets, socketId), {
				onNone: () => Effect.void,
				onSome: (entry) => Effect.all([Ref.update(entry.state, (state) => ({ ...state, rooms: A.filter(state.rooms, (id) => id !== roomId) })), _roomMembership.remove(tenantId, roomId, socketId)], { discard: true }),
			})));
		const broadcast = (roomId: string, data: unknown, tenantId: string) => _emitWs(eventBus, tenantId, 'room.message', { data, roomId });
		yield* Effect.logInfo('WebSocketService initialized');
		return { accept, broadcast, getPresence, getRoomMembers, handleConnection, joinRoom, leaveRoom };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Error = WsError;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebSocketService {
	export type Error = WsError;
	export type ErrorReason = WsError['reason'];
	export type State = typeof _SCHEMA.state.Type;
	export type Message = typeof _SCHEMA.msg.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebSocketService };
