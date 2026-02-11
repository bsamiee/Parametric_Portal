/**
 * Orchestrate notification delivery across channels.
 * Domain: Multi-channel service (email, webhook, inApp) with preference filtering.
 */
import { Update } from '@parametric-portal/database/factory';
import { Notification, NotificationPreferencesSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Match, Option, Schema as S, Stream } from 'effect';
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
		const [database, email, eventBus, jobs, webhooks] = yield* Effect.all([DatabaseService, EmailAdapter, EventBus, JobService, WebhookService]);
			yield* jobs.registerHandler('notification.send', (raw) => S.decodeUnknown(S.Struct({ notificationId: S.UUID }))(raw).pipe(
				Effect.flatMap(({ notificationId }) => database.notifications.one([{ field: 'id', value: notificationId }])),
				Effect.flatMap((notification) => Option.match(notification, {
					onNone: () => Effect.void,
					onSome: (row) => Match.value(row.status).pipe(
						Match.when('queued', () => database.notifications.transition(row.id, { status: 'sending' }, 'queued').pipe(
							Effect.flatMap(Option.match({
								onNone: () => Effect.logDebug('notification.send claim skipped', { notificationId: row.id }).pipe(Effect.asVoid),
								onSome: () => Effect.gen(function* () {
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
									yield* database.notifications.transition(row.id, { deliveredAt: new Date(), error: null, provider: Option.getOrNull(provider), status: 'delivered' });
									yield* eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', status: 'delivered' }, tenantId: row.appId }).pipe(Effect.ignore);
								}).pipe(
									Effect.catchAll((error) => Effect.gen(function* () {
										const encodedError = JSON.stringify({
											message: Match.value(error).pipe(
												Match.when(Match.instanceOf(Error), (value) => value.message),
												Match.orElse((value) => String(value)),
											),
											tag: MetricsService.errorTag(error),
										});
										const attemptsNext = row.attempts + 1;
										const next = yield* Match.value(attemptsNext >= row.maxAttempts).pipe(
											Match.when(true, () => Effect.succeed({ status: 'dlq' as const })),
											Match.orElse(() => Context.Request.withinSync(
												row.appId,
												jobs.submit('notification.send', { notificationId: row.id }, {
													dedupeKey: `${row.appId}:${row.id}:retry:${attemptsNext}`,
													maxAttempts: 1,
												}),
											).pipe(Effect.map((jobId) => ({ jobId, status: 'queued' as const })))),
										);
										yield* database.notifications.set(row.id, Match.value(next).pipe(
											Match.when({ status: 'dlq' }, () => ({ attempts: Update.inc(), error: encodedError, status: 'dlq' as const })),
											Match.orElse((queued) => ({ attempts: Update.inc(), error: encodedError, jobId: queued.jobId, status: 'queued' as const })),
										));
										yield* eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', error: encodedError, status: next.status }, tenantId: row.appId }).pipe(Effect.ignore);
									})),
								),
							})),
						)),
						Match.orElse((status) => Effect.logDebug('notification.send skipped non-queued row', { notificationId: row.id, status }).pipe(Effect.asVoid)),
					),
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
				Effect.flatMap((user) => S.decodeUnknown(NotificationPreferencesSchema)(user.notificationPreferences).pipe(Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))))),
				Telemetry.span('notification.preferences.get', { kind: 'server', metrics: false }),
			),
			list: listPage,
			listMine: (options?: { after?: Date; before?: Date; cursor?: string; limit?: number }) => Context.Request.sessionOrFail.pipe(Effect.flatMap((session) => listPage({ ...options, userId: session.userId }))),
			replay: (notificationId: string) => Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.notifications.one([{ field: 'id', value: notificationId }]))),
				Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('notification', notificationId)), onSome: Effect.succeed })),
					Effect.flatMap((notification) => Context.Request.withinSync(notification.appId, jobs.submit('notification.send', { notificationId: notification.id }, { dedupeKey: `${notification.appId}:${notification.id}:replay:${crypto.randomUUID()}`, maxAttempts: 1 })).pipe(
						Effect.tap((jobId) => database.notifications.transition(notification.id, { error: null, jobId, status: 'queued' })),
						Effect.asVoid,
					)),
				Telemetry.span('notification.replay', { kind: 'server', metrics: false }),
			),
			send: (input: S.Schema.Encoded<typeof NotificationRequest> | readonly S.Schema.Encoded<typeof NotificationRequest>[]) => Effect.forEach(
				Array.isArray(input) ? input : [input],
					(raw) => S.decodeUnknown(NotificationRequest)(raw).pipe(
						Effect.flatMap((request) => Context.Request.currentTenantId.pipe(
							Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, Effect.gen(function* () {
								const user = yield* Option.match(Option.fromNullable(request.userId), {
									onNone: () => Effect.succeed(Option.none()),
									onSome: (userId) => database.users.one([{ field: 'id', value: userId }]).pipe(
										Effect.flatMap(Option.match({
											onNone: () => Effect.fail(HttpError.NotFound.of('user', userId)),
											onSome: (value) => Effect.succeed(Option.some(value)),
										})),
									),
								});
									const preferences = yield* Option.match(user, {
										onNone: () => Effect.succeed(Option.none<S.Schema.Type<typeof NotificationPreferencesSchema>>()),
										onSome: (value) => S.decodeUnknown(NotificationPreferencesSchema)(value.notificationPreferences).pipe(
											Effect.map(Option.some),
											Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))),
										),
								});
							const blocked = Option.match(preferences, {
								onNone: () => false,
								onSome: (value) => (value.mutedUntil !== null && Date.parse(value.mutedUntil) > Date.now()) || !value.channels[request.channel] || value.templates[request.template]?.[request.channel] === false,
							});
							yield* Effect.filterOrFail(Effect.void, () => !blocked, () => NotificationError.from('PreferenceBlocked'));
							const recipient = request.channel === 'email' ? Option.getOrUndefined(Option.orElse(Option.fromNullable(request.recipient), () => Option.map(user, (value) => value.email))) : request.recipient;
							yield* Effect.filterOrFail(Effect.void, () => !(request.channel === 'email' && recipient === undefined), () => NotificationError.from('MissingRecipient'));
									const toInsert = (dk: Option.Option<string>) => ({
									appId: tenantId,
									attempts: 0,
									channel: request.channel,
									dedupeKey: dk,
									maxAttempts: request.maxAttempts,
									payload: request.data,
									recipient: Option.fromNullable(recipient),
									status: 'queued' as const,
									template: request.template,
									userId: Option.fromNullable(request.userId),
								});
								const dedupeKey = Option.fromNullable(request.dedupeKey);
									const staged = yield* dedupeKey.pipe(Option.match({
										onNone: () => database.notifications.put(toInsert(Option.none())).pipe(Effect.map((row) => ({ duplicate: false as const, row }))),
										onSome: (key) => database.notifications.one([
											{ field: 'dedupe_key', value: key },
											{ field: 'status', op: 'in', values: ['queued', 'sending'] },
										]).pipe(Effect.flatMap(Option.match({
											onNone: () => database.notifications.put(toInsert(Option.some(key))).pipe(
												Effect.map((row) => ({ duplicate: false as const, row })),
												Effect.catchAll((error) => database.notifications.one([
													{ field: 'dedupe_key', value: key },
													{ field: 'status', op: 'in', values: ['queued', 'sending'] },
												]).pipe(Effect.flatMap(Option.match({
													onNone: () => Effect.fail(error),
													onSome: (row) => Effect.succeed({ duplicate: true as const, row }),
												})))),
											),
											onSome: (row) => Effect.succeed({ duplicate: true as const, row }),
										}))),
									}));
									yield* Match.value(staged.duplicate).pipe(
										Match.when(true, () => Effect.void),
										Match.orElse(() => jobs.submit(
											'notification.send',
											{ notificationId: staged.row.id },
											{
												dedupeKey: Option.match(dedupeKey, {
													onNone: () => `${tenantId}:${staged.row.id}`,
													onSome: (value) => `${tenantId}:${value}`,
												}),
												maxAttempts: 1,
											},
										).pipe(
											Effect.catchAll((error) => {
												const encodedError = JSON.stringify({
													message: Match.value(error).pipe(
														Match.when(Match.instanceOf(Error), (value) => value.message),
														Match.orElse((value) => String(value)),
													),
													tag: MetricsService.errorTag(error),
												});
												return database.notifications.transition(staged.row.id, { error: encodedError, jobId: null, status: 'failed' }).pipe(Effect.andThen(Effect.fail(error)));
											}),
											Effect.flatMap((jobId) => database.notifications.transition(staged.row.id, { error: null, jobId, status: 'queued' })),
											Effect.asVoid,
										)),
									);
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
			updatePreferences: (raw: S.Schema.Encoded<typeof NotificationPreferencesSchema>) => S.decodeUnknown(NotificationPreferencesSchema)(raw).pipe(
				Effect.flatMap((preferences) => Context.Request.sessionOrFail.pipe(
					Effect.flatMap((session) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, database.users.setNotificationPreferences(session.userId, preferences))))),
					Effect.map((user) => user.notificationPreferences),
					Effect.flatMap(S.decodeUnknown(NotificationPreferencesSchema)),
				)),
				Telemetry.span('notification.preferences.update', { kind: 'server', metrics: false }),
			),
		} as const;
	}),
}) {
	static readonly Error = NotificationError;
	static readonly Preferences = NotificationPreferencesSchema;
	static readonly Request = NotificationRequest;
}

// --- [EXPORT] ----------------------------------------------------------------

export { NotificationService };
