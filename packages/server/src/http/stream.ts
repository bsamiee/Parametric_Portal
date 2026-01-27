/**
 * Unified streaming module with SSE encoding, backpressure control, and metrics integration.
 * Uses @effect/experimental Sse encoder for SSE formatting.
 * All buffers have explicit capacity to prevent unbounded memory growth.
 *
 * Design: Response builders (sse, response, download, export_) accept streams with no requirements
 * and return HttpServerResponse directly. Stream transformers (withBuffer, withProgress, withCircuit)
 * preserve requirements for composition before response building.
 */
import { Headers, HttpServerResponse } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Effect, Match, Metric, Option, Stream } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from './resilience.ts';

// --- [TYPES] -----------------------------------------------------------------

type BufferStrategy = 'sliding' | 'suspend' | 'dropping';

type BufferConfig = {
	readonly capacity: number;
	readonly strategy: BufferStrategy;
};

type SseEventData = {
	readonly id?: string;
	readonly event?: string;
	readonly data: string;
};

type SseConfig<A, E> = {
	readonly serialize: (a: A) => SseEventData;
	readonly buffer?: Partial<BufferConfig>;
	readonly onError?: (e: E) => SseEventData;
};

type ResponseConfig = {
	readonly contentType: string;
	readonly headers?: Headers.Input;
	readonly buffer?: Partial<BufferConfig>;
};

type SseTrackedConfig<A, E> = SseConfig<A, E> & {
	readonly name: string;
};

type ProgressConfig = {
	readonly name: string;
	readonly logInterval?: number;
};

type DownloadConfig = {
	readonly filename: string;
	readonly contentType?: string;
	readonly size?: number;
	readonly buffer?: Partial<BufferConfig>;
};

type ExportFormat = 'json' | 'csv' | 'ndjson';

type ExportConfig<A> = {
	readonly filename: string;
	readonly format: ExportFormat;
	readonly serialize?: (a: A) => string;
	readonly buffer?: Partial<BufferConfig>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _bufferDefaults = {
	download: { capacity: 256, strategy: 'suspend' },
	export: { capacity: 128, strategy: 'suspend' },
	import: { capacity: 64, strategy: 'suspend' },
	sse: { capacity: 64, strategy: 'sliding' },
} as const satisfies Record<string, BufferConfig>;

const _textEncoder = new TextEncoder();

const _metrics = {
	bufferOverflows: Metric.counter('stream_buffer_overflows_total'),
	bytes: Metric.counter('stream_bytes_total'),
	duration: Metric.timerWithBoundaries('stream_duration_seconds', [0.1, 1, 10, 60, 300]),
	elements: Metric.counter('stream_elements_total'),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _encodeToBytes = (text: string): Uint8Array => _textEncoder.encode(text);

const _resolveBufferConfig = (
	defaults: BufferConfig,
	override?: Partial<BufferConfig>,
): BufferConfig => ({
	capacity: override?.capacity ?? defaults.capacity,
	strategy: override?.strategy ?? defaults.strategy,
});

const _applyBufferStrategy = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	config: BufferConfig,
): Stream.Stream<A, E, R> =>
	Match.value(config.strategy).pipe(
		Match.when('sliding', () => Stream.buffer(stream, { capacity: config.capacity, strategy: 'sliding' })),
		Match.when('dropping', () => Stream.buffer(stream, { capacity: config.capacity, strategy: 'dropping' })),
		Match.when('suspend', () => Stream.buffer(stream, { capacity: config.capacity, strategy: 'suspend' })),
		Match.exhaustive,
	);

const _formatSseEvent = (eventData: SseEventData): string =>
	Sse.encoder.write({
		_tag: 'Event',
		data: eventData.data,
		event: eventData.event ?? 'message',
		id: eventData.id,
	});

// --- [SERVICES] --------------------------------------------------------------

/**
 * Build SSE response from a stream of events.
 * Uses @effect/experimental Sse encoder for proper SSE formatting.
 * Stream must have no requirements (use Effect.provide before calling).
 */
const sse = <A, E>(
	events: Stream.Stream<A, E, never>,
	config: SseConfig<A, E>,
): HttpServerResponse.HttpServerResponse => {
	const bufferConfig = _resolveBufferConfig(_bufferDefaults.sse, config.buffer);

	const sseStream = events.pipe(
		Stream.map((a) => _encodeToBytes(_formatSseEvent(config.serialize(a)))),
		Stream.catchAll((e) =>
			config.onError
				? Stream.succeed(_encodeToBytes(_formatSseEvent(config.onError(e))))
				: Stream.fail(e),
		),
		(s) => _applyBufferStrategy(s, bufferConfig),
	);

	return HttpServerResponse.stream(sseStream, {
		contentType: 'text/event-stream',
		headers: Headers.fromInput({
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
		}),
	});
};

/**
 * Build generic stream response with configurable content type and headers.
 * Stream must have no requirements (use Effect.provide before calling).
 */
const response = <E>(
	stream: Stream.Stream<Uint8Array, E, never>,
	config: ResponseConfig,
): HttpServerResponse.HttpServerResponse => {
	const bufferConfig = _resolveBufferConfig(_bufferDefaults.download, config.buffer);
	const bufferedStream = _applyBufferStrategy(stream, bufferConfig);

	const baseHeaders = Headers.fromInput({
		'Content-Type': config.contentType,
	});

	const mergedHeaders = config.headers
		? Headers.merge(baseHeaders, Headers.fromInput(config.headers))
		: baseHeaders;

	return HttpServerResponse.stream(bufferedStream, {
		contentType: config.contentType,
		headers: mergedHeaders,
	});
};

/**
 * Apply buffer configuration to a stream.
 * Accepts either a preset name or explicit configuration.
 */
const withBuffer = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	type: keyof typeof _bufferDefaults | BufferConfig,
): Stream.Stream<A, E, R> => {
	const config = typeof type === 'string' ? _bufferDefaults[type] : type;
	return _applyBufferStrategy(stream, config);
};

/**
 * Build SSE response with metrics tracking.
 * Tracks element count per stream. Metrics are optional - works without MetricsService.
 */
const sseTracked = <A, E>(
	events: Stream.Stream<A, E, never>,
	config: SseTrackedConfig<A, E>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
	Effect.gen(function* () {
		const metricsOpt = yield* Effect.serviceOption(MetricsService);
		const labels = MetricsService.label({ stream: config.name });

		const trackedEvents = Option.match(metricsOpt, {
			onNone: () => events,
			onSome: () => Stream.tap(events, () => MetricsService.inc(_metrics.elements, labels)),
		});

		const bufferConfig = _resolveBufferConfig(_bufferDefaults.sse, config.buffer);

		const sseStream = trackedEvents.pipe(
			Stream.map((a) => _encodeToBytes(_formatSseEvent(config.serialize(a)))),
			Stream.catchAll((e) =>
				config.onError
					? Stream.succeed(_encodeToBytes(_formatSseEvent(config.onError(e))))
					: Stream.fail(e),
			),
			(s) => _applyBufferStrategy(s, bufferConfig),
		);

		return HttpServerResponse.stream(sseStream, {
			contentType: 'text/event-stream',
			headers: Headers.fromInput({
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			}),
		});
	});

/**
 * Add progress tracking to a stream with periodic logging.
 * Uses sampling to reduce overhead on high-volume streams.
 */
const withProgress = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	config: ProgressConfig,
): Stream.Stream<A, E, R> => {
	const interval = config.logInterval ?? 1000;
	const labels = MetricsService.label({ stream: config.name });

	return stream.pipe(
		Stream.zipWithIndex,
		Stream.tap(([, idx]) =>
			idx > 0 && idx % interval === 0
				? Effect.flatMap(
					Effect.serviceOption(MetricsService),
					Option.match({
						onNone: () => Effect.logInfo('Stream progress', { items: idx, stream: config.name }),
						onSome: () => Effect.all([
							MetricsService.inc(_metrics.elements, labels, idx),
							Effect.logInfo('Stream progress', { items: idx, stream: config.name }),
						]),
					}),
				)
				: Effect.void,
		),
		Stream.map(([item]) => item),
	);
};

/**
 * Wrap a stream with circuit breaker protection.
 * Checks circuit state at stream start - if open, fails immediately.
 * For per-element circuit protection, use Resilience.withCircuit on individual effects.
 */
const withCircuit = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	circuitName: string,
): Stream.Stream<A, E | Resilience.CircuitOpenError, R> =>
	Stream.unwrap(
		Resilience.withCircuit(
			Effect.succeed(stream),
			circuitName,
		),
	);

/**
 * Build file download response with proper headers.
 * Sets Content-Disposition for browser download, Content-Type, and optional Content-Length.
 */
const download = <E>(
	stream: Stream.Stream<Uint8Array, E, never>,
	config: DownloadConfig,
): HttpServerResponse.HttpServerResponse => {
	const bufferConfig = _resolveBufferConfig(_bufferDefaults.download, config.buffer);
	const bufferedStream = _applyBufferStrategy(stream, bufferConfig);

	const contentType = config.contentType ?? 'application/octet-stream';
	const escapedFilename = config.filename.replace(/"/g, '\\"');

	const headers = Headers.fromInput({
		'Content-Disposition': `attachment; filename="${escapedFilename}"`,
		'Content-Type': contentType,
		...(config.size !== undefined ? { 'Content-Length': String(config.size) } : {}),
	});

	return HttpServerResponse.stream(bufferedStream, {
		contentType,
		headers,
	});
};

/**
 * Transform stream to JSON array format (wrapped in brackets, comma-separated).
 */
const jsonArray = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	serialize: (a: A) => string = (a) => JSON.stringify(a),
): Stream.Stream<Uint8Array, E, R> =>
	Stream.concat(
		Stream.succeed(_encodeToBytes('[')),
		Stream.concat(
			stream.pipe(
				Stream.zipWithIndex,
				Stream.map(([a, idx]) => _encodeToBytes(idx === 0 ? serialize(a) : `,${serialize(a)}`)),
			),
			Stream.succeed(_encodeToBytes(']')),
		),
	);

/**
 * Transform stream to NDJSON format (newline-delimited JSON).
 */
const ndjson = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	serialize: (a: A) => string = (a) => JSON.stringify(a),
): Stream.Stream<Uint8Array, E, R> =>
	Stream.map(stream, (a) => _encodeToBytes(`${serialize(a)}\n`));

/**
 * Build data export response in specified format.
 * Supports JSON array, NDJSON, and CSV formats.
 */
const export_ = <A, E>(
	stream: Stream.Stream<A, E, never>,
	config: ExportConfig<A>,
): HttpServerResponse.HttpServerResponse => {
	const serialize = config.serialize ?? ((a: A) => JSON.stringify(a));
	const bufferConfig = _resolveBufferConfig(_bufferDefaults.export, config.buffer);

	const formatResult = Match.value(config.format).pipe(
		Match.when('json', () => ({
			contentType: 'application/json',
			stream: _applyBufferStrategy(jsonArray(stream, serialize), bufferConfig),
		})),
		Match.when('ndjson', () => ({
			contentType: 'application/x-ndjson',
			stream: _applyBufferStrategy(ndjson(stream, serialize), bufferConfig),
		})),
		Match.when('csv', () => ({
			contentType: 'text/csv',
			stream: _applyBufferStrategy(ndjson(stream, serialize), bufferConfig), // CSV uses same newline pattern
		})),
		Match.exhaustive,
	);

	const escapedFilename = config.filename.replace(/"/g, '\\"');
	const headers = Headers.fromInput({
		'Content-Disposition': `attachment; filename="${escapedFilename}"`,
		'Content-Type': formatResult.contentType,
	});

	return HttpServerResponse.stream(formatResult.stream, {
		contentType: formatResult.contentType,
		headers,
	});
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Streaming = {
	download,
	export_,
	jsonArray,
	ndjson,
	response,
	sse,
	sseTracked,
	withBuffer,
	withCircuit,
	withProgress,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Streaming {
	export type BufferStrategy = typeof _bufferDefaults extends Record<string, infer T>
		? T extends { strategy: infer S } ? S : never
		: never;
	export type BufferConfig = {
		readonly capacity: number;
		readonly strategy: BufferStrategy;
	};
	export type SseConfig<A, E> = {
		readonly serialize: (a: A) => SseEventData;
		readonly buffer?: Partial<BufferConfig>;
		readonly onError?: (e: E) => SseEventData;
	};
	export type SseTrackedConfig<A, E> = SseConfig<A, E> & {
		readonly name: string;
	};
	export type ResponseConfig = {
		readonly contentType: string;
		readonly headers?: Headers.Input;
		readonly buffer?: Partial<BufferConfig>;
	};
	export type ProgressConfig = {
		readonly name: string;
		readonly logInterval?: number;
	};
	export type DownloadConfig = {
		readonly filename: string;
		readonly contentType?: string;
		readonly size?: number;
		readonly buffer?: Partial<BufferConfig>;
	};
	export type ExportFormat = 'json' | 'csv' | 'ndjson';
	export type ExportConfig<A> = {
		readonly filename: string;
		readonly format: ExportFormat;
		readonly serialize?: (a: A) => string;
		readonly buffer?: Partial<BufferConfig>;
	};
	export type CircuitOpenError = Resilience.CircuitOpenError;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Streaming };
