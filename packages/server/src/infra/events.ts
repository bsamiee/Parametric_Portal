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
			const resolved = Option.fromNullable(this.payload).pipe(
				Option.filter((payload): payload is Readonly<Record<string, unknown>> => typeof payload === 'object' && payload !== null),
				Option.flatMap((payload) => typeof payload['_tag'] === 'string' && typeof payload['action'] === 'string' ? Option.some(`${payload['_tag']}.${payload['action']}`) : Option.none()),
			);
			return Option.getOrElse(resolved, constant('unknown'));
		}
	}
class EventEnvelope extends S.Class<EventEnvelope>('EventEnvelope')({
	emittedAt: S.DateTimeUtcFromNumber,
	event: DomainEvent,
}) {}

// --- [CONSTANTS] -------------------------------------------------------------

const _JSON = {
	envelope: S.parseJson(EventEnvelope),
	notify: S.parseJson(S.Struct({ eventId: S.String, sourceNodeId: S.String })),
} as const;
const _CODEC = {
	envelope: { decode: S.decode(_JSON.envelope), encode: S.encode(_JSON.envelope) },
	notify: { decode: S.decode(_JSON.notify), encode: S.encode(_JSON.notify) },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _extractSqlErrorCode = (cause: unknown): string =>
	Match.value(cause).pipe(
		Match.when(
			(value: unknown): value is { code: string } =>
				typeof value === 'object' && value !== null && 'code' in value && typeof (value as { readonly code?: unknown }).code === 'string',
			(value) => value.code,
		),
		Match.when(
			(value: unknown): value is { cause: { code: string } } =>
				typeof value === 'object'
				&& value !== null
				&& 'cause' in value
				&& typeof (value as { readonly cause?: unknown }).cause === 'object'
				&& (value as { readonly cause?: unknown }).cause !== null
				&& 'code' in (value as { readonly cause: { readonly code?: unknown } }).cause
				&& typeof (value as { readonly cause: { readonly code?: unknown } }).cause.code === 'string',
			(value) => value.cause.code,
		),
		Match.orElse(() => String(cause).includes('23505') ? '23505' : ''),
	);

// --- [SERVICES] --------------------------------------------------------------

class EventBus extends Effect.Service<EventBus>()('server/EventBus', {
	dependencies: [SqlEventJournal.layer({ eventLogTable: 'effect_event_journal', remotesTable: 'effect_event_remotes' }), MetricsService.Default, ClusterService.Default, DatabaseService.Default],
	scoped: Effect.gen(function* () {
		const journal = yield* EventJournal.EventJournal;
		const sharding = yield* Sharding.Sharding;
		const metrics = yield* MetricsService;
			const database = yield* DatabaseService;
			const sql = yield* SqlClient.SqlClient;
			const nodeId = crypto.randomUUID();
			const subscriptions = yield* STM.commit(TRef.make(0));
			yield* Effect.annotateLogsScoped({ 'service.name': 'eventbus' });
			const hub = yield* PubSub.bounded<EventEnvelope>(256);
			const changesQueue = yield* journal.changes;
			yield* Stream.fromQueue(changesQueue).pipe(
				Stream.mapEffect((entry) => Effect.sync(() => new TextDecoder().decode(entry.payload)).pipe(
					Effect.flatMap(_CODEC.envelope.decode),
					Effect.tap((envelope) => PubSub.publish(hub, envelope)),
					Effect.tapError((error) => Effect.logWarning('Event envelope decode failed', { error: String(error) })),
					Effect.option,
				)),
				Stream.runDrain, Effect.forkScoped,
			);
				const handleNotifyEntry = (entry: { readonly payload: string }) => _CODEC.envelope.decode(entry.payload).pipe(
				Effect.flatMap((envelope) => PubSub.publish(hub, envelope)),
			);
			yield* Client.listen.raw('event_journal_notify').pipe(
				Stream.mapEffect((payload) => _CODEC.notify.decode(payload).pipe(
					Effect.flatMap(({ eventId, sourceNodeId }) => database.eventJournal.byPrimaryKey(eventId).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Effect.logWarning('LISTEN/NOTIFY event not found in journal', { eventId }),
							onSome: handleNotifyEntry,
						})),
						Effect.unless(constant(sourceNodeId === nodeId)),
					)),
					Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY decode failed', { error: String(error) })),
					Effect.catchAll(constant(Effect.void)),
				)),
				Stream.runDrain,
			Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY stream interrupted, retrying bridge listener', { error: String(error) })),
			Effect.retry({ times: 3 }),
			Effect.catchAll(() => Effect.logWarning('LISTEN/NOTIFY bridge disabled after retries exhausted; no automatic polling fallback configured')),
			Effect.forkScoped,
		);
		const publish = (input: EventBus.Types.Input | readonly EventBus.Types.Input[] | Chunk.Chunk<EventBus.Types.Input>) => {
				const items = pipe(
					Match.value(input),
					Match.when(Chunk.isChunk, Chunk.toReadonlyArray),
					Match.when(Array.isArray, (arr) => arr),
					Match.orElse((v) => [v]),
				);
				return Telemetry.span(
					Effect.forEach(items, Effect.fn(function*(item) {
							const requestContext = yield* Context.Request.current;
							yield* Effect.annotateCurrentSpan('correlation.id', requestContext.requestId);
							const snowflake = yield* sharding.getSnowflake;
							const eventId = item.eventId ?? S.decodeSync(DomainEvent.fields.eventId)(String(snowflake));
							const correlationId = pipe(
								Option.fromNullable(item.correlationId ?? requestContext.requestId),
								Option.filter(S.is(S.UUID)),
								Option.getOrUndefined,
							);
							const envelope = new EventEnvelope({
								emittedAt: DateTime.unsafeMake(Snowflake.timestamp(snowflake)),
								event: new DomainEvent({
									aggregateId: item.aggregateId, causationId: item.causationId,
									correlationId,
									eventId,
									payload: item.payload, tenantId: item.tenantId ?? requestContext.tenantId,
									}),
								});
						const json = yield* _CODEC.envelope.encode(envelope);
							yield* journal.write({
								effect: constant(Metric.increment(metrics.events.emitted)),
								event: envelope.event.eventType,
								payload: new TextEncoder().encode(json),
								primaryKey: envelope.event.eventId,
							}).pipe(
								Effect.catchTag('EventJournalError', (cause) => {
									const sqlCode = _extractSqlErrorCode(cause.cause);
									return Effect.fail(EventError.from(
										envelope.event.eventId,
										sqlCode === '23505' ? 'DuplicateEvent' : 'DeliveryFailed',
										cause,
									));
								}),
								);
						const notifyPayload = yield* _CODEC.notify.encode({ eventId: envelope.event.eventId, sourceNodeId: nodeId });
						yield* Client.notify('event_journal_notify', notifyPayload).pipe(
							Effect.tapError(constant(Effect.logWarning('LISTEN/NOTIFY publish failed'))),
							Effect.ignore,
						);
					return envelope;
				}), { concurrency: 'unbounded' }),
				'events.publish',
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
										Effect.flatMap((payload) => Telemetry.span(handler(envelope.event, payload), 'events.handle', { 'event.type': eventType, metrics: false }).pipe(
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
													context: Option.fromNullable(envelope.event.correlationId).pipe(Option.map((request) => ({ request }))),
													errorReason: error.reason, errors: [{ error: String(error.cause ?? error.message), timestamp: Date.now() }],
												payload: envelope.event.payload, replayedAt: Option.none(),
												source: 'event', sourceId: envelope.event.eventId, type: eventType,
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
					return Stream.paginateChunkEffect(initialCursor, Effect.fn('events.replay')(function*(cursor) {
						yield* Effect.annotateCurrentSpan('replay.batch_size', batchSize);
						yield* Effect.annotateCurrentSpan('replay.cursor', cursor);
						const rows = yield* database.eventJournal.replay({
							batchSize,
							eventType: filter.eventType,
							sinceSequenceId: cursor,
							sinceTimestamp: filter.sinceTimestamp,
						}).pipe(
							Effect.catchTag('SqlError', (cause) => Effect.fail(EventError.from('', 'DeliveryFailed', cause))),
							Effect.mapError((error) => error instanceof EventError ? error : EventError.from('', 'DeliveryFailed', error)),
						);
						const envelopes = yield* Effect.forEach(
							rows,
							({ payload }) => _CODEC.envelope.decode(payload),
						).pipe(Effect.orElseFail(constant(EventError.from('', 'DeserializationFailed'))));
						const filtered = envelopes.filter((envelope) =>
							(!filter.tenantId || envelope.event.tenantId === filter.tenantId)
							&& (!filter.aggregateId || envelope.event.aggregateId === filter.aggregateId),
						);
						const nextCursor = pipe(
							Option.fromNullable(rows.at(-1)?.primaryKey),
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
			readonly eventId?: S.Schema.Type<typeof DomainEvent>['eventId'];
			readonly payload: { readonly _tag: string; readonly action: string } & Readonly<Record<string, unknown>>;
			readonly tenantId?: string;
		};
		export type ReplayFilter = {
			readonly aggregateId?: string; readonly batchSize?: number; readonly eventType?: string;
			readonly sinceSequenceId?: `${bigint}`; readonly sinceTimestamp?: number; readonly tenantId?: string; readonly throttle?: Duration.Duration;
		};
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { EventBus };
