/**
 * Tenant lifecycle state machine — provision, suspend, resume, archive, purge.
 * Polymorphic transition dispatch via Match.type on _TransitionCommand.
 * Guarantees compensation on permission seed failure during provisioning.
 */
import { SqlClient } from '@effect/sql';
import { type App, AppSettingsSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Layer, Match, Option, Schema as S } from 'effect';
import { Context } from '../../context.ts';
import { HttpError } from '../../errors.ts';
import { AuditService } from '../../observe/audit.ts';
import { PolicyService } from '../../security/policy.ts';
import { EventBus } from '../events.ts';
import { JobService } from '../jobs.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _ProvisionPayload = S.Struct({
    name:      S.NonEmptyTrimmedString,
    namespace: S.NonEmptyTrimmedString.pipe(S.pattern(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)),
    settings:  S.optional(AppSettingsSchema),
});
const _TransitionCommand = S.Union(
    S.Struct({ _tag: S.Literal('provision'), name: _ProvisionPayload.fields.name, namespace: _ProvisionPayload.fields.namespace, settings: _ProvisionPayload.fields.settings }),
    S.Struct({ _tag: S.Literal('suspend'),   tenantId: S.UUID }),
    S.Struct({ _tag: S.Literal('resume'),    tenantId: S.UUID }),
    S.Struct({ _tag: S.Literal('archive'),   tenantId: S.UUID }),
    S.Struct({ _tag: S.Literal('purge'),     tenantId: S.UUID }),
);

// --- [CONSTANTS] -------------------------------------------------------------

const _TRANSITIONS: Partial<Record<typeof App.Type.status, ReadonlySet<typeof App.Type.status>>> = {
    active:    new Set<typeof App.Type.status>(['suspended']),
    archived:  new Set<typeof App.Type.status>(['purging']),
    suspended: new Set<typeof App.Type.status>(['active', 'archived']),
};

// --- [SERVICES] --------------------------------------------------------------

class TenantLifecycleService extends Effect.Service<TenantLifecycleService>()('server/TenantLifecycle', {
    dependencies: [AuditService.Default, DatabaseService.Default, EventBus.Default, JobService.Default, PolicyService.Default],
    effect: Effect.gen(function* () {
        const [audit, database, eventBus, jobs, policy, sql] = yield* Effect.all([AuditService, DatabaseService, EventBus, JobService, PolicyService, SqlClient.SqlClient]);
        const _lookupTenant = (tenantId: string) => database.apps.one([{ field: 'id', value: tenantId }]).pipe(
            HttpError.mapTo('tenant lookup failed'),
            Effect.filterOrFail(Option.isSome, () => HttpError.NotFound.of('tenant', tenantId)),
            Effect.map(({ value }) => value),
        );
        const _validateTransition = (app: { readonly status: typeof App.Type.status }, target: typeof App.Type.status) =>
            Effect.filterOrFail(
                Effect.succeed(app),
                (tenant) => _TRANSITIONS[tenant.status]?.has(target) ?? false,
                (tenant) => HttpError.Validation.of('tenantTransition', `Invalid transition from '${tenant.status}' to '${target}'`),
            );
        const _emitAndAudit = (tenantId: string, action: string, before: string, after: string) => Effect.all([
            eventBus.publish({ aggregateId: tenantId, payload: { _tag: 'tenant', action }, tenantId }).pipe(Effect.ignore),
            audit.log('tenant.update', { after: { status: after }, before: { status: before }, subjectId: tenantId }),
        ], { discard: true });
        // Why: CAS guard ensures the DB write fails atomically when status changed between read and write (TOCTOU).
        // The `when` predicate adds `WHERE status = $current` so a concurrent transition causes a no-op update instead of silently overwriting the other transition's result.
        const _statusGuard = (currentStatus: typeof App.Type.status) => ({ field: 'status', value: currentStatus }) as const;
        const _applyTransition = (tenantId: string, target: typeof App.Type.status, action: string, errorLabel: string) =>
            Effect.gen(function* () {
                const app = yield* _lookupTenant(tenantId);
                yield* _validateTransition(app, target);
                yield* database.apps.set(tenantId, { status: target }, undefined, _statusGuard(app.status)).pipe(
                    Effect.filterOrFail(Option.isSome, () => HttpError.Conflict.of('tenant', 'Status changed concurrently')),
                    HttpError.mapTo(errorLabel),
                );
                yield* _emitAndAudit(tenantId, action, app.status, target);
                return { success: true as const };
            });
        const _provision = Effect.fn('TenantLifecycleService.provision')((payload: typeof _ProvisionPayload.Type) => database.apps.byNamespace(payload.namespace).pipe(
            HttpError.mapTo('Tenant namespace lookup failed'),
            Effect.filterOrFail(Option.isNone, () => HttpError.Conflict.of('tenant', `Namespace '${payload.namespace}' already exists`)),
            Effect.andThen(database.apps.insert({
                name: payload.name,
                namespace: payload.namespace,
                settings: Option.fromNullable(payload.settings),
                status: 'active',
                updatedAt: undefined,
            })),
            HttpError.mapTo('Tenant creation failed'),
            Effect.flatMap((inserted) => Context.Request.withinSync(inserted.id, policy.seedTenantDefaults(inserted.id).pipe(
                HttpError.mapTo('Tenant default permissions failed'),
            )).pipe(
                Effect.catchAll((error) => database.apps.drop(inserted.id).pipe(
                    Effect.ignore,
                    Effect.andThen(Effect.logError('Permission seeding failed, tenant record removed', { error: String(error), namespace: payload.namespace, tenantId: inserted.id })),
                    Effect.andThen(Effect.fail(error)),
                )),
                Effect.as(inserted),
            )),
            Effect.tap((inserted) => eventBus.publish({
                aggregateId: inserted.id,
                payload: { _tag: 'tenant', action: 'provisioned', name: payload.name, namespace: payload.namespace },
                tenantId: inserted.id,
            }).pipe(Effect.ignore)),
            Effect.tap((inserted) => audit.log('tenant.create', { after: { name: payload.name, namespace: payload.namespace }, subjectId: inserted.id })),
        ));
        return {
            transition: Effect.fn('TenantLifecycleService.transition')((command: typeof _TransitionCommand.Type) =>
                Match.type<typeof _TransitionCommand.Type>().pipe(
                    Match.tag('provision', (payload) => _provision(payload)),
                    Match.tag('suspend', ({ tenantId }) => _applyTransition(tenantId, 'suspended', 'suspended', 'Tenant suspension failed')),
                    Match.tag('resume', ({ tenantId }) => _applyTransition(tenantId, 'active', 'resumed', 'Tenant resume failed')),
                    Match.tag('archive', ({ tenantId }) => _applyTransition(tenantId, 'archived', 'archived', 'Tenant archive failed')),
                    Match.tag('purge', ({ tenantId }) => Effect.gen(function* () {
                        const app = yield* _lookupTenant(tenantId);
                        yield* _validateTransition(app, 'purging');
                        yield* database.apps.set(tenantId, { status: 'purging' }, undefined, _statusGuard(app.status)).pipe(
                            Effect.filterOrFail(Option.isSome, () => HttpError.Conflict.of('tenant', 'Status changed concurrently')),
                            HttpError.mapTo('Tenant purge status update failed'),
                        );
                        yield* Context.Request.withinSync(tenantId, jobs.submit('purge-tenant-data', null)).pipe(
                            HttpError.mapTo('Tenant purge job submission failed'),
                            Effect.tapError(() => database.apps.set(tenantId, { status: app.status }, undefined, _statusGuard('purging')).pipe(Effect.ignore)),
                        );
                        yield* _emitAndAudit(tenantId, 'purging', app.status, 'purging');
                        return { success: true as const };
                    })),
                    Match.exhaustive,
                )(command).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
            ),
        };
    }),
}) {
    static readonly Handlers = Layer.effectDiscard(
        Effect.gen(function* () {
            const [jobs, lifecycle] = yield* Effect.all([JobService, TenantLifecycleService]);
            yield* jobs.registerHandler(
                'provision-tenant',
                (payload) => S.decodeUnknown(_ProvisionPayload)(payload).pipe(
                    Effect.mapError((error) => HttpError.Validation.of('provisionTenantPayload', String(error))),
                    Effect.flatMap((decoded) => lifecycle.transition({ _tag: 'provision', ...decoded })),
                    Effect.catchAll((error) => Effect.logError('Tenant provisioning failed', { error: String(error) }).pipe(
                        Effect.andThen(Effect.fail(error)),
                    )),
                    Effect.asVoid,
                ),
            );
            yield* jobs.registerHandler(
                'tenant-lifecycle',
                (payload) => S.decodeUnknown(_TransitionCommand)(payload).pipe(
                    Effect.mapError((error) => HttpError.Validation.of('tenantLifecyclePayload', String(error))),
                    Effect.flatMap(lifecycle.transition),
                    Effect.catchAll((error) => Effect.logError('Tenant lifecycle transition failed', { error: String(error) }).pipe(
                        Effect.andThen(Effect.fail(error)),
                    )),
                    Effect.asVoid,
                ),
            );
            yield* Effect.logInfo('Handlers registered: provision-tenant, tenant-lifecycle');
        }),
    );
    static readonly Layer = Layer.mergeAll(TenantLifecycleService.Default, TenantLifecycleService.Handlers);
}

// --- [EXPORT] ----------------------------------------------------------------

export { _TransitionCommand, TenantLifecycleService };
