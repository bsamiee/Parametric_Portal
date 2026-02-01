# Phase 5: EventBus & Reliability - Research

**Researched:** 2026-02-01 | **Confidence:** HIGH | **Valid until:** 2026-02-28
**Domain:** Typed domain events, transactional outbox, at-least-once delivery, broadcaster fan-out

## Summary

EventBus implements reliable domain event publishing via `Sharding.broadcaster` for cross-pod fan-out, `Activity.make` for replay-safe idempotency, and `PersistedQueue` for transactional outbox. Single `events.ts` file (~250 LOC) replaces `StreamingService.channel()` with typed contracts via polymorphic VariantSchema.

**Architecture:** Single DomainEvent VariantSchema with hierarchical tags, envelope injection at emit-time (eventId via Snowflake contains timestamp), `PersistedQueue.offer/take` for transactional outbox with built-in idempotency + automatic retry, unified DLQ via Phase 4's `job_dlq` table with `source` discriminator.

**Key Decisions:** (1) Single `_VS` const for VariantSchema—no loose type/const extraction, (2) Fat events with full payload, (3) Polymorphic `emit()` handles single/Chunk via `Match.value`, (4) Unified DLQ with jobs, (5) `broadcaster` over `Entity.make` (fire-and-forget fan-out), (6) `Match.type` exhaustive handlers—no dispatch tables or type casting, (7) `Effect.when`/`Option.match`—no imperative control flow, (8) Unified `EventBus` namespace export with nested types.

## Standard Stack

| Library | Version | Key Imports | Purpose |
|---------|---------|-------------|---------|
| `@effect/cluster` | 0.56.1 | `Sharding.broadcaster`, `RecipientType.Topic`, `Snowflake` | Cluster fan-out, ID generation |
| `@effect/workflow` | 0.2.0 | `Activity.make`, `Workflow.withCompensation`, `DurableDeferred`, `DurableClock`, `DurableQueue` | Replay-safe handlers, sagas, acknowledgment, durable delays |
| `@effect/experimental` | 0.48.0 | `VariantSchema.make`, `PersistedCache`, `PersistedQueue`, `Reactivity`, `Machine` | Schema variants, two-tier cache, outbox, invalidation, state machines |
| `effect` | 3.19.15 | `PubSub.sliding`, `Chunk`, `HashSet`, `Match.type`, `Predicate`, `Request`, `RequestResolver` | Backpressure, polymorphic handling, batched lookups |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Sharding.broadcaster` | Local PubSub | Single-pod only, no cluster fan-out |
| `Activity.make` | Manual dedupe table | Loses replay-safety, more code |
| `PersistedQueue` | Manual outbox + polling | Loses built-in idempotency + retry |
| VariantSchema.Class | Tagged union per file | Fragmented, no single source of truth |
| Data-driven `_Actions` | Inline literals | Duplication, no single source of truth |

**Installation:** All packages in pnpm-workspace.yaml catalog. No new dependencies.

## Implementation Files

```
packages/server/src/
├── events/
│   └── events.ts       # EventBus service (~250 LOC) - schema + bus + handlers merged
├── observe/
│   ├── devtools.ts     # Optional DevTools layer (~25 LOC)
│   └── metrics.ts      # EXTEND: Add event metrics
└── infra/
    └── cluster.ts      # Reference for patterns

packages/database/
├── migrations/
│   └── 0003_event_outbox.ts  # Outbox + DLQ extension (~25 LOC)
└── src/
    ├── models.ts       # EXTEND: EventOutbox model
    └── repos.ts        # EXTEND: eventOutbox repo
```

### File 1: `packages/server/src/events/events.ts`

```typescript
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

// VariantSchema factory: single source for variants, Class, Field (no loose const/type extraction)
const _VS = VariantSchema.make({ variants: ['order', 'payment', 'system', 'user'] as const, defaultVariant: 'system' });

// Error properties: Match.type for compile-time exhaustiveness (vs dispatch table which silently returns undefined on new variants)
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
	Match.exhaustive, // Adding new reason forces handling—dispatch table silently fails
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

// Domain event class via _VS.Class (NOT Events.Struct—Struct not extendable)
// Creates Schema.Class with static variant accessors: DomainEvent.order, DomainEvent.user, etc.
class DomainEvent extends _VS.Class('DomainEvent')({
	eventId: S.UUID.pipe(S.brand('EventId')),
	aggregateId: S.String,
	correlationId: S.optional(S.UUID),
	causationId: S.optional(S.UUID),
	// NOTE: No occurredAt field—eventId (Snowflake) contains timestamp via Snowflake.timestamp()
	payload: _VS.Field({
		order: S.Struct({ action: S.Literal('placed', 'shipped', 'delivered', 'cancelled'), orderId: S.UUID, status: S.String, items: S.Array(S.Struct({ sku: S.String, qty: S.Number })) }),
		payment: S.Struct({ action: S.Literal('initiated', 'completed', 'failed', 'refunded'), paymentId: S.UUID, amount: S.Number, currency: S.String }),
		system: S.Struct({ action: S.Literal('started', 'stopped', 'health'), details: S.optional(S.Unknown) }),
		user: S.Struct({ action: S.Literal('created', 'updated', 'deleted'), userId: S.UUID, email: S.optional(S.String), changes: S.optional(S.Unknown) }),
	}),
}) {
	[PrimaryKey.symbol]() { return `event:${this.eventId}`; }
}

// Envelope wraps event with emit timestamp + trace context (Class for PrimaryKey + static accessors)
class EventEnvelope extends S.Class<EventEnvelope>('EventEnvelope')({
	event: DomainEvent,
	emittedAt: S.DateTimeUtcFromNumber,
	traceContext: S.optional(S.Struct({ traceId: S.String, spanId: S.String, parentSpanId: S.optional(S.String) })),
}) {
	[PrimaryKey.symbol]() { return `envelope:${this.event.eventId}`; }
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	batch: { maxSize: 100, window: Duration.millis(50) },
	broadcast: { bulkhead: 5, threshold: 3, timeout: Duration.millis(100) },
	buffer: { capacity: 256, replay: 16 },
	dedupe: { ttl: Duration.minutes(5), inMemoryCapacity: 10000, inMemoryTTL: Duration.minutes(5) },
	rateLimit: { window: Duration.seconds(1), limit: 100, algorithm: 'token-bucket' as const },
	retry: { maxAttempts: 5, timeout: Duration.seconds(30), backoffBase: Duration.millis(100) },
} as const;

// Default event handler via Match.type—exhaustive, no type casting, no dispatch table
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
			storeId: 'event-processed',
			lookup: (key: EventBus.DedupKey) => Effect.succeed(undefined),
			timeToLive: (_key, exit) => Match.value(Exit.isSuccess(exit)).pipe(Match.when(true, () => Duration.hours(24)), Match.orElse(() => _CONFIG.dedupe.ttl)),
			inMemoryCapacity: _CONFIG.dedupe.inMemoryCapacity,
			inMemoryTTL: _CONFIG.dedupe.inMemoryTTL,
		});
		const outboxQueue = yield* PersistedQueue.make({ name: 'event-outbox', schema: EventEnvelope });

		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });

		// Process envelope with Activity.make for replay-safe idempotency
		const _processEnvelope = (envelope: EventEnvelope, handler: (event: DomainEvent) => Effect.Effect<void, EventError>) =>
			Telemetry.span(
				Context.Request.withinCluster({ entityType: 'EventBus' })(
					dedupCache.get(new EventBus.DedupKey({ eventId: envelope.event.eventId })).pipe(
						Effect.flatMap(Option.match({
							onSome: () => Metric.increment(metrics.events.duplicatesSkipped).pipe(Effect.asVoid),
							onNone: () => Activity.make({
								name: `handler.${envelope.event.payload._tag}`,
								idempotencyKey: () => `${envelope.event.payload._tag}:${envelope.event.eventId}`,
								execute: Activity.CurrentAttempt.pipe(Effect.flatMap((attempt) =>
									handler(envelope.event).pipe(Effect.timeout(Duration.millis(Duration.toMillis(_CONFIG.retry.timeout) * (attempt.attemptNumber + 1)))),
								)),
							}).pipe(
								Activity.retry({ times: _CONFIG.retry.maxAttempts }),
								Effect.tap(() => dedupCache.set(new EventBus.DedupKey({ eventId: envelope.event.eventId }), Exit.succeed(undefined))),
							),
						})),
						Effect.catchAll((e) => Clock.currentTimeMillis.pipe(
							Effect.flatMap((ts) => db.deadLetter.insert({
								appId: 'system', attempts: 1, errorHistory: [{ error: String(e), timestamp: ts }],
								errorReason: 'MaxRetries', source: 'event', sourceId: envelope.event.eventId, type: envelope.event.payload._tag, payload: envelope,
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
						DurableRateLimiter.rateLimit({ name: 'eventbus.broadcast', algorithm: _CONFIG.rateLimit.algorithm, window: _CONFIG.rateLimit.window, limit: _CONFIG.rateLimit.limit, key: `event:${envelope.event.payload._tag}` }),
						Effect.when(DurableClock.sleep({ name: `retry-backoff-${id}`, duration: Duration.millis(Duration.toMillis(_CONFIG.retry.backoffBase) * Math.pow(2, attempts - 1)), inMemoryThreshold: Duration.seconds(5) }), () => attempts > 1),
					], { discard: true }).pipe(
						Effect.zipRight(_broadcastCircuit(envelope)),
						Effect.tap(() => dedupCache.set(new EventBus.DedupKey({ eventId: envelope.event.eventId }), Exit.succeed(undefined))),
						Effect.tap(() => Metric.increment(metrics.events.processed)),
						Effect.catchAll((e) => attempts >= _CONFIG.retry.maxAttempts
							? Clock.currentTimeMillis.pipe(
								Effect.flatMap((ts) => db.deadLetter.insert({ appId: 'system', attempts, errorHistory: [{ error: String(e), timestamp: ts }], errorReason: 'MaxRetries', source: 'event', sourceId: envelope.event.eventId, type: envelope.event.payload._tag, payload: envelope })),
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
							event: { ...e, eventId: e.eventId ?? String(sf), correlationId: e.correlationId ?? ctx.requestId },
							emittedAt: DateTime.unsafeMake(Snowflake.timestamp(sf)),
							traceContext: Option.some({ traceId: ctx.traceId, spanId: ctx.spanId }),
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
							Stream.throttle({ units: _CONFIG.rateLimit.limit, duration: _CONFIG.rateLimit.window, strategy: 'enforce' }), // Subscriber-side rate control
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

		return { emit, subscribe, onEvent: () => Stream.fromPubSub(statusHub, { scoped: true }) };
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
```

### File 2: `packages/server/src/observe/devtools.ts`

```typescript
import { DevTools } from '@effect/experimental';
import { NodeSocket } from '@effect/platform-node';
import { Config, Duration, Effect, Layer, Match, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = { timeout: Duration.seconds(1), url: 'ws://localhost:34437' } as const;

// --- [LAYERS] ----------------------------------------------------------------

// DevToolsLayer with inline tracer and connection test—no loose const
const DevToolsLayer = Layer.unwrapEffect(
	Effect.all({ env: Config.string('NODE_ENV').pipe(Config.withDefault('development')), enabled: Config.boolean('DEVTOOLS_ENABLED').pipe(Config.withDefault(false)) }).pipe(
		Effect.map(({ env, enabled }) => env !== 'production' && enabled),
		Effect.filterOrElse((shouldConnect) => shouldConnect, () => Effect.succeed(Layer.empty)),
		Effect.flatMap(() => Effect.async<boolean>((resume) => {
			const ws = new WebSocket(_CONFIG.url);
			ws.onopen = () => { ws.close(); resume(Effect.succeed(true)); };
			ws.onerror = () => { ws.close(); resume(Effect.succeed(false)); };
			return Effect.sync(() => ws.close());
		}).pipe(Effect.timeout(_CONFIG.timeout), Effect.map(Option.getOrElse(() => false)))),
		Effect.filterOrElse((available) => available, () => Effect.logDebug('DevTools server unavailable').pipe(Effect.as(Layer.empty))),
		Effect.flatMap(() => Effect.logInfo('DevTools tracer enabled').pipe(Effect.as(
			DevTools.Client.layerTracer.pipe(Layer.provide(NodeSocket.layerWebSocket(_CONFIG.url))),
		))),
	),
);

// --- [EXPORT] ----------------------------------------------------------------

export { DevToolsLayer };
```

### File 3: `packages/database/migrations/0003_event_outbox.ts`

```typescript
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`
		CREATE TABLE event_outbox (
			id UUID PRIMARY KEY DEFAULT uuidv7(),
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
			event_id UUID NOT NULL UNIQUE,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			published_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			CONSTRAINT event_outbox_status_check CHECK (status IN ('pending', 'published', 'failed'))
		)
	`;
	yield* sql`CREATE INDEX idx_event_outbox_pending ON event_outbox(status, created_at) WHERE status = 'pending'`;
	yield* sql`CREATE INDEX idx_event_outbox_event_id ON event_outbox(event_id)`;
	yield* sql`ALTER TABLE job_dlq ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'job'`;
	yield* sql`ALTER TABLE job_dlq ADD CONSTRAINT job_dlq_source_check CHECK (source IN ('job', 'event'))`;
	yield* sql`CREATE INDEX idx_dlq_source ON job_dlq(source, error_reason) WHERE replayed_at IS NULL`;
});
```

## Persistence API Reference

### PersistedCache (Recommended)

Two-tier caching: in-memory LRU (hot path O(1)) + persistent fallback (cold path). Use for high-throughput deduplication (10K+ events/sec).

```typescript
import { PersistedCache } from '@effect/experimental';

// DedupKey nested in EventBus namespace—colocated with consumer
// Keys MUST implement PrimaryKey.symbol—raw strings fail at runtime
const dedupCache = yield* PersistedCache.make({
	storeId: 'event-processed',
	lookup: (key: EventBus.DedupKey) => Effect.succeed(undefined), // Cache miss returns undefined
	timeToLive: (_key, exit) => Match.value(Exit.isSuccess(exit)).pipe(
		Match.when(true, () => Duration.hours(24)),
		Match.orElse(() => Duration.minutes(5)),
	),
	inMemoryCapacity: 10000, // LRU eviction threshold
	inMemoryTTL: Duration.minutes(5), // In-memory expiration
});

yield* dedupCache.get(new EventBus.DedupKey({ eventId })); // Hot: in-memory first, cold: persistent fallback
yield* dedupCache.set(key, Exit.succeed(undefined)); // Store Exit (not raw boolean)
yield* dedupCache.invalidate(key); // Force re-lookup on next get
```

### ResultPersistence (Low-Volume)

Persistent-only storage for infrequent lookups. DB round-trip per access.

```typescript
import { Persistence } from '@effect/experimental';

const dedupStore = yield* Persistence.ResultPersistence.pipe(
	Effect.flatMap((p) => p.make({
		storeId: 'event-processed',
		timeToLive: (_key, exit) => Exit.isSuccess(exit) ? Duration.hours(24) : Duration.minutes(5),
	})),
);
```

| Aspect | PersistedCache | ResultPersistence |
|--------|----------------|-------------------|
| **Performance** | O(1) hot path | DB round-trip |
| **Memory** | LRU-bounded | None |
| **Use case** | High-throughput | Low-volume |

## RequestResolver Batching

Automatic request batching for event replay scenarios—multiple concurrent lookups within window batch into single DB query.

```typescript
import { RequestResolver as ExpRequestResolver } from '@effect/experimental';
import { Request, RequestResolver, Duration, Effect, HashMap, Option } from 'effect';

// Request class nested in namespace—colocated with resolver
class GetEventRequest extends Request.TaggedClass('GetEventRequest')<EventBus.Event, EventBus.Error, { readonly eventId: string }>() {}

// Inline resolver—no loose const
const eventLoader = yield* ExpRequestResolver.dataLoader(
	RequestResolver.makeBatched((requests: NonEmptyArray<GetEventRequest>) =>
		db.events.getByIds(requests.map((r) => r.eventId)).pipe(
			Effect.flatMap((results) => Effect.forEach(requests, (req) =>
				Option.match(HashMap.get(results, req.eventId), {
					onSome: (event) => Request.succeed(req, event),
					onNone: () => Request.fail(req, EventBus.Error.from(req.eventId, 'HandlerMissing')),
				}),
			)),
		),
	),
	{ window: Duration.millis(10), maxBatchSize: 100 },
);
```

## Machine State Patterns

Recoverable subscriber state machines with Actor.send dispatch, Procedure.Context.forkWith for background work, and Machine.restore for crash recovery.

```typescript
import { Machine, Procedure, Actor, MachineDefect } from '@effect/experimental';

// Request schemas for typed dispatch via Actor.send
class ProcessEvent extends S.TaggedRequest<ProcessEvent>()('ProcessEvent', { failure: EventError, success: S.Void, payload: { eventId: S.String } }) {}
class GetStatus extends S.TaggedRequest<GetStatus>()('GetStatus', { failure: EventError, success: S.Struct({ status: S.String, count: S.Number }), payload: {} }) {}

const SubscriberMachine = Machine.makeSerializable({
	state: S.Struct({ status: S.Literal('idle', 'processing', 'paused'), lastEventId: S.optional(S.String), processedCount: S.Number }),
	requests: S.Union(ProcessEvent, GetStatus),
})({
	init: (input: { subscriberId: string }, previousState?) => Effect.gen(function* () {
		const state = previousState ?? { status: 'idle' as const, processedCount: 0 };
		return Procedure.make<typeof SubscriberMachine.requests.Type, typeof SubscriberMachine.state.Type>()
			('ProcessEvent', (ctx) => ctx.forkWith({ ...ctx.state, status: 'processing' })(
				Effect.succeed({ ...ctx.state, lastEventId: ctx.request.eventId, processedCount: ctx.state.processedCount + 1 }),
			).pipe(Effect.map(([_, s]) => [undefined, s] as const)))
			('GetStatus', (ctx) => Effect.succeed([{ status: ctx.state.status, count: ctx.state.processedCount }, ctx.state] as const));
	}),
});

// Startup: restore from persisted snapshot or boot fresh
const snapshot = yield* db.machineSnapshots.get('subscriber:sub-1').pipe(Effect.option);
const actor = yield* Option.match(snapshot, {
	onNone: () => Machine.boot(SubscriberMachine, { subscriberId: 'sub-1' }),
	onSome: (s) => Machine.restore(SubscriberMachine, s), // Resume with full state
});
yield* Actor.send(actor, new ProcessEvent({ eventId: 'evt-123' })); // Typed dispatch—returns Effect<Void, EventError>
// Actor.subscribe replaces manual PubSub for state change streams
const stateChanges = Actor.subscribe(actor); // Stream<State>—re-emits on each state transition
yield* Effect.addFinalizer(() => Machine.snapshot(actor).pipe(Effect.flatMap((s) => db.machineSnapshots.set('subscriber:sub-1', s))));

// Machine.retry for init failure recovery (vs defectRetryPolicy which handles running defects only)
const ResilientMachine = Machine.retry(Schedule.exponential(Duration.millis(100)).pipe(Schedule.compose(Schedule.recurs(5))))(SubscriberMachine);
```

## DurableRateLimiter Throttling

Cluster-wide rate limiting within workflows—coordinates across all pods via persistent storage.

```typescript
import { DurableRateLimiter } from '@effect/workflow';

// Inline rate limit call—no loose const factory
// Usage in webhook worker:
Effect.gen(function* () {
	yield* DurableRateLimiter.rateLimit({
		name: 'webhookDelivery',
		algorithm: 'token-bucket', // OR 'fixed-window' (resets at boundary)
		window: Duration.seconds(1),
		limit: 10, // 10 webhooks/second per destination
		key: `webhook:${payload.webhookUrl}`,
	});
	yield* sendWebhook(payload);
});

// Variable token consumption for expensive operations (inline, not loose const)
yield* DurableRateLimiter.rateLimit({
	name: 'apiLimit',
	algorithm: 'token-bucket',
	window: Duration.seconds(1),
	limit: 100,
	key: 'api:heavy',
	tokens: 10, // Consumes 10 tokens (heavy operation)
});
```

## Activity Advanced Patterns

Multi-channel delivery, adaptive retry, current attempt tracking.

```typescript
import { Activity } from '@effect/workflow';

// Multi-provider delivery—first success wins, others cancelled
const DeliverViaFastest = Activity.raceAll('deliveryChannels', [
	Activity.make({ name: 'webhook', execute: sendWebhook(envelope) }),
	Activity.make({ name: 'grpc', execute: sendGrpc(envelope) }),
	Activity.make({ name: 'queue', execute: sendToQueue(envelope) }),
]);

// Adaptive retry—longer timeout on later attempts
const AdaptiveActivity = Activity.make({
	name: 'adaptiveRetry',
	execute: Effect.gen(function* () {
		const attempt = yield* Activity.CurrentAttempt;
		const timeout = Duration.millis(1000 * (attempt.attemptNumber + 1));
		return yield* externalCall.pipe(Effect.timeout(timeout));
	}),
});

// Idempotency key with attempt number for retry-specific tracking
const keyWithAttempt = yield* Activity.idempotencyKey('process', { includeAttempt: true });
// Returns: "process:attempt-1" on first try, "process:attempt-2" on retry
```

## DurableQueue vs PersistedQueue

| Aspect | DurableQueue | PersistedQueue |
|--------|--------------|----------------|
| **Abstraction** | High-level (workflow-native) | Low-level (experimental) |
| **process()** | Submits + blocks until worker completes | N/A (fire-and-forget only) |
| **worker()** | Returns Layer with concurrency control | Manual `take()` loop required |
| **Idempotency** | Built-in via `idempotencyKey` | Via `id` parameter on `offer()` |
| **Context** | Requires WorkflowEngine | Standalone |
| **Use case** | Webhook delivery with ack | Event outbox (transactional) |

```typescript
import { DurableQueue } from '@effect/workflow';

const WebhookQueue = DurableQueue.make({
	name: 'WebhookQueue',
	payload: S.Struct({ webhookUrl: S.String, eventId: S.String, body: S.Unknown }),
	success: S.Struct({ statusCode: S.Number }),
	error: EventError,
	idempotencyKey: (p) => p.eventId,
});

// Enqueue and await completion (blocks until worker processes)
const result = yield* DurableQueue.process(WebhookQueue, payload);

// Worker Layer with HttpClient combinators—no manual retry/timeout/header logic
const WebhookWorkerLayer = DurableQueue.worker(
	WebhookQueue,
	Effect.fn(function* ({ webhookUrl, eventId, body }) {
		const client = yield* HttpClient.HttpClient;
		const sig = yield* computeHmacSignature(body, eventId);
		return yield* HttpClientRequest.post(webhookUrl).pipe(
			HttpClientRequest.bodyJson(body),
			HttpClientRequest.setHeaders(Headers.fromInput({ 'X-Webhook-Signature': sig, 'Content-Type': 'application/json', 'X-Event-Id': eventId })),
			client.execute,
			HttpClient.filterStatusOk, // Fail with ResponseError on non-2xx
			HttpClientResponse.schemaBodyJson(S.Struct({ statusCode: S.Number })), // Validate ack response
			HttpClient.retryTransient({ mode: 'both', times: 3, schedule: Schedule.exponential(Duration.millis(100)) }),
			HttpClient.withTracerPropagation(true), // Forward trace context
		);
	}),
	{ concurrency: 5 },
);
```

## Transactional Outbox Pattern

### Transaction Boundary Requirement

Events MUST be offered to outbox within the same SQL transaction as the domain mutation:

```typescript
// CORRECT: emit inside transaction
yield* db.transaction(Effect.gen(function* () {
	yield* db.orders.insert(order);
	yield* eventBus.emit({ _tag: 'order', payload: { action: 'placed', orderId: order.id, ... } });
}));
// Event only visible after transaction commits - no phantom events on rollback

// WRONG: emit outside transaction
yield* db.orders.insert(order);
yield* eventBus.emit(...); // If this fails, order exists without event!
```

### PersistedQueue Transaction Semantics

`PersistedQueue.offer()` participates in the current SQL transaction when called within a transactional context. The message becomes visible only after commit.

## Reactivity Patterns

### mutation() vs stream()

| Method | Purpose | Re-execution |
|--------|---------|--------------|
| `mutation(keys, effect)` | Wrap writes, invalidate keys after completion | N/A |
| `stream(keys, streamEffect)` | Subscribe to changes, re-execute on invalidation | Yes - entire stream re-created |

### stream() Usage (CRITICAL)

`reactivity.stream()` re-executes the provided Stream on key invalidation. Do NOT fork inside:

```typescript
// WRONG: fork defeats re-execution
reactivity.stream(keys, Effect.gen(function* () {
	yield* Effect.forkScoped(myStream.pipe(Stream.runDrain)); // Runs once, never re-executes!
}));

// CORRECT: return Stream directly
reactivity.stream(keys, myStream); // Re-executes on invalidation
```

## Anti-Patterns

| Don't | Use Instead |
|-------|-------------|
| Redis pub/sub, manual broadcast | `Sharding.broadcaster` — cluster-integrated, typed |
| Manual dedupe table | `Activity.make` with `idempotencyKey` — built-in replay tracking |
| `ResultPersistence` for high-throughput | `PersistedCache` — two-tier with in-memory LRU |
| Manual outbox + polling | `PersistedQueue.offer/take` or `DurableQueue.worker` |
| `Map<string, Handler>`, manual refresh | `Reactivity.mutation/stream` — auto-invalidation |
| `new Set()` for deduplication | `HashSet.fromIterable` — Effect standard |
| `Chunk.filter(Chunk.dedupe(c), pred)` | `Chunk.compact(Chunk.dedupe(c))` — single pass O(n) |
| Manual buffering + timer | `Stream.aggregateWithin(sink, Schedule)` — time-windowed batching |
| No debounce on rapid events | `Stream.debounce(Duration)` — suppress bursts |
| Manual rate limiting in stream | `Stream.throttle({ units, duration, strategy })` — built-in throttle |
| `Effect.forEach(Chunk.toArray(c))` | `Chunk.forEach(c, fn)` — direct iteration, no allocation |
| `Object.keys(obj) as Type[]` | `const tuple as const` — compile-time type safety |
| `Events.Struct({ ... })` | `_VS.Class(id)({ ... })` — Struct not extendable |
| Separate `occurredAt` field | `Snowflake.timestamp(eventId)` or `Snowflake.dateTime(eventId)` — embedded timestamp |
| Logging raw Snowflake IDs | `Snowflake.toParts(sf)` — decompose to timestamp, machineId, sequence for debugging |
| No entity lifecycle monitoring | `sharding.getRegistrationEvents` stream — emits EntityRegistered/SingletonRegistered |
| `sharding.reset` without result check | `Effect.filterOrFail(sharding.reset(id), identity)` — false means reset failed |
| Raw string as Persistence key | `EventBus.DedupKey` class with `PrimaryKey.symbol` — type-safe key |
| `Effect.forkScoped` inside `reactivity.stream` | Return Stream directly — fork defeats re-execution |
| Emit outside SQL transaction | Wrap in `db.transaction()` — prevents phantom events |
| Manual batching logic | `RequestResolver.dataLoader` — automatic time-window batching |
| Ad-hoc `Ref` + `FiberMap` state | `Machine.makeSerializable` — recoverable state machines |
| `Effect.ensuring` in workflow | `Workflow.addFinalizer` — runs once on completion, not every suspend |
| Compensation without Activity wrap | Wrap in `Activity.make` — prevents re-execution on replay |
| `Effect.sleep` for retry delays | `DurableClock.sleep` — survives pod restarts |
| Polling for external completion | `DurableDeferred.await` — durable suspension |
| Non-deterministic ops outside Activity | Wrap in `Activity.make` — ensures same value on replay |
| `Effect.fork` without Activity in workflow | `Activity.make` — fork loses replay tracking |
| Manual Ref-based rate limiting | `DurableRateLimiter.rateLimit` — cluster-wide coordination |
| Sequential delivery to multiple channels | `Activity.raceAll` — first success wins, others cancelled |
| Manual retry logic for HTTP | `HttpClient.retryTransient({ mode: 'both', times: N })` — auto retry classification |
| Manual timeout on HTTP calls | `HttpClient.transform` with `Effect.timeout` — scoped per-request timeout |
| Manual header construction | `Headers.fromInput({ key: value })` — typed header builder |
| Raw `httpClient.post` | `HttpClientRequest.post(url).pipe(bodyJson, setHeaders)` — fluent request building |
| Manual status code checks | `HttpClient.filterStatusOk` — fail with ResponseError on non-2xx |
| No trace propagation | `HttpClient.withTracerPropagation(true)` — forward trace context |
| Logging headers with secrets | `Headers.redact(['Authorization', 'X-Webhook-Signature'])` — safe logging |
| Manual scheduled delivery check | `DeliverAt.isDeliverAt(msg)` + `DeliverAt.toMillis(msg)` — type-safe guards |
| Entity without defect recovery | `Entity.toLayer(h, { defectRetryPolicy: Schedule })` — auto-restart on defects |
| Snowflake string conversion | `Snowflake.SnowflakeFromString` schema — validated conversion with error channel |
| Manual machine boot + Ref state | `Machine.restore(machine, snapshot)` — resume from persisted state |
| Direct method call on machine | `Actor.send(actor, Request)` — typed dispatch, returns `Effect<Success, Error>` |
| Manual PubSub for machine state | `Actor.subscribe(actor)` — typed state change stream |
| Machine init failure unhandled | `Machine.retry(Schedule)(machine)` — retry init failures (vs defectRetryPolicy) |
| Untyped defect in entity handler | `MachineDefect.wrap(cause)` — structured defect tracking |
| Inline state update in Procedure | `ctx.forkWith(state)(effect)` — state-preserving background work |
| `_mkBrandedId` factory helpers | Inline `S.UUID.pipe(S.brand('X'))` — no single-use helpers |
| `_VARIANTS` const extraction | Inline in `VariantSchema.make({ variants: [...] })` — no loose const |
| Optional field on all variants | `_VS.FieldOnly('order', 'payment')(S.UUID)` — variant-restricted fields |
| Excluded field per variant | `_VS.FieldExcept('system')(S.Unknown)` — applies to all except specified |
| `type EventType = ...` extraction | `(typeof _VS.variants)[number]` in namespace — derive, don't duplicate |
| `_ActionSchema` helper function | Inline `S.Literal(...)` in Field mapping — no indirection |
| `_DefaultHandlers` dispatch table | `Match.type` exhaustive handler — no type casting, compile-checked |
| `if (x) { ... }` imperative check | `Effect.when(..., () => condition)` — declarative |
| `condition ? A : B` ternary | `Match.value(condition).pipe(Match.when(...))` — exhaustive |
| `arr.length > 0 ?` empty check | `Chunk.match({ onEmpty, onNonEmpty })` — pattern match |
| `Predicate.hasProperty(x, Symbol.iterator)` | `Match.value(x).pipe(Match.when(Chunk.isChunk, ...))` — typed |
| `(x.payload as { foo: T })` type casting | `_VS.extract(variant)(x)` — runtime-safe variant access |
| Multiple `export { A, B, C }` | Single `export { EventBus }` — unified namespace |
| Module-level `DedupKey` class | `EventBus.DedupKey` in namespace — colocated with consumer |
| `_DomainEventTopic` loose const | `EventBus.Topic` static — no module pollution |

## Critical Pitfalls

| Pitfall | Solution |
|---------|----------|
| Broadcast before commit → phantom events | `PersistedQueue.offer` waits for transaction commit |
| At-least-once + no dedupe → duplicate processing | `Activity.make({ idempotencyKey })` — built-in replay tracking |
| Sync fan-out → slow subscriber blocks all | `PubSub.sliding` + `Stream.bufferChunks({ strategy: 'sliding' })` |
| Manual timer for DB batch writes | `Stream.aggregateWithin(Sink.collectAll(), Schedule.spaced(Duration.seconds(1)))` |
| No burst suppression → handler thrashing | `Stream.debounce(Duration.millis(10))` before processing |
| DB round-trip per dedupe check → latency | `PersistedCache` with `inMemoryCapacity` for hot path O(1) |
| `withCompensation` without Activity wrap → replay re-executes | Always wrap compensation handler in `Activity.make` |
| `Effect.ensuring` in workflow → runs on every suspend | Use `Workflow.addFinalizer` for once-only completion cleanup |
| `Events.Struct` used for class definition → not extendable | Use `_VS.Class(id)({ ... })` from VariantSchema.make |
| `Object.keys()` for variants → loses type safety | Derive via `(typeof _VS.variants)[number]` |
| Raw string key in Persistence → runtime error | Use `EventBus.DedupKey` class implementing `PrimaryKey.symbol` |
| Fork inside `reactivity.stream` → runs once, never re-executes | Return Stream directly; Reactivity manages lifecycle |
| Emit outside transaction → phantom events on rollback | Always emit within `db.transaction()` scope |
| Concurrent lookups without batching → N+1 queries | `RequestResolver.dataLoader` with time window |
| Subscriber crash loses position → reprocess from start | `Machine.restore(machine, snapshot)` — resume from persisted snapshot |
| Non-deterministic ops in workflow → different values on replay | Wrap `Date.now()`, `Math.random()`, external calls in `Activity.make` |
| `Effect.sleep` in workflow → loses position on restart | `DurableClock.sleep` persists to DB for long delays |
| DurableDeferred without token storage → deadlock | Include token in outbound request for external completion |
| `Effect.fork` in workflow without Activity → lost on replay | Use `Activity.make` for tracked execution |
| Type casting `(e.payload as X)` → loses variant safety | Use `_VS.extract(variant)(e)` for runtime-safe access |
| Dispatch table + Object.entries → no compile-time checks | `Match.type` exhaustive pattern matching |
| `if`/ternary control flow → imperative, hard to compose | `Effect.when`, `Match.value`, `Option.match` patterns |
| Module-level loose const pollution → fragmented exports | Colocate in class statics + namespace |

## Open Questions

| Question | Recommendation |
|----------|----------------|
| Dedupe window duration | Start 5 min, adjust per event type based on duplicate rate |
| Schema versioning for breaking changes | Use `fieldEvolve` for migration; prefer additive via `S.optional` |
| Broadcaster vs local PubSub | Broadcaster universally — simpler, negligible overhead for single-pod |
| EventLog vs PersistedQueue | PersistedQueue for fire-and-forget; EventLog for full event sourcing with conflict detection |

## Sources

**Core:** [@effect/cluster Docs](https://effect-ts.github.io/effect/docs/cluster) | [@effect/workflow README](https://github.com/Effect-TS/effect/blob/main/packages/workflow/README.md) | [VariantSchema API](https://effect-ts.github.io/effect/experimental/VariantSchema.ts.html)

**Codebase:** `cluster.ts` (broadcaster patterns), `jobs.ts` (Entity + _StatusProps pattern), `resilience.ts` (composition patterns), `context.ts` (withinCluster)

**Patterns:** [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) | [Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html)

## Metadata

**Confidence:** HIGH — All packages in catalog, patterns validated against cluster.ts/jobs.ts density
**Research date:** 2026-02-01 | **Valid until:** 2026-02-28
