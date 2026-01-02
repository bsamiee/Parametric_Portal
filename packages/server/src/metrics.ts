/**
 * Prometheus metrics service via Effect Layer.
 * Context.Tag + static layer pattern following crypto.ts gold standard.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { DurationMs, Timestamp } from '@parametric-portal/types/types';
import { Context, Effect, Layer } from 'effect';
import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';

// --- [TYPES] -----------------------------------------------------------------

type MetricsShape = {
    readonly httpRequestDuration: Histogram<'method' | 'path' | 'status'>;
    readonly httpRequestsTotal: Counter<'method' | 'path' | 'status'>;
    readonly registry: Registry;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    labelNames: ['method', 'path', 'status'] as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createMetrics = (): MetricsShape => {
    const registry = new Registry();
    collectDefaultMetrics({ register: registry });
    const httpRequestsTotal = new Counter({
        help: 'Total HTTP requests',
        labelNames: [...B.labelNames],
        name: 'http_requests_total',
        registers: [registry],
    });
    const httpRequestDuration = new Histogram({
        buckets: [...B.buckets],
        help: 'HTTP request duration in seconds',
        labelNames: [...B.labelNames],
        name: 'http_request_duration_seconds',
        registers: [registry],
    });
    return { httpRequestDuration, httpRequestsTotal, registry };
};

// --- [SERVICE] ---------------------------------------------------------------

class Metrics extends Context.Tag('server/Metrics')<Metrics, MetricsShape>() {
    static readonly layer = Layer.sync(this, createMetrics);
}

// --- [MIDDLEWARE] ------------------------------------------------------------

const createMetricsMiddleware = () =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const { httpRequestDuration, httpRequestsTotal } = yield* Metrics;
            const request = yield* HttpServerRequest.HttpServerRequest;
            const method = request.method;
            const path = request.url;
            const startTime = Timestamp.nowSync();
            const response = yield* app;
            const status = String(response.status);
            const duration = DurationMs.toSeconds(Timestamp.diff(Timestamp.nowSync(), startTime));
            yield* Effect.sync(() => {
                httpRequestsTotal.inc({ method, path, status });
                httpRequestDuration.observe({ method, path, status }, duration);
            });
            return response;
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { createMetricsMiddleware, Metrics };
