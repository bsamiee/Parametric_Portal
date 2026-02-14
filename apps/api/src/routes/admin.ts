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
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
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
        const _dbQuery = <const N extends (typeof PolicyService.Catalog)['admin'][number], A, E, R>(name: N, effect: Effect.Effect<A, E, R>, label: string) =>
            Middleware.guarded('admin', name, 'api', effect.pipe(HttpError.mapTo(label), Telemetry.span(`admin.${name}`)));
        return handlers
            .handle('listUsers', ({ urlParams }) => Middleware.guarded('admin', 'listUsers', 'api', database.users.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                HttpError.mapTo('User list failed'),
                Telemetry.span('admin.listUsers'),
            )))
            .handle('listSessions', ({ urlParams }) => Middleware.guarded('admin', 'listSessions', 'api', database.sessions.page(
                    pipe(
                        Match.value(urlParams),
                        Match.when({ userId: Match.defined }, ({ userId }) => [{ field: 'user_id' as const, value: userId }]),
                        Match.when({ ipAddress: Match.defined }, ({ ipAddress }) => [{ field: 'ip_address' as const, value: ipAddress }]),
                        Match.orElse(() => []),
                    ),
                    { cursor: urlParams.cursor, limit: urlParams.limit },
                ).pipe(HttpError.mapTo('Session list failed'),
                Telemetry.span('admin.listSessions'),
            )))
            .handle('deleteSession', ({ path }) => Middleware.guarded('admin', 'deleteSession', 'mutation', database.sessions.softDelete(path.id).pipe(
                Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('session', path.id) : HttpError.Internal.of('Session delete failed', error)),
                Effect.tap(() => audit.log('Session.delete', { details: { sessionId: path.id } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.deleteSession'),
            )))
            .handle('revokeSessionsByIp', ({ payload }) => Middleware.guarded('admin', 'revokeSessionsByIp', 'mutation', Context.Request.currentTenantId.pipe(
                Effect.flatMap((appId) => database.sessions.softDeleteByIp(appId, payload.ipAddress)),
                HttpError.mapTo('Session revoke failed'),
                Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
                Effect.map((revoked) => ({ revoked })),
                Telemetry.span('admin.revokeSessionsByIp'),
            )))
            .handle('listJobs', ({ urlParams }) => Middleware.guarded('admin', 'listJobs', 'api', database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                HttpError.mapTo('Job list failed'),
                Telemetry.span('admin.listJobs'),
            )))
            .handle('cancelJob', ({ path }) => Middleware.guarded('admin', 'cancelJob', 'mutation', jobs.cancel(path.id).pipe(
                Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),
                Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.cancelJob'),
            )))
            .handle('listDlq', ({ urlParams }) => Middleware.guarded('admin', 'listDlq', 'api', database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                HttpError.mapTo('DLQ list failed'),
                Telemetry.span('admin.listDlq'),
            )))
            .handle('replayDlq', ({ path }) => Middleware.guarded('admin', 'replayDlq', 'mutation', database.jobDlq.one([{ field: 'id', value: path.id }]).pipe(
                HttpError.mapTo('dlq lookup failed'),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('dlq', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (entry) => entry.source === 'job' || entry.type.startsWith('webhook:'),
                    (entry) => HttpError.Validation.of('dlqReplay', `Unsupported event DLQ type: ${entry.type}`),
                ),
                Effect.andThen((entry) => pipe(
                    Match.value(entry.source),
                    Match.when('job', constant(
                        Context.Request.withinSync(entry.appId, jobs.submit(entry.type, entry.payload, { priority: 'normal' }).pipe(
                            Effect.flatMap(constant(database.jobDlq.markReplayed(path.id))),
                        )),
                    )),
                    Match.orElse(constant(webhooks.retry(path.id))),
                )),
                Effect.asVoid,
                Effect.catchAll((error: unknown) => Effect.fail(HttpError.Internal.of('DLQ replay failed', error))),
                Effect.tap(() => audit.log('Dlq.replay', { details: { dlqId: path.id } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.replayDlq'),
            )))
            .handle('listNotifications', ({ urlParams }) => Middleware.guarded('admin', 'listNotifications', 'api', notifications.list({
                after: urlParams.after,
                before: urlParams.before,
                cursor: urlParams.cursor,
                limit: urlParams.limit,
            }).pipe(
                HttpError.mapTo('Notification list failed'),
                Telemetry.span('admin.listNotifications'),
            )))
            .handle('replayNotification', ({ path }) => Middleware.guarded('admin', 'replayNotification', 'mutation', notifications.replay(path.id).pipe(
                HttpError.mapTo('Notification replay failed'),
                Effect.tap(() => audit.log('Job.replay', { details: { notificationId: path.id } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.replayNotification'),
            )))
            .handleRaw('events', constant(Middleware.guarded('admin', 'events', 'realtime', Context.Request.currentTenantId.pipe(
                Effect.andThen((tenantId) => StreamingService.sse({
                    filter: (envelope) => envelope.event.tenantId === tenantId,
                    name: 'admin.events',
                    serialize: (envelope) => ({
                        data: JSON.stringify(envelope.event),
                        event: 'domain' as const,
                        id: envelope.event.eventId,
                    }),
                    source: eventBus.stream(),
                })),
                Telemetry.span('admin.events'),
            ))))
            .handle('ioDetail', () => _dbQuery('ioDetail', database.monitoring.ioDetail(), 'Database io stats failed'))
            .handle('ioConfig', () => _dbQuery('ioConfig', database.monitoring.ioConfig(), 'Database io config failed'))
            .handle('statements', ({ urlParams }) => _dbQuery('statements', database.statements(urlParams.limit), 'Database statements failed'))
            .handle('cacheRatio', () => _dbQuery('cacheRatio', database.monitoring.cacheRatio(), 'Database cache hit ratio failed'))
            .handle('walInspect', ({ urlParams }) => _dbQuery('walInspect', database.walInspect(urlParams.limit), 'Database WAL inspect failed'))
            .handle('kcache', ({ urlParams }) => _dbQuery('kcache', database.kcache(urlParams.limit), 'Database stat kcache failed'))
            .handle('qualstats', ({ urlParams }) => _dbQuery('qualstats', database.qualstats(urlParams.limit), 'Database qualstats failed'))
            .handle('waitSampling', ({ urlParams }) => _dbQuery('waitSampling', database.waitSampling(urlParams.limit), 'Database wait sampling failed'))
            .handle('waitSamplingCurrent', ({ urlParams }) => _dbQuery('waitSamplingCurrent', database.waitSamplingCurrent(urlParams.limit), 'Database wait sampling current failed'))
            .handle('waitSamplingHistory', ({ urlParams }) => _dbQuery('waitSamplingHistory', database.waitSamplingHistory(urlParams.limit, urlParams.sinceSeconds), 'Database wait sampling history failed'))
            .handle('resetWaitSampling', () => Middleware.guarded('admin', 'resetWaitSampling', 'mutation', database.resetWaitSampling().pipe(
                HttpError.mapTo('Database wait sampling reset failed'),
                Effect.tap((reset) => audit.log('Db.resetWaitSampling', { details: { reset } })),
                Telemetry.span('admin.resetWaitSampling'),
            )))
            .handle('cronJobs', () => _dbQuery('cronJobs', database.cronJobs(), 'Database cron jobs failed'))
            .handle('partitionHealth', ({ urlParams }) => _dbQuery('partitionHealth', database.partitionHealth(urlParams.parentTable), 'Database partition health failed'))
            .handle('partmanConfig', () => _dbQuery('partmanConfig', database.partmanConfig(), 'Database partman config failed'))
            .handle('runPartmanMaintenance', () => Middleware.guarded('admin', 'runPartmanMaintenance', 'mutation', database.runPartmanMaintenance().pipe(
                HttpError.mapTo('Database partman maintenance failed'),
                Effect.tap((ran) => audit.log('Db.runPartmanMaintenance', { details: { ran } })),
                Telemetry.span('admin.runPartmanMaintenance'),
            )))
            .handle('syncCronJobs', () => Middleware.guarded('admin', 'syncCronJobs', 'mutation', database.syncCronJobs().pipe(
                HttpError.mapTo('Database maintenance reconciliation failed'),
                Effect.tap((result) => audit.log('Db.syncCronJobs', { details: { result } })),
                Telemetry.span('admin.syncCronJobs'),
            )))
            .handle('squeezeStatus', () => _dbQuery('squeezeStatus', database.squeezeStatus(), 'Database squeeze status failed'))
            .handle('squeezeStartWorker', () => Middleware.guarded('admin', 'squeezeStartWorker', 'mutation', database.squeezeStartWorker().pipe(
                HttpError.mapTo('Database squeeze worker start failed'),
                Effect.tap((started) => audit.log('Db.squeezeStartWorker', { details: { started } })),
                Telemetry.span('admin.squeezeStartWorker'),
            )))
            .handle('squeezeStopWorker', ({ path }) => Middleware.guarded('admin', 'squeezeStopWorker', 'mutation', database.squeezeStopWorker(path.pid).pipe(
                HttpError.mapTo('Database squeeze worker stop failed'),
                Effect.tap((stopped) => audit.log('Db.squeezeStopWorker', { details: { pid: path.pid, stopped } })),
                Telemetry.span('admin.squeezeStopWorker'),
            )))
            .handle('listPermissions', () => Middleware.guarded('admin', 'listPermissions', 'api', policy.list().pipe(
                Effect.map(Arr.map(({ action, resource, role }) => ({ action, resource, role }))),
                Telemetry.span('admin.listPermissions'),
            )))
            .handle('grantPermission', ({ payload }) => Middleware.guarded('admin', 'grantPermission', 'mutation', policy.grant(payload).pipe(
                Effect.map((permission) => ({ action: permission.action, resource: permission.resource, role: permission.role })),
                Effect.tap((permission) => audit.log('Permission.create', { details: permission })),
                Telemetry.span('admin.grantPermission'),
            )))
            .handle('revokePermission', ({ payload }) => Middleware.guarded('admin', 'revokePermission', 'mutation', policy.revoke(payload).pipe(
                Effect.tap(() => audit.log('Permission.revoke', { details: payload })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.revokePermission'),
            )))
            .handle('listTenants', () => Middleware.guarded('admin', 'listTenants', 'api', database.apps.find([]).pipe(
                HttpError.mapTo('Tenant list failed'),
                Telemetry.span('admin.listTenants'),
            )))
            .handle('createTenant', ({ payload }) => Middleware.guarded('admin', 'createTenant', 'mutation', lifecycle.transition({ _tag: 'provision', ...payload }).pipe(
                Effect.filterOrFail(
                    (result): result is typeof App.Type => 'id' in result,
                    constant(HttpError.Internal.of('Provision did not return tenant')),
                ),
                HttpError.mapTo('Tenant creation failed'),
                Telemetry.span('admin.createTenant'),
            )))
            .handle('getTenant', ({ path }) => Middleware.guarded('admin', 'getTenant', 'api', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                HttpError.mapTo('tenant lookup failed'),
                Effect.flatMap(Option.match({
                    onNone: () => Effect.fail(HttpError.NotFound.of('tenant', path.id)),
                    onSome: Effect.succeed,
                })),
                Telemetry.span('admin.getTenant'),
            )))
            .handle('updateTenant', ({ path, payload }) => Middleware.guarded('admin', 'updateTenant', 'mutation', database.withTransaction(
                database.apps.readSettings(path.id, 'update').pipe(
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
            )).pipe(
                HttpError.mapTo('Tenant update failed'),
                Telemetry.span('admin.updateTenant'),
            )))
            .handle('deactivateTenant', ({ path }) => Middleware.guarded('admin', 'deactivateTenant', 'mutation', lifecycle.transition({ _tag: 'suspend', tenantId: path.id }).pipe(
                HttpError.mapTo('Tenant suspension failed'),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.deactivateTenant'),
            )))
            .handle('resumeTenant', ({ path }) => Middleware.guarded('admin', 'resumeTenant', 'mutation', lifecycle.transition({ _tag: 'resume', tenantId: path.id }).pipe(
                HttpError.mapTo('Tenant resume failed'),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.resumeTenant'),
            )))
            .handle('archiveTenant', ({ path }) => Middleware.guarded('admin', 'archiveTenant', 'mutation', lifecycle.transition({ _tag: 'archive', tenantId: path.id }).pipe(
                HttpError.mapTo('Tenant archive failed'),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.archiveTenant'),
            )))
            .handle('purgeTenant', ({ path }) => Middleware.guarded('admin', 'purgeTenant', 'mutation', lifecycle.transition({ _tag: 'purge', tenantId: path.id }).pipe(
                HttpError.mapTo('Tenant purge failed'),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.purgeTenant'),
            )))
            .handle('getTenantOAuth', ({ path }) => Middleware.guarded('admin', 'getTenantOAuth', 'api', database.apps.readSettings(path.id).pipe(
                Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                Effect.map(({ value: { settings } }) => settings.oauthProviders),
                Effect.map(Arr.map(({ clientSecretEncrypted, ...rest }) => ({ ...rest, clientSecretSet: clientSecretEncrypted.length > 0 }))),
                Effect.map((providers) => ({ providers })),
                Telemetry.span('admin.getTenantOAuth'),
            )))
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
                                        Effect.map(Struct.get('clientSecretEncrypted')),
                                    )
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
                (effect) => Middleware.guarded('admin', 'updateTenantOAuth', 'mutation', effect.pipe(
                    HttpError.mapTo('Tenant OAuth config update failed'),
                    Telemetry.span('admin.updateTenantOAuth'),
                )),
            ))
            .handle('getFeatureFlags', () => Middleware.guarded('admin', 'getFeatureFlags', 'api', features.getAll.pipe(
                Telemetry.span('admin.getFeatureFlags'),
            )))
            .handle('setFeatureFlag', ({ payload }) => Middleware.guarded('admin', 'setFeatureFlag', 'mutation', features.set(payload.flag, payload.value).pipe(
                Effect.tap(() => audit.log('Feature.update', { details: { flag: payload.flag, value: payload.value } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.setFeatureFlag'),
            )));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AdminLive };
