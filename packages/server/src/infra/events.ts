/**
 * EventBus: Domain events via SqlEventJournal with cluster broadcast.
 * Architecture: Journal (durable) → Changes queue (reactive) → Subscribers (typed).
 */
import { EventJournal } from '@effect/experimental';
import { SqlEventJournal } from '@effect/sql';
import { Sharding, Snowflake } from '@effect/cluster';
import { Chunk, DateTime, Effect, Metric, PrimaryKey, Schema as S, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { ClusterService } from './cluster.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	journal: {
		entryTable: 'effect_event_journal',
		remotesTable: 'effect_event_remotes'
	},
} as const;
const _ErrorProps = {
	DeliveryFailed:        { retryable: true,  terminal: false },
	DeserializationFailed: { retryable: false, terminal: true  },
	DuplicateEvent:        { retryable: false, terminal: true  },
	ValidationFailed:      { retryable: false, terminal: true  },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _EventErrorReason = S.Literal(...Object.keys(_ErrorProps) as [keyof typeof _ErrorProps, ...(keyof typeof _ErrorProps)[]]);
class EventError extends S.TaggedError<EventError>()('EventError', {
	cause: S.optional(S.Unknown),
	eventId: S.optional(S.String),
	reason: _EventErrorReason,
}) {
	get isTerminal(): boolean { return _ErrorProps[this.reason].terminal; }
	get isRetryable(): boolean { return _ErrorProps[this.reason].retryable; }
	static readonly from = (eventId: string, reason: typeof _EventErrorReason.Type, cause?: unknown) => new EventError({ cause, eventId, reason });
}
class DomainEvent extends S.Class<DomainEvent>('DomainEvent')({
	aggregateId: S.String,
	causationId: S.optional(S.UUID),
	correlationId: S.optional(S.UUID),
	eventId: S.UUID.pipe(S.brand('EventId')),
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

// --- [FUNCTIONS] -------------------------------------------------------------

const _encode = (envelope: EventEnvelope) => S.encode(S.parseJson(EventEnvelope))(envelope).pipe(Effect.map((json) => new TextEncoder().encode(json)));
const _decode = (entry: EventJournal.Entry) => Effect.sync(() => new TextDecoder().decode(entry.payload)).pipe(Effect.flatMap(S.decode(S.parseJson(EventEnvelope))));

// --- [SERVICE] ---------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer(_CONFIG.journal), MetricsService.Default, ClusterService.Layer],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		const changesQueue = yield* journal.changes;
		const broadcastStream: Stream.Stream<EventEnvelope, never, never> = Stream.fromQueue(changesQueue).pipe(
			Stream.mapEffect(_decode),
			Stream.catchAll(() => Stream.empty),
		);
		const emit = (input: DomainEvent | Chunk.Chunk<DomainEvent>) => {
			const items = Chunk.isChunk(input) ? input : Chunk.of(input);
			return Telemetry.span(
				Effect.all([Context.Request.current, sharding.getSnowflake]).pipe(
					Effect.flatMap(([ctx, sf]) =>
						Effect.forEach(
							Chunk.map(items, (event): EventEnvelope => new EventEnvelope({
								emittedAt: DateTime.unsafeMake(Snowflake.timestamp(sf)),
								event: new DomainEvent({
									...event,
									correlationId: event.correlationId ?? ctx.requestId,
									eventId: event.eventId ?? (String(sf) as typeof event.eventId),
									tenantId: event.tenantId ?? ctx.tenantId,
								}),
							})),
							(envelope) => _encode(envelope).pipe(
								Effect.flatMap((payload) => journal.write({
									effect: () => Metric.increment(metrics.events.emitted),
									event: envelope.event.eventType,
									payload,
									primaryKey: envelope.event.eventId,
								})),
							),
						),
					),
				),
				'eventbus.emit',
				{ 'event.count': Chunk.size(items) },
			);
		};
		const subscribe = <T>(
			eventType: string,
			schema: S.Schema<T, unknown, never>,
			handler: (event: DomainEvent, payload: T) => Effect.Effect<void, EventError>,
			filter?: (event: DomainEvent) => boolean,) =>
			broadcastStream.pipe(
				Stream.filter((env) => env.event.eventType === eventType && (filter?.(env.event) ?? true)),
				Stream.mapEffect((env) =>
					S.validate(schema)(env.event.payload).pipe(
						Effect.mapError((e) => EventError.from(env.event.eventId, 'ValidationFailed', e)),
						Effect.flatMap((payload) => Telemetry.span(handler(env.event, payload), 'eventbus.handle', { 'event.type': eventType })),
					),
				),
			);
		const onEvent = (): Stream.Stream<EventEnvelope, never, never> => broadcastStream;
		yield* Effect.logInfo('EventBus initialized with SqlEventJournal');
		return { emit, onEvent, subscribe };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Error = EventError;
	static readonly Event = DomainEvent;
	static readonly Envelope = EventEnvelope;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace EventBus {
	export type Error = EventError;
	export type Event = DomainEvent;
	export type Envelope = EventEnvelope;
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
