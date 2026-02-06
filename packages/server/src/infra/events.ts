/**
 * EventBus: Domain events via SqlEventJournal with cluster broadcast.
 * Architecture: Journal (durable) → Changes queue (reactive) → Subscribers (typed).
 */
import { EventJournal } from '@effect/experimental';
import { SqlEventJournal } from '@effect/sql';
import { Sharding, Snowflake } from '@effect/cluster';
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
		DeliveryFailed:        { retryable: true,  terminal: false },
		DeserializationFailed: { retryable: false, terminal: true  },
		DuplicateEvent:        { retryable: false, terminal: true  },
		ValidationFailed:      { retryable: false, terminal: true  },
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
		const p = this.payload as { _tag?: string; action?: string } | undefined;
		return p?._tag && p?.action ? `${p._tag}.${p.action}` : 'unknown';
	}
}
class EventEnvelope extends S.Class<EventEnvelope>('EventEnvelope')({
	emittedAt: S.DateTimeUtcFromNumber,
	event: DomainEvent,
}) {}

// --- [SERVICE] ---------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer({ eventLogTable: 'effect_event_journal', remotesTable: 'effect_event_remotes' }), MetricsService.Default, ClusterService.LayerClient],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
		const subscriptions = yield* Ref.make(0);
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		const changesQueue = yield* journal.changes;
		const broadcastStream: Stream.Stream<EventEnvelope, never, never> = Stream.fromQueue(changesQueue).pipe(
			Stream.mapEffect((entry) => Effect.sync(() => new TextDecoder().decode(entry.payload)).pipe(Effect.flatMap(S.decode(S.parseJson(EventEnvelope))),),),
			Stream.catchAll(() => Stream.empty),
		);
		const writeEnvelope = (envelope: EventEnvelope) => Effect.gen(function* () {
			const json = yield* S.encode(S.parseJson(EventEnvelope))(envelope);
			const payload = new TextEncoder().encode(json);
			return yield* journal.write({
				effect: () => Metric.increment(metrics.events.emitted),
				event: envelope.event.eventType,
				payload,
				primaryKey: envelope.event.eventId,
			});
		});
			const emit = (input: EventBus.Input | Chunk.Chunk<EventBus.Input>) => {
				const items = Chunk.isChunk(input) ? input : Chunk.of(input);
				return Telemetry.span(
					Effect.gen(function* () {
						const [ctx, snowflake] = yield* Effect.all([Context.Request.current, sharding.getSnowflake]);
					const envelopes = Chunk.map(items, (event): EventEnvelope => new EventEnvelope({
						emittedAt: DateTime.unsafeMake(Snowflake.timestamp(snowflake)),
						event: new DomainEvent({
							aggregateId: event.aggregateId,
							causationId: event.causationId,
							correlationId: event.correlationId ?? ctx.requestId,
							eventId: event.eventId ?? (String(snowflake) as typeof DomainEvent.Type['eventId']),
							payload: event.payload,
							tenantId: event.tenantId ?? ctx.tenantId,
						}),
					}));
					return yield* Effect.forEach(envelopes, writeEnvelope);
					}),
					'eventbus.emit',
					{ 'event.count': Chunk.size(items), metrics: false },
				);
			};
			const subscribe = <T, I>(
				eventType: string,
				schema: S.Schema<T, I, never>,
				handler: (event: DomainEvent, payload: T) => Effect.Effect<void, EventError>,
				filter?: (event: DomainEvent) => boolean,) =>
				Stream.unwrapScoped(
					Ref.updateAndGet(subscriptions, (count) => count + 1).pipe(
						Effect.tap((count) => Metric.set(metrics.events.subscriptions, count)),
						Effect.as(
							broadcastStream.pipe(
								Stream.filter((env) => env.event.eventType === eventType && (filter?.(env.event) ?? true)),
								Stream.mapEffect((env) => {
									const labels = MetricsService.label({ event_type: eventType });
									return S.validate(schema)(env.event.payload).pipe(
										Effect.mapError((error) => EventError.from(env.event.eventId, 'ValidationFailed', error)),
										Effect.flatMap((payload) => Telemetry.span(
											handler(env.event, payload).pipe(
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
								Stream.ensuring(
									Ref.updateAndGet(subscriptions, (count) => Math.max(0, count - 1)).pipe(
										Effect.flatMap((count) => Metric.set(metrics.events.subscriptions, count)),
									),
								),
							),
						),
					),
				);
		const onEvent = (): Stream.Stream<EventEnvelope, never, never> => broadcastStream;
		yield* Effect.logInfo('EventBus initialized with SqlEventJournal');
		return { emit, onEvent, subscribe };
	}),
}) {
	static readonly Error = EventError;
	static readonly Event = DomainEvent;
	static readonly Envelope = EventEnvelope;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace EventBus {
	export type Error = EventError;
	export type Event = DomainEvent;
	export type Envelope = EventEnvelope;
	export type Input = {
		readonly aggregateId: string;
		readonly causationId?: string;
		readonly correlationId?: string;
		readonly eventId?: typeof DomainEvent.Type['eventId'];
		readonly payload: unknown;
		readonly tenantId?: string;
	};
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
