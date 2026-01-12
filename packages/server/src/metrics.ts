/**
 * Unified MetricsService via Effect.Service pattern.
 * Single source of truth for all observability metrics: HTTP, crypto, DB, rate-limit.
 * Uses Metric.trackDuration for automatic duration tracking and Metric.trackErrorWith for error categorization.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Duration, Effect, Metric, MetricBoundaries, MetricLabel } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type MetricEvent =
    | { readonly _tag: 'BatchCoalesce'; readonly batchSize: number; readonly deduplicationRatio: number; readonly durationSec: number; readonly originalRequests: number; readonly resolverName: string }
    | { readonly _tag: 'DbQuery'; readonly durationSec: number; readonly operation: string; readonly status: 'error' | 'success' }
    | { readonly _tag: 'Error'; readonly errorType: string }
    | { readonly _tag: 'PoolConnections'; readonly count: number }
    | { readonly _tag: 'RateLimitCheck'; readonly durationSec: number; readonly preset: string }
    | { readonly _tag: 'RateLimitRejection'; readonly preset: string; readonly remaining?: number }
    | { readonly _tag: 'RateLimitStoreFailure'; readonly preset: string };
type MetricsShape = {
    readonly batch: {
        readonly batchSize: Metric.Metric.Histogram<number>;
        readonly coalesceDuration: ReturnType<typeof Metric.timer>;
        readonly deduplicationRatio: Metric.Metric.Histogram<number>;
        readonly n1Warnings: Metric.Metric.Counter<number>;
        readonly totalBatches: Metric.Metric.Counter<number>;
    };
    readonly crypto: { readonly duration: ReturnType<typeof Metric.timer> };
    readonly db: { readonly poolConnections: Metric.Metric.Gauge<number>; readonly queryDuration: Metric.Metric.Histogram<number>; readonly queryErrors: Metric.Metric.Counter<number> };
    readonly errors: Metric.Metric.Frequency<string>;
    readonly http: { readonly active: Metric.Metric.Gauge<number>; readonly duration: ReturnType<typeof Metric.timer>; readonly requests: Metric.Metric.Counter<number> };
    readonly rateLimit: { readonly checkDuration: ReturnType<typeof Metric.timer>; readonly rejections: Metric.Metric.Frequency<string>; readonly storeFailures: Metric.Metric.Counter<number> };
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    boundaries: {
        batchSize: MetricBoundaries.linear({ count: 10, start: 1, width: 5 }), // 1, 6, 11, 16, 21, 26, 31, 36, 41, 46
        db: MetricBoundaries.exponential({ count: 8, factor: 2, start: 0.01 }),
        deduplication: MetricBoundaries.linear({ count: 10, start: 0, width: 0.1 }), // 0%, 10%, 20%, ..., 90%, 100%
        http: MetricBoundaries.exponential({ count: 10, factor: 2, start: 0.005 }),
    },
    thresholds: { n1BatchSize: 1 }, // Single-item batches indicate potential N+1 pattern
} as const);

// --- [SERVICES] --------------------------------------------------------------

class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
    effect: Effect.succeed({
        batch: {
            batchSize: Metric.histogram('resolver_batch_size', B.boundaries.batchSize),
            coalesceDuration: Metric.timer('resolver_coalesce_duration_seconds'),
            deduplicationRatio: Metric.histogram('resolver_deduplication_ratio', B.boundaries.deduplication),
            n1Warnings: Metric.counter('resolver_n1_warnings_total'),
            totalBatches: Metric.counter('resolver_batches_total'),
        },
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
                    BatchCoalesce: Effect.gen(function* () {
                        const e = event as Extract<MetricEvent, { _tag: 'BatchCoalesce' }>;
                        const labels = [MetricLabel.make('resolver', e.resolverName)];
                        yield* Metric.update(m.batch.batchSize.pipe(Metric.taggedWithLabels(labels)), e.batchSize);
                        yield* Metric.update(m.batch.deduplicationRatio.pipe(Metric.taggedWithLabels(labels)), e.deduplicationRatio);
                        yield* Metric.update(m.batch.coalesceDuration.pipe(Metric.taggedWithLabels(labels)), Duration.seconds(e.durationSec));
                        yield* Metric.update(m.batch.totalBatches.pipe(Metric.taggedWithLabels(labels)), 1);
                        e.batchSize <= B.thresholds.n1BatchSize && (yield* Metric.update(m.batch.n1Warnings.pipe(Metric.taggedWithLabels(labels)), 1));
                    }),
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
    static readonly trackBatchCoalesce = (resolverName: string, originalRequests: number, batchSize: number, duration: Duration.Duration) =>
        MetricsService.track({
            _tag: 'BatchCoalesce',
            batchSize,
            deduplicationRatio: originalRequests > 0 ? (originalRequests - batchSize) / originalRequests : 0,
            durationSec: Duration.toSeconds(duration),
            originalRequests,
            resolverName,
        });
}

// --- [MIDDLEWARE] ------------------------------------------------------------

const createMetricsMiddleware = () =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const metrics = yield* MetricsService;
            const request = yield* HttpServerRequest.HttpServerRequest;
            const path = request.url.split('?')[0] ?? '/';
            yield* Metric.increment(metrics.http.active);
            const labeledDuration = metrics.http.duration.pipe(Metric.tagged('method', request.method), Metric.tagged('path', path));
            return yield* app.pipe(
                Metric.trackDuration(labeledDuration),
                Metric.trackErrorWith(metrics.errors, (e) => (typeof e === 'object' && e !== null && '_tag' in e ? String(e._tag) : 'UnknownError')),
                Effect.tap((response) => Metric.update(metrics.http.requests.pipe(Metric.tagged('method', request.method), Metric.tagged('path', path), Metric.tagged('status', String(response.status))), 1)),
                Effect.ensuring(Metric.incrementBy(metrics.http.active, -1)),
            );
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B as METRICS_TUNING, createMetricsMiddleware, MetricsService };
export type { MetricEvent, MetricsShape };
