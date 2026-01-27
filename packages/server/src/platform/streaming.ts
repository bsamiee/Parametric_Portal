/**
 * Unified streaming service with intelligent backpressure defaults.
 * Three entry points: sse (Server-Sent Events), download (binary), export (formatted).
 *
 * [PATTERN] Follows MetricsService polymorphic pattern — dense service, static methods, internalized logic.
 * Resilience (circuit breaker, retry, timeout) belongs at source level via Resilience.wrap.
 * This service handles: encoding, buffering, metrics, flow control.
 */
import { Headers, HttpServerResponse } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Duration, Effect, Match, Option, Schedule, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _buffers = {
	download: { capacity: 256, strategy: 'suspend' },
	export: { capacity: 128, strategy: 'suspend' },
	sse: { capacity: 64, strategy: 'sliding' },
} as const;
const _heartbeat = Duration.seconds(30);

// --- [SERVICES] --------------------------------------------------------------

class StreamingService extends Effect.Service<StreamingService>()('server/StreamingService', {
	effect: Effect.succeed({}),
}) {
	/**
	 * Server-Sent Events stream with automatic heartbeat, metrics, and sliding backpressure.
	 * Buffer BEFORE encoding — lets sliding strategy drop stale domain objects, not encoded strings.
	 */
	static readonly sse = <A, E>(
		name: string,
		events: Stream.Stream<A, E, never>,
		serialize: (a: A) => { readonly data: string; readonly event?: string; readonly id?: string },
	): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const encoder = new TextEncoder();
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = MetricsService.label({ stream: name, tenant: tenantId });
			// 1. Metrics tracking (before buffer) — increment stream.elements per event
			const tracked = Option.isSome(metricsOpt)
				? Stream.tap(events, () => MetricsService.inc(metricsOpt.value.stream.elements, labels))
				: events;
			// 2. Buffer with sliding strategy — drops stale events for real-time
			const buffered = Stream.buffer(tracked, { capacity: _buffers.sse.capacity, strategy: 'sliding' });
			// 3. Encode to SSE format
			const encoded = Stream.map(buffered, (a) => {
				const e = serialize(a);
				return encoder.encode(Sse.encoder.write({ _tag: 'Event', data: e.data, event: e.event ?? 'message', id: e.id }));
			});
			// 4. Heartbeat via Stream.merge with scheduled comment
			const withHeartbeat = Stream.merge(
				encoded,
				Stream.schedule(Stream.repeatValue(encoder.encode(': heartbeat\n\n')), Schedule.spaced(_heartbeat)),
			);
			// 5. Cleanup logging on stream termination
			const withCleanup = Stream.ensuring(withHeartbeat, Effect.logDebug('SSE stream closed', { stream: name, tenant: tenantId }));
			return HttpServerResponse.stream(withCleanup, {
				contentType: 'text/event-stream',
				headers: Headers.fromInput({ 'Cache-Control': 'no-cache', Connection: 'keep-alive' }),
			});
		});

	/**
	 * Binary download stream with suspend backpressure for consumer-paced delivery.
	 * Synchronous — no Effect wrapper needed since no async dependencies.
	 */
	static readonly download = <E>(
		stream: Stream.Stream<Uint8Array, E, never>,
		config: { readonly filename: string; readonly contentType: string; readonly size?: number },
	): HttpServerResponse.HttpServerResponse => {
		const buffered = Stream.buffer(stream, { capacity: _buffers.download.capacity, strategy: 'suspend' });
		const headers = Headers.fromInput({
			'Content-Disposition': `attachment; filename="${config.filename.replaceAll('"', String.raw`\"`)}"`,
			'Content-Type': config.contentType,
			...(config.size === undefined ? {} : { 'Content-Length': String(config.size) }),
		});
		return HttpServerResponse.stream(buffered, { contentType: config.contentType, headers });
	};

	/**
	 * Formatted export stream (json/csv/ndjson) with metrics and suspend backpressure.
	 * Format encoding via Match.value — exhaustive handling of all formats.
	 */
	static readonly export = <A, E>(
		name: string,
		stream: Stream.Stream<A, E, never>,
		format: 'json' | 'csv' | 'ndjson',
		serialize: (a: A) => string = (a) => JSON.stringify(a),
	): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const encoder = new TextEncoder();
			const metricsOpt = yield* Effect.serviceOption(MetricsService);
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = MetricsService.label({ export: name, tenant: tenantId });
			// 1. Metrics tracking — increment stream.elements per record
			const tracked = Option.isSome(metricsOpt)
				? Stream.tap(stream, () => MetricsService.inc(metricsOpt.value.stream.elements, labels))
				: stream;
			// 2. Format encoding via exhaustive match
			const { contentType, encoded } = Match.value(format).pipe(
				Match.when('json', () => ({
					contentType: 'application/json',
					encoded: Stream.concat(
						Stream.succeed(encoder.encode('[')),
						Stream.concat(
							tracked.pipe(
								Stream.zipWithIndex,
								Stream.map(([a, i]) => encoder.encode(i === 0 ? serialize(a) : `,${serialize(a)}`)),
							),
							Stream.succeed(encoder.encode(']')),
						),
					),
				})),
				Match.when('ndjson', () => ({
					contentType: 'application/x-ndjson',
					encoded: Stream.map(tracked, (a) => encoder.encode(`${serialize(a)}\n`)),
				})),
				Match.when('csv', () => ({
					contentType: 'text/csv',
					encoded: Stream.map(tracked, (a) => encoder.encode(`${serialize(a)}\n`)),
				})),
				Match.exhaustive,
			);
			// 3. Buffer with suspend strategy — waits for consumer
			const buffered = Stream.buffer(encoded, { capacity: _buffers.export.capacity, strategy: 'suspend' });
			return HttpServerResponse.stream(buffered, {
				contentType,
				headers: Headers.fromInput({
					'Content-Disposition': `attachment; filename="${name}.${format === 'ndjson' ? 'ndjson' : format}"`,
					'Content-Type': contentType,
				}),
			});
		});
}

// --- [EXPORT] ----------------------------------------------------------------

export { StreamingService };
