/**
 * Unified MetricsService via Effect.Service pattern.
 * Single source of truth for all observability metrics: HTTP, crypto, DB, rate-limit.
 * Uses Metric.trackDuration for automatic duration tracking and Metric.trackErrorWith for error categorization.
 * Supports app label from RequestContext for multi-app metric segmentation.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Duration, Effect, Metric, MetricBoundaries, MetricLabel, Option } from 'effect';
import { RequestContext } from './context.ts';

// --- [TYPES] -----------------------------------------------------------------

type MetricEvent =
    | { readonly _tag: 'DbQuery'; readonly durationSec: number; readonly operation: string; readonly status: 'error' | 'success' }
    | { readonly _tag: 'Error'; readonly errorType: string }
    | { readonly _tag: 'PoolConnections'; readonly count: number }
    | { readonly _tag: 'RateLimitCheck'; readonly durationSec: number; readonly preset: string }
    | { readonly _tag: 'RateLimitRejection'; readonly preset: string; readonly remaining?: number }
    | { readonly _tag: 'RateLimitStoreFailure'; readonly preset: string };
type MetricsShape = {
    readonly crypto: { readonly duration: ReturnType<typeof Metric.timer> };
    readonly db: { readonly poolConnections: Metric.Metric.Gauge<number>; readonly queryDuration: Metric.Metric.Histogram<number>; readonly queryErrors: Metric.Metric.Counter<number> };
    readonly errors: Metric.Metric.Frequency<string>;
    readonly http: { readonly active: Metric.Metric.Gauge<number>; readonly duration: ReturnType<typeof Metric.timer>; readonly requests: Metric.Metric.Counter<number> };
    readonly mfa: { readonly disabled: Metric.Metric.Counter<number>; readonly enrollments: Metric.Metric.Counter<number>; readonly recoveryUsed: Metric.Metric.Counter<number>; readonly verifications: Metric.Metric.Counter<number> };
    readonly rateLimit: { readonly checkDuration: ReturnType<typeof Metric.timer>; readonly rejections: Metric.Metric.Frequency<string>; readonly storeFailures: Metric.Metric.Counter<number> };
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    boundaries: {
        db: MetricBoundaries.exponential({ count: 8, factor: 2, start: 0.01 }),
        http: MetricBoundaries.exponential({ count: 10, factor: 2, start: 0.005 }),
    },
} as const);

// --- [SERVICES] --------------------------------------------------------------

class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
    effect: Effect.succeed({
        crypto: { duration: Metric.timer('crypto_op_duration_seconds') },
        db: {
            poolConnections: Metric.gauge('db_pool_connections'),
            queryDuration: Metric.histogram('db_query_duration_seconds', B.boundaries.db),
            queryErrors: Metric.counter('db_query_errors_total'),
        },
        errors: Metric.frequency('errors_total'),
        http: {
            active: Metric.gauge('http_requests_active'),
            duration: Metric.timer('http_request_duration_seconds'),
            requests: Metric.counter('http_requests_total'),
        },
        mfa: {
            disabled: Metric.counter('mfa_disabled_total'),
            enrollments: Metric.counter('mfa_enrollments_total'),
            recoveryUsed: Metric.counter('mfa_recovery_used_total'),
            verifications: Metric.counter('mfa_verifications_total'),
        },
        rateLimit: {
            checkDuration: Metric.timer('rate_limit_check_duration_seconds'),
            rejections: Metric.frequency('rate_limit_rejections_total'),
            storeFailures: Metric.counter('rate_limit_store_failures_total'),
        },
    } satisfies MetricsShape),
}) {
    static readonly layer = this.Default;
    static readonly track = (event: MetricEvent): Effect.Effect<void, never, MetricsService> =>
        MetricsService.pipe(
            Effect.flatMap((m) => {
                const handlers: Record<MetricEvent['_tag'], Effect.Effect<void>> = {
                    DbQuery: Effect.gen(function* () {
                        const e = event as Extract<MetricEvent, { _tag: 'DbQuery' }>;
                        const labels = [MetricLabel.make('operation', e.operation), MetricLabel.make('status', e.status)];
                        yield* Metric.update(m.db.queryDuration.pipe(Metric.taggedWithLabels(labels)), e.durationSec);
                        e.status === 'error' && (yield* Metric.update(m.db.queryErrors.pipe(Metric.tagged('operation', e.operation)), 1));
                    }),
                    Error: Metric.update(m.errors, (event as Extract<MetricEvent, { _tag: 'Error' }>).errorType),
                    PoolConnections: Metric.set(m.db.poolConnections, (event as Extract<MetricEvent, { _tag: 'PoolConnections' }>).count),
                    RateLimitCheck: Metric.update(m.rateLimit.checkDuration.pipe(Metric.tagged('preset', (event as Extract<MetricEvent, { _tag: 'RateLimitCheck' }>).preset)), Duration.seconds((event as Extract<MetricEvent, { _tag: 'RateLimitCheck' }>).durationSec)),
                    RateLimitRejection: Metric.update(m.rateLimit.rejections, (event as Extract<MetricEvent, { _tag: 'RateLimitRejection' }>).preset),
                    RateLimitStoreFailure: Metric.update(m.rateLimit.storeFailures.pipe(Metric.tagged('preset', (event as Extract<MetricEvent, { _tag: 'RateLimitStoreFailure' }>).preset)), 1),
                };
                return handlers[event._tag];
            }),
        );
    static readonly trackDbQuery = (operation: string, duration: Duration.Duration, status: 'error' | 'success') =>
        MetricsService.track({ _tag: 'DbQuery', durationSec: Duration.toSeconds(duration), operation, status });
}

// --- [MIDDLEWARE] ------------------------------------------------------------

const metricsMiddleware = HttpMiddleware.make((app) =>
    Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = request.url.split('?')[0] ?? '/';
        const ctxOpt = yield* Effect.serviceOption(RequestContext);
        const appLabel = Option.isSome(ctxOpt) ? ctxOpt.value.appId : 'unknown';
        const activeGauge = metrics.http.active.pipe(Metric.tagged('app', appLabel));
        yield* Metric.update(activeGauge, 1);
        const labeledDuration = metrics.http.duration.pipe(
            Metric.tagged('method', request.method),
            Metric.tagged('path', path),
            Metric.tagged('app', appLabel),
        );
        return yield* app.pipe(
            Metric.trackDuration(labeledDuration),
            Metric.trackErrorWith(metrics.errors.pipe(Metric.tagged('app', appLabel)), (e) => (typeof e === 'object' && e !== null && '_tag' in e ? String(e._tag) : 'UnknownError')),
            Effect.tap((response) => Metric.update(
                metrics.http.requests.pipe(
                    Metric.tagged('method', request.method),
                    Metric.tagged('path', path),
                    Metric.tagged('status', String(response.status)),
                    Metric.tagged('app', appLabel),
                ),
                1,
            )),
            Effect.ensuring(Metric.update(activeGauge, -1)),
        );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as METRICS_TUNING, metricsMiddleware, MetricsService };
export type { MetricEvent, MetricsShape };
