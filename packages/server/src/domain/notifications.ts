/**
 * Orchestrate notification delivery across channels.
 * Domain: Multi-channel service (email, webhook, inApp) with preference filtering.
 */
import { SqlClient } from '@effect/sql';
import { Update } from '@parametric-portal/database/factory';
import { Notification, PreferencesSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Cause, Effect, Match, Option, Schema as S, Stream, pipe } from 'effect';
import { constant } from 'effect/Function';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { EmailAdapter } from '../infra/email.ts';
import { EventBus } from '../infra/events.ts';
import { JobService } from '../infra/jobs.ts';
import { WebhookService } from '../infra/webhooks.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class NotificationRequest extends S.Class<NotificationRequest>('NotificationRequest')({
	channel: Notification.fields.channel,
	data: S.Unknown,
	dedupeKey: S.optional(S.String),
	maxAttempts: S.optionalWith(S.Int.pipe(S.between(1, 10)), { default: () => 5 }),
	recipient: S.optional(S.String),
	template: S.NonEmptyTrimmedString,
	userId: S.optional(S.UUID),
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class NotificationError extends S.TaggedError<NotificationError>()('NotificationError', {
	cause: S.optional(S.Unknown),
	reason: S.Literal('MissingRecipient', 'PreferenceBlocked'),
}) {static readonly from = <const R extends NotificationError['reason']>(reason: R, cause?: unknown) => new NotificationError({ cause, reason });}

// --- [SERVICES] --------------------------------------------------------------

class NotificationService extends Effect.Service<NotificationService>()('server/Notifications', {
	dependencies: [DatabaseService.Default, EventBus.Default, JobService.Default, WebhookService.Default, EmailAdapter.Default],
	scoped: Effect.gen(function* () {
		const [database, email, eventBus, jobs, sql, webhooks] = yield* Effect.all([DatabaseService, EmailAdapter, EventBus, JobService, SqlClient.SqlClient, WebhookService]);
		yield* jobs.registerHandler('notification.send', Effect.fn(function* (raw) {
			const { notificationId } = yield* S.decodeUnknown(S.Struct({ notificationId: S.UUID }))(raw);
			const notification = yield* database.notifications.one([{ field: 'id', value: notificationId }]);
			yield* Option.match(notification, {
				onNone: () => Effect.void,
				onSome: (row) => pipe(
					Effect.void,
					Effect.tap(() => pipe(
						Effect.logDebug('notification.send skipped non-queued row', { notificationId: row.id, status: row.status }),
						Effect.andThen(Option.none<never>()),
						Effect.when(() => row.status !== 'queued'),
						Effect.asVoid,
					)),
					Effect.flatMap(() => database.notifications.transition(row.id, { status: 'sending' }, 'queued')),
					Effect.tap((claimed) => pipe(
						Effect.logDebug('notification.send claim skipped', { notificationId: row.id }),
						Effect.when(() => Option.isNone(claimed)),
						Effect.asVoid,
					)),
					Effect.flatMap((claimed) => pipe(
						Match.value(row.channel).pipe(
							Match.when('email', () => Effect.filterOrFail(
								Effect.succeed(Option.getOrUndefined(row.recipient)),
								(recipient): recipient is string => recipient !== undefined,
								() => NotificationError.from('MissingRecipient', row.id),
							).pipe(
								Effect.flatMap((recipient) => email.send({ notificationId: row.id, template: row.template, tenantId: row.appId, to: recipient, vars: row.payload })),
								Effect.map((result) => Option.some(result.provider)),
							)),
							Match.when('webhook', () => webhooks.deliverEvent(row.appId, row.template, row.payload, row.id).pipe(Effect.as(Option.none<string>()))),
							Match.orElse(() => eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'inApp', data: row.payload, template: row.template, userId: Option.getOrUndefined(row.userId) }, tenantId: row.appId }).pipe(Effect.as(Option.none<string>()))),
						),
						Effect.flatMap((provider) => database.notifications.transition(row.id, { delivery: Option.some({ at: new Date(), error: undefined, provider: Option.getOrUndefined(provider) }), status: 'delivered' })),
						Effect.tap(() => eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', status: 'delivered' }, tenantId: row.appId }).pipe(Effect.ignore)),
						Effect.catchAll(Effect.fn(function* (error) {
							const message = error instanceof Error ? error.message : String(error);
							const encodedError = JSON.stringify({ message, tag: MetricsService.errorTag(error) });
							const attemptsNext = row.retry.current + 1;
							const retryJobId = yield* Match.value(attemptsNext >= row.retry.max).pipe(
								Match.when(true, () => Effect.succeed(Option.none<string>())),
								Match.orElse(() => Context.Request.withinSync(
									row.appId,
									jobs.submit('notification.send', { notificationId: row.id }, {
										dedupeKey: `${row.appId}:${row.id}:retry:${attemptsNext}`,
										maxAttempts: 1,
									}),
								).pipe(Effect.map(Option.some))),
							);
							const next = Option.match(retryJobId, {
								onNone: () => ({ status: 'dlq' as const }),
								onSome: (jobId) => ({ jobId, status: 'queued' as const }),
							});
							yield* database.notifications.set(row.id, Match.value(next).pipe(
								Match.when({ status: 'dlq' }, () => ({ delivery: Option.some({ error: encodedError }), retry: { current: Update.inc(), max: row.retry.max }, status: 'dlq' as const })),
								Match.orElse((queued) => ({ correlation: Option.some({ job: queued.jobId }), delivery: Option.some({ error: encodedError }), retry: { current: Update.inc(), max: row.retry.max }, status: 'queued' as const })),
							));
							yield* eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', error: encodedError, status: next.status }, tenantId: row.appId }).pipe(Effect.ignore);
						})),
						Effect.when(() => Option.isSome(claimed)),
						Effect.asVoid,
					)),
				),
			});
		}, (effect) => effect.pipe(
			Effect.catchIf(Cause.isNoSuchElementException, () => Effect.void),
			Telemetry.span('notification.job.handle', { metrics: false }),
		)) as (raw: unknown) => Effect.Effect<void, unknown, never>);
		const listPage = (options?: { after?: Date; before?: Date; cursor?: string; limit?: number; userId?: string }) => Context.Request.currentTenantId.pipe(
			Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.notifications.page(
				database.notifications.preds({ after: options?.after, before: options?.before, user_id: options?.userId }),
				{ cursor: options?.cursor, limit: options?.limit },
			))),
		);
		return {
			getPreferences: () => Context.Request.sessionOrFail.pipe(
				Effect.flatMap((session) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.users.one([{ field: 'id', value: session.userId }]))))),
				Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('user')), onSome: Effect.succeed })),
				Effect.flatMap((user) => S.decodeUnknown(PreferencesSchema)(user.preferences).pipe(Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))))),
				Telemetry.span('notification.preferences.get', { metrics: false }),
			),
			list: listPage,
			listMine: (options?: { after?: Date; before?: Date; cursor?: string; limit?: number }) => Context.Request.sessionOrFail.pipe(Effect.flatMap((session) => listPage({ ...options, userId: session.userId }))),
			replay: (notificationId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.notifications.one([{ field: 'id', value: notificationId }]))),
				Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('notification', notificationId)), onSome: Effect.succeed })),
				Effect.flatMap((notification) => Context.Request.withinSync(notification.appId, jobs.submit('notification.send', { notificationId: notification.id }, { dedupeKey: `${notification.appId}:${notification.id}:replay:${crypto.randomUUID()}`, maxAttempts: 1 })).pipe(
					Effect.tap((jobId) => database.notifications.transition(notification.id, { correlation: Option.some({ job: jobId }), delivery: Option.some({ error: undefined }), status: 'queued' })),
					Effect.asVoid,
				)),
				Telemetry.span('notification.replay', { metrics: false }),
			),
			send: (input: S.Schema.Encoded<typeof NotificationRequest> | readonly S.Schema.Encoded<typeof NotificationRequest>[]) => Effect.forEach(
				Array.isArray(input) ? input : [input],
				Effect.fn(function* (raw) {
					const request = yield* S.decodeUnknown(NotificationRequest)(raw);
					const tenantId = yield* Context.Request.currentTenantId;
					const userIdOpt = Option.fromNullable(request.userId);
					const user = Option.isSome(userIdOpt)
						? Option.some(yield* Context.Request.withinSync(tenantId, database.users.one([{ field: 'id', value: userIdOpt.value }]).pipe(
							Effect.filterOrFail(Option.isSome, () => HttpError.NotFound.of('user', userIdOpt.value)),
							Effect.map((some) => some.value),
						)))
						: Option.none();
					const preferences = Option.isSome(user)
						? yield* Context.Request.withinSync(tenantId, S.decodeUnknown(PreferencesSchema)(user.value.preferences).pipe(
							Effect.map(Option.some),
							Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))),
						))
						: Option.none<S.Schema.Type<typeof PreferencesSchema>>();
					const blocked = Option.isSome(preferences) && (() => {
						const isMuted = preferences.value.mutedUntil !== null && Date.parse(preferences.value.mutedUntil) > Date.now();
						const channelDisabled = !preferences.value.channels[request.channel];
						const templateBlocked = preferences.value.templates[request.template]?.[request.channel] === false;
						return isMuted || channelDisabled || templateBlocked;
					})();
					yield* Effect.when(Effect.fail(NotificationError.from('PreferenceBlocked')), () => blocked).pipe(Effect.asVoid);
					const fallbackEmail = Option.flatMap(user, (value) => Option.fromNullable(value.email));
					const recipient = request.channel === 'email' ? Option.getOrUndefined(Option.orElse(Option.fromNullable(request.recipient), () => fallbackEmail)) : request.recipient;
					yield* Effect.filterOrFail(Effect.void, () => !(request.channel === 'email' && recipient === undefined), () => NotificationError.from('MissingRecipient'));
					const toInsert = (dk: Option.Option<string>) => ({
						appId: tenantId,
						channel: request.channel,
						correlation: Option.map(dk, (dedupe) => ({ dedupe })),
						payload: request.data,
						recipient: Option.fromNullable(recipient),
						retry: { current: 0, max: request.maxAttempts },
						status: 'queued' as const,
						template: request.template,
						userId: Option.fromNullable(request.userId),
					});
					const dedupeKey = Option.fromNullable(request.dedupeKey);
					const existingDedup = Option.isSome(dedupeKey)
						? yield* Context.Request.withinSync(tenantId, database.notifications.one([
							{ raw: sql`correlation->>'dedupe' = ${dedupeKey.value}` },
							{ field: 'status', op: 'in', values: ['queued', 'sending'] },
						]))
						: Option.none();
					const dedupRace = Option.match(dedupeKey, {
						onNone: () => Effect.fail(new Error('No dedupe key for race')),
						onSome: (dk) => Context.Request.withinSync(tenantId, database.notifications.one([
							{ raw: sql`correlation->>'dedupe' = ${dk}` },
							{ field: 'status', op: 'in', values: ['queued', 'sending'] },
						])).pipe(Effect.flatten, Effect.map((row) => ({ duplicate: true as const, row }))),
					});
					const staged = Option.isSome(existingDedup)
						? { duplicate: true as const, row: existingDedup.value }
						: yield* Context.Request.withinSync(tenantId, database.notifications.put(toInsert(dedupeKey)).pipe(
							Effect.map((row) => ({ duplicate: false as const, row })),
							Effect.catchAll((error) => Effect.mapError(dedupRace, constant(error))),
						));
					const dedupeKeyStr = Option.match(dedupeKey, { onNone: () => `${tenantId}:${staged.row.id}`, onSome: (dk) => `${tenantId}:${dk}` });
					yield* Context.Request.withinSync(
						tenantId,
						jobs.submit('notification.send', { notificationId: staged.row.id }, { dedupeKey: dedupeKeyStr, maxAttempts: 1 }),
					).pipe(
						Effect.catchAll(Effect.fn(function* (error) {
							const message = error instanceof Error ? error.message : String(error);
							const encodedError = JSON.stringify({ message, tag: MetricsService.errorTag(error) });
							yield* Context.Request.withinSync(tenantId, database.notifications.transition(staged.row.id, { delivery: Option.some({ error: encodedError }), status: 'failed' }));
							return yield* Effect.fail(error);
						})),
						Effect.flatMap((jobId) => Context.Request.withinSync(tenantId, database.notifications.transition(staged.row.id, { correlation: Option.some({ job: jobId }), delivery: Option.some({ error: undefined }), status: 'queued' }, 'queued'))),
						Effect.asVoid,
						Effect.when(() => !staged.duplicate),
						Effect.asVoid,
					);
				}, Effect.catchAll((error) => error instanceof NotificationError && error.reason === 'PreferenceBlocked' ? Effect.void : Effect.fail(error))),
				{ concurrency: 'unbounded', discard: true },
			).pipe(Telemetry.span('notification.send', { metrics: false })),
			streamMine: () => Stream.unwrap(Context.Request.sessionOrFail.pipe(Effect.map((session) => eventBus.stream().pipe(
				Stream.filter((envelope) => envelope.event.eventType === 'notification.inApp' && (envelope.event.payload as Record<string, unknown>)?.['userId'] === session.userId),
			)))),
			updatePreferences: (raw: S.Schema.Encoded<typeof PreferencesSchema>) => Effect.gen(function* () {
				const preferences = yield* S.decodeUnknown(PreferencesSchema)(raw);
				const session = yield* Context.Request.sessionOrFail;
				const tenantId = yield* Context.Request.currentTenantId;
				const user = yield* Context.Request.withinSync(tenantId, database.users.setPreferences(session.userId, preferences));
				return yield* S.decodeUnknown(PreferencesSchema)(user.preferences);
			}).pipe(Telemetry.span('notification.preferences.update', { metrics: false })),
		} as const;
	}),
}) {
	static readonly Error = NotificationError;
	static readonly Preferences = PreferencesSchema;
	static readonly Request = NotificationRequest;
}

// --- [EXPORT] ----------------------------------------------------------------

export { NotificationService };
