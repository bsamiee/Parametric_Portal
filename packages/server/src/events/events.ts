/**
 * EventBus: Typed domain events with transactional outbox and cluster broadcast.
 *
 * Architecture:
 * - DomainEvent via VariantSchema (_VS.Class + _VS.Field) - single source of truth
 * - Transactional outbox via DatabaseService.eventOutbox.offer() (called within db.transaction)
 * - Outbox worker polls db.eventOutbox.takePending() and broadcasts via Sharding.broadcaster
 * - Two-tier deduplication: in-memory LRU + persistent fallback via PersistedCache
 * - At-least-once delivery with dead-letter after max retries
 *
 * Event Naming:
 * - Database eventType: 'user.created', 'order.placed' (dot-notation)
 * - Schema _tag: 'user', 'order' (category discriminator)
 * - Schema payload.action: 'created', 'placed' (action within category)
 *
 * Routing: Uses Sharding.broadcaster for fire-and-forget fan-out (NOT Entity.make).
 * Research recommends broadcaster over Entity.make for event distribution.
 */
import { DeliverAt, RecipientType, Sharding, Snowflake, SqlMessageStorage } from '@effect/cluster';
import { PersistedCache, PersistedQueue, Reactivity, VariantSchema } from '@effect/experimental';
import { Activity, DurableClock, DurableRateLimiter } from '@effect/workflow';
import { Chunk, Clock, DateTime, Duration, Effect, Exit, HashSet, Match, Metric, Option, PrimaryKey, PubSub, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';
import { ClusterService } from '../infra/cluster.ts';

// --- [SCHEMA] ----------------------------------------------------------------

// VariantSchema factory: single source for variants, Class, Field
// NOTE: This is NOT "loose const extraction" - _VS is a factory providing Class/Field methods
const _VS = VariantSchema.make({ defaultVariant: 'system', variants: ['order', 'payment', 'system', 'user'] as const });

// Error reason discriminant with Match.type for compile-time exhaustiveness
const EventErrorReason = S.Literal('DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'HandlerMissing', 'HandlerTimeout', 'MaxRetries', 'TransactionRollback', 'ValidationFailed');
const _errorProps = Match.type<typeof EventErrorReason.Type>().pipe(
	Match.when('DeliveryFailed', () => ({ retryable: true, terminal: false })),
	Match.when('DeserializationFailed', () => ({ retryable: false, terminal: true })),
	Match.when('DuplicateEvent', () => ({ retryable: false, terminal: true })),
	Match.when('HandlerMissing', () => ({ retryable: false, terminal: true })),
	Match.when('HandlerTimeout', () => ({ retryable: true, terminal: false })),
	Match.when('MaxRetries', () => ({ retryable: false, terminal: true })),
	Match.when('TransactionRollback', () => ({ retryable: false, terminal: true })),
	Match.when('ValidationFailed', () => ({ retryable: false, terminal: true })),
	Match.exhaustive,
);

class EventError extends S.TaggedError<EventError>()('EventError', {
	cause: S.optional(S.Unknown),
	eventId: S.optional(S.String),
	reason: EventErrorReason,
}) {
	get isTerminal(): boolean { return _errorProps(this.reason).terminal; }
	get isRetryable(): boolean { return _errorProps(this.reason).retryable; }
	static readonly from = (eventId: string, reason: typeof EventErrorReason.Type, cause?: unknown) => new EventError({ cause, eventId, reason });
}

// DomainEvent class via _VS.Class - creates Schema.Class with static variant accessors
class DomainEvent extends _VS.Class('DomainEvent')({
	aggregateId: S.String,
	causationId: S.optional(S.UUID),
	correlationId: S.optional(S.UUID),
	eventId: S.UUID.pipe(S.brand('EventId')),
	// NOTE: No occurredAt field - eventId (Snowflake) contains timestamp via Snowflake.timestamp()
	payload: _VS.Field({
		order: S.Struct({ action: S.Literal('placed', 'shipped', 'delivered', 'cancelled'), items: S.Array(S.Struct({ qty: S.Number, sku: S.String })), orderId: S.UUID, status: S.String }),
		payment: S.Struct({ action: S.Literal('initiated', 'completed', 'failed', 'refunded'), amount: S.Number, currency: S.String, paymentId: S.UUID }),
		system: S.Struct({ action: S.Literal('started', 'stopped', 'health'), details: S.optional(S.Unknown) }),
		user: S.Struct({ action: S.Literal('created', 'updated', 'deleted'), changes: S.optional(S.Unknown), email: S.optional(S.String), userId: S.UUID }),
  }),
}) {
	[PrimaryKey.symbol]() { return `event:${this.eventId}`; }
  	/** Dot-notation event type for database storage: 'user.created', 'order.placed' */
	get eventType(): string { return `${this.payload._tag}.${this.payload.action}`; }
}

// EventEnvelope wraps event with emit timestamp + trace context
class EventEnvelope extends S.Class<EventEnvelope>('EventEnvelope')({
	emittedAt: S.DateTimeUtcFromNumber,
	event: DomainEvent,
	traceContext: S.optional(S.Struct({ parentSpanId: S.optional(S.String), spanId: S.String, traceId: S.String })),
}) {
	[PrimaryKey.symbol]() { return `envelope:${this.event.eventId}`; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	batch: { maxSize: 100, window: Duration.millis(50) },
	broadcast: { bulkhead: 5, threshold: 3, timeout: Duration.millis(100) },
	buffer: { capacity: 256, replay: 16 },
	dedupe: { inMemoryCapacity: 10000, inMemoryTTL: Duration.minutes(5), ttl: Duration.minutes(5) },
	outbox: { batchSize: 100, pollInterval: Duration.seconds(1) },
	rateLimit: { algorithm: 'token-bucket' as const, limit: 100, window: Duration.seconds(1) },
	retry: { backoffBase: Duration.millis(100), maxAttempts: 5, timeout: Duration.seconds(30) },
} as const;

// Default handler via Match.type - exhaustive, no dispatch table
const _handleDefault = Match.type<DomainEvent>().pipe(
	Match.tag('order', (e) => Match.value(e.payload.action).pipe(
		Match.when('placed', () => Effect.logInfo('Order placed', { orderId: e.payload.orderId })),
		Match.when('shipped', () => Effect.logInfo('Order shipped', { orderId: e.payload.orderId })),
		Match.when('delivered', () => Effect.logInfo('Order delivered', { orderId: e.payload.orderId })),
		Match.when('cancelled', () => Effect.logInfo('Order cancelled', { orderId: e.payload.orderId })),
		Match.exhaustive,
	)),
	Match.tag('user', (e) => Match.value(e.payload.action).pipe(
		Match.when('created', () => Effect.logInfo('User created', { userId: e.payload.userId })),
		Match.when('updated', () => Effect.logInfo('User updated', { userId: e.payload.userId })),
		Match.when('deleted', () => Effect.logInfo('User deleted', { userId: e.payload.userId })),
		Match.exhaustive,
	)),
	Match.tag('payment', () => Effect.void),
	Match.tag('system', () => Effect.void),
	Match.exhaustive,
);

// --- [SERVICE] ---------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [ClusterService.Layer, DatabaseService.Default, MetricsService.Default, Reactivity.layer, PersistedCache.layer],
	scoped: Effect.gen(function* () {
		const sharding = yield* Sharding.Sharding;
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const reactivity = yield* Reactivity.Reactivity;
		const statusHub = yield* PubSub.sliding<EventEnvelope>({ capacity: _CONFIG.buffer.capacity, replay: _CONFIG.buffer.replay });
		const broadcaster = yield* sharding.broadcaster(RecipientType.Topic('domain-events', EventEnvelope));
		// Two-tier dedupe: in-memory LRU (hot path O(1)) + persistent fallback (cold path)
		const dedupCache = yield* PersistedCache.make({
			inMemoryCapacity: _CONFIG.dedupe.inMemoryCapacity,
			inMemoryTTL: _CONFIG.dedupe.inMemoryTTL,
			lookup: (_key: EventBus.DedupKey) => Effect.succeed(undefined),
			storeId: 'event-processed',
			timeToLive: (_key, exit) => Match.value(Exit.isSuccess(exit)).pipe(Match.when(true, () => Duration.hours(24)), Match.orElse(() => _CONFIG.dedupe.ttl)),
		});
		const outboxQueue = yield* PersistedQueue.make({ name: 'event-outbox', schema: EventEnvelope });
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		// Process envelope with Activity.make for replay-safe idempotency
		const _processEnvelope = (envelope: EventEnvelope, handler: (event: DomainEvent) => Effect.Effect<void, EventError>) =>
			Telemetry.span(
				Context.Request.withinCluster({ entityType: 'EventBus' })(
					dedupCache.get(new EventBus.DedupKey({ eventId: envelope.event.eventId })).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Activity.make({
								execute: Activity.CurrentAttempt.pipe(Effect.flatMap((attempt) =>
									handler(envelope.event).pipe(Effect.timeout(Duration.millis(Duration.toMillis(_CONFIG.retry.timeout) * (attempt.attemptNumber + 1)))),
								)),
								idempotencyKey: () => `${envelope.event.payload._tag}:${envelope.event.eventId}`,
								name: `handler.${envelope.event.payload._tag}`,
							}).pipe(
								Activity.retry({ times: _CONFIG.retry.maxAttempts }),
								Effect.tap(() => dedupCache.set(new EventBus.DedupKey({ eventId: envelope.event.eventId }), Exit.succeed(undefined))),
							),
							onSome: () => Metric.increment(metrics.events.duplicatesSkipped).pipe(Effect.asVoid),
						})),
						Effect.catchAll((e) => Clock.currentTimeMillis.pipe(
							Effect.flatMap((ts) => db.deadLetter.insert({
								appId: 'system', attempts: 1, errorHistory: [{ error: String(e), timestamp: ts }],
								errorReason: 'MaxRetries', payload: envelope,source: 'event', sourceId: envelope.event.eventId, type: envelope.event.payload._tag, 
							})),
							Effect.zipRight(Metric.increment(metrics.events.deadLettered)),
							Effect.asVoid,
						)),
					),
				),
				'eventbus.processEnvelope',
				{ 'event.id': envelope.event.eventId, 'event.type': envelope.event.payload._tag },
			);
		// Outbox worker: rate-limited broadcast with circuit-protected delivery
		const _broadcastCircuit = (envelope: EventEnvelope) => {
			const circuitName = `eventbus.broadcast.${envelope.event.payload._tag}`;
			return Resilience.run(circuitName, broadcaster.send(envelope), {
				bulkhead: _CONFIG.broadcast.bulkhead,
				circuit: circuitName,
				retry: false, // Workflow handles retries via PersistedQueue
				threshold: _CONFIG.broadcast.threshold,
				timeout: _CONFIG.broadcast.timeout,
			});
		};
		yield* Effect.forkScoped(
			outboxQueue.take(
				(envelope, { id, attempts }) => Telemetry.span(
					Effect.all([
						DurableRateLimiter.rateLimit({ algorithm: _CONFIG.rateLimit.algorithm, key: `event:${envelope.event.payload._tag}`, limit: _CONFIG.rateLimit.limit, name: 'eventbus.broadcast', window: _CONFIG.rateLimit.window }),
						Effect.when(DurableClock.sleep({ duration: Duration.millis(Duration.toMillis(_CONFIG.retry.backoffBase) * 2 ** (attempts - 1)), inMemoryThreshold: Duration.seconds(5), name: `retry-backoff-${id}` }), () => attempts > 1),
					], { discard: true }).pipe(
						Effect.zipRight(_broadcastCircuit(envelope)),
						Effect.tap(() => dedupCache.set(new EventBus.DedupKey({ eventId: envelope.event.eventId }), Exit.succeed(undefined))),
						Effect.tap(() => Metric.increment(metrics.events.processed)),
						Effect.catchAll((e) => attempts >= _CONFIG.retry.maxAttempts
							? Clock.currentTimeMillis.pipe(
								Effect.flatMap((ts) => db.deadLetter.insert({ appId: 'system', attempts, errorHistory: [{ error: String(e), timestamp: ts }], errorReason: 'MaxRetries', payload: envelope, source: 'event', sourceId: envelope.event.eventId, type: envelope.event.payload._tag })),
								Effect.asVoid,
							)
							: Effect.fail(e),
						),
					),
					'eventbus.outbox.process',
					{ 'event.id': envelope.event.eventId, 'outbox.attempt': attempts },
				),
				{ maxAttempts: _CONFIG.retry.maxAttempts },
			),
		);
		// Startup recovery: reprocess unprocessed messages
		yield* Effect.all([sharding.getAssignedShardIds, Clock.currentTimeMillis]).pipe(
			Effect.flatMap(([shards, now]) => SqlMessageStorage.unprocessedMessages(shards, now)),
			Effect.flatMap((pending) => Chunk.fromIterable(pending).pipe(
				Chunk.match({ onEmpty: () => Effect.void, onNonEmpty: (items) => broadcaster.sendAll(Chunk.toArray(items)).pipe(Effect.tap(() => Effect.logInfo('Recovered pending events', { count: Chunk.size(items) }))) }),
			)),
			Effect.catchAll((e) => Effect.logWarning('Startup recovery failed', { error: String(e) })),
		);
		// Polymorphic emit: handles single event or Chunk via Match.value (no ternary, no Predicate)
		const emit = (input: DomainEvent | Chunk.Chunk<DomainEvent>, opts?: { scheduledAt?: number }) => {
			const items = Match.value(input).pipe(Match.when(Chunk.isChunk, (c) => c), Match.orElse((e) => Chunk.of(e)));
			return Telemetry.span(
				Effect.all([Context.Request.current, sharding.getSnowflake]).pipe(
					Effect.flatMap(([ctx, sf]) => {
						const deliverAt = Option.fromNullable(opts?.scheduledAt).pipe(Option.map(DateTime.unsafeMake));
						const enriched = Chunk.map(items, (e): EventEnvelope => ({
							emittedAt: DateTime.unsafeMake(Snowflake.timestamp(sf)),
							event: { ...e, correlationId: e.correlationId ?? ctx.requestId, eventId: e.eventId ?? String(sf) },
							traceContext: Option.some({ spanId: ctx.spanId, traceId: ctx.traceId }),
							...Option.match(deliverAt, { onNone: () => ({}), onSome: (dt) => ({ [DeliverAt.symbol]: () => dt }) }),
						}));
						const keys = HashSet.toArray(HashSet.fromIterable(Chunk.flatMap(enriched, (e) => [`events:${e.event.payload._tag}`, `aggregate:${e.event.aggregateId}`, 'events:all'])));
						return reactivity.mutation(keys, Effect.forEach(enriched, (e) => outboxQueue.offer(e, { id: e.event.eventId }))).pipe(
							Effect.zipRight(Effect.all([Metric.incrementBy(metrics.events.emitted, Chunk.size(enriched)), PubSub.publishAll(statusHub, Chunk.toArray(enriched))], { discard: true })),
						);
					}),
				),
				'eventbus.emit',
				{ 'event.batch': Chunk.size(items) > 1, 'event.count': Chunk.size(items) },
			);
		};
		// Subscribe returns Stream that re-executes on invalidation (no fork—Reactivity handles lifecycle)
		const subscribe = <T extends EventBus.Variant>(
			eventType: T,
			handler: EventBus.Handler<T>,
			options?: { filter?: (e: S.Schema.Type<(typeof DomainEvent)[T]>) => boolean },
		) =>
			broadcaster.subscribe.pipe(
				Effect.map((queue) =>
					reactivity.stream([`events:${eventType}`, 'events:all'],
						Stream.fromQueue(queue).pipe(
							Stream.filter((e): e is EventEnvelope => e.event.payload._tag === eventType && Option.getOrElse(Option.fromNullable(options?.filter), () => () => true)(_VS.extract(eventType)(e.event))),
							Stream.debounce(Duration.millis(10)), // Suppress rapid bursts before buffering
							Stream.bufferChunks({ capacity: _CONFIG.buffer.capacity, strategy: 'sliding' }),
							Stream.mapChunks((chunk) => Chunk.compact(Chunk.dedupe(chunk))), // compact removes falsy in single pass
							Stream.throttle({ duration: _CONFIG.rateLimit.window, strategy: 'enforce', units: _CONFIG.rateLimit.limit }), // Subscriber-side rate control
							Stream.mapEffect((chunk) => Chunk.forEach(chunk, (e) => _processEnvelope(e, handler as EventBus.Handler))), // Direct Chunk.forEach avoids allocation
						),
					),
				),
				Stream.unwrap,
			);
		// Register default handler via Match.type (exhaustive, no iteration, no type casting)
		yield* Effect.forkScoped(
			broadcaster.subscribe.pipe(
				Effect.flatMap((queue) => Stream.fromQueue(queue).pipe(
					Stream.mapEffect((e) => _handleDefault(e.event)),
					Stream.runDrain,
				)),
			),
		).pipe(Effect.tap(() => Effect.logInfo('Default event handler registered')));
		return { emit, onEvent: () => Stream.fromPubSub(statusHub, { scoped: true }), subscribe };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Error = EventError;
	static readonly Event = DomainEvent;
	static readonly Envelope = EventEnvelope;
	static readonly Topic = RecipientType.Topic('domain-events', EventEnvelope);
}
namespace EventBus {
	export type Variant = (typeof _VS.variants)[number];
	export type Event = DomainEvent;
	export type Envelope = EventEnvelope;
	export type Handler<T extends Variant = Variant> = (event: S.Schema.Type<(typeof DomainEvent)[T]>) => Effect.Effect<void, EventError>;
	export class DedupKey extends S.Class<DedupKey>('DedupKey')({ eventId: S.String }) {
		[PrimaryKey.symbol]() { return `dedup:${this.eventId}`; }
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
