/**
 * Admin management endpoints.
 * Admin-gated CRUD for users, sessions, jobs, DLQ, events, tenants.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { HttpError } from '@parametric-portal/server/errors';
import { EventBus } from '@parametric-portal/server/infra/events';
import { ProvisioningService } from '@parametric-portal/server/infra/handlers/provisioning';
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
        const [database, jobs, eventBus, audit, webhooks, policy, notifications, features, provisioning] = yield* Effect.all([DatabaseService, JobService, EventBus, AuditService, WebhookService, PolicyService, NotificationService, FeatureService, ProvisioningService]);
        return handlers
            .handle('listUsers', ({ urlParams }) => Middleware.guarded('admin', 'listUsers', 'api', database.users.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                Effect.mapError((error) => HttpError.Internal.of('User list failed', error)),
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
                ).pipe(Effect.mapError((error) => HttpError.Internal.of('Session list failed', error)),
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
                Effect.mapError((error) => HttpError.Internal.of('Session revoke failed', error)),
                Effect.tap((revoked) => audit.log('Session.revokeByIp', { details: { ipAddress: payload.ipAddress, revoked } })),
                Effect.map((revoked) => ({ revoked })),
                Telemetry.span('admin.revokeSessionsByIp'),
            )))
            .handle('listJobs', ({ urlParams }) => Middleware.guarded('admin', 'listJobs', 'api', database.jobs.page([], { cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Job list failed', error)),
                Telemetry.span('admin.listJobs'),
            )))
            .handle('cancelJob', ({ path }) => Middleware.guarded('admin', 'cancelJob', 'mutation', jobs.cancel(path.id).pipe(
                Effect.mapError((error) => error.reason === 'NotFound' ? HttpError.NotFound.of('job', path.id) : HttpError.Internal.of('Job cancel failed', error)),
                Effect.tap(() => audit.log('Job.cancel', { details: { jobId: path.id } })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.cancelJob'),
            )))
            .handle('listDlq', ({ urlParams }) => Middleware.guarded('admin', 'listDlq', 'api', database.jobDlq.listPending({ cursor: urlParams.cursor, limit: urlParams.limit }).pipe(
                Effect.mapError((error) => HttpError.Internal.of('DLQ list failed', error)),
                Telemetry.span('admin.listDlq'),
            )))
            .handle('replayDlq', ({ path }) => Middleware.guarded('admin', 'replayDlq', 'mutation', database.jobDlq.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError((error) => HttpError.Internal.of('dlq lookup failed', error)),
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
                Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification list failed', error)),
                Telemetry.span('admin.listNotifications'),
            )))
            .handle('replayNotification', ({ path }) => Middleware.guarded('admin', 'replayNotification', 'mutation', notifications.replay(path.id).pipe(
                Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Notification replay failed', error)),
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
            .handle('dbIoStats', () => Middleware.guarded('admin', 'dbIoStats', 'api', database.monitoring.ioStats().pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database io stats failed', error)),
                Telemetry.span('admin.dbIoStats'),
            )))
            .handle('dbIoConfig', () => Middleware.guarded('admin', 'dbIoConfig', 'api', database.monitoring.ioConfig().pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database io config failed', error)),
                Telemetry.span('admin.dbIoConfig'),
            )))
            .handle('dbStatements', ({ urlParams }) => Middleware.guarded('admin', 'dbStatements', 'api', database.listStatStatements(urlParams.limit).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database statements failed', error)),
                Telemetry.span('admin.dbStatements'),
            )))
            .handle('dbCacheHitRatio', () => Middleware.guarded('admin', 'dbCacheHitRatio', 'api', database.monitoring.cacheHitRatio().pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database cache hit ratio failed', error)),
                Telemetry.span('admin.dbCacheHitRatio'),
            )))
            .handle('dbWalInspect', ({ urlParams }) => Middleware.guarded('admin', 'dbWalInspect', 'api', database.listWalInspect(urlParams.limit).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database WAL inspect failed', error)),
                Telemetry.span('admin.dbWalInspect'),
            )))
            .handle('dbStatKcache', ({ urlParams }) => Middleware.guarded('admin', 'dbStatKcache', 'api', database.listStatKcache(urlParams.limit).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database stat kcache failed', error)),
                Telemetry.span('admin.dbStatKcache'),
            )))
            .handle('dbCronJobs', () => Middleware.guarded('admin', 'dbCronJobs', 'api', database.listCronJobs().pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database cron jobs failed', error)),
                Telemetry.span('admin.dbCronJobs'),
            )))
            .handle('dbPartitionHealth', ({ urlParams }) => Middleware.guarded('admin', 'dbPartitionHealth', 'api', database.listPartitionHealth(urlParams.parentTable).pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database partition health failed', error)),
                Telemetry.span('admin.dbPartitionHealth'),
            )))
            .handle('dbReconcileMaintenance', () => Middleware.guarded('admin', 'dbReconcileMaintenance', 'mutation', database.reconcileMaintenanceCronJobs().pipe(
                Effect.mapError((error) => HttpError.Internal.of('Database maintenance reconciliation failed', error)),
                Effect.tap((result) => audit.log('Db.reconcileMaintenance', { details: { result } })),
                Telemetry.span('admin.dbReconcileMaintenance'),
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
                Effect.mapError((error) => HttpError.Internal.of('Tenant list failed', error)),
                Telemetry.span('admin.listTenants'),
            )))
            .handle('createTenant', ({ payload }) => Middleware.guarded('admin', 'createTenant', 'mutation', provisioning.provision(payload).pipe(
                Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Tenant creation failed', error)),
                Telemetry.span('admin.createTenant'),
            )))
            .handle('getTenant', ({ path }) => Middleware.guarded('admin', 'getTenant', 'api', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError((error) => HttpError.Internal.of('tenant lookup failed', error)),
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
                Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Tenant update failed', error)),
                Telemetry.span('admin.updateTenant'),
            )))
            .handle('deactivateTenant', ({ path }) => Middleware.guarded('admin', 'deactivateTenant', 'mutation', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (app) => app.status === 'active',
                    (app) => HttpError.Validation.of('tenantTransition', `Invalid transition from '${app.status}' to 'suspended'`),
                ),
                Effect.tap(() => database.apps.suspend(path.id).pipe(Effect.mapError(constant(HttpError.Internal.of('Tenant suspension failed'))))),
                Effect.tap(() => eventBus.publish({ aggregateId: path.id, payload: { _tag: 'tenant', action: 'suspended' }, tenantId: path.id }).pipe(Effect.ignore)),
                Effect.tap((app) => audit.log('tenant.update', { after: { status: 'suspended' }, before: { status: app.status }, subjectId: path.id })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.deactivateTenant'),
            )))
            .handle('resumeTenant', ({ path }) => Middleware.guarded('admin', 'resumeTenant', 'mutation', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (app) => app.status === 'suspended',
                    (app) => HttpError.Validation.of('tenantTransition', `Invalid transition from '${app.status}' to 'active'`),
                ),
                Effect.tap(() => database.apps.resume(path.id).pipe(Effect.mapError(constant(HttpError.Internal.of('Tenant resume failed'))))),
                Effect.tap(() => eventBus.publish({ aggregateId: path.id, payload: { _tag: 'tenant', action: 'resumed' }, tenantId: path.id }).pipe(Effect.ignore)),
                Effect.tap((app) => audit.log('tenant.update', { after: { status: 'active' }, before: { status: app.status }, subjectId: path.id })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.resumeTenant'),
            )))
            .handle('archiveTenant', ({ path }) => Middleware.guarded('admin', 'archiveTenant', 'mutation', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (app) => app.status === 'suspended',
                    (app) => HttpError.Validation.of('tenantTransition', `Invalid transition from '${app.status}' to 'archived'`),
                ),
                Effect.tap(() => database.apps.archive(path.id).pipe(Effect.mapError(constant(HttpError.Internal.of('Tenant archive failed'))))),
                Effect.tap(() => eventBus.publish({ aggregateId: path.id, payload: { _tag: 'tenant', action: 'archived' }, tenantId: path.id }).pipe(Effect.ignore)),
                Effect.tap((app) => audit.log('tenant.update', { after: { status: 'archived' }, before: { status: app.status }, subjectId: path.id })),
                Effect.as({ success: true as const }),
                Telemetry.span('admin.archiveTenant'),
            )))
            .handle('purgeTenant', ({ path }) => Middleware.guarded('admin', 'purgeTenant', 'mutation', database.apps.one([{ field: 'id', value: path.id }]).pipe(
                Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                Effect.map(({ value }) => value),
                Effect.filterOrFail(
                    (app) => app.status === 'archived',
                    (app) => HttpError.Validation.of('tenantTransition', `Invalid transition: tenant must be 'archived' to purge (current: '${app.status}')`),
                ),
                Effect.tap(() => Context.Request.withinSync(path.id, jobs.submit('purge-tenant-data', null)).pipe(Effect.mapError(constant(HttpError.Internal.of('Tenant purge job submission failed'))))),
                Effect.tap(() => audit.log('tenant.update', { after: { status: 'purging' }, before: { status: 'archived' }, subjectId: path.id })),
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
            .handle('updateTenantOAuth', ({ path, payload }) => Middleware.guarded('admin', 'updateTenantOAuth', 'mutation',
                database.apps.readSettings(path.id, 'update').pipe(
                    Effect.mapError(constant(HttpError.Internal.of('tenant lookup failed'))),
                    Effect.filterOrFail(Option.isSome, constant(HttpError.NotFound.of('tenant', path.id))),
                    Effect.map(Struct.get('value')),
                    Effect.bindTo('loaded'),
                    Effect.let('secretsByProvider', ({ loaded }) => Arr.groupBy(loaded.settings.oauthProviders, Struct.get('provider'))),
                    Effect.bind('encrypted', ({ secretsByProvider }) =>
                        Effect.forEach(payload.providers, (provider): Effect.Effect<string, HttpError.Validation | HttpError.Internal, Crypto.Service> => pipe(
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
                        ), { concurrency: 'unbounded' }),
                    ),
                    Effect.let('oauthProviders', flow(
                        Struct.get('encrypted'),
                        Arr.zipWith(payload.providers, (enc, provider) => ({ ...Struct.omit(provider, 'clientSecret'), clientSecretEncrypted: enc })),
                    )),
                    Effect.tap(({ loaded, oauthProviders }) =>
                        database.apps.updateSettings(loaded.app.id, { ...loaded.settings, oauthProviders }),
                    ),
                    Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Tenant OAuth config update failed', error)),
                    Effect.tap(constant(audit.log('App.update', { details: { tenantId: path.id } }))),
                    Effect.tap(constant(eventBus.publish({ aggregateId: path.id, payload: { _tag: 'app', action: 'settings.updated' }, tenantId: path.id }).pipe(Effect.ignore))),
                    Effect.map(flow(
                        Struct.get('oauthProviders'),
                        Arr.map(({ clientSecretEncrypted, ...rest }) => ({ ...rest, clientSecretSet: clientSecretEncrypted.length > 0 })),
                        (providers) => ({ providers }),
                    )),
                    Telemetry.span('admin.updateTenantOAuth'),
                ),
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
