/**
 * OTLP proxy for browser telemetry (CORS bypass).
 * Browser POSTs to /api/v1/traces, API forwards to collector.
 *
 * [AUDIT EXEMPTION]: Telemetry ingestion is intentionally not audited.
 * This high-volume endpoint would generate excessive audit entries (one per trace batch).
 * Telemetry data is already observable via the OTLP collector itself.
 */
import { Headers, HttpApiBuilder, type HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Array as A, Config, Duration, Effect, Match, Option, pipe, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	contentType: { header: 'content-type', json: 'application/json', protobuf: { aliases: ['application/x-protobuf', 'application/protobuf'], primary: 'application/x-protobuf' } },
	defaults: 	 { endpoint: Telemetry.config.defaults.endpoint, headers: Telemetry.config.defaults.headers },
	index: 		 { first: 0 },
	paths: 		 { traces: '/v1/traces' },
	replace: 	 { grpc: ':4317', http: ':4318' },
	response: 	 { accepted: 202 },
	telemetry: 	 { circuit: 'telemetry.otlp' },
} as const;
const CollectorEndpoint = Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
	Config.withDefault(_CONFIG.defaults.endpoint),
	Config.map((url) => url.replace(_CONFIG.replace.grpc, _CONFIG.replace.http)),
);
const CollectorHeaders = Config.string('OTEL_EXPORTER_OTLP_HEADERS').pipe(
	Config.withDefault(_CONFIG.defaults.headers),
	Config.map(Telemetry.parseHeaders),
);
// --- [SCHEMA] ----------------------------------------------------------------

const OtlpPayload = S.Struct({ resourceSpans: S.Array(S.Unknown) });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleIngestTraces = (request: HttpServerRequest.HttpServerRequest) =>
	Effect.gen(function* () {
		const endpoint = yield* CollectorEndpoint;
		const extraHeaders = yield* CollectorHeaders;
		const contentType = pipe(
			Headers.get(request.headers, _CONFIG.contentType.header),
			Option.map((value) => value.toLowerCase().split(';')),
			Option.flatMap((parts) => A.get(parts, _CONFIG.index.first)),
			Option.map((value) => value.trim()),
			Option.getOrElse(() => _CONFIG.contentType.json),
		);
		const payload = yield* Match.value(A.some(_CONFIG.contentType.protobuf.aliases, (value) => contentType.includes(value))).pipe(
			Match.when(true, () => request.arrayBuffer.pipe(Effect.map((buffer) => ({ body: new Uint8Array(buffer), contentType: _CONFIG.contentType.protobuf.primary })))),
			Match.orElse(() => request.json.pipe(
				Effect.flatMap(S.decodeUnknown(OtlpPayload)),
				Effect.map((decoded) => ({ body: JSON.stringify(decoded), contentType: _CONFIG.contentType.json })),
			)),
		);
		yield* Resilience.run(_CONFIG.telemetry.circuit,
			Effect.tryPromise({
				catch: (error) => error instanceof Error ? error : new Error(String(error)),
				try: (signal) => fetch(`${endpoint}${_CONFIG.paths.traces}`, { body: payload.body, headers: { ...extraHeaders, 'content-type': payload.contentType }, method: 'POST', signal })
					.then((response) => response.ok ? undefined : Promise.reject(new Error(`OTLP collector HTTP ${response.status}`))),
			}),
				{ circuit: _CONFIG.telemetry.circuit, retry: 'brief', timeout: Duration.seconds(5) },
			);
		return HttpServerResponse.empty({ status: _CONFIG.response.accepted });
		}).pipe(
			Effect.tapError((error) => Effect.logWarning('Telemetry proxy failed', { error: String(error) })),
			Effect.orElseSucceed(() => HttpServerResponse.empty({ status: _CONFIG.response.accepted })),
			Telemetry.span('telemetry.ingest', { kind: 'server', metrics: false }),
		);

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryRouteLive = HttpApiBuilder.group(ParametricApi, 'telemetry', (handlers) =>
	handlers.handle('ingestTraces', ({ request }) => CacheService.rateLimit('api', handleIngestTraces(request))),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryRouteLive };
