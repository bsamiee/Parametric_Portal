/**
 * EventBus: Domain events via SqlEventJournal with cluster broadcast.
 * Architecture: Journal (durable) -> PubSub (fan-out) -> Subscribers (typed, per-consumer).
 * Cross-pod: LISTEN/NOTIFY bridge supplements local PubSub for low-latency fan-out.
 * DLQ: Failed event handlers persist to job_dlq for inspection/replay.
 */
import { Sharding, Snowflake } from '@effect/cluster';
import { EventJournal } from '@effect/experimental';
import { SqlClient, SqlEventJournal } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Chunk, Clock, DateTime, Duration, Effect, Metric, Option, PrimaryKey, PubSub, Ref, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
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
const _NOTIFY_CHANNEL = 'event_journal_notify' as const;
const _REPLAY_BATCH_SIZE = 500 as const;
const _REPLAY_DEFAULT_THROTTLE = Duration.millis(10);

// --- [SERVICES] --------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer({ eventLogTable: 'effect_event_journal', remotesTable: 'effect_event_remotes' }), MetricsService.Default, ClusterService.Layers.client, DatabaseService.Default],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
		const database = yield* DatabaseService;
		const sql = yield* SqlClient.SqlClient;
		const pgClient = yield* PgClient.PgClient;
		const subscriptions = yield* Ref.make(0);
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		const hub = yield* PubSub.bounded<EventEnvelope>(256);
		const changesQueue = yield* journal.changes;
		yield* Stream.fromQueue(changesQueue).pipe(
			Stream.mapEffect((entry) => Effect.sync(() => new TextDecoder().decode(entry.payload)).pipe(
				Effect.flatMap(_CODEC.decode),
				Effect.tapError((error) => Effect.logWarning('Event envelope decode failed', { error: String(error) })),
				Effect.option,
			)),
			Stream.filterMap((envelope) => envelope),
			Stream.mapEffect((envelope) => PubSub.publish(hub, envelope)),
			Stream.runDrain,
			Effect.forkScoped,
		);
		yield* pgClient.listen(_NOTIFY_CHANNEL).pipe(
			Stream.mapEffect((payload) => _CODEC.decode(payload).pipe(
				Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY decode failed', { error: String(error) })),
				Effect.option,
			)),
			Stream.filterMap((envelope) => envelope),
			Stream.mapEffect((envelope) => PubSub.publish(hub, envelope)),
			Stream.runDrain,
			Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY stream interrupted, falling back to cron polling', { error: String(error) })),
			Effect.retry({ times: 3 }),
			Effect.catchAll(() => Effect.logWarning('LISTEN/NOTIFY bridge disabled after retries exhausted')),
			Effect.forkScoped,
		);
		const publish = (input: EventBus.Types.Input | readonly EventBus.Types.Input[] | Chunk.Chunk<EventBus.Types.Input>) =>
			Telemetry.span(
				Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
					const correlationId = requestContext.requestId;
					const items = Chunk.toReadonlyArray(
						Chunk.isChunk(input)
							? input
							: Chunk.fromIterable(Array.isArray(input) ? input : [input] as const),
					);
					yield* Effect.annotateCurrentSpan('correlation.id', correlationId);
					return yield* Effect.forEach(items, (item) => sharding.getSnowflake.pipe(
						Effect.map((snowflake) => {
							const eventId = item.eventId ?? (String(snowflake) as typeof DomainEvent.Type['eventId']);
							return new EventEnvelope({
								emittedAt: DateTime.unsafeMake(Snowflake.timestamp(snowflake)),
								event: new DomainEvent({
									aggregateId: item.aggregateId,
									causationId: item.causationId,
									correlationId: item.correlationId ?? correlationId,
									eventId,
									payload: item.payload,
									tenantId: item.tenantId ?? requestContext.tenantId,
								}),
							});
						}),
						Effect.flatMap((envelope) => _CODEC.encode(envelope).pipe(
							Effect.flatMap((json) => journal.write({
								effect: () => Metric.increment(metrics.events.emitted),
								event: envelope.event.eventType,
								payload: new TextEncoder().encode(json),
								primaryKey: envelope.event.eventId,
							}).pipe(Effect.tap(() => pgClient.notify(_NOTIFY_CHANNEL, json).pipe(
								Effect.catchAll((error) => Effect.logWarning('NOTIFY failed (non-critical)', { error: String(error) })),
							)))),
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
			Effect.gen(function* () {
				const count = yield* Ref.updateAndGet(subscriptions, (current) => current + 1);
				yield* Metric.set(metrics.events.subscriptions, count);
				const dequeue = yield* PubSub.subscribe(hub);
				return Stream.fromQueue(dequeue).pipe(
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
							Effect.tapError((error) => error.isTerminal
								? Clock.currentTimeMillis.pipe(Effect.flatMap((timestampMs) =>
									Context.Request.withinSync(
										envelope.event.tenantId,
										database.jobDlq.insert({
											appId: envelope.event.tenantId,
											attempts: 1,
											errorHistory: [{ error: String(error.cause ?? error.message), timestamp: timestampMs }],
											errorReason: error.reason,
											originalJobId: envelope.event.eventId,
											payload: envelope.event.payload,
											replayedAt: Option.none(),
											requestId: Option.fromNullable(envelope.event.correlationId),
											source: 'event',
											type: eventType,
											userId: Option.none(),
										}).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
									).pipe(
										Effect.tap(() => Effect.logWarning('Event written to DLQ', {
											'dlq.error_reason': error.reason,
											'dlq.event_id': envelope.event.eventId,
											'dlq.event_type': eventType,
										})),
										Effect.catchAll((dlqError) => Effect.logError('DLQ write failed', {
											'dlq.event_id': envelope.event.eventId,
											'dlq.write_error': String(dlqError),
										})),
									)))
								: Effect.void),
						);
					}),
					Stream.ensuring(Ref.updateAndGet(subscriptions, (current) => Math.max(0, current - 1)).pipe(Effect.flatMap((current) => Metric.set(metrics.events.subscriptions, current)),),),
				);
			}),
		);
		const stream = (): Stream.Stream<EventEnvelope, never, never> => Stream.unwrapScoped(PubSub.subscribe(hub).pipe(Effect.map((dequeue) => Stream.fromQueue(dequeue))),);
		const replay = (filter: EventBus.Types.ReplayFilter): Stream.Stream<EventEnvelope, EventError> => {
			const throttle = filter.throttle ?? _REPLAY_DEFAULT_THROTTLE;
			const batchSize = filter.batchSize ?? _REPLAY_BATCH_SIZE;
			return Stream.paginateChunkEffect(0, (offset) =>
				Telemetry.span(
					Effect.gen(function* () {
						const conditions = [`1=1`];
						const params: Array<unknown> = [];
						filter.sinceTimestamp
							? conditions.push(`timestamp >= $${params.push(filter.sinceTimestamp)}`)
							: filter.sinceSequenceId
								? conditions.push(`primary_key >= $${params.push(filter.sinceSequenceId)}`)
								: undefined;
						filter.eventType ? conditions.push(`event = $${params.push(filter.eventType)}`) : undefined;
						const whereClause = conditions.join(' AND ');
						const rows = yield* sql.unsafe(
							`SELECT payload FROM effect_event_journal WHERE ${whereClause} ORDER BY timestamp ASC, primary_key ASC LIMIT $${params.push(batchSize)} OFFSET $${params.push(offset)}`,
							params,
						).pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(EventError.from('', 'DeliveryFailed', cause))));
						const envelopes = yield* Effect.forEach(
							rows as ReadonlyArray<{ readonly payload: Uint8Array }>,
							(row) => Effect.sync(() => new TextDecoder().decode(row.payload)).pipe(
								Effect.flatMap(_CODEC.decode),
								Effect.mapError((cause) => EventError.from('', 'DeserializationFailed', cause)),
							),
						);
						const filtered = envelopes.filter((envelope) =>
							(filter.tenantId ? envelope.event.tenantId === filter.tenantId : true)
							&& (filter.aggregateId ? envelope.event.aggregateId === filter.aggregateId : true),
						);
						const next: Option.Option<number> = rows.length < batchSize
							? Option.none()
							: Option.some(offset + batchSize);
						return [Chunk.fromIterable(filtered), next] as const;
					}),
					'eventbus.replay',
					{ metrics: false, 'replay.batch_size': batchSize, 'replay.offset': offset },
				),
			).pipe(
				Stream.schedule(Schedule.spaced(throttle)),
				Stream.tap(() => Metric.increment(metrics.events.processed)),
			);
		};
		yield* Effect.logInfo('EventBus initialized with SqlEventJournal + PubSub fan-out + LISTEN/NOTIFY bridge');
		return { publish, replay, stream, subscribe };
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
		export type ReplayFilter = {
			readonly aggregateId?: string;
			readonly batchSize?: number;
			readonly eventType?: string;
			readonly sinceSequenceId?: string;
			readonly sinceTimestamp?: number;
			readonly tenantId?: string;
			readonly throttle?: Duration.Duration;
		};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
