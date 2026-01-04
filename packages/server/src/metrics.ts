/**
 * Effect native metrics with HTTP middleware instrumentation.
 * Uses Metric module for counters/histograms, exported via OtlpMetrics in telemetry.ts.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Effect, Metric, MetricBoundaries, MetricLabel } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    boundaries: MetricBoundaries.exponential({ count: 10, factor: 2, start: 0.005 }),
    crypto: { boundaries: MetricBoundaries.exponential({ count: 6, factor: 2, start: 0.001 }) },
    db: { boundaries: MetricBoundaries.exponential({ count: 8, factor: 2, start: 0.01 }) },
    metrics: {
        crypto: { description: 'Cryptographic operation duration', name: 'crypto_op_duration_seconds' },
        dbErrors: { description: 'Database query errors', name: 'db_query_errors_total' },
        dbQuery: { description: 'Database query duration', name: 'db_query_duration_seconds' },
        duration: { description: 'HTTP request duration in seconds', name: 'http_request_duration_seconds' },
        requests: { description: 'Total HTTP requests', name: 'http_requests_total' },
    },
} as const);

// --- [METRICS] ---------------------------------------------------------------

const httpRequestsTotal = Metric.counter(B.metrics.requests.name, { description: B.metrics.requests.description });
const httpRequestDuration = Metric.histogram(B.metrics.duration.name, B.boundaries, B.metrics.duration.description);
const dbQueryDuration = Metric.histogram(B.metrics.dbQuery.name, B.db.boundaries, B.metrics.dbQuery.description);
const dbQueryErrors = Metric.counter(B.metrics.dbErrors.name, { description: B.metrics.dbErrors.description });
const cryptoOpDuration = Metric.histogram(B.metrics.crypto.name, B.crypto.boundaries, B.metrics.crypto.description);

// --- [MIDDLEWARE] ------------------------------------------------------------

const createMetricsMiddleware = () =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const clock = yield* Effect.clock;
            const start = yield* clock.currentTimeMillis;
            const response = yield* app;
            const end = yield* clock.currentTimeMillis;
            const duration = (end - start) / 1000;
            const labels = [
                MetricLabel.make('method', request.method),
                MetricLabel.make('path', request.url.split('?')[0] ?? '/'),
                MetricLabel.make('status', String(response.status)),
            ];
            const taggedCounter = httpRequestsTotal.pipe(Metric.taggedWithLabels(labels));
            const taggedHistogram = httpRequestDuration.pipe(Metric.taggedWithLabels(labels));
            yield* Metric.increment(taggedCounter);
            yield* Metric.update(taggedHistogram, duration);
            return response;
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export {
    B as METRICS_TUNING,
    createMetricsMiddleware,
    cryptoOpDuration,
    dbQueryDuration,
    dbQueryErrors,
    httpRequestDuration,
    httpRequestsTotal,
};
