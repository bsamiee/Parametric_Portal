/**
 * OTLP proxy for browser telemetry (CORS bypass).
 * Browser POSTs to /api/v1/traces, API forwards to collector.
 *
 * [AUDIT EXEMPTION]: Telemetry ingestion is intentionally not audited.
 * This high-volume endpoint would generate excessive audit entries (one per trace batch).
 * Telemetry data is already observable via the OTLP collector itself.
 */
import { FetchHttpClient, Headers, HttpApiBuilder, HttpClient, HttpClientRequest, type HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Array as A, Duration, Effect, Match, Option, pipe, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	contentType: { header: 'content-type', json: 'application/json', protobuf: { aliases: ['application/x-protobuf', 'application/protobuf'], primary: 'application/x-protobuf' } },
	protocol: 	 { httpJson: 'http/json', httpProtobuf: 'http/protobuf' } as const,
	response: 	 { accepted: 202 },
	telemetry: 	 { circuit: 'telemetry.otlp' },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const OtlpPayload = S.Struct({ resourceSpans: S.Array(S.Unknown) });

// --- [FUNCTIONS] -------------------------------------------------------------

const handleIngestTraces = (request: HttpServerRequest.HttpServerRequest) =>
	Effect.gen(function* () {
		const collector = yield* Telemetry.collectorConfig;
		const contentType = Headers.get(request.headers, _CONFIG.contentType.header).pipe(
			Option.map((header) => (header.split(';')[0] ?? '').trim().toLowerCase()),
			Option.getOrElse(() => collector.protocol === _CONFIG.protocol.httpProtobuf ? _CONFIG.contentType.protobuf.primary : _CONFIG.contentType.json),
		);
		const payload = yield* Match.value(A.some(_CONFIG.contentType.protobuf.aliases, (value) => contentType.includes(value))).pipe(
			Match.when(true, () => request.arrayBuffer.pipe(Effect.map((buffer) => ({ body: new Uint8Array(buffer), contentType: _CONFIG.contentType.protobuf.primary })))),
			Match.orElse(() => request.json.pipe(
				Effect.flatMap(S.decodeUnknown(OtlpPayload)),
				Effect.map((decoded) => ({ body: JSON.stringify(decoded), contentType: _CONFIG.contentType.json })),
			)),
		);
		const outbound = pipe(
			HttpClientRequest.post(collector.endpoint),
			HttpClientRequest.setHeaders(collector.headers),
			payload.body instanceof Uint8Array
				? HttpClientRequest.bodyUint8Array(payload.body, payload.contentType)
				: HttpClientRequest.bodyText(payload.body, payload.contentType),
		);
		yield* Resilience.run(_CONFIG.telemetry.circuit,
			Effect.flatMap(HttpClient.HttpClient, (client) => client.pipe(HttpClient.filterStatusOk).execute(outbound).pipe(Effect.scoped, Effect.asVoid)).pipe(Effect.provide(FetchHttpClient.layer)),
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
