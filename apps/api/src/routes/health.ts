/**
 * Health check endpoints: liveness probe and readiness probe.
 * Canonical health surface: database, cache (L1/L2), metrics polling, worker pool.
 * Traced for observability - health probe failures visible in distributed traces.
 */
import { HttpApiBuilder } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { DopplerService } from '@parametric-portal/server/platform/doppler';
import { Effect, Match, Option, pipe } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _RATE_LIMIT_PRESET = 'health' as const;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _readiness = (polling: PollingService) => pipe(
    Effect.all({
        cache: CacheService.health(),
        db: Client.healthDeep(),
        doppler: DopplerService.health().pipe(Effect.orElseSucceed(() => ({ consecutiveFailures: 0, lastError: Option.none(), lastRefreshAt: 0 }))),
        pollingHealth: polling.refresh().pipe(Effect.andThen(polling.getHealth())),
        vectorConfig: Client.vector.getConfig().pipe(Effect.map((cfg) => cfg.length > 0), Effect.orElseSucceed(() => false)),
    }),
    Effect.let('critical', ({ pollingHealth }) => pollingHealth.alerts.filter((alert) => alert.severity === 'critical')),
    Effect.tap(({ cache, critical, db, doppler, pollingHealth, vectorConfig }) => Effect.all([
        Effect.annotateCurrentSpan('health.db.healthy', db.healthy),
        Effect.annotateCurrentSpan('health.db.latencyMs', db.latencyMs),
        Effect.annotateCurrentSpan('health.cache.connected', cache.connected),
        Effect.annotateCurrentSpan('health.cache.latencyMs', cache.latencyMs),
        Effect.annotateCurrentSpan('health.doppler.consecutiveFailures', doppler.consecutiveFailures),
        Effect.annotateCurrentSpan('health.doppler.lastRefreshAt', doppler.lastRefreshAt),
        Effect.annotateCurrentSpan('health.alerts.total', pollingHealth.alerts.length),
        Effect.annotateCurrentSpan('health.alerts.critical', critical.length),
        Effect.annotateCurrentSpan('health.polling.stale', pollingHealth.stale),
        Effect.annotateCurrentSpan('health.vectorConfig', vectorConfig),
    ], { discard: true })),
    Effect.filterOrFail(
        ({ cache, critical, db, pollingHealth }) => db.healthy && cache.connected && critical.length === 0 && !pollingHealth.stale,
        ({ cache, critical, db, pollingHealth }) => HttpError.ServiceUnavailable.of(
            Match.value({ cache: cache.connected, critical: critical.length, db: db.healthy, stale: pollingHealth.stale }).pipe(
                Match.when({ db: false }, () => 'Database check failed'),
                Match.when({ cache: false }, () => 'Cache check failed'),
                Match.when({ stale: true }, () => 'Polling data stale'),
                Match.orElse(({ critical }) => `Metrics critical: ${critical} alerts`),
            ),
            30000,
        ),
    ),
    Effect.map(({ cache, critical, db, pollingHealth, vectorConfig }) => ({
        checks: {
            cache: { connected: cache.connected, latencyMs: cache.latencyMs },
            database: { healthy: db.healthy, latencyMs: db.latencyMs },
            metrics: Match.value({ alertCount: pollingHealth.alerts.length, criticalCount: critical.length }).pipe(
                Match.when(({ criticalCount }) => criticalCount > 0, () => 'alerted' as const),
                Match.when(({ alertCount }) => alertCount > 0, () => 'degraded' as const),
                Match.orElse(() => 'healthy' as const),
            ),
            polling: {
                criticalAlerts: critical.length,
                lastFailureAtMs: pollingHealth.lastFailureAtMs,
                lastSuccessAtMs: pollingHealth.lastSuccessAtMs,
                scope: 'global' as const,
                stale: pollingHealth.stale,
                totalAlerts: pollingHealth.alerts.length,
            },
            vector: { configured: vectorConfig },
        },
        status: 'ok' as const,
    })),
    Effect.mapError((error) => error instanceof HttpError.ServiceUnavailable ? error : HttpError.ServiceUnavailable.of('Readiness check failed', 30000, error)),
    Telemetry.span('health.readiness'),
);

// --- [LAYERS] ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
    Effect.andThen(PollingService, (polling) => handlers
        .handle('liveness', () => CacheService.rateLimit(_RATE_LIMIT_PRESET, Client.health().pipe(
            Effect.map(({ healthy, latencyMs }) => ({ latencyMs, status: healthy ? 'ok' as const : 'degraded' as const })),
            Telemetry.span('health.liveness'),
        )))
        .handle('readiness', () => CacheService.rateLimit(_RATE_LIMIT_PRESET, _readiness(polling)))
        .handle('clusterHealth', () => CacheService.rateLimit(_RATE_LIMIT_PRESET, ClusterService.Health.cluster().pipe(
            Effect.map((cluster) => ({ cluster })),
            Effect.mapError((error) => HttpError.ServiceUnavailable.of('Cluster health check failed', 30000, error)),
            Telemetry.span('health.clusterHealth'),
        )))
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { HealthLive };
