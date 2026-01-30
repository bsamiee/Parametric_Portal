/**
 * Health check endpoints: liveness probe and readiness probe.
 * Canonical health surface: database, cache (L1/L2), metrics polling, worker pool.
 * Traced for observability - health probe failures visible in distributed traces.
 */
import { HttpApiBuilder } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Boolean as B, Effect, Match, pipe } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _liveness = pipe(
	Effect.succeed({ status: 'ok' as const }),
	Effect.withSpan('health.liveness'),
);
const _readiness = (polling: PollingService) => pipe(
	Effect.all({ alerts: polling.getHealth(), cache: CacheService.health(), db: Client.healthDeep() }),
	Effect.let('critical', ({ alerts }) => alerts.filter((a) => a.severity === 'critical')),
	Effect.tap(({ alerts, cache, critical, db }) => Effect.all([
		Effect.annotateCurrentSpan('health.db.healthy', db.healthy),
		Effect.annotateCurrentSpan('health.db.latencyMs', db.latencyMs),
		Effect.annotateCurrentSpan('health.cache.connected', cache.connected),
		Effect.annotateCurrentSpan('health.cache.latencyMs', cache.latencyMs),
		Effect.annotateCurrentSpan('health.alerts.total', alerts.length),
		Effect.annotateCurrentSpan('health.alerts.critical', critical.length),
	], { discard: true })),
	Effect.filterOrFail(
		({ cache, critical, db }) => db.healthy && cache.connected && critical.length === 0,
		({ cache, critical, db }) => HttpError.ServiceUnavailable.of(
			Match.value({ cache: cache.connected, critical: critical.length, db: db.healthy }).pipe(
				Match.when({ db: false }, () => 'Database check failed'),
				Match.when({ cache: false }, () => 'Cache check failed'),
				Match.orElse(({ critical }) => `Metrics critical: ${critical} alerts`),
			),
			30000,
		),
	),
	Effect.map(({ alerts, cache, critical, db }) => ({
		checks: {
			cache: { connected: cache.connected, latencyMs: cache.latencyMs },
			database: { healthy: db.healthy, latencyMs: db.latencyMs },
			metrics: B.match(critical.length > 0, {
				onFalse: () => B.match(alerts.length > 0, { onFalse: () => 'healthy' as const, onTrue: () => 'degraded' as const }),
				onTrue: () => 'alerted' as const,
			}),
		},
		status: 'ok' as const,
	})),
	Effect.withSpan('health.readiness'),
);

// --- [LAYERS] ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
	Effect.andThen(PollingService, (polling) => handlers
		.handle('liveness', () => _liveness)
		.handle('readiness', () => _readiness(polling)),
	),
);

// --- [EXPORT] ----------------------------------------------------------------

export { HealthLive };
