/**
 * Health check endpoints: liveness probe and readiness probe with database/metrics checks.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { MetricsPollingService } from '@parametric-portal/server/infra/metrics-polling';
import { Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
	Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metricsPolling = yield* MetricsPollingService;
		const checkDatabase = () =>
			db.withTransaction(Effect.succeed(true)).pipe(
				Effect.as(true),
				Effect.timeout('5 seconds'),
				Effect.catchAll(() => Effect.succeed(false)),
			);
			return handlers
			.handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
			.handle('readiness', () =>
				Effect.gen(function* () {
					const [dbOk, healthAlerts] = yield* Effect.all([checkDatabase(), metricsPolling.getHealth()]);
					const criticalAlerts = healthAlerts.filter((a) => a.severity === 'critical');
					yield* Effect.filterOrFail(
						Effect.succeed({ criticalAlerts, dbOk }),
						({ dbOk, criticalAlerts }) => dbOk && criticalAlerts.length === 0,
						({ dbOk, criticalAlerts }) =>
							HttpError.ServiceUnavailable.of(
								dbOk ? `Metrics critical: ${criticalAlerts.map((a) => a.metric).join(', ')}` : 'Database check failed',
								30000,
							),
					);
					return { checks: { database: true, metrics: healthAlerts.length === 0 ? 'ok' : 'warning' }, status: 'ok' as const };
				}),
			);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { HealthLive };
