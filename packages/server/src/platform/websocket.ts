/**
 * WebSocket service: bidirectional real-time, rooms, cross-instance pub/sub.
 *
 * @effect/platform    — Socket, SocketServer (WebSocket upgrade + message handling)
 * @effect/rpc         — Rpc.effect, Rpc.stream (typed request/response over socket)
 * @effect/cluster     — Sharding, MessageState (extractable for distributed state)
 * @effect/experimental — Machine (connection lifecycle FSM)
 * effect              — PubSub (rooms), SubscriptionRef (presence), HashMap (registry)
 * internal            — CacheService (presence/room state), Resilience (Redis calls), StreamingService (broadcast)
 */
export const _dependencies = [
	'@effect/platform',			// Socket, SocketServer.fromWebSocket
	'@effect/rpc',				// Rpc.effect, Rpc.stream (typed WS messages)
	'@effect/cluster',			// Sharding (extractable), MessageState
	'@effect/experimental',		// Machine.make (connection state FSM)
	'effect',					// PubSub.unbounded, SubscriptionRef, HashMap, Stream.fromPubSub
	'ioredis',					// Redis pub/sub for multi-instance fan-out (via CacheService.redis)
	'./platform/cache',			// CacheService (presence state, room membership, cross-instance coordination)
	'./platform/streaming',		// StreamingService.broadcast (fan-out to room subscribers)
	'./utils/resilience',		// Resilience.run (Redis pub/sub calls with circuit/retry)
	'./observe/metrics',		// MetricsService (connections, messages, rooms gauges)
] as const;
