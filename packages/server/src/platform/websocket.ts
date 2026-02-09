/** WebSocket service: rooms, presence, cross-instance pub/sub, Machine lifecycle. */
import type { Socket } from '@effect/platform';
import { Machine } from '@effect/experimental';
import { Array as Arr, Clock, Config, Duration, Effect, Function as F, Match, Metric, Option, Request, Schedule, Schema as S, STM, TMap } from 'effect';
import { CacheService } from './cache.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [TYPES] -----------------------------------------------------------------

type _Type = {
	command:
		| { readonly _tag: 'join'; readonly roomId: string } | { readonly _tag: 'leave'; readonly roomId: string }
		| { readonly _tag: 'send'; readonly data: unknown; readonly roomId: string } | { readonly _tag: 'direct'; readonly data: unknown; readonly targetSocketId: string }
		| { readonly _tag: 'meta.set'; readonly metadata: { readonly [key: string]: unknown } };
	inbound: typeof _SCHEMA.InboundMsg.Type; outbound: typeof _SCHEMA.OutboundMsg.Type;
	lifecyclePhase: typeof _MODEL.lifecycle[keyof typeof _MODEL.lifecycle];
	signal: { readonly _tag: 'ping' } | { readonly _tag: 'disconnect' };
};
type _RegistryEntry = { readonly actor: Machine.Actor<Machine.Machine.Any>; readonly lastPong: number; readonly phase: _Type['lifecyclePhase']; readonly rooms: ReadonlyArray<string>; readonly socket: Socket.Socket; readonly tenantId: string; readonly userId: string };

// --- [CONSTANTS] -------------------------------------------------------------

const _MODEL = { broadcastRoomId: '__broadcast__', key: { meta: (socketId: string) => `ws:meta:${socketId}`, room: (tenantId: string, roomId: string) => `room:${tenantId}:${roomId}` }, lifecycle: { active: 'active', disconnecting: 'disconnecting' }, metaTtl: Duration.hours(2) } as const;
const _Tuning = Config.all({ broadcastChannel: Config.string('WS_BROADCAST_CHANNEL').pipe(Config.withDefault('ws:broadcast')), maxRoomsPerSocket: Config.integer('WS_MAX_ROOMS_PER_SOCKET').pipe(Config.withDefault(10)), pingIntervalMs: Config.integer('WS_PING_INTERVAL_MS').pipe(Config.withDefault(30_000)), pongTimeoutMs: Config.integer('WS_PONG_TIMEOUT_MS').pipe(Config.withDefault(90_000)), reaperIntervalMs: Config.integer('WS_REAPER_INTERVAL_MS').pipe(Config.withDefault(15_000)) });

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	InboundMsg: S.Union(S.Struct({ _tag: S.Literal('join'), roomId: S.String }), S.Struct({ _tag: S.Literal('leave'), roomId: S.String }),
		S.Struct({ _tag: S.Literal('send'), data: S.Unknown, roomId: S.String }), S.Struct({ _tag: S.Literal('ping') }),
		S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, targetSocketId: S.String }),
		S.Struct({ _tag: S.Literal('meta.set'), metadata: S.Record({ key: S.String, value: S.Unknown }) }), S.Struct({ _tag: S.Literal('meta.get') })),
	OutboundMsg: S.Union(S.Struct({ _tag: S.Literal('pong') }), S.Struct({ _tag: S.Literal('error'), reason: S.String }),
		S.Struct({ _tag: S.Literal('room.message'), data: S.Unknown, roomId: S.String }), S.Struct({ _tag: S.Literal('direct.message'), data: S.Unknown, fromSocketId: S.String }),
		S.Struct({ _tag: S.Literal('meta.data'), metadata: S.Record({ key: S.String, value: S.Unknown }) }), S.Struct({ _tag: S.Literal('heartbeat'), serverTime: S.Number })),
	PresencePayload: S.Struct({ connectedAt: S.Number, userId: S.String }),
	TransportEnvelope: S.Union(
		S.Struct({ _tag: S.Literal('room'), data: S.Unknown, nodeId: S.String, roomId: S.String, tenantId: S.String }),
		S.Struct({ _tag: S.Literal('direct'), data: S.Unknown, fromSocketId: S.String, nodeId: S.String, targetSocketId: S.String, tenantId: S.String }),
		S.Struct({ _tag: S.Literal('broadcast'), data: S.Unknown, nodeId: S.String, tenantId: S.String }),
	),
} as const;
const _CODEC = { inbound: { decode: S.decodeUnknown(S.parseJson(_SCHEMA.InboundMsg)) }, outbound: { encode: S.encode(S.parseJson(_SCHEMA.OutboundMsg)) }, transport: { decode: S.decodeUnknown(S.parseJson(_SCHEMA.TransportEnvelope)), encode: S.encode(S.parseJson(_SCHEMA.TransportEnvelope)) } } as const;

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
class CommandRequest extends Request.TaggedClass('Command')<void, WsError, { readonly command: _Type['command'] }> {}
class SignalRequest extends Request.TaggedClass('Signal')<void, never, { readonly signal: _Type['signal'] }> {}

// --- [SERVICES] --------------------------------------------------------------

class WebSocketService extends Effect.Service<WebSocketService>()('server/WebSocket', {
	dependencies: [CacheService.Default, MetricsService.Default],
	scoped: Effect.gen(function* () {
		const cache = yield* CacheService;
		const metrics = yield* MetricsService;
		const tuning = yield* _Tuning;
		const socketRegistry = yield* STM.commit(TMap.empty<string, _RegistryEntry>());
		const nodeId = crypto.randomUUID();
		const broadcastSubscriber = yield* Effect.acquireRelease(
			cache.pubsub.duplicate,
			(connection) => Effect.sync(() => connection.unsubscribe()).pipe(Effect.andThen(Effect.promise(() => connection.quit()))),
			);
			const labels = MetricsService.label({ service: 'websocket' });
			const _trackRtcEvent = (direction: 'error' | 'inbound' | 'outbound', messageType: string) => Metric.increment(Metric.taggedWithLabels(metrics.rtc.events, MetricsService.label({ direction, message_type: messageType, service: 'websocket' })));
			const _reg = {
			addRoom: (socketId: string, roomId: string) => _reg.update(socketId, (entry) => ({ ...entry, rooms: [...entry.rooms, roomId] })),
			entries: () => STM.commit(TMap.toArray(socketRegistry)),
			get: (socketId: string) => STM.commit(TMap.get(socketRegistry, socketId)),
			modify: (socketId: string, partial: Partial<_RegistryEntry>) => _reg.update(socketId, (entry) => ({ ...entry, ...partial })),
			remove: (socketId: string) => STM.commit(TMap.remove(socketRegistry, socketId)),
			removeRoom: (socketId: string, roomId: string) => _reg.update(socketId, (entry) => ({ ...entry, rooms: Arr.filter(entry.rooms, (id) => id !== roomId) })),
			set: (socketId: string, entry: _RegistryEntry) => STM.commit(TMap.set(socketRegistry, socketId, entry)),
			update: (socketId: string, updateFn: (entry: _RegistryEntry) => _RegistryEntry) => STM.commit(TMap.get(socketRegistry, socketId).pipe(STM.flatMap(Option.match({ onNone: () => STM.void, onSome: (entry: _RegistryEntry) => TMap.set(socketRegistry, socketId, updateFn(entry)) })))),
			values: () => STM.commit(TMap.values(socketRegistry)),
		} as const;
		const _roomsFor = (socketId: string) => _reg.get(socketId).pipe(Effect.map(Option.match({ onNone: () => [] as ReadonlyArray<string>, onSome: (entry: _RegistryEntry) => entry.rooms })));
		const _fanout = (entries: ReadonlyArray<_RegistryEntry>, payload: _Type['outbound'], messageType?: string) => _CODEC.outbound.encode(payload).pipe(
			Effect.tap(Option.match(Option.fromNullable(messageType), { onNone: () => Effect.void, onSome: _trackRtcEvent.bind(null, 'outbound') })),
			Effect.flatMap((encoded) =>
				Effect.forEach(
					entries,
					(entry) => entry.socket.writer.pipe(Effect.flatMap((write) => write(encoded)), Effect.ignore),
					{ concurrency: 'unbounded', discard: true },
				)),
		);
			const _disconnectCleanup = (socketId: string, tenantId: string, _userId: string, rooms: ReadonlyArray<string>) => _reg.get(socketId).pipe(
			Effect.flatMap(Option.match({
				onNone: () => Effect.void,
					onSome: () => Effect.all([
						_reg.remove(socketId), MetricsService.gauge(metrics.stream.active, labels, -1),
						Effect.forEach(rooms, (roomId) => cache.sets.remove(_MODEL.key.room(tenantId, roomId), socketId), { discard: true }),
						CacheService.presence.remove(tenantId, socketId), cache.kv.del(_MODEL.key.meta(socketId)),
						Effect.void,
					], { discard: true }),
				})),
			);
			const _cleanupForSocket = (socketId: string, tenantId: string, userId: string) => _roomsFor(socketId).pipe(Effect.flatMap((rooms) => _disconnectCleanup(socketId, tenantId, userId, rooms)));
			const _publishTransport = (envelope: typeof _SCHEMA.TransportEnvelope.Type) => _CODEC.transport.encode(envelope).pipe(
				Effect.andThen((encoded) => cache.pubsub.publish(tuning.broadcastChannel, encoded)),
				Effect.ignore,
			);
			const _pingUpdate = (socketId: string) => Clock.currentTimeMillis.pipe(Effect.flatMap((now) => _reg.modify(socketId, { lastPong: now, phase: _MODEL.lifecycle.active })));
			const _entriesFor = (socketIds: ReadonlyArray<string>) => Effect.forEach(socketIds, (socketId) => _reg.get(socketId).pipe(Effect.map(Option.toArray)), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
		const _deliverLocal = (tenantId: string, roomId: string, data: unknown) => Telemetry.span(
			cache.sets.members(_MODEL.key.room(tenantId, roomId)).pipe(Effect.flatMap(_entriesFor), Effect.flatMap((entries) => _fanout(entries, { _tag: 'room.message', data, roomId }, 'room.message'))),
			'websocket.deliverLocal', { metrics: false, 'websocket.room_id': roomId },
		);
		const _deliverDirect = (tenantId: string, targetSocketId: string, data: unknown, fromSocketId: string) => Telemetry.span(
			_reg.get(targetSocketId).pipe(Effect.flatMap(Option.match({
				onNone: () => Effect.void,
				onSome: (entry: _RegistryEntry) => entry.tenantId === tenantId
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
			yield* cache.pubsub.subscribe(broadcastSubscriber, tuning.broadcastChannel).pipe(Effect.catchAll((error) => Effect.logWarning('WebSocket broadcast pub/sub unavailable', { error: String(error) })));
			broadcastSubscriber.on('message', (channel, raw) => channel === tuning.broadcastChannel && Effect.runFork(
				_CODEC.transport.decode(raw).pipe(
					Effect.flatMap((envelope) => envelope.nodeId === nodeId ? Effect.void : Effect.scoped(_deliverTransport(envelope))),
					Effect.catchAll((error) => Effect.logWarning('Malformed broadcast message', { error: String(error) })),
				),
			));
		yield* Effect.forkScoped(Effect.repeat(
			_reg.values().pipe(Effect.flatMap((entries) => Clock.currentTimeMillis.pipe(Effect.flatMap((serverTime) => _fanout(entries, { _tag: 'heartbeat', serverTime }))))),
			Schedule.spaced(Duration.millis(tuning.pingIntervalMs)),
		).pipe(Effect.ignore));
		yield* Effect.forkScoped(Effect.repeat(
			Effect.all([Clock.currentTimeMillis, _reg.entries()]).pipe(
				Effect.flatMap(([now, entries]) => Effect.forEach(entries, ([socketId, entry]: [string, _RegistryEntry]) =>
						Effect.all([
							Effect.logWarning('Reaping stale WebSocket connection', { socketId, tenantId: entry.tenantId, userId: entry.userId }),
							entry.actor.send(new SignalRequest({ signal: { _tag: 'disconnect' } })).pipe(Effect.ignore),
							_reg.modify(socketId, { phase: _MODEL.lifecycle.disconnecting }),
							_disconnectCleanup(socketId, entry.tenantId, entry.userId, entry.rooms),
							_trackRtcEvent('outbound', 'connection.reaped'),
						], { discard: true }).pipe(Effect.when(() => now - entry.lastPong > tuning.pongTimeoutMs), Effect.asVoid),
					{ concurrency: 'unbounded', discard: true },
				)),
			),
			Schedule.spaced(Duration.millis(tuning.reaperIntervalMs)),
		).pipe(Effect.ignore));
		const _connectionMachine = Machine.makeWith<_Type['lifecyclePhase'], { readonly socketId: string; readonly tenantId: string; readonly userId: string }>()(
				(input) => {
					const _joinRoom = (roomId: string) => _roomsFor(input.socketId).pipe(
						Effect.flatMap((rooms) => Match.value(rooms.includes(roomId)).pipe(
							Match.when(true, () => Effect.void),
							Match.orElse(() => Effect.filterOrFail(Effect.succeed(rooms), (current) => current.length < tuning.maxRoomsPerSocket, () => WsError.from('room_limit', input.socketId)).pipe(
								Effect.andThen(Effect.all([_reg.addRoom(input.socketId, roomId), cache.sets.add(_MODEL.key.room(input.tenantId, roomId), input.socketId)], { discard: true })),
								Effect.asVoid,
							)),
						)),
					);
				return Effect.succeed(
					Machine.procedures.make<_Type['lifecyclePhase']>(_MODEL.lifecycle.active, { identifier: `ws:${input.socketId}` }).pipe(
					Machine.procedures.add<SignalRequest>()('Signal', (context) => Match.valueTags(context.request.signal, {
							disconnect: () => Effect.succeed([Machine.NoReply, _MODEL.lifecycle.disconnecting] as const),
							ping: () => _pingUpdate(input.socketId).pipe(
								Effect.andThen(CacheService.presence.refresh(input.tenantId)),
								Effect.as([Machine.NoReply, context.state] as const),
							),
					})),
						Machine.procedures.add<CommandRequest>()('Command', (context) => Match.value(context.request.command).pipe(
							Match.tag('join', ({ roomId }) => _joinRoom(roomId)),
							Match.tag('leave', ({ roomId }) => Effect.all([
								_reg.removeRoom(input.socketId, roomId),
								cache.sets.remove(_MODEL.key.room(input.tenantId, roomId), input.socketId),
							], { discard: true })),
							Match.tag('send', ({ data, roomId }) => _roomsFor(input.socketId).pipe(
								Effect.filterOrFail(Arr.contains(roomId), F.constant(WsError.from('not_in_room', input.socketId))),
								Effect.andThen(send({ _tag: 'room', roomId }, data, input.tenantId)),
								Effect.ignore,
							)),
							Match.tag('direct', ({ data, targetSocketId }) => send({ _tag: 'direct', socketId: targetSocketId }, data, input.tenantId, input.socketId).pipe(Effect.ignore)),
							Match.tag('meta.set', ({ metadata }) => cache.kv.set(_MODEL.key.meta(input.socketId), metadata, _MODEL.metaTtl)),
							Match.exhaustive,
							Effect.map(() => [undefined, context.state] as const),
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
						Effect.void,
					], { discard: true });
				yield* Effect.addFinalizer(F.constant(_cleanupForSocket(socketId, tenantId, userId)));
				const write = yield* socket.writer;
				const sendOutbound = (payload: _Type['outbound']) => _CODEC.outbound.encode(payload).pipe(
					Effect.tap(_trackRtcEvent('outbound', payload._tag)),
					Effect.flatMap(write),
					Effect.mapError(WsError.mapper('send_failed', socketId)),
				);
				const decode = (data: string | Uint8Array) => _CODEC.inbound.decode(typeof data === 'string' ? data : new TextDecoder().decode(data)).pipe(Effect.mapError(WsError.mapper('invalid_message', socketId)));
				const _metaPayload = (metadata: Record<string, unknown>): _Type['outbound'] => ({ _tag: 'meta.data', metadata });
				const _dispatch = {
					direct: (message: { data: unknown; targetSocketId: string }) => actor.send(new CommandRequest({ command: { _tag: 'direct', data: message.data, targetSocketId: message.targetSocketId } })),
					join: (message: { roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'join', roomId: message.roomId } })),
					leave: (message: { roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'leave', roomId: message.roomId } })),
					'meta.get': F.constant(cache.kv.get(_MODEL.key.meta(socketId), S.Record({ key: S.String, value: S.Unknown })).pipe(Effect.map(Option.getOrElse(F.constant({} as Record<string, unknown>))), Effect.map(_metaPayload), Effect.flatMap(sendOutbound), Effect.ignore)),
					'meta.set': (message: { metadata: Record<string, unknown> }) => actor.send(new CommandRequest({ command: { _tag: 'meta.set', metadata: message.metadata } })),
					ping: F.constant(actor.send(new SignalRequest({ signal: { _tag: 'ping' } })).pipe(Effect.andThen(sendOutbound({ _tag: 'pong' })), Effect.ignore)),
					send: (message: { data: unknown; roomId: string }) => actor.send(new CommandRequest({ command: { _tag: 'send', data: message.data, roomId: message.roomId } })),
				};
				const handle = (msg: _Type['inbound']) => _trackRtcEvent('inbound', msg._tag).pipe(Effect.andThen(Match.valueTags(msg, _dispatch)));
				return yield* socket.runRaw((data) => Telemetry.span(
					decode(data).pipe(
						Effect.flatMap(handle),
						Effect.tapError(F.constant(_trackRtcEvent('error', 'dispatch'))),
						Effect.catchAll(F.flow(WsError.toPayload, sendOutbound, Effect.ignore)),
					),
					'websocket.readDispatch',
					{ metrics: false, 'websocket.socket_id': socketId },
				));
			}),
			'websocket.accept',
			{ metrics: false, 'websocket.tenant_id': tenantId, 'websocket.user_id': userId },
		);
			const send = (target: WebSocketService.Target, data: unknown, tenantId: string, fromSocketId = 'server') => Telemetry.span(Match.value(target).pipe(
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
			send,
		};
	}),
}) {
	static readonly PresencePayload = _SCHEMA.PresencePayload;
	static readonly ErrorReason = S.Literal('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'disconnecting');
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
