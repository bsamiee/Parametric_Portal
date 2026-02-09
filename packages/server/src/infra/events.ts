/**
 * EventBus: Domain events via SqlEventJournal with cluster broadcast.
 * Architecture: Journal (durable) -> PubSub (fan-out) -> Subscribers (typed, per-consumer).
 * Cross-pod: LISTEN/NOTIFY bridge supplements local PubSub for low-latency fan-out.
 * DLQ: Failed event handlers persist to job_dlq for inspection/replay.
 */
import { Sharding, Snowflake } from '@effect/cluster';
import { EventJournal } from '@effect/experimental';
import { SqlClient, SqlEventJournal } from '@effect/sql';
import { Client } from '@parametric-portal/database/client';
import { Chunk, DateTime, Duration, Effect, Match, Metric, Option, pipe, PrimaryKey, PubSub, Schedule, Schema as S, STM, Stream, TRef } from 'effect';
import { constant } from 'effect/Function';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';
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

// --- [SERVICES] --------------------------------------------------------------

const _decode = S.decode(S.parseJson(EventEnvelope));
const _encode = S.encode(S.parseJson(EventEnvelope));

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer({ eventLogTable: 'effect_event_journal', remotesTable: 'effect_event_remotes' }), MetricsService.Default, ClusterService.Default, DatabaseService.Default],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
		const database = yield* DatabaseService;
		const sql = yield* SqlClient.SqlClient;
		const nodeId = crypto.randomUUID();
		const notifySchema = S.Struct({ eventId: S.String, sourceNodeId: S.String });
		const decodeNotify = S.decode(S.parseJson(notifySchema));
		const encodeNotify = S.encode(S.parseJson(notifySchema));
		const subscriptions = yield* STM.commit(TRef.make(0));
		yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
		const hub = yield* PubSub.bounded<EventEnvelope>(256);
		const changesQueue = yield* journal.changes;
		yield* Stream.fromQueue(changesQueue).pipe(
			Stream.mapEffect((entry) => Effect.sync(() => new TextDecoder().decode(entry.payload)).pipe(
				Effect.flatMap(_decode), Effect.tapError((error) => Effect.logWarning('Event envelope decode failed', { error: String(error) })), Effect.option,
			)),
			Stream.filterMap((envelope) => envelope),
			Stream.mapEffect((envelope) => PubSub.publish(hub, envelope)),
			Stream.runDrain, Effect.forkScoped,
		);
		yield* Client.listen.raw('event_journal_notify').pipe(
			Stream.mapEffect((payload) => decodeNotify(payload).pipe(
					Effect.flatMap(({ eventId, sourceNodeId }) => pipe(
						Effect.gen(function* () {
							const rows = yield* sql.unsafe(
								'SELECT payload FROM effect_event_journal WHERE primary_key = $1 LIMIT 1',
								[eventId],
							);
							const entryPayload = yield* Effect.fromNullable((rows as ReadonlyArray<{ readonly payload: Uint8Array }>)[0]?.payload);
							const decoded = new TextDecoder().decode(entryPayload);
							const envelope = yield* _decode(decoded);
							yield* PubSub.publish(hub, envelope);
						}),
						Effect.catchTag('NoSuchElementException', constant(Effect.logWarning('LISTEN/NOTIFY event not found in journal', { eventId }))),
						Effect.unless(constant(sourceNodeId === nodeId)),
					)),
					Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY decode failed', { error: String(error) })),
					Effect.catchAll(constant(Effect.void)),
				)),
			Stream.runDrain,
			Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY stream interrupted, falling back to cron polling', { error: String(error) })),
			Effect.retry({ times: 3 }),
			Effect.catchAll(() => Effect.logWarning('LISTEN/NOTIFY bridge disabled after retries exhausted')),
			Effect.forkScoped,
		);
		const publish = (input: EventBus.Types.Input | readonly EventBus.Types.Input[] | Chunk.Chunk<EventBus.Types.Input>) => {
			const items = pipe(
				Match.value(input),
				Match.when(Chunk.isChunk, Chunk.toReadonlyArray),
				Match.when(Array.isArray, (arr) => arr),
				Match.orElse((v) => [v]),
			) as ReadonlyArray<EventBus.Types.Input>;
			return Telemetry.span(
				Effect.forEach(items, Effect.fn(function*(item) {
					const requestContext = yield* Context.Request.current;
					yield* Effect.annotateCurrentSpan('correlation.id', requestContext.requestId);
					const snowflake = yield* sharding.getSnowflake;
					const envelope = new EventEnvelope({
						emittedAt: DateTime.unsafeMake(Snowflake.timestamp(snowflake)),
						event: new DomainEvent({
							aggregateId: item.aggregateId, causationId: item.causationId,
							correlationId: item.correlationId ?? requestContext.requestId,
							eventId: item.eventId ?? (String(snowflake) as typeof DomainEvent.Type['eventId']),
							payload: item.payload, tenantId: item.tenantId ?? requestContext.tenantId,
						}),
					});
					const json = yield* _encode(envelope);
					yield* journal.write({
						effect: constant(Metric.increment(metrics.events.emitted)),
						event: envelope.event.eventType,
						payload: new TextEncoder().encode(json),
						primaryKey: envelope.event.eventId,
					}).pipe(
						Effect.catchTag('EventJournalError', (cause) => Effect.fail(EventError.from(
							envelope.event.eventId,
							pipe(
								Option.fromNullable((cause.cause as { readonly sqlState?: unknown; readonly cause?: { readonly sqlState?: unknown } } | undefined)?.sqlState ?? (cause.cause as { readonly cause?: { readonly sqlState?: unknown } } | undefined)?.cause?.sqlState),
								Option.filter(S.is(S.Literal('23505'))),
								Option.match({ onNone: constant('DeliveryFailed'), onSome: constant('DuplicateEvent') }),
							),
							cause,
						))),
					);
					const notifyPayload = yield* encodeNotify({ eventId: envelope.event.eventId, sourceNodeId: nodeId });
					yield* Client.notify('event_journal_notify', notifyPayload).pipe(
						Effect.tapError(constant(Effect.logWarning('LISTEN/NOTIFY publish failed'))),
						Effect.ignore,
					);
					return envelope;
				}), { concurrency: 'unbounded' }),
				'eventbus.publish',
				{ 'event.count': items.length, metrics: false },
			);
			};
			const subscribe = <T, I>(
				eventType: string, schema: S.Schema<T, I, never>,
				handler: (event: DomainEvent, payload: T) => Effect.Effect<void, EventError>,
				filter?: (event: DomainEvent) => boolean,
			) => {
				const labels = MetricsService.label({ event_type: eventType });
				return Stream.unwrapScoped(
					STM.commit(TRef.updateAndGet(subscriptions, (current) => current + 1)).pipe(
						Effect.flatMap((count) => Metric.set(metrics.events.subscriptions, count)),
							Effect.andThen(PubSub.subscribe(hub)),
							Effect.map(Stream.fromQueue),
								Effect.map(Stream.filter((envelope) => envelope.event.eventType === eventType && (filter?.(envelope.event) ?? true))),
								Effect.map(Stream.mapEffect(Effect.fn(function*(envelope) {
									yield* S.validate(schema)(envelope.event.payload).pipe(
										Effect.mapError((cause) => EventError.from(envelope.event.eventId, 'ValidationFailed', cause)),
										Effect.flatMap((payload) => Telemetry.span(handler(envelope.event, payload), 'eventbus.handle', { 'event.type': eventType, metrics: false }).pipe(
											Effect.tap(constant(Metric.increment(Metric.taggedWithLabels(metrics.events.processed, labels)))),
										)),
										Effect.tapError((error) => Metric.increment(Metric.taggedWithLabels(metrics.events.retries, labels)).pipe(
											Effect.when(constant(error.isRetryable)),
											Effect.asVoid,
										)),
										Effect.retry({
											schedule: Resilience.schedule({ base: Duration.millis(100), cap: Duration.seconds(5), maxAttempts: 3 }),
											while: (error) => error.isRetryable,
										}),
										Effect.catchAll((error) => Match.value(error.reason).pipe(
											Match.when('DuplicateEvent', constant(Metric.increment(Metric.taggedWithLabels(metrics.events.duplicatesSkipped, labels)).pipe(Effect.asVoid))),
											Match.orElse(constant(
												Context.Request.withinSync(envelope.event.tenantId, database.jobDlq.insert({
													appId: envelope.event.tenantId, attempts: 1,
													errorHistory: [{ error: String(error.cause ?? error.message), timestamp: Date.now() }],
												errorReason: error.reason, originalJobId: envelope.event.eventId,
												payload: envelope.event.payload, replayedAt: Option.none(),
												requestId: Option.fromNullable(envelope.event.correlationId),
												source: 'event', type: eventType, userId: Option.none(),
												}).pipe(Effect.provideService(SqlClient.SqlClient, sql))).pipe(
													Effect.tap(constant(Effect.logWarning('Event written to DLQ', { 'dlq.error_reason': error.reason, 'dlq.event_id': envelope.event.eventId, 'dlq.event_type': eventType }))),
													Effect.catchAll(constant(Effect.logError('DLQ write failed', { 'dlq.event_id': envelope.event.eventId }))),
													Effect.asVoid,
												),
											)),
										)),
									);
							}))),
						Effect.map(
							Stream.ensuring(
								STM.commit(TRef.updateAndGet(subscriptions, (current) => Math.max(0, current - 1))).pipe(
									Effect.flatMap((current) => Metric.set(metrics.events.subscriptions, current)),
								),
							),
						),
					),
				);
			};
		const stream = (): Stream.Stream<EventEnvelope, never, never> => Stream.unwrapScoped(PubSub.subscribe(hub).pipe(Effect.map((dequeue) => Stream.fromQueue(dequeue))));
			const replay = (filter: EventBus.Types.ReplayFilter): Stream.Stream<EventEnvelope, EventError> => {
				const throttle = filter.throttle ?? Duration.millis(10);
				const batchSize = filter.batchSize ?? 500;
				const initialCursor = Option.getOrElse(Option.fromNullable(filter.sinceSequenceId), constant('0'));
				return Stream.paginateChunkEffect(initialCursor, Effect.fn('eventbus.replay')(function*(cursor) {
					yield* Effect.annotateCurrentSpan('replay.batch_size', batchSize);
					yield* Effect.annotateCurrentSpan('replay.cursor', cursor);
					const params: Array<unknown> = [];
					const timestampCond = pipe(Option.fromNullable(filter.sinceTimestamp), Option.map((v) => `timestamp >= $${params.push(v)}`));
					const cursorCond = `primary_key::numeric > $${params.push(cursor)}`;
					const eventCond = pipe(Option.fromNullable(filter.eventType), Option.map((v) => `event = $${params.push(v)}`));
					const conditions = ['1=1', ...Option.toArray(timestampCond), cursorCond, ...Option.toArray(eventCond)];
					const whereClause = conditions.join(' AND ');
					const rows = yield* sql.unsafe(
						`SELECT payload, primary_key FROM effect_event_journal WHERE ${whereClause} ORDER BY primary_key::numeric ASC LIMIT $${params.push(batchSize)}`, params,
					).pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(EventError.from('', 'DeliveryFailed', cause))));
					const envelopes = yield* Effect.forEach(
						rows as ReadonlyArray<{ readonly payload: Uint8Array }>,
						(row) => _decode(new TextDecoder().decode(row.payload)).pipe(Effect.orElseFail(constant(EventError.from('', 'DeserializationFailed')))),
					);
					const filtered = envelopes.filter((envelope) =>
						(!filter.tenantId || envelope.event.tenantId === filter.tenantId)
						&& (!filter.aggregateId || envelope.event.aggregateId === filter.aggregateId),
					);
						const nextCursor = pipe(
							Option.fromNullable((rows as ReadonlyArray<{ readonly primary_key?: string | number | bigint }>)[rows.length - 1]?.primary_key),
							Option.map(String),
							Option.filter(() => rows.length >= batchSize),
						);
					return [Chunk.fromIterable(filtered), nextCursor] as const;
				})).pipe(Stream.schedule(Schedule.spaced(throttle)), Stream.tap(constant(Metric.increment(metrics.events.processed))));
			};
		yield* Effect.logInfo('EventBus initialized with SqlEventJournal + PubSub fan-out + LISTEN/NOTIFY bridge');
		return { publish, replay, stream, subscribe };
	}),
}) {static readonly Model = { Envelope: EventEnvelope, Error: EventError, Event: DomainEvent } as const;}

// --- [NAMESPACE] -------------------------------------------------------------

namespace EventBus {
	export namespace Types {
		export type Input = {
			readonly aggregateId: string; readonly causationId?: string; readonly correlationId?: string;
			readonly eventId?: S.Schema.Type<typeof DomainEvent>['eventId']; readonly payload: unknown; readonly tenantId?: string;
		};
		export type ReplayFilter = {
			readonly aggregateId?: string; readonly batchSize?: number; readonly eventType?: string;
			readonly sinceSequenceId?: `${bigint}`; readonly sinceTimestamp?: number; readonly tenantId?: string; readonly throttle?: Duration.Duration;
		};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
