/**
 * Orchestrate notification delivery across channels.
 * Domain: Multi-channel service (email, webhook, inApp) with preference filtering.
 */
import { Update } from '@parametric-portal/database/factory';
import { NotificationPreferencesSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Match, Option, Schema as S, Stream } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { EmailAdapter } from '../infra/email.ts';
import { EventBus } from '../infra/events.ts';
import { JobService } from '../infra/jobs.ts';
import { WebhookService } from '../infra/webhooks.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class NotificationRequest extends S.Class<NotificationRequest>('NotificationRequest')({
	channel: S.Literal('email', 'webhook', 'inApp'),
	data: S.Unknown,
	dedupeKey: S.optional(S.String),
	maxAttempts: S.optionalWith(S.Int.pipe(S.between(1, 10)), { default: () => 5 }),
	recipient: S.optional(S.String),
	template: S.NonEmptyTrimmedString,
	userId: S.optional(S.UUID),
}) {}
class NotificationPreferences extends S.Class<NotificationPreferences>('NotificationPreferences')(NotificationPreferencesSchema.fields) {}

// --- [ERRORS] ----------------------------------------------------------------

class NotificationError extends S.TaggedError<NotificationError>()('NotificationError', {
	cause: S.optional(S.Unknown),
	reason: S.Literal('InvalidTransition', 'MissingRecipient', 'PreferenceBlocked'),
}) {static readonly from = <const R extends NotificationError['reason']>(reason: R, cause?: unknown) => new NotificationError({ cause, reason });}

// --- [SERVICES] --------------------------------------------------------------

class NotificationService extends Effect.Service<NotificationService>()('server/Notifications', {
	dependencies: [DatabaseService.Default, EventBus.Default, JobService.Default, WebhookService.Default, EmailAdapter.Default],
	scoped: Effect.gen(function* () {
		const [database, email, eventBus, jobs, webhooks] = yield* Effect.all([DatabaseService, EmailAdapter, EventBus, JobService, WebhookService]);
		yield* jobs.registerHandler('notification.send', (raw) => S.decodeUnknown(S.Struct({ notificationId: S.UUID }))(raw).pipe(
			Effect.flatMap(({ notificationId }) => database.notifications.one([{ field: 'id', value: notificationId }])),
			Effect.flatMap((notification) => Option.match(notification, {
				onNone: () => Effect.void,
				onSome: (row) => Effect.gen(function* () {
					yield* Effect.filterOrFail(Effect.void, () => row.status === 'queued', () => NotificationError.from('InvalidTransition', `${row.status} -> sending`));
					yield* database.notifications.transition(row.id, { status: 'sending' });
					const provider = yield* Match.value(row.channel).pipe(
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
					);
					yield* database.notifications.transition(row.id, { deliveredAt: new Date(), provider: Option.getOrNull(provider), status: 'delivered' });
					yield* eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', status: 'delivered' }, tenantId: row.appId }).pipe(Effect.ignore);
				}).pipe(Effect.catchAll((error) => {
					const nextStatus = row.attempts + 1 >= row.maxAttempts ? 'dlq' : 'failed';
					return database.notifications.set(row.id, { attempts: Update.inc(), error: String(error), status: nextStatus }).pipe(
						Effect.tap(() => eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', error: String(error), status: nextStatus }, tenantId: row.appId }).pipe(Effect.ignore)),
						Effect.andThen(Effect.fail(error)),
					);
				})),
			})),
			Telemetry.span('notification.job.handle', { kind: 'server', metrics: false }),
		) as Effect.Effect<void, unknown, never>);
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
				Effect.flatMap((user) => S.decodeUnknown(NotificationPreferences)(user.notificationPreferences).pipe(Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))))),
				Telemetry.span('notification.preferences.get', { kind: 'server', metrics: false }),
			),
			list: listPage,
			listMine: (options?: { after?: Date; before?: Date; cursor?: string; limit?: number }) => Context.Request.sessionOrFail.pipe(Effect.flatMap((session) => listPage({ ...options, userId: session.userId }))),
			replay: (notificationId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.notifications.one([{ field: 'id', value: notificationId }]))),
				Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('notification', notificationId)), onSome: Effect.succeed })),
				Effect.flatMap((notification) => Context.Request.withinSync(notification.appId, jobs.submit('notification.send', { notificationId: notification.id }, { dedupeKey: `${notification.appId}:${notification.id}:replay:${crypto.randomUUID()}` })).pipe(
					Effect.tap((jobId) => database.notifications.transition(notification.id, { error: null, jobId: Array.isArray(jobId) ? jobId[0] : jobId, status: 'queued' })),
					Effect.asVoid,
				)),
				Telemetry.span('notification.replay', { kind: 'server', metrics: false }),
			),
			send: (input: S.Schema.Encoded<typeof NotificationRequest> | readonly S.Schema.Encoded<typeof NotificationRequest>[]) => Effect.forEach(
				Array.isArray(input) ? input : [input],
				(raw) => S.decodeUnknown(NotificationRequest)(raw).pipe(
					Effect.flatMap((request) => Context.Request.currentTenantId.pipe(
						Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, Effect.gen(function* () {
							const user = yield* Option.match(Option.fromNullable(request.userId), { onNone: () => Effect.succeed(Option.none()), onSome: (userId) => database.users.one([{ field: 'id', value: userId }]) });
							const preferences = yield* Option.match(user, {
								onNone: () => Effect.succeed(Option.none<S.Schema.Type<typeof NotificationPreferences>>()),
								onSome: (value) => S.decodeUnknown(NotificationPreferences)(value.notificationPreferences).pipe(Effect.map(Option.some), Effect.orElseSucceed(() => Option.none<S.Schema.Type<typeof NotificationPreferences>>())),
							});
							const blocked = Option.match(preferences, {
								onNone: () => false,
								onSome: (value) => (value.mutedUntil !== null && Date.parse(value.mutedUntil) > Date.now()) || !value.channels[request.channel] || value.templates[request.template]?.[request.channel] === false,
							});
							yield* Effect.filterOrFail(Effect.void, () => !blocked, () => NotificationError.from('PreferenceBlocked'));
							const recipient = request.channel === 'email' ? Option.getOrUndefined(Option.orElse(Option.fromNullable(request.recipient), () => Option.map(user, (value) => value.email))) : request.recipient;
							yield* Effect.filterOrFail(Effect.void, () => !(request.channel === 'email' && recipient === undefined), () => NotificationError.from('MissingRecipient'));
							const inserted = yield* database.notifications.put({
								appId: tenantId,
								attempts: 0,
								channel: request.channel,
								dedupeKey: Option.fromNullable(request.dedupeKey),
								maxAttempts: request.maxAttempts,
								payload: request.data,
								recipient: Option.fromNullable(recipient),
								status: 'queued',
								template: request.template,
								userId: Option.fromNullable(request.userId),
							});
							const insertedId = yield* Match.value(inserted).pipe(
								Match.when((value: unknown): value is { readonly id: string } => value !== undefined && !Array.isArray(value), (value) => Effect.succeed(value.id)),
								Match.orElse(() => Effect.fail(HttpError.Internal.of('Notification insert failed'))),
							);
							const jobId = yield* jobs.submit('notification.send', { notificationId: insertedId }, { dedupeKey: request.dedupeKey ? `${tenantId}:${request.dedupeKey}` : `${tenantId}:${insertedId}` });
							yield* database.notifications.set(insertedId, { job_id: Array.isArray(jobId) ? jobId[0] : jobId });
						})).pipe(
							Effect.catchAll((error) => error instanceof NotificationError && error.reason === 'PreferenceBlocked' ? Effect.void : Effect.fail(error)),
						)),
					)),
				),
				{ concurrency: 'unbounded', discard: true },
			).pipe(Telemetry.span('notification.send', { kind: 'server', metrics: false })),
			streamMine: () => Stream.unwrap(Context.Request.sessionOrFail.pipe(Effect.map((session) => eventBus.stream().pipe(
				Stream.filter((envelope) => envelope.event.eventType === 'notification.inApp' && (envelope.event.payload as Record<string, unknown>)?.['userId'] === session.userId),
			)))),
			updatePreferences: (raw: S.Schema.Encoded<typeof NotificationPreferences>) => S.decodeUnknown(NotificationPreferences)(raw).pipe(
				Effect.flatMap((preferences) => Context.Request.sessionOrFail.pipe(
					Effect.flatMap((session) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.users.setNotificationPreferences(session.userId, preferences))))),
					Effect.map((user) => user.notificationPreferences),
					Effect.flatMap(S.decodeUnknown(NotificationPreferences)),
				)),
				Telemetry.span('notification.preferences.update', { kind: 'server', metrics: false }),
			),
		} as const;
	}),
}) {
	static readonly Error = NotificationError;
	static readonly Preferences = NotificationPreferences;
	static readonly Request = NotificationRequest;
}

// --- [EXPORT] ----------------------------------------------------------------

export { NotificationService };
