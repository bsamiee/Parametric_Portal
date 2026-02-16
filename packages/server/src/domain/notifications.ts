/**
 * Orchestrate notification delivery across channels.
 * Domain: Multi-channel service (email, webhook, inApp) with preference filtering.
 */
import { Update } from '@parametric-portal/database/factory';
import { Notification, PreferencesSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Cause, Duration, Effect, Match, Metric, Option, Schema as S, Stream, pipe } from 'effect';
import { constant } from 'effect/Function';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { EmailAdapter } from '../infra/email.ts';
import { EventBus } from '../infra/events.ts';
import { JobService } from '../infra/jobs.ts';
import { WebhookService } from '../infra/webhooks.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class NotificationRequest extends S.Class<NotificationRequest>('NotificationRequest')({
    channel:     Notification.fields.channel,
    data:        S.Unknown,
    dedupeKey:   S.optional(S.String),
    maxAttempts: S.optionalWith(S.Int.pipe(S.between(1, 10)), { default: () => 5 }),
    recipient:   S.optional(S.String),
    template:    S.NonEmptyTrimmedString,
    userId:      S.optional(S.UUID),
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class NotificationError extends S.TaggedError<NotificationError>()('NotificationError', {
    cause: S.optional(S.Unknown),
    reason: S.Literal('MissingRecipient', 'PreferenceBlocked'),
}) {static readonly from = <const R extends NotificationError['reason']>(reason: R, cause?: unknown) => new NotificationError({ cause, reason });}

// --- [SERVICES] --------------------------------------------------------------

class NotificationService extends Effect.Service<NotificationService>()('server/Notifications', {
    dependencies: [DatabaseService.Default, EmailAdapter.Default, EventBus.Default, JobService.Default, MetricsService.Default, Resilience.Layer, WebhookService.Default],
    scoped: Effect.gen(function* () {
        const [database, email, eventBus, jobs, metrics, webhooks] = yield* Effect.all([DatabaseService, EmailAdapter, EventBus, JobService, MetricsService, WebhookService]);
        const resilienceCtx = yield* Effect.context<Resilience.State>();
        yield* jobs.registerHandler('notification.send', Effect.fn(function* (raw) {
            const { notificationId } = yield* S.decodeUnknown(S.Struct({ notificationId: S.UUID }))(raw);
            const notification = yield* database.notifications.one([{ field: 'id', value: notificationId }]);
            const row = yield* notification;
            yield* pipe(
                Effect.logDebug('notification.send skipped non-queued row', { notificationId: row.id, status: row.status }),
                Effect.andThen(Option.none<never>()),
                Effect.when(() => row.status !== 'queued'),
                Effect.asVoid,
            );
            const claimed = yield* database.notifications.transition(row.id, { status: 'sending' }, 'queued');
            yield* pipe(
                Effect.logDebug('notification.send claim skipped', { notificationId: row.id }),
                Effect.when(() => Option.isNone(claimed)),
                Effect.asVoid,
            );
            const channel = row.channel as 'email' | 'inApp' | 'webhook';
            const encodeError = (error: unknown) => Match.value(error as { readonly _tag: string; readonly reason?: string; readonly provider?: string; readonly deliveryId?: string }).pipe(
                Match.when({ _tag: 'NotificationError' }, (tagged) => JSON.stringify({ message: tagged.reason, tag: 'NotificationError' })),
                Match.when({ _tag: 'EmailError' }, (tagged) => JSON.stringify({ message: tagged.reason, provider: tagged.provider, tag: 'EmailError' })),
                Match.when({ _tag: 'WebhookError' }, (tagged) => JSON.stringify({ deliveryId: tagged.deliveryId, message: tagged.reason, tag: 'WebhookError' })),
                Match.orElse((other) => JSON.stringify({ message: String(other), tag: MetricsService.errorTag(other) })),
            );
            const onExhaustion = (error: unknown) => pipe(
                Context.Request.withinSync(row.appId, jobs.submit('notification.send', { notificationId: row.id }, {
                    dedupeKey: `${row.appId}:${row.id}:retry:${row.retryCurrent + 1}`,
                    maxAttempts: 1,
                    scheduledAt: Date.now() + Math.min(
                        Duration.toMillis({ email: Duration.seconds(30), inApp: Duration.seconds(5), webhook: Duration.seconds(15) }[channel]) * 2 ** row.retryCurrent,
                        Duration.toMillis({ email: Duration.minutes(10), inApp: Duration.seconds(30), webhook: Duration.minutes(5) }[channel]),
                    ),
                })),
                Effect.flatMap((jobId) => database.notifications.set(row.id, {
                    correlation: Option.some({ job: jobId }),
                    delivery: Option.some({ error: encodeError(error) }),
                    retryCurrent: Update.inc(),
                    retryMax: row.retryMax,
                    status: 'queued' as const,
                })),
                Effect.when(() => row.retryCurrent + 1 < row.retryMax),
                Effect.catchAll((reEnqueueError) => Effect.logWarning('notification.reEnqueue.failed', { error: String(reEnqueueError), notificationId: row.id })),
                Effect.asVoid,
            );
            yield* pipe(
                ({
                    email: pipe(
                        Effect.filterOrFail(
                            Effect.succeed(Option.getOrUndefined(row.recipient)),
                            (recipient): recipient is string => recipient !== undefined,
                            constant(NotificationError.from('MissingRecipient', row.id)),
                        ),
                        Effect.flatMap((recipient) => Resilience.run('notification.deliver.email',
                            email.send({ notificationId: row.id, template: row.template, tenantId: row.appId, to: recipient, vars: row.payload }).pipe(Effect.map((result) => Option.some(result.provider))),
                            { circuit: 'notification.email', onExhaustion, retry: 'default', timeout: Duration.seconds(30) },
                        )),
                    ),
                    inApp: Resilience.run('notification.deliver.inApp',
                        eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'inApp', data: row.payload, template: row.template, userId: Option.getOrUndefined(row.userId) }, tenantId: row.appId }),
                        { onExhaustion, retry: 'brief', timeout: Duration.seconds(5) },
                    ).pipe(Effect.as(Option.none<string>())),
                    webhook: Resilience.run('notification.deliver.webhook',
                        webhooks.deliverEvent(row.appId, row.template, row.payload, row.id),
                        { circuit: 'notification.webhook', onExhaustion, retry: 'default', timeout: Duration.seconds(15) },
                    ).pipe(Effect.as(Option.none<string>())),
                } as const)[channel],
                Effect.provide(resilienceCtx),
                Metric.trackDuration(Metric.taggedWithLabels(metrics.notification.latency, MetricsService.label({ channel }))),
                Effect.flatMap((provider: Option.Option<string>) => database.notifications.transition(row.id, { delivery: Option.some({ at: new Date(), error: undefined, provider: Option.getOrUndefined(provider) }), status: 'delivered' })),
                Effect.tap(() => MetricsService.inc(metrics.notification.delivered, MetricsService.label({ channel }))),
                Effect.tap(() => eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', status: 'delivered' }, tenantId: row.appId }).pipe(Effect.ignore)),
                Effect.catchAll(Effect.fn(function* (error) {
                    yield* pipe(
                        Effect.gen(function* () {
                            const encoded = encodeError(error);
                            yield* database.notifications.set(row.id, { delivery: Option.some({ error: encoded }), retryCurrent: Update.inc(), retryMax: row.retryMax, status: 'dlq' as const });
                            yield* MetricsService.inc(metrics.notification.failed, MetricsService.label({ channel, status: 'dlq' }));
                            yield* eventBus.publish({ aggregateId: row.id, payload: { _tag: 'notification', action: 'status', error: encoded, status: 'dlq' }, tenantId: row.appId }).pipe(Effect.ignore);
                        }),
                        Effect.when(() => row.retryCurrent + 1 >= row.retryMax || Resilience.is(error, 'CircuitError')),
                        Effect.asVoid,
                    );
                })),
                Effect.when(() => Option.isSome(claimed)),
                Effect.asVoid,
            );
        }, (effect) => effect.pipe(
            Effect.catchIf(Cause.isNoSuchElementException, () => Effect.void),
            Telemetry.span('notification.job.handle', { metrics: false }),
        )) as (raw: unknown) => Effect.Effect<void, unknown, never>);
        const listPage = (options?: { after?: Date; before?: Date; cursor?: string; limit?: number; userId?: string }) => database.notifications.page(
            database.notifications.preds({ after: options?.after, before: options?.before, user_id: options?.userId }),
            { cursor: options?.cursor, limit: options?.limit },
        );
        return {
            getPreferences: () => Context.Request.sessionOrFail.pipe(
                Effect.flatMap((session) => database.users.one([{ field: 'id', value: session.userId }])),
                Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('user')), onSome: Effect.succeed })),
                Effect.flatMap((user) => S.decodeUnknown(PreferencesSchema)(user.preferences).pipe(Effect.mapError((error) => HttpError.Validation.of('notificationPreferences', String(error))))),
                Telemetry.span('notification.preferences.get', { metrics: false }),
            ),
            list: listPage,
            listMine: (options?: { after?: Date; before?: Date; cursor?: string; limit?: number }) => Context.Request.sessionOrFail.pipe(Effect.flatMap((session) => listPage({ ...options, userId: session.userId }))),
            replay: (notificationId: string) => Context.Request.currentTenantId.pipe(
                Effect.flatMap(() => database.notifications.one([{ field: 'id', value: notificationId }])),
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
                    const user = yield* Option.match(userIdOpt, {
                        onNone: () => Effect.succeed(Option.none()),
                        onSome: (userId) => database.users.one([{ field: 'id', value: userId }]).pipe(
                            Effect.flatMap(Option.match({ onNone: constant(Effect.fail(HttpError.NotFound.of('user', userId))), onSome: Effect.succeed })),
                            Effect.map(Option.some),
                        ),
                    });
                    const prefsEffect = Option.match(user, {
                        onNone: () => Effect.succeed(Option.none<S.Schema.Type<typeof PreferencesSchema>>()),
                        onSome: (u) => S.decodeUnknown(PreferencesSchema)(u.preferences).pipe(Effect.map(Option.some)),
                    }) as Effect.Effect<Option.Option<S.Schema.Type<typeof PreferencesSchema>>, unknown>;
                    const preferences = yield* Effect.mapError(prefsEffect, (error) => HttpError.Validation.of('notificationPreferences', String(error)));
                    const blocked = pipe(
                        preferences,
                        Option.map((p) => p.mutedUntil !== null && Date.parse(p.mutedUntil) > Date.now()
                            || !p.channels[request.channel]
                            || p.templates[request.template]?.[request.channel] === false),
                        Option.getOrElse(constant(false)),
                    );
                    yield* Effect.when(Effect.fail(NotificationError.from('PreferenceBlocked')), constant(blocked)).pipe(Effect.asVoid);
                    const fallbackEmail = Option.flatMap(user, (value) => Option.fromNullable(value.email));
                    const recipient = Match.value(request.channel).pipe(
                        Match.when('email', constant(Option.getOrUndefined(Option.orElse(Option.fromNullable(request.recipient), constant(fallbackEmail))))),
                        Match.orElse(constant(request.recipient)),
                    );
                    yield* Effect.filterOrFail(Effect.void, constant(request.channel !== 'email' || recipient !== undefined), constant(NotificationError.from('MissingRecipient')));
                    const dedupeKey = Option.fromNullable(request.dedupeKey);
                    const existing = yield* Option.match(dedupeKey, {
                        onNone: () => Effect.succeed(Option.none()),
                        onSome: (dk) => database.notifications.one([
                            { field: 'correlation', op: 'contains', value: JSON.stringify({ dedupe: dk }) },
                            { field: 'status', op: 'in', values: ['queued', 'sending'] },
                        ]),
                    });
                    const staged = yield* Option.match(existing, {
                        onNone: () => database.notifications.put({
                            appId: tenantId,
                            channel: request.channel,
                            correlation: Option.map(dedupeKey, (dedupe) => ({ dedupe })),
                            payload: request.data,
                            recipient: Option.fromNullable(recipient),
                            retryCurrent: 0,
                            retryMax: request.maxAttempts,
                            status: 'queued' as const,
                            template: request.template,
                            userId: Option.fromNullable(request.userId),
                        }).pipe(
                            Effect.map((row) => ({ duplicate: false, row })),
                            Effect.catchIf(
                                (error) => typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505',
                                () => Option.match(dedupeKey, {
                                    onNone: () => Effect.dieMessage('Unique violation without dedupe key'),
                                    onSome: (dk) => database.notifications.one([
                                        { field: 'correlation', op: 'contains', value: JSON.stringify({ dedupe: dk }) },
                                        { field: 'status', op: 'in', values: ['queued', 'sending'] },
                                    ]).pipe(
                                        Effect.flatMap(Option.match({
                                            onNone: () => Effect.dieMessage('Race condition: unique violation but no existing row'),
                                            onSome: (row) => Effect.succeed({ duplicate: true, row }),
                                        })),
                                    ),
                                }),
                            ),
                        ),
                        onSome: (row) => Effect.succeed({ duplicate: true, row }),
                    });
                    const dedupeKeyStr = Option.match(dedupeKey, { onNone: constant(`${tenantId}:${staged.row.id}`), onSome: (dk) => `${tenantId}:${dk}` });
                    yield* pipe(
                        jobs.submit('notification.send', { notificationId: staged.row.id }, { dedupeKey: dedupeKeyStr, maxAttempts: 1 }).pipe(
                            Effect.catchAll(Effect.fn(function* (error) {
                                const encodedError = JSON.stringify({ message: String(error), tag: MetricsService.errorTag(error) });
                                yield* database.notifications.transition(staged.row.id, { delivery: Option.some({ error: encodedError }), status: 'failed' });
                                return yield* Effect.fail(error);
                            })),
                            Effect.flatMap((jobId) => database.notifications.transition(staged.row.id, { correlation: Option.some({ job: jobId }), delivery: Option.some({ error: undefined }), status: 'queued' }, 'queued')),
                            Effect.asVoid,
                        ),
                        Effect.when(constant(!staged.duplicate)),
                    );
                    yield* MetricsService.inc(metrics.notification.queued, MetricsService.label({ channel: request.channel, template: request.template }));
                    return { id: staged.row.id, status: 'queued' as const };
                }, (effect, raw) => effect.pipe(
                    Effect.catchIf(
                        (error): error is NotificationError => error instanceof NotificationError,
                        (error) => Effect.succeed({
                            id: raw.template,
                            status: Match.value(error.reason).pipe(
                                Match.when('PreferenceBlocked', constant('blocked' as const)),
                                Match.when('MissingRecipient', constant('failed' as const)),
                                Match.exhaustive,
                            ),
                        }),
                    ),
                )),
                { concurrency: 'unbounded' },
            ).pipe(Telemetry.span('notification.send', { metrics: false })),
            streamMine: () => Stream.unwrap(Context.Request.sessionOrFail.pipe(Effect.map((session) => eventBus.stream().pipe(Stream.filter((envelope) => envelope.event.eventType === 'notification.inApp' && (envelope.event.payload as Record<string, unknown>)?.['userId'] === session.userId),)))),
            updatePreferences: (raw: S.Schema.Encoded<typeof PreferencesSchema>) => Effect.gen(function* () {
                const preferences = yield* S.decodeUnknown(PreferencesSchema)(raw);
                const session = yield* Context.Request.sessionOrFail;
                const user = yield* database.users.setPreferences(session.userId, preferences);
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
