/**
 * WebSocket service: bidirectional real-time, rooms, cross-instance pub/sub.
 * Redis-backed presence (delegated to CacheService), EventBus-driven message fan-out,
 * schema-validated protocol, Machine-based connection lifecycle, STM/TMap concurrent socket registry.
 */
import type { Socket } from '@effect/platform';
import { Machine } from '@effect/experimental';
import { Clock, Config, Duration, Effect, Match, Metric, Option, Request, Schedule, Schema as S, STM, Stream, TMap } from 'effect';
import { CacheService } from './cache.ts';
import { Context } from '../context.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [TYPES] -----------------------------------------------------------------

type _Type = {
	command:
		| { readonly _tag: 'join'; readonly roomId: string }
		| { readonly _tag: 'leave'; readonly roomId: string }
		| { readonly _tag: 'send'; readonly data: unknown; readonly roomId: string }
		| { readonly _tag: 'direct'; readonly data: unknown; readonly targetSocketId: string }
		| { readonly _tag: 'meta.set'; readonly metadata: { readonly [key: string]: unknown } };
	inbound: typeof _SCHEMA.InboundMsg.Type;
	lifecyclePhase: typeof _MODEL.lifecycle[keyof typeof _MODEL.lifecycle];
	outbound: typeof _SCHEMA.OutboundMsg.Type;
	signal: { readonly _tag: 'ping' } | { readonly _tag: 'mark-stale' } | { readonly _tag: 'disconnect' };
};
type _RegistryEntry = {
	readonly actor: Machine.Actor<Machine.Machine.Any>;
	readonly lastPong: number;
	readonly phase: _Type['lifecyclePhase'];
	readonly rooms: ReadonlyArray<string>;
	readonly socket: Socket.Socket;
	readonly tenantId: string;
	readonly userId: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _MODEL = {
	broadcastRoomId: '__broadcast__',
	key: { meta: (socketId: string) => `ws:meta:${socketId}`, room: (tenantId: string, roomId: string) => `room:${tenantId}:${roomId}` },
	lifecycle: { active: 'active', authenticated: 'authenticated', connecting: 'connecting', disconnecting: 'disconnecting', stale: 'stale' },
	metaTtl: Duration.hours(2),
} as const;
const _Tuning = Config.all({
	broadcastChannel: 	Config.string('WS_BROADCAST_CHANNEL').pipe(Config.withDefault('ws:broadcast')),
	maxRoomsPerSocket: 	Config.integer('WS_MAX_ROOMS_PER_SOCKET').pipe(Config.withDefault(10)),
	pingIntervalMs: 	Config.integer('WS_PING_INTERVAL_MS').pipe(Config.withDefault(30_000)),
	pongTimeoutMs: 		Config.integer('WS_PONG_TIMEOUT_MS').pipe(Config.withDefault(90_000)),
	reaperIntervalMs: 	Config.integer('WS_REAPER_INTERVAL_MS').pipe(Config.withDefault(15_000)),
});

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	BroadcastEnvelope: S.Struct({ data: S.Unknown, nodeId: S.String }),
	InboundMsg: S.Union(
		S.Struct({ _tag: S.Literal('join'), roomId: S.String }),
		S.Struct({ _tag: S.Literal('leave'), roomId: S.String }),
		S.Struct({ _tag: S.Literal('send'), data: S.Unknown, roomId: S.String }),
		S.Struct({ _tag: S.Literal('ping') }),
		S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, targetSocketId: S.String }),
		S.Struct({ _tag: S.Literal('meta.set'), metadata: S.Record({ key: S.String, value: S.Unknown }) }),
		S.Struct({ _tag: S.Literal('meta.get') }),
	),
	OutboundMsg: S.Union(
		S.Struct({ _tag: S.Literal('pong') }),
		S.Struct({ _tag: S.Literal('error'), reason: S.String }),
		S.Struct({ _tag: S.Literal('room.message'), data: S.Unknown, roomId: S.String }),
		S.Struct({ _tag: S.Literal('direct.message'), data: S.Unknown, fromSocketId: S.String }),
		S.Struct({ _tag: S.Literal('meta.data'), metadata: S.Record({ key: S.String, value: S.Unknown }) }),
		S.Struct({ _tag: S.Literal('heartbeat'), serverTime: S.Number }),
	),
	PresencePayload: S.Struct({ connectedAt: S.Number, userId: S.String }),
} as const;
const _CODEC = {
	broadcast: 	{ decode: S.decodeUnknown(S.parseJson(_SCHEMA.BroadcastEnvelope)), encode: S.encode(S.parseJson(_SCHEMA.BroadcastEnvelope)) },
	inbound: 	{ decode: S.decodeUnknown(S.parseJson(_SCHEMA.InboundMsg)) },
	outbound: 	{ encode: S.encode(S.parseJson(_SCHEMA.OutboundMsg)) },
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class WsError extends S.TaggedError<WsError>()('WsError', {
	cause: S.optional(S.Unknown),
	reason: S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'stale', 'disconnecting'),
	socketId: S.optional(S.String),
}) {
	static readonly _props = {
		disconnecting: 	 { retryable: false, terminal: true  },
		invalid_message: { retryable: false, terminal: true  },
		not_in_room: 	 { retryable: false, terminal: false },
		room_limit: 	 { retryable: false, terminal: false },
		send_failed: 	 { retryable: true,  terminal: false },
		stale: 			 { retryable: false, terminal: false },
	} as const;
	static readonly from = (reason: WsError['reason'], socketId?: string, cause?: unknown) => new WsError({ cause, reason, socketId });
	static readonly toPayload = (error: unknown): { readonly _tag: 'error'; readonly reason: string } => ({ _tag: 'error', reason: error instanceof WsError ? error.reason : 'invalid_message' });
	get isRetryable(): boolean { return WsError._props[this.reason].retryable; }
	get isTerminal(): boolean { return WsError._props[this.reason].terminal; }
}
class CommandRequest extends Request.TaggedClass('Command')<void, WsError, { readonly command: _Type['command'] }> {}
class SignalRequest extends Request.TaggedClass('Signal')<void, never, { readonly signal: _Type['signal'] }> {}

// --- [SERVICES] --------------------------------------------------------------

class WebSocketService extends Effect.Service<WebSocketService>()('server/WebSocket', {
	dependencies: [CacheService.Default, EventBus.Default, MetricsService.Default],
	scoped: Effect.gen(function* () {
		const cache = yield* CacheService;
		const eventBus = yield* EventBus;
		const metrics = yield* MetricsService;
		const tuning = yield* _Tuning;
		const socketRegistry = yield* STM.commit(TMap.empty<string, _RegistryEntry>());
		const nodeId = crypto.randomUUID();
		const broadcastSubscriber = yield* Effect.acquireRelease(
			Effect.sync(() => cache._redis.duplicate()),
			(connection) => Effect.sync(() => connection.unsubscribe()).pipe(Effect.andThen(Effect.promise(() => connection.quit()))),
		);
		const labels = MetricsService.label({ service: 'websocket' });
		const _trackRtcEvent = (direction: 'error' | 'inbound' | 'outbound', messageType: string) => Metric.increment(Metric.taggedWithLabels(metrics.rtc.events, MetricsService.label({ direction, message_type: messageType, service: 'websocket' })));
		const _emit = (tenantId: string, action: string, extra?: { data?: unknown; fromSocketId?: string; roomId?: string; targetSocketId?: string; userId?: string }) => Context.Request.withinSync(tenantId, eventBus.publish({ aggregateId: extra?.roomId ? `${tenantId}:${extra.roomId}` : tenantId, payload: { _tag: 'ws' as const, action, ...extra }, tenantId }));
		const _registryGet = (socketId: string): Effect.Effect<Option.Option<_RegistryEntry>> => STM.commit(TMap.get(socketRegistry, socketId));
		const _registrySet = (socketId: string, entry: _RegistryEntry): Effect.Effect<void> => STM.commit(TMap.set(socketRegistry, socketId, entry));
		const _registryRemove = (socketId: string): Effect.Effect<void> => STM.commit(TMap.remove(socketRegistry, socketId));
		const _registryValues = (): Effect.Effect<Array<_RegistryEntry>> => STM.commit(TMap.values(socketRegistry));
		const _registryEntries = (): Effect.Effect<Array<[string, _RegistryEntry]>> => STM.commit(TMap.toArray(socketRegistry));
		const _registryUpdate = (socketId: string, updateFn: (entry: _RegistryEntry) => _RegistryEntry): Effect.Effect<void> => STM.commit(TMap.get(socketRegistry, socketId).pipe(STM.flatMap(Option.match({ onNone: () => STM.void, onSome: (entry: _RegistryEntry) => TMap.set(socketRegistry, socketId, updateFn(entry)) }))),);
		const _registryUpdateRooms = (socketId: string, updateFn: (rooms: ReadonlyArray<string>) => ReadonlyArray<string>): Effect.Effect<void> => _registryUpdate(socketId, (entry) => ({ ...entry, rooms: updateFn(entry.rooms) }));
		const _registryUpdatePhase = (socketId: string, phase: _Type['lifecyclePhase']): Effect.Effect<void> => _registryUpdate(socketId, (entry) => ({ ...entry, phase }));
		const _registryUpdatePong = (socketId: string, timestamp: number): Effect.Effect<void> => _registryUpdate(socketId, (entry) => ({ ...entry, lastPong: timestamp, phase: _MODEL.lifecycle.active }));
		const _roomsFor = (socketId: string): Effect.Effect<ReadonlyArray<string>> => _registryGet(socketId).pipe(Effect.map(Option.match({ onNone: () => [] as ReadonlyArray<string>, onSome: (entry: _RegistryEntry) => entry.rooms })));
		const _writeEncoded = (entry: _RegistryEntry, encoded: string) => entry.socket.writer.pipe(Effect.flatMap((writer) => writer(encoded)), Effect.ignore);
		const _trackOutbound = (messageType?: string) => Option.fromNullable(messageType).pipe(Option.match({ onNone: () => Effect.void, onSome: (value) => _trackRtcEvent('outbound', value) }));
		const _fanout = (entries: ReadonlyArray<_RegistryEntry>, payload: _Type['outbound'], messageType?: string) => _CODEC.outbound.encode(payload).pipe(
			Effect.tap(() => _trackOutbound(messageType)),
			Effect.flatMap((encoded) => Effect.forEach(entries, (entry) => _writeEncoded(entry, encoded), { concurrency: 'unbounded', discard: true })),
		);
		const _entriesFor = (socketIds: ReadonlyArray<string>): Effect.Effect<Array<_RegistryEntry>> => Effect.forEach(socketIds, (socketId) => _registryGet(socketId).pipe(Effect.map(Option.toArray)), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
		const _disconnectCleanup = (socketId: string, tenantId: string, userId: string, rooms: ReadonlyArray<string>) => Effect.gen(function* () {
			yield* _registryRemove(socketId);
			yield* MetricsService.gauge(metrics.stream.active, labels, -1);
			yield* Effect.forEach(rooms, (roomId) => cache.sets.remove(_MODEL.key.room(tenantId, roomId), socketId), { discard: true });
			yield* CacheService.presence.remove(tenantId, socketId);
			yield* cache.kv.del(_MODEL.key.meta(socketId));
			yield* _emit(tenantId, 'presence.offline', { userId }).pipe(Effect.ignore);
		});
		const _deliverLocal = (tenantId: string, roomId: string, data: unknown) => Telemetry.span(
			cache.sets.members(_MODEL.key.room(tenantId, roomId)).pipe(Effect.flatMap(_entriesFor), Effect.flatMap((entries) => _fanout(entries, { _tag: 'room.message', data, roomId }, 'room.message'))),
			'websocket.deliverLocal',
			{ metrics: false, 'websocket.room_id': roomId },
		);
		const _deliverDirect = (targetSocketId: string, data: unknown, fromSocketId: string) => Telemetry.span(
			_registryGet(targetSocketId).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (entry: _RegistryEntry) => _fanout([entry], { _tag: 'direct.message', data, fromSocketId }, 'direct.message') }))),
			'websocket.deliverDirect',
			{ metrics: false, 'websocket.from_socket_id': fromSocketId, 'websocket.target_socket_id': targetSocketId },
		);
		const _deliverBroadcastLocal = (data: unknown) => Telemetry.span(
			_registryValues().pipe(Effect.flatMap((entries) => _fanout(entries, { _tag: 'room.message', data, roomId: _MODEL.broadcastRoomId }, 'room.message'))),
			'websocket.deliverBroadcastLocal',
			{ metrics: false },
		);
		yield* Effect.tryPromise({ catch: (cause) => cause, try: () => broadcastSubscriber.subscribe(tuning.broadcastChannel) }).pipe(Effect.catchAll((error) => Effect.logWarning('WebSocket broadcast pub/sub unavailable', { error: String(error) })));
		broadcastSubscriber.on('message', (channel, raw) => channel === tuning.broadcastChannel && Effect.runFork(
			_CODEC.broadcast.decode(raw).pipe(
				Effect.flatMap((envelope) => envelope.nodeId === nodeId ? Effect.void : Effect.scoped(_deliverBroadcastLocal(envelope.data))),
				Effect.catchAll((error) => Effect.logWarning('Malformed broadcast message', { error: String(error) })),
			),
		));
		yield* Effect.forkScoped(eventBus.subscribe('ws.room.message', S.Struct({ data: S.Unknown, roomId: S.String }), (event, payload) => Effect.scoped(_deliverLocal(event.tenantId, payload.roomId, payload.data)).pipe(Effect.ignore)).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain));
		yield* Effect.forkScoped(eventBus.subscribe('ws.direct.message', S.Struct({ data: S.Unknown, fromSocketId: S.String, targetSocketId: S.String }), (_event, payload) => Effect.scoped(_deliverDirect(payload.targetSocketId, payload.data, payload.fromSocketId)).pipe(Effect.ignore)).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain));
		yield* Effect.forkScoped(
			Effect.repeat(
				Effect.gen(function* () {
					const entries = yield* _registryValues();
					const serverTime = yield* Clock.currentTimeMillis;
					yield* _fanout(entries, { _tag: 'heartbeat', serverTime });
				}),
				Schedule.spaced(Duration.millis(tuning.pingIntervalMs)),
			).pipe(Effect.ignore),
		);
		yield* Effect.forkScoped(
			Effect.repeat(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const entries = yield* _registryEntries();
					yield* Effect.forEach(entries, ([socketId, entry]: [string, _RegistryEntry]) =>
						(now - entry.lastPong > tuning.pongTimeoutMs)
							? Match.value(entry.phase).pipe(
								Match.when(_MODEL.lifecycle.stale, () => Effect.gen(function* () {
									yield* Effect.logWarning('Reaping stale WebSocket connection', { socketId, tenantId: entry.tenantId, userId: entry.userId });
									yield* entry.actor.send(new SignalRequest({ signal: { _tag: 'disconnect' } })).pipe(Effect.ignore);
									yield* _registryUpdatePhase(socketId, _MODEL.lifecycle.disconnecting);
									yield* _disconnectCleanup(socketId, entry.tenantId, entry.userId, entry.rooms);
									yield* _trackRtcEvent('outbound', 'connection.reaped');
								})),
								Match.when((phase: _Type['lifecyclePhase']) => phase === _MODEL.lifecycle.active || phase === _MODEL.lifecycle.authenticated, () => Effect.all([
									entry.actor.send(new SignalRequest({ signal: { _tag: 'mark-stale' } })).pipe(Effect.ignore),
									_registryUpdatePhase(socketId, _MODEL.lifecycle.stale),
								], { discard: true })),
								Match.orElse(() => Effect.void),
							)
							: Effect.void,
						{ concurrency: 'unbounded', discard: true },
					);
				}),
				Schedule.spaced(Duration.millis(tuning.reaperIntervalMs)),
			).pipe(Effect.ignore),
		);
		const _connectionMachine = Machine.makeWith<_Type['lifecyclePhase'], { readonly socketId: string; readonly tenantId: string; readonly userId: string }>()(
			(input) => {
				const _signalReply = (state: _Type['lifecyclePhase']) => [Machine.NoReply, state] as const;
				const _commandReply = (state: _Type['lifecyclePhase']) => [undefined, state] as const;
				const _joinRoom = (roomId: string) => _roomsFor(input.socketId).pipe(
					Effect.flatMap((rooms) => Match.value({ alreadyIn: rooms.includes(roomId), atLimit: rooms.length >= tuning.maxRoomsPerSocket }).pipe(
						Match.when({ alreadyIn: true }, () => Effect.void),
						Match.when({ atLimit: true }, () => Effect.fail(WsError.from('room_limit', input.socketId))),
						Match.orElse(() => Effect.all([
							_registryUpdateRooms(input.socketId, (current) => [...current, roomId]),
							cache.sets.add(_MODEL.key.room(input.tenantId, roomId), input.socketId),
						], { discard: true })),
					)),
				);
				return Effect.succeed(
					Machine.procedures.make<_Type['lifecyclePhase']>(_MODEL.lifecycle.connecting, { identifier: `ws:${input.socketId}` }).pipe(
						Machine.procedures.add<SignalRequest>()('Signal', (context) => Match.value(context.request.signal).pipe(
							Match.tag('ping', () => Clock.currentTimeMillis.pipe(
								Effect.flatMap((now) => _registryUpdatePong(input.socketId, now)),
								Effect.andThen(CacheService.presence.refresh(input.tenantId)),
								Effect.map(() => _signalReply(context.state === _MODEL.lifecycle.stale ? _MODEL.lifecycle.active : context.state)),
							)),
							Match.tag('mark-stale', () => Effect.succeed(_signalReply(context.state === _MODEL.lifecycle.active ? _MODEL.lifecycle.stale : context.state))),
							Match.tag('disconnect', () => Effect.succeed(_signalReply(_MODEL.lifecycle.disconnecting))),
							Match.exhaustive,
						)),
						Machine.procedures.add<CommandRequest>()('Command', (context) => Match.value(context.request.command).pipe(
							Match.tag('join', ({ roomId }) => _joinRoom(roomId)),
							Match.tag('leave', ({ roomId }) => Effect.all([
								_registryUpdateRooms(input.socketId, (rooms) => rooms.filter((id) => id !== roomId)),
								cache.sets.remove(_MODEL.key.room(input.tenantId, roomId), input.socketId),
							], { discard: true })),
							Match.tag('send', ({ data, roomId }) => _roomsFor(input.socketId).pipe(Effect.flatMap((rooms) => rooms.includes(roomId)
								? send({ _tag: 'room', roomId }, data, input.tenantId).pipe(Effect.ignore)
								: Effect.fail(WsError.from('not_in_room', input.socketId))))),
							Match.tag('direct', ({ data, targetSocketId }) => send({ _tag: 'direct', socketId: targetSocketId }, data, input.tenantId, input.socketId).pipe(Effect.ignore)),
							Match.tag('meta.set', ({ metadata }) => cache.kv.set(_MODEL.key.meta(input.socketId), metadata, _MODEL.metaTtl)),
							Match.exhaustive,
							Effect.map(() => _commandReply(context.state)),
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
				yield* _registrySet(socketId, { actor, lastPong: connectedAt, phase: _MODEL.lifecycle.authenticated, rooms: [], socket, tenantId, userId });
				yield* _registryUpdatePhase(socketId, _MODEL.lifecycle.active);
				yield* Effect.all([
					MetricsService.gauge(metrics.stream.active, labels, 1),
					Metric.increment(Metric.taggedWithLabels(metrics.rtc.connections, labels)),
					CacheService.presence.set(tenantId, socketId, { connectedAt, userId }),
					_emit(tenantId, 'presence.online', { userId }),
				], { discard: true });
				yield* Effect.addFinalizer(() => _roomsFor(socketId).pipe(Effect.flatMap((rooms) => _disconnectCleanup(socketId, tenantId, userId, rooms))));
				const write = yield* socket.writer;
				const sendOutbound = (payload: _Type['outbound']) => _CODEC.outbound.encode(payload).pipe(
					Effect.tap(() => _trackRtcEvent('outbound', payload._tag)),
					Effect.flatMap(write),
					Effect.mapError((error) => WsError.from('send_failed', socketId, error)),
				);
				const decode = (data: string | Uint8Array) => _CODEC.inbound.decode(typeof data === 'string' ? data : new TextDecoder().decode(data)).pipe(Effect.mapError((error) => WsError.from('invalid_message', socketId, error)));
				const handle = (msg: _Type['inbound']) => _trackRtcEvent('inbound', msg._tag).pipe(Effect.andThen(Match.value(msg).pipe(
					Match.tag('join', (message) => actor.send(new CommandRequest({ command: { _tag: 'join', roomId: message.roomId } }))),
					Match.tag('leave', (message) => actor.send(new CommandRequest({ command: { _tag: 'leave', roomId: message.roomId } }))),
					Match.tag('send', (message) => actor.send(new CommandRequest({ command: { _tag: 'send', data: message.data, roomId: message.roomId } }))),
					Match.tag('ping', () => actor.send(new SignalRequest({ signal: { _tag: 'ping' } })).pipe(Effect.andThen(sendOutbound({ _tag: 'pong' }).pipe(Effect.ignore)))),
					Match.tag('direct', (message) => actor.send(new CommandRequest({ command: { _tag: 'direct', data: message.data, targetSocketId: message.targetSocketId } }))),
					Match.tag('meta.set', (message) => actor.send(new CommandRequest({ command: { _tag: 'meta.set', metadata: message.metadata } }))),
					Match.tag('meta.get', () => cache.kv.get(_MODEL.key.meta(socketId), S.Record({ key: S.String, value: S.Unknown })).pipe(
						Effect.flatMap(Option.match({
							onNone: () => sendOutbound({ _tag: 'meta.data', metadata: {} }).pipe(Effect.ignore),
							onSome: (metadata) => sendOutbound({ _tag: 'meta.data', metadata }).pipe(Effect.ignore),
						})),
					)),
					Match.exhaustive,
				)));
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
			Match.when({ _tag: 'broadcast' }, () => Effect.all([
				_deliverBroadcastLocal(data),
				_CODEC.broadcast.encode({ data, nodeId }).pipe(
					Effect.flatMap((encoded) => Effect.tryPromise({ catch: (cause) => cause, try: () => cache._redis.publish(tuning.broadcastChannel, encoded) })),
					Effect.ignore,
				),
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
			send,
		};
	}),
}) {
	static readonly PresencePayload = _SCHEMA.PresencePayload;
	static readonly ErrorReason = S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'stale', 'disconnecting');
	static readonly InboundMsg = _SCHEMA.InboundMsg;
	static readonly OutboundMsg = _SCHEMA.OutboundMsg;
	static readonly encodeOutbound = _CODEC.outbound.encode;
	static readonly decodeInbound = _CODEC.inbound.decode;
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
