/**
 * Health check endpoints: liveness probe and readiness probe with database/metrics checks.
 * Traced for observability - health probe failures visible in distributed traces.
 */
import { HttpApiBuilder } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { WorkerPoolService } from '@parametric-portal/server/platform/workers/pool';
import { Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
	Effect.gen(function* () {
		const polling = yield* PollingService;
		return handlers
			.handle('liveness', () =>
				Effect.succeed({ status: 'ok' as const }).pipe(
					Effect.withSpan('health.liveness'),
				),
			)
			.handle('readiness', () =>
				Effect.gen(function* () {
					// Use healthDeep for readiness: tests transaction capability, catches pool exhaustion
					const [dbHealth, healthAlerts, workerHealth] = yield* Effect.all([
						Client.healthDeep(),
						polling.getHealth(),
						WorkerPoolService.health().pipe(
							Effect.catchAll(() => Effect.succeed({ available: false, poolSize: 0 })),
						),
					]);
					const criticalAlerts = healthAlerts.filter((a) => a.severity === 'critical');
					yield* Effect.annotateCurrentSpan('health.database', dbHealth.healthy);
					yield* Effect.annotateCurrentSpan('health.database.latencyMs', dbHealth.latencyMs);
					yield* Effect.annotateCurrentSpan('health.alerts.count', healthAlerts.length);
					yield* Effect.annotateCurrentSpan('health.alerts.critical', criticalAlerts.length);
					yield* Effect.annotateCurrentSpan('health.workers.available', workerHealth.available);
					yield* Effect.annotateCurrentSpan('health.workers.poolSize', workerHealth.poolSize);
					const dbOk = dbHealth.healthy;
					yield* Effect.filterOrFail(
						Effect.succeed({ criticalAlerts, dbOk }),
						({ dbOk, criticalAlerts }) => dbOk && criticalAlerts.length === 0,
						({ dbOk, criticalAlerts }) =>
							HttpError.ServiceUnavailable.of(
								dbOk ? `Metrics critical: ${criticalAlerts.map((a) => a.metric).join(', ')}` : 'Database check failed',
								30000,
							),
					);
					return {
						checks: {
							database: true,
							metrics: healthAlerts.length === 0 ? 'ok' : 'warning',
							workers: workerHealth,
						},
						status: 'ok' as const,
					};
				}).pipe(Effect.withSpan('health.readiness')),
			);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { HealthLive };
