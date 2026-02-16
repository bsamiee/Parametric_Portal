/**
 * Admin management endpoints.
 * Admin-gated CRUD for users, sessions, jobs, DLQ, events, tenants.
 */
import { HttpApiBuilder } from '@effect/platform';
import type { App } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { HttpError } from '@parametric-portal/server/errors';
import { EventBus } from '@parametric-portal/server/infra/events';
import { TenantLifecycleService } from '@parametric-portal/server/infra/handlers/tenant-lifecycle';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { PolicyService } from '@parametric-portal/server/security/policy';
import { FeatureService } from '@parametric-portal/server/domain/features';
import { constant, flow } from 'effect/Function';
import { Array as Arr, Cause, Effect, Encoding, Match, Option, pipe, Struct } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const AdminLive = HttpApiBuilder.group(ParametricApi, 'admin', (handlers) =>
    Effect.gen(function* () {
        const [database, jobs, eventBus, audit, webhooks, policy, notifications, features, lifecycle] = yield* Effect.all([DatabaseService, JobService, EventBus, AuditService, WebhookService, PolicyService, NotificationService, FeatureService, TenantLifecycleService]);
        const admin = Middleware.resource('admin');
        return handlers
            .handle('listUsers', ({ urlParams }) => admin.api('listUsers',database.users.page([], { cursor: urlParams.cursor, limit: urlParams.limit }),))
            .handle('listSessions', ({ urlParams }) => admin.api('listSessions',
                database.sessions.page(
                    pipe(
                        Match.value(urlParams),
                        Match.when({ userId: Match.defined }, ({ userId }) => [{ field: 'userId' as const, value: userId }]),
                        Match.when({ ipAddress: Match.defined }, ({ ipAddress }) => [{ field: 'ipAddress' as const, value: ipAddress }]),
                        Match.orElse(() => []),
                    ),
                    { cursor: urlParams.cursor, limit: urlParams.limit },
                ),
            ))
            .handle('deleteSession', ({ path }) => admin.mutation('deleteSession', database.sessions.softDelete(path.id).pipe(
                Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('session', path.id) : HttpError.Internal.of('Session delete failed', error)),
                Effect.tap(() => audit.log('Session.delete', { details: { sessionId: path.id } })),
                Effect.as({ success: true as const }),
            )))
            .handle('revokeSessionsByIp', ({ payload }) => admin.mutation('revokeSessionsByIp',
                Context.Request.currentTenantId.pipe(
                Effect.flatMap((appId) => database.sessions.softDeleteByIp(appId, payload.ipAddress)),
                Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
                Effect.map((revoked) => ({ revoked })),),
            ))
            .handle('listJobs', ({ urlParams }) => admin.api('listJobs', database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }),))
            .handle('cancelJob', ({ path }) => admin.mutation('cancelJob', jobs.cancel(path.id).pipe(
                Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),
                Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
                Effect.as({ success: true as const }),
            )))
            .handle('listDlq', ({ urlParams }) => admin.api('listDlq', database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }),))
            .handle('replayDlq', ({ path }) => admin.mutation('replayDlq', database.jobDlq.one([{ field: 'id', value: path.id }]).pipe(
                HttpError.mapTo('dlq lookup failed'),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('dlq', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (entry) => entry.source === 'job' || entry.type.startsWith('webhook:'),
                    (entry) => HttpError.Validation.of('dlqReplay', `Unsupported event DLQ type: ${entry.type}`),
                ),
                Effect.andThen((entry) => pipe(
                    Match.value(entry.source),
                    Match.when('job', constant(Context.Request.withinSync(entry.appId, jobs.submit(entry.type, entry.payload, { priority: 'normal' }).pipe(Effect.flatMap(constant(database.jobDlq.markReplayed(path.id))),)),)),
                    Match.orElse(constant(webhooks.retry(path.id))),
                )),
                Effect.asVoid,
                Effect.catchAll((error: unknown) => Effect.fail(HttpError.Internal.of('DLQ replay failed', error))),
                Effect.tap(() => audit.log('Dlq.replay', { details: { dlqId: path.id } })),
                Effect.as({ success: true as const }),
            )))
            .handle('listNotifications', ({ urlParams }) => admin.api('listNotifications',
                notifications.list({
                    after:  urlParams.after,
                    before: urlParams.before,
                    cursor: urlParams.cursor,
                    limit:  urlParams.limit,
                }),
            ))
            .handle('replayNotification', ({ path }) => admin.mutation('replayNotification',
                notifications.replay(path.id).pipe(
                    Effect.tap(() => audit.log('Job.replay', { details: { notificationId: path.id } })),
                    Effect.as({ success: true as const }),
                ),
            ))
            .handleRaw('events', constant(admin.realtime('events', Context.Request.currentTenantId.pipe(
                Effect.andThen((tenantId) => StreamingService.sse({
                    filter:    (envelope) => envelope.event.tenantId === tenantId,
                    name:      'admin.events',
                    serialize: (envelope) => ({data: JSON.stringify(envelope.event), event: 'domain' as const, id: envelope.event.eventId,}),
                    source:    eventBus.stream(),
                })),
            ))))
            .handle('queryDbObservability', ({ payload }) => admin.api('queryDbObservability', database.observability.query(payload).pipe(Effect.map((sections) => ({ sections }))),))
            .handle('listPermissions', () => admin.api('listPermissions', policy.list().pipe(Effect.map(Arr.map(({ action, resource, role }) => ({ action, resource, role })))),))
            .handle('grantPermission', ({ payload }) => admin.mutation('grantPermission',
                policy.grant(payload).pipe(
                    Effect.map((permission) => ({ action: permission.action, resource: permission.resource, role: permission.role })),
                    Effect.tap((permission) => audit.log('Permission.create', { details: permission })),
                ),
            ))
            .handle('revokePermission', ({ payload }) => admin.mutation('revokePermission',
                policy.revoke(payload).pipe(
                    Effect.tap(() => audit.log('Permission.revoke', { details: payload })),
                    Effect.as({ success: true as const }),
                ),
            ))
            .handle('listTenants', () => admin.api('listTenants', database.apps.find([]),))
            .handle('createTenant', ({ payload }) => admin.mutation('createTenant',
                lifecycle.transition({ _tag: 'provision', ...payload }).pipe(
                Effect.filterOrFail(
                    (result): result is typeof App.Type => 'id' in result,
                    constant(HttpError.Internal.of('Provision did not return tenant')),),
                ),
            ))
            .handle('getTenant', ({ path }) => admin.api('getTenant',
                database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.fail(HttpError.NotFound.of('tenant', path.id)),
                    onSome: Effect.succeed,})),
                ),
            ))
            .handle('updateTenant', ({ path, payload }) => admin.mutation('updateTenant',
                database.withTransaction(database.apps.readSettings(path.id, 'update').pipe(
                    Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(HttpError.NotFound.of('tenant', path.id)),
                        onSome: Effect.succeed,
                    })),
                    Effect.bindTo('loaded'),
                    Effect.let('updates', ({ loaded }) => ({
                        ...(payload.name === undefined ? {} : { name: payload.name }),
                        ...(payload.settings === undefined ? {} : { settings: { ...loaded.settings, ...payload.settings } }),
                    })),
                    Effect.bind('updated', ({ loaded, updates }) =>
                        database.apps.set(path.id, updates).pipe(
                            Effect.mapError(constant(HttpError.Internal.of('Tenant update failed'))),
                            Effect.when(constant(Object.keys(updates).length > 0)),
                            Effect.map(Option.getOrElse(constant(loaded.app))),
                        ),
                    ),
                    Effect.tap(() => audit.log('App.update', { details: { tenantId: path.id } })),
                    Effect.tap(() => eventBus.publish({ aggregateId: path.id, payload: { _tag: 'app', action: 'settings.updated' }, tenantId: path.id }).pipe(Effect.ignore)),
                    Effect.map(({ updated }) => updated),
                )),
            ))
            .handle('deactivateTenant', ({ path }) => admin.mutation('deactivateTenant', lifecycle.transition({ _tag: 'suspend', tenantId: path.id }).pipe(Effect.as({ success: true as const }),),))
            .handle('resumeTenant', ({ path }) => admin.mutation('resumeTenant', lifecycle.transition({ _tag: 'resume', tenantId: path.id }).pipe(Effect.as({ success: true as const }),),))
            .handle('archiveTenant', ({ path }) => admin.mutation('archiveTenant', lifecycle.transition({ _tag: 'archive', tenantId: path.id }).pipe(Effect.as({ success: true as const }),),))
            .handle('purgeTenant', ({ path }) => admin.mutation('purgeTenant', lifecycle.transition({ _tag: 'purge', tenantId: path.id }).pipe(Effect.as({ success: true as const }),),))
            .handle('getTenantOAuth', ({ path }) => admin.api('getTenantOAuth',
                database.apps.readSettings(path.id).pipe(
                    Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                    Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                    Effect.map(({ value: { settings } }) => settings.oauthProviders),
                    Effect.map(Arr.map(({ clientSecretEncrypted, ...rest }) => ({ ...rest, clientSecretSet: clientSecretEncrypted.length > 0 }))),
                    Effect.map((providers) => ({ providers })),
                ),
            ))
            .handle('updateTenantOAuth', Effect.fn(
                function*({ path, payload }) {
                    const loaded = yield* database.apps.readSettings(path.id, 'update').pipe(
                        Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                        Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                        Effect.map(Struct.get('value')),
                    );
                    const secretsByProvider = Arr.groupBy(loaded.settings.oauthProviders, Struct.get('provider'));
                    const encrypted = yield* Effect.forEach(
                        payload.providers,
                        (provider): Effect.Effect<string, HttpError.Validation | HttpError.Internal, Crypto.Service> => pipe(
                            Option.fromNullable(provider.clientSecret),
                            Option.match({
                                onNone: constant(
                                    Effect.fromNullable(secretsByProvider[provider.provider]?.[0]).pipe(
                                        Effect.mapError(constant(HttpError.Validation.of('clientSecret', `Missing clientSecret for provider '${provider.provider}'`))),
                                        Effect.map(Struct.get('clientSecretEncrypted')),)
                                ),
                                onSome: flow(Crypto.encrypt, Effect.mapError(constant(HttpError.Internal.of('Encryption failed'))), Effect.map(Encoding.encodeBase64)),
                            }),
                        ),
                        { concurrency: 'unbounded' },
                    );
                    const oauthProviders = Arr.zipWith(encrypted, payload.providers, (enc, provider) => ({ ...Struct.omit(provider, 'clientSecret'), clientSecretEncrypted: enc }));
                    yield* database.apps.updateSettings(loaded.app.id, { ...loaded.settings, oauthProviders });
                    yield* audit.log('App.update', { details: { tenantId: path.id } });
                    yield* eventBus.publish({ aggregateId: path.id, payload: { _tag: 'app', action: 'settings.updated' }, tenantId: path.id }).pipe(Effect.ignore);
                    return pipe(
                        oauthProviders,
                        Arr.map(({ clientSecretEncrypted, ...rest }) => ({ ...rest, clientSecretSet: clientSecretEncrypted.length > 0 })),
                        (providers) => ({ providers }),
                    );
                },
                (effect) => admin.mutation('updateTenantOAuth', effect,),
            ))
            .handle('getFeatureFlags', () => admin.api('getFeatureFlags', features.getAll,))
            .handle('setFeatureFlag', ({ payload }) => admin.mutation('setFeatureFlag',
                features.set(payload.flag, payload.value).pipe(
                    Effect.tap(() => audit.log('Feature.update', { details: { flag: payload.flag, value: payload.value } })),
                    Effect.as({ success: true as const }),
                ),
            ));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AdminLive };
