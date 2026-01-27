/**
 * Unified streaming responses with automatic metrics, buffering, and flow control.
 * Three entry points: sse (Server-Sent Events), response (binary), export (formatted).
 *
 * Resilience (circuit breaker, retry, timeout) belongs at the SOURCE effect level via Resilience.wrap.
 * This module handles stream-level concerns: encoding, buffering, metrics, flow control.
 */
import { Headers, HttpServerResponse } from '@effect/platform';
import { Sse } from '@effect/experimental';
import type { Duration } from 'effect';
import { Effect, Match, Option, Schedule, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _buffers = {
	download: { capacity: 256, strategy: 'suspend' },
	export: { capacity: 128, strategy: 'suspend' },
	sse: { capacity: 64, strategy: 'sliding' },
} as const;

// --- [SERVICES] --------------------------------------------------------------

const sse = <A, E>(
	events: Stream.Stream<A, E, never>,
	config: {
		readonly serialize: (a: A) => { readonly id?: string; readonly event?: string; readonly data: string };
		readonly name?: string;
		readonly retry?: Schedule.Schedule<unknown, E, never>;
		readonly timeout?: Duration.Duration;
		readonly throttle?: { readonly elements: number; readonly duration: Duration.Duration };
		readonly heartbeat?: Duration.Duration;
		readonly onError?: (e: E) => { readonly event: string; readonly data: string };
		readonly onCleanup?: () => void;
		readonly buffer?: { readonly capacity?: number; readonly strategy?: 'sliding' | 'suspend' | 'dropping' };
	},
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
	Effect.gen(function* () {
		const enc = new TextEncoder();
		const metricsOpt = yield* Effect.serviceOption(MetricsService);
		const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
		const labels = config.name === undefined ? undefined : MetricsService.label({ stream: config.name, tenant: tenantId });
		// 1. Metrics tracking (only when name provided and metrics available)
		const tracked = labels !== undefined && Option.isSome(metricsOpt)
			? Stream.tap(events, () => MetricsService.inc(metricsOpt.value.stream.elements, labels))
			: events;
		// 2. Stream-level retry (restarts stream production on failure)
		const withRetry = config.retry === undefined ? tracked : Stream.retry(tracked, config.retry);
		// 3. Throttle (rate limiting)
		const withThrottle = config.throttle === undefined
			? withRetry
			: Stream.throttle(withRetry, { cost: () => 1, duration: config.throttle.duration, strategy: 'enforce', units: config.throttle.elements });
		// 4. Timeout (inactivity cutoff)
		const withTimeout = config.timeout === undefined ? withThrottle : Stream.timeout(withThrottle, config.timeout);
		// 5. Encode to SSE format + error handling
		const encoded = withTimeout.pipe(
			Stream.map((a) => {
				const e = config.serialize(a);
				return enc.encode(Sse.encoder.write({ _tag: 'Event', data: e.data, event: e.event ?? 'message', id: e.id }));
			}),
			Stream.catchAll((e) => {
				if (config.onError === undefined) return Stream.fail(e);
				const err = config.onError(e);
				return Stream.succeed(enc.encode(Sse.encoder.write({ _tag: 'Event', data: err.data, event: err.event, id: undefined })));
			}),
		);
		// 6. Heartbeat (keep-alive via stream merge)
		const withHeartbeat = config.heartbeat === undefined
			? encoded
			: Stream.merge(encoded, Stream.schedule(Stream.repeatValue(enc.encode(': heartbeat\n\n')), Schedule.spaced(config.heartbeat)));
		// 7. Cleanup (resource release on termination)
		const withCleanup = config.onCleanup === undefined
			? withHeartbeat
			: Stream.ensuring(withHeartbeat, Effect.sync(config.onCleanup));
		// 8. Buffer (backpressure - sliding drops stale events for real-time)
		const buffered = Stream.buffer(withCleanup, {
			capacity: config.buffer?.capacity ?? _buffers.sse.capacity,
			strategy: config.buffer?.strategy ?? 'sliding',
		});
		return HttpServerResponse.stream(buffered, {
			contentType: 'text/event-stream',
			headers: Headers.fromInput({ 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }),
		});
	});
const response = <E>(
	stream: Stream.Stream<Uint8Array, E, never>,
	config: {
		readonly contentType: string;
		readonly headers?: Headers.Input;
		readonly filename?: string;
		readonly size?: number;
		readonly buffer?: { readonly capacity?: number; readonly strategy?: 'sliding' | 'suspend' | 'dropping' };
	},
): HttpServerResponse.HttpServerResponse => {
	const buffered = Stream.buffer(stream, {
		capacity: config.buffer?.capacity ?? _buffers.download.capacity,
		strategy: config.buffer?.strategy ?? 'suspend',
	});
	const baseHeaders: Record<string, string> = { 'Content-Type': config.contentType };
	if (config.filename !== undefined) {
		baseHeaders['Content-Disposition'] = `attachment; filename="${config.filename.replaceAll('"', String.raw`\"`)}"`;
	}
	if (config.size !== undefined) {
		baseHeaders['Content-Length'] = String(config.size);
	}
	const headers = config.headers === undefined
		? Headers.fromInput(baseHeaders)
		: Headers.merge(Headers.fromInput(baseHeaders), Headers.fromInput(config.headers));
	return HttpServerResponse.stream(buffered, { contentType: config.contentType, headers });
};
const export_ = <A, E>(
	stream: Stream.Stream<A, E, never>,
	config: {
		readonly filename: string;
		readonly format: 'json' | 'csv' | 'ndjson';
		readonly serialize?: (a: A) => string;
		readonly buffer?: { readonly capacity?: number; readonly strategy?: 'sliding' | 'suspend' | 'dropping' };
	},
): HttpServerResponse.HttpServerResponse => {
	const enc = new TextEncoder();
	const serialize = config.serialize ?? ((a: A) => JSON.stringify(a));
	const { contentType, encoded } = Match.value(config.format).pipe(
		Match.when('json', () => ({
			contentType: 'application/json',
			encoded: Stream.concat(
				Stream.succeed(enc.encode('[')),
				Stream.concat(
					stream.pipe(Stream.zipWithIndex, Stream.map(([a, i]) => enc.encode(i === 0 ? serialize(a) : `,${serialize(a)}`))),
					Stream.succeed(enc.encode(']')),
				),
			),
		})),
		Match.when('ndjson', () => ({
			contentType: 'application/x-ndjson',
			encoded: stream.pipe(Stream.map((a) => enc.encode(`${serialize(a)}\n`))),
		})),
		Match.when('csv', () => ({
			contentType: 'text/csv',
			encoded: stream.pipe(Stream.map((a) => enc.encode(`${serialize(a)}\n`))),
		})),
		Match.exhaustive,
	);
	const buffered = Stream.buffer(encoded, {
		capacity: config.buffer?.capacity ?? _buffers.export.capacity,
		strategy: config.buffer?.strategy ?? 'suspend',
	});
	return HttpServerResponse.stream(buffered, {
		contentType,
		headers: Headers.fromInput({
			'Content-Disposition': `attachment; filename="${config.filename.replaceAll('"', String.raw`\"`)}"`  ,
			'Content-Type': contentType,
		}),
	});
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Streaming = { export: export_, response, sse } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Streaming {
	export type SseConfig<A, E> = Parameters<typeof sse<A, E>>[1];
	export type ResponseConfig = Parameters<typeof response>[1];
	export type ExportConfig<A> = Parameters<typeof export_<A, unknown>>[1];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Streaming };
