/**
 * OTLP proxy for browser telemetry (CORS bypass).
 * Browser POSTs to /api/v1/traces, API forwards to collector.
 *
 * [AUDIT EXEMPTION]: Telemetry ingestion is intentionally not audited.
 * This high-volume endpoint would generate excessive audit entries (one per trace batch).
 * Telemetry data is already observable via the OTLP collector itself.
 */
import { HttpApiBuilder, type HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Config, Effect, Function as F, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const CollectorEndpoint = Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
    Config.withDefault(Telemetry.config.defaults.endpoint),
    Config.map((url) => url.replace(':4317', ':4318')),
);
const TelemetryCircuit = Circuit.make('telemetry.otlp');

// --- [SCHEMA] ----------------------------------------------------------------

const OtlpPayload = S.Struct({ resourceSpans: S.Array(S.Unknown) });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleIngestTraces = Effect.fn('telemetry.ingest')((request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
        const endpoint = yield* CollectorEndpoint;
        const json = yield* request.json;
        const payload = yield* S.decodeUnknown(OtlpPayload)(json);
        const circuit = yield* TelemetryCircuit;
        yield* circuit.execute(
            Effect.tryPromise({
                catch: (error) => error instanceof Error ? error : new Error(String(error)),
                try: (signal) => fetch(`${endpoint}/v1/traces`, { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, method: 'POST', signal })
                    .then((response) => response.ok ? undefined : Promise.reject(new Error(`OTLP collector HTTP ${response.status}`))),
            }),
        );
        return HttpServerResponse.empty({ status: 202 });
    }).pipe(
        Effect.tapError((error) => Effect.logWarning('Telemetry proxy failed', { error: String(error) })),
        Effect.orElseSucceed(F.constant(HttpServerResponse.empty({ status: 202 }))),
    ),
);

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryRouteLive = HttpApiBuilder.group(ParametricApi, 'telemetry', (handlers) =>
    handlers.handle('ingestTraces', ({ request }) => CacheService.rateLimit('api', handleIngestTraces(request))),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryRouteLive };
