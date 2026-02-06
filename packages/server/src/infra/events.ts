/**
 * EventBus: Domain events via SqlEventJournal with cluster broadcast.
 * Architecture: Journal (durable) -> Changes queue (reactive) -> Subscribers (typed).
 */
import { Sharding, Snowflake } from '@effect/cluster';
import { EventJournal } from '@effect/experimental';
import { SqlEventJournal } from '@effect/sql';
import { Chunk, DateTime, Effect, Metric, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class EventError extends S.TaggedError<EventError>()('EventError', {
	cause: S.optional(S.Unknown),
	eventId: S.optional(S.String),
	reason: S.Literal('DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'ValidationFailed'),
}) {
	static readonly _props = {
		DeliveryFailed: 		{ retryable: true, 	terminal: false },
		DeserializationFailed: 	{ retryable: false, terminal: true },
		DuplicateEvent: 		{ retryable: false, terminal: true },
		ValidationFailed: 		{ retryable: false, terminal: true },
	} as const;
	static readonly from = (eventId: string, reason: EventError['reason'], cause?: unknown) => new EventError({ cause, eventId, reason });
	get isTerminal(): boolean { return EventError._props[this.reason].terminal; }
	get isRetryable(): boolean { return EventError._props[this.reason].retryable; }
}
class DomainEvent extends S.Class<DomainEvent>('DomainEvent')({
	aggregateId: S.String,
	causationId: S.optional(S.UUID),
	correlationId: S.optional(S.UUID),
	eventId: S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('SnowflakeId')),
	payload: S.Unknown,
	tenantId: S.String,
}) {
	[PrimaryKey.symbol]() { return this.eventId; }
	get eventType(): string {
		const payload = this.payload as { _tag?: string; action?: string } | undefined;
		return payload?._tag && payload?.action ? `${payload._tag}.${payload.action}` : 'unknown';
	}
}
class EventEnvelope extends S.Class<EventEnvelope>('EventEnvelope')({
	emittedAt: S.DateTimeUtcFromNumber,
	event: DomainEvent,
}) {}

// --- [CONSTANTS] -------------------------------------------------------------

const _CODEC = {
	decode: S.decode(S.parseJson(EventEnvelope)),
	encode: S.encode(S.parseJson(EventEnvelope)),
} as const;
const _decoder = new TextDecoder();
const _encoder = new TextEncoder();

// --- [SERVICE] ---------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer({ eventLogTable: 'effect_event_journal', remotesTable: 'effect_event_remotes' }), MetricsService.Default, ClusterService.Layers.client],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
		const subscriptions = yield* Ref.make(0);
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		const changesQueue = yield* journal.changes;
		const broadcastStream = Stream.fromQueue(changesQueue).pipe(
			Stream.mapEffect((entry) => Effect.sync(() => _decoder.decode(entry.payload)).pipe(
				Effect.flatMap(_CODEC.decode),
				Effect.tapError((error) => Effect.logWarning('Event envelope decode failed', { error: String(error) })),
				Effect.option,
			)),
			Stream.filterMap((envelope) => envelope),
		);
		const publish = (input: EventBus.Types.Input | readonly EventBus.Types.Input[] | Chunk.Chunk<EventBus.Types.Input>) =>
			Telemetry.span(
				Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
					const items = Chunk.toReadonlyArray(
						Chunk.isChunk(input)
							? input
							: Chunk.fromIterable(Array.isArray(input) ? input : [input] as const),
					);
					return yield* Effect.forEach(items, (item) => sharding.getSnowflake.pipe(
						Effect.map((snowflake) => {
							const eventId = item.eventId ?? (String(snowflake) as typeof DomainEvent.Type['eventId']);
							return new EventEnvelope({
								emittedAt: DateTime.unsafeMake(Snowflake.timestamp(snowflake)),
								event: new DomainEvent({
									aggregateId: item.aggregateId,
									causationId: item.causationId,
									correlationId: item.correlationId ?? requestContext.requestId,
									eventId,
									payload: item.payload,
									tenantId: item.tenantId ?? requestContext.tenantId,
								}),
							});
						}),
						Effect.flatMap((envelope) => _CODEC.encode(envelope).pipe(
							Effect.map((json) => _encoder.encode(json)),
							Effect.flatMap((payload) => journal.write({
								effect: () => Metric.increment(metrics.events.emitted),
								event: envelope.event.eventType,
								payload,
								primaryKey: envelope.event.eventId,
							})),
							Effect.as(envelope),
						)),
					), { concurrency: 'unbounded' });
				}),
				'eventbus.publish',
				{ 'event.count': Chunk.size(Chunk.isChunk(input) ? input : Chunk.fromIterable(Array.isArray(input) ? input : [input])), metrics: false },
			);
		const subscribe = <T, I>(
			eventType: string,
			schema: S.Schema<T, I, never>,
			handler: (event: DomainEvent, payload: T) => Effect.Effect<void, EventError>,
			filter?: (event: DomainEvent) => boolean,) => Stream.unwrapScoped(
			Ref.updateAndGet(subscriptions, (count) => count + 1).pipe(
				Effect.tap((count) => Metric.set(metrics.events.subscriptions, count)),
				Effect.as(
					broadcastStream.pipe(
						Stream.filter((envelope) => envelope.event.eventType === eventType && (filter?.(envelope.event) ?? true)),
						Stream.mapEffect((envelope) => {
							const labels = MetricsService.label({ event_type: eventType });
							return S.validate(schema)(envelope.event.payload).pipe(
								Effect.mapError((error) => EventError.from(envelope.event.eventId, 'ValidationFailed', error)),
								Effect.flatMap((payload) => Telemetry.span(
									handler(envelope.event, payload).pipe(
										Effect.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.events.processed, labels))),
										Effect.tapError((error) => error.reason === 'DuplicateEvent'
											? Metric.increment(Metric.taggedWithLabels(metrics.events.duplicatesSkipped, labels))
											: Effect.void),
									),
									'eventbus.handle',
									{ 'event.type': eventType, metrics: false },
								)),
							);
						}),
						Stream.ensuring(Ref.updateAndGet(subscriptions, (count) => Math.max(0, count - 1)).pipe(Effect.flatMap((count) => Metric.set(metrics.events.subscriptions, count)),),),
					),
				),
			),
		);
		const stream = (): Stream.Stream<EventEnvelope, never, never> => broadcastStream;
		yield* Effect.logInfo('EventBus initialized with SqlEventJournal');
		return { publish, stream, subscribe };
	}),
}) {
	static readonly Model = {
		Envelope: EventEnvelope,
		Error: EventError,
		Event: DomainEvent,
	} as const;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace EventBus {
	export namespace Types {
		export type Error = InstanceType<typeof EventBus.Model.Error>;
		export type Event = S.Schema.Type<typeof EventBus.Model.Event>;
		export type Envelope = S.Schema.Type<typeof EventBus.Model.Envelope>;
		export type Input = {
			readonly aggregateId: string; readonly causationId?: string; readonly correlationId?: string;
			readonly eventId?: Event['eventId']; readonly payload: unknown; readonly tenantId?: string;
		};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
