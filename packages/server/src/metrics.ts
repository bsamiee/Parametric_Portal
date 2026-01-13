/**
 * Unified MetricsService via Effect.Service pattern.
 * Single source of truth for all observability metrics: HTTP, crypto, DB, rate-limit.
 * Supports app label from RequestContext for multi-app metric segmentation.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Duration, Effect, Metric, MetricBoundaries, MetricLabel, Option } from 'effect';
import { RequestContext } from './context.ts';

// --- [TYPES] -----------------------------------------------------------------

type PoolStats = {readonly active: number; readonly idle: number; readonly total: number; readonly waiting: number; };
type MetricEvent =
    | { readonly _tag: 'AuditFailure'; readonly entityType: string; readonly operation: string }
    | { readonly _tag: 'AuditSkipped'; readonly entityType: string; readonly operation: string; readonly reason: string }
    | { readonly _tag: 'AuditWrite'; readonly entityType: string; readonly operation: string }
    | { readonly _tag: 'DbQuery'; readonly durationSec: number; readonly operation: string; readonly status: 'error' | 'success' }
    | { readonly _tag: 'DbQueryCount'; readonly operation: string }
    | { readonly _tag: 'Error'; readonly errorType: string }
    | { readonly _tag: 'PoolStats'; readonly stats: PoolStats }
    | { readonly _tag: 'RateLimitCheck'; readonly durationSec: number; readonly preset: string }
    | { readonly _tag: 'RateLimitRejection'; readonly preset: string; readonly remaining?: number }
    | { readonly _tag: 'RateLimitStoreFailure'; readonly preset: string };

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
        audit: {
            failures: Metric.counter('audit_failures_total'),
            skipped: Metric.counter('audit_skipped_total'),
            writes: Metric.counter('audit_writes_total'),
        },
        crypto: { duration: Metric.timer('crypto_op_duration_seconds') },
        db: {
            pool: {
                active: Metric.gauge('db_pool_active'),
                idle: Metric.gauge('db_pool_idle'),
                total: Metric.gauge('db_pool_total'),
                waiting: Metric.gauge('db_pool_waiting'),
            },
            query: {
                count: Metric.counter('db_query_count_total'),
                duration: Metric.histogram('db_query_duration_seconds', B.boundaries.db),
                errors: Metric.counter('db_query_errors_total'),
            },
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
    }),
}) {
    static readonly layer = this.Default;
    static readonly track = (event: MetricEvent): Effect.Effect<void, never, MetricsService> =>
        Effect.gen(function* () {
            const m = yield* MetricsService;
            const handlers: Record<MetricEvent['_tag'], Effect.Effect<void>> = {
                AuditFailure: Metric.update(m.audit.failures.pipe(
                    Metric.tagged('entity_type', (event as Extract<MetricEvent, { _tag: 'AuditFailure' }>).entityType),
                    Metric.tagged('operation', (event as Extract<MetricEvent, { _tag: 'AuditFailure' }>).operation),
                ), 1),
                AuditSkipped: Metric.update(m.audit.skipped.pipe(
                    Metric.tagged('entity_type', (event as Extract<MetricEvent, { _tag: 'AuditSkipped' }>).entityType),
                    Metric.tagged('operation', (event as Extract<MetricEvent, { _tag: 'AuditSkipped' }>).operation),
                    Metric.tagged('reason', (event as Extract<MetricEvent, { _tag: 'AuditSkipped' }>).reason),
                ), 1),
                AuditWrite: Metric.update(m.audit.writes.pipe(
                    Metric.tagged('entity_type', (event as Extract<MetricEvent, { _tag: 'AuditWrite' }>).entityType),
                    Metric.tagged('operation', (event as Extract<MetricEvent, { _tag: 'AuditWrite' }>).operation),
                ), 1),
                DbQuery: Effect.gen(function* () {
                    const e = event as Extract<MetricEvent, { _tag: 'DbQuery' }>;
                    const labels = [MetricLabel.make('operation', e.operation), MetricLabel.make('status', e.status)];
                    yield* Metric.update(m.db.query.duration.pipe(Metric.taggedWithLabels(labels)), e.durationSec);
                    yield* Metric.update(m.db.query.count.pipe(Metric.tagged('operation', e.operation)), 1);
                    yield* e.status === 'error'
                        ? Metric.update(m.db.query.errors.pipe(Metric.tagged('operation', e.operation)), 1)
                        : Effect.void;
                }),
                DbQueryCount: Metric.update(m.db.query.count.pipe(
                    Metric.tagged('operation', (event as Extract<MetricEvent, { _tag: 'DbQueryCount' }>).operation),
                ), 1),
                Error: Metric.update(m.errors, (event as Extract<MetricEvent, { _tag: 'Error' }>).errorType),
                PoolStats: Effect.gen(function* () {
                    const { stats } = event as Extract<MetricEvent, { _tag: 'PoolStats' }>;
                    yield* Metric.set(m.db.pool.active, stats.active);
                    yield* Metric.set(m.db.pool.idle, stats.idle);
                    yield* Metric.set(m.db.pool.total, stats.total);
                    yield* Metric.set(m.db.pool.waiting, stats.waiting);
                }),
                RateLimitCheck: Metric.update(m.rateLimit.checkDuration.pipe(
                    Metric.tagged('preset', (event as Extract<MetricEvent, { _tag: 'RateLimitCheck' }>).preset),
                ), Duration.seconds((event as Extract<MetricEvent, { _tag: 'RateLimitCheck' }>).durationSec)),
                RateLimitRejection: Metric.update(m.rateLimit.rejections, (event as Extract<MetricEvent, { _tag: 'RateLimitRejection' }>).preset),
                RateLimitStoreFailure: Metric.update(m.rateLimit.storeFailures.pipe(
                    Metric.tagged('preset', (event as Extract<MetricEvent, { _tag: 'RateLimitStoreFailure' }>).preset),
                ), 1),
            };
            yield* handlers[event._tag];
        });
    static readonly trackDbQuery = (operation: string, duration: Duration.Duration, status: 'error' | 'success') => MetricsService.track({ _tag: 'DbQuery', durationSec: Duration.toSeconds(duration), operation, status });
    static readonly trackPoolStats = (stats: PoolStats) => MetricsService.track({ _tag: 'PoolStats', stats });
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
            Metric.trackErrorWith(metrics.errors.pipe(Metric.tagged('app', appLabel)), (e) =>
                typeof e === 'object' && e !== null && '_tag' in e ? String(e._tag) : 'UnknownError',
            ),
            Effect.tap((response) =>
                Metric.update(
                    metrics.http.requests.pipe(
                        Metric.tagged('method', request.method),
                        Metric.tagged('path', path),
                        Metric.tagged('status', String(response.status)),
                        Metric.tagged('app', appLabel),
                    ),
                    1,
                ),
            ),
            Effect.ensuring(Metric.update(activeGauge, -1)),
        );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { metricsMiddleware, MetricsService };
export type { PoolStats };
