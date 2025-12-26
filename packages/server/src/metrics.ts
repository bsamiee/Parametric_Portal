/**
 * Prometheus metrics middleware for HTTP request tracking.
 * Exports registry, counters, histograms for /metrics endpoint.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Context, Effect, Layer } from 'effect';
import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    labelNames: ['method', 'path', 'status'] as const,
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class MetricsRegistry extends Context.Tag('MetricsRegistry')<MetricsRegistry, Registry>() {}

// --- [SCHEMA] ----------------------------------------------------------------

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

// --- [MIDDLEWARE] ------------------------------------------------------------

const createMetricsMiddleware = () =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const method = request.method;
            const path = request.url;
            const startTime = Date.now();
            const response = yield* app;
            const status = String(response.status);
            const duration = (Date.now() - startTime) / 1000;
            yield* Effect.sync(() => {
                httpRequestsTotal.inc({ method, path, status });
                httpRequestDuration.observe({ method, path, status }, duration);
            });
            return response;
        }),
    );

// --- [LAYERS] ----------------------------------------------------------------

const MetricsRegistryLive = Layer.succeed(MetricsRegistry, registry);

// --- [EXPORT] ----------------------------------------------------------------

export { createMetricsMiddleware, MetricsRegistry, MetricsRegistryLive, registry };
