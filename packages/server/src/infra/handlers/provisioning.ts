/**
 * Tenant provisioning pipeline shared by admin API and job runtime.
 * Guarantees compensation on permission seed failure.
 */
import { SqlClient } from '@effect/sql';
import { AppSettingsSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Layer, Option, Schema as S } from 'effect';
import { Context } from '../../context.ts';
import { HttpError } from '../../errors.ts';
import { AuditService } from '../../observe/audit.ts';
import { PolicyService } from '../../security/policy.ts';
import { EventBus } from '../events.ts';
import { JobService } from '../jobs.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _ProvisionPayload = S.Struct({
	name: S.NonEmptyTrimmedString,
	namespace: S.NonEmptyTrimmedString.pipe(S.pattern(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)),
	settings: S.optional(AppSettingsSchema),
});

// --- [SERVICES] --------------------------------------------------------------

class ProvisioningService extends Effect.Service<ProvisioningService>()('server/Provisioning', {
	dependencies: [AuditService.Default, DatabaseService.Default, EventBus.Default, PolicyService.Default],
	effect: Effect.gen(function* () {
		const [audit, database, eventBus, policy, sql] = yield* Effect.all([AuditService, DatabaseService, EventBus, PolicyService, SqlClient.SqlClient]);
		return {
			provision: Effect.fn('ProvisioningService.provision')((payload: typeof _ProvisionPayload.Type) => database.apps.byNamespace(payload.namespace).pipe(
				Effect.mapError((error) => HttpError.Internal.of('Tenant namespace lookup failed', error)),
				Effect.filterOrFail(Option.isNone, () => HttpError.Conflict.of('tenant', `Namespace '${payload.namespace}' already exists`)),
				Effect.andThen(database.apps.insert({
					name: payload.name,
					namespace: payload.namespace,
					settings: Option.fromNullable(payload.settings),
					status: 'active',
					updatedAt: undefined,
				})),
				Effect.mapError((error) => HttpError.is(error) ? error : HttpError.Internal.of('Tenant creation failed', error)),
				Effect.flatMap((inserted) => Context.Request.withinSync(inserted.id, policy.seedTenantDefaults(inserted.id).pipe(
					Effect.mapError((error) => HttpError.Internal.of('Tenant default permissions failed', error)),
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
				Effect.provideService(SqlClient.SqlClient, sql),
			)),
		};
	}),
}) {
	static readonly Handlers = Layer.effectDiscard(
		Effect.gen(function* () {
			const [jobs, provisioning] = yield* Effect.all([JobService, ProvisioningService]);
			yield* jobs.registerHandler(
				'provision-tenant',
				(payload) => S.decodeUnknown(_ProvisionPayload)(payload).pipe(
					Effect.mapError((error) => HttpError.Validation.of('provisionTenantPayload', String(error))),
					Effect.flatMap(provisioning.provision),
					Effect.catchAll((error) => Effect.logError('Tenant provisioning failed', { error: String(error) }).pipe(
						Effect.andThen(Effect.fail(error)),
					)),
					Effect.asVoid,
				),
			);
			yield* Effect.logInfo('Handler registered: provision-tenant');
		}),
	);
	static readonly Layer = Layer.mergeAll(ProvisioningService.Default, ProvisioningService.Handlers);
}

// --- [EXPORT] ----------------------------------------------------------------

export { ProvisioningService };
