/**
 * Feature flags: typed per-tenant flag registry with cache invalidation via app settings events.
 * Backed by App.settings featureFlags object.
 */
import { SqlClient } from '@effect/sql';
import { AppSettingsDefaults, FeatureFlagsSchema } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Duration, Effect, Option, PrimaryKey, Schema as S, Stream } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { EventBus } from '../infra/events.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const FlagRegistry = FeatureFlagsSchema;

// --- [SERVICES] --------------------------------------------------------------

class FeatureService extends Effect.Service<FeatureService>()('server/Features', {
	dependencies: [DatabaseService.Default, CacheService.Default, EventBus.Default],
	scoped: Effect.gen(function* () {
		const [database, eventBus, sql] = yield* Effect.all([DatabaseService, EventBus, SqlClient.SqlClient]);
		class FlagCacheKey extends S.TaggedRequest<FlagCacheKey>()('FlagCacheKey', {
			failure: HttpError.Internal,
			payload: { tenantId: S.String },
			success: FlagRegistry,
			}) {[PrimaryKey.symbol]() { return `features:${this.tenantId}`; }}
			const cache = yield* CacheService.cache<FlagCacheKey, never, never>({
					lookup: (key) => Context.Request.withinSync(key.tenantId, database.apps.readSettings(key.tenantId)).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Effect.succeed({ ...AppSettingsDefaults.featureFlags }),
							onSome: ({ settings }) => Effect.succeed(settings.featureFlags),
						})),
						Effect.mapError((error) => HttpError.Internal.of('Feature flag lookup failed', error)),
						Effect.provideService(SqlClient.SqlClient, sql),
			),
			storeId: 'features',
			timeToLive: Duration.minutes(5),
		});
		yield* Effect.forkScoped(
			eventBus.subscribe(
				'app.settings.updated',
				S.Struct({ _tag: S.Literal('app'), action: S.Literal('settings.updated') }),
				(event) => cache.invalidate(new FlagCacheKey({ tenantId: event.tenantId })).pipe(Effect.ignore),
			).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain),
		);
			const _loadFlags = (tenantId: string) => cache.get(new FlagCacheKey({ tenantId })).pipe(
				Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Feature flag cache error', error))),
			);
		const getAll = Context.Request.currentTenantId.pipe(Effect.flatMap(_loadFlags));
			const set = <K extends keyof typeof FlagRegistry.Type>(flagName: K, value: typeof FlagRegistry.Type[K]) =>
				Telemetry.span(Effect.gen(function* () {
					const tenantId = yield* Context.Request.currentTenantId;
					const loaded = yield* Context.Request.withinSync(tenantId, database.apps.readSettings(tenantId, 'update')).pipe(
						Effect.provideService(SqlClient.SqlClient, sql),
						Effect.mapError((error) => HttpError.Internal.of('Tenant lookup failed', error)),
						Effect.flatMap(Option.match({
							onNone: () => Effect.fail(HttpError.NotFound.of('tenant', tenantId)),
							onSome: Effect.succeed,
						})),
					);
					yield* Context.Request.withinSync(tenantId, database.apps.updateSettings(tenantId, {
						...loaded.settings,
						featureFlags: {
							...loaded.settings.featureFlags,
							[flagName]: value,
						},
					})).pipe(
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.mapError((error) => HttpError.Internal.of('Feature flag update failed', error)),
				);
				yield* cache.invalidate(new FlagCacheKey({ tenantId })).pipe(Effect.ignore);
				yield* eventBus.publish({
					aggregateId: tenantId,
					payload: { _tag: 'app', action: 'settings.updated' },
					tenantId,
				}).pipe(Effect.ignore);
			}), 'features.set', { 'feature.flag': flagName });
		const isEnabled = Effect.fn('FeatureService.isEnabled')(function* (flagName: keyof typeof FlagRegistry.Type) {
			const tenantId = yield* Context.Request.currentTenantId;
			const flags = yield* _loadFlags(tenantId);
			return flags[flagName];
		});
		const require = Effect.fn('FeatureService.require')(function* (flagName: keyof typeof FlagRegistry.Type) {
			yield* isEnabled(flagName).pipe(
				Effect.filterOrFail(
					(enabled) => enabled,
					() => HttpError.Forbidden.of(`Feature '${flagName}' is not enabled for this tenant`),
				),
			);
		});
		yield* Effect.logInfo('FeatureService initialized');
		return { getAll, isEnabled, require, set };
	}),
}) {
	static readonly FlagRegistry = FlagRegistry;
}

// --- [EXPORT] ----------------------------------------------------------------

export { FeatureService };
