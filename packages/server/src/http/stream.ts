/** Unified streaming with automatic metrics, buffering, and format encoding. */
import { Headers, HttpServerResponse } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Effect, Match, Option, Stream } from 'effect';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _buffers = {
	download: { capacity: 256, strategy: 'suspend' },
	export: { capacity: 128, strategy: 'suspend' },
	sse: { capacity: 64, strategy: 'sliding' },
} as const;

const _textEncoder = new TextEncoder();

// --- [FUNCTIONS] -------------------------------------------------------------

const _encodeToBytes = (text: string): Uint8Array => _textEncoder.encode(text);

const _applyBuffer = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	type: keyof typeof _buffers,
	override?: Partial<Streaming.BufferConfig>,
): Stream.Stream<A, E, R> => {
	const defaults = _buffers[type];
	const capacity = override?.capacity ?? defaults.capacity;
	const strategy = override?.strategy ?? defaults.strategy;
	return Match.value(strategy).pipe(
		Match.when('sliding', () => Stream.buffer(stream, { capacity, strategy: 'sliding' })),
		Match.when('dropping', () => Stream.buffer(stream, { capacity, strategy: 'dropping' })),
		Match.when('suspend', () => Stream.buffer(stream, { capacity, strategy: 'suspend' })),
		Match.exhaustive,
	);
};

const _formatSseEvent = (eventData: { readonly id?: string; readonly event?: string; readonly data: string }): string =>
	Sse.encoder.write({
		_tag: 'Event',
		data: eventData.data,
		event: eventData.event ?? 'message',
		id: eventData.id,
	});

const _trackStream = <A, E, R>(
	stream: Stream.Stream<A, E, R>,
	name: string,
	logInterval?: number,
): Effect.Effect<Stream.Stream<A, E, R>, never, never> =>
	Effect.gen(function* () {
		const metricsOpt = yield* Effect.serviceOption(MetricsService);
		return Option.match(metricsOpt, {
			onNone: () => stream,
			onSome: (metrics) =>
				logInterval !== undefined
					? MetricsService.trackStreamProgress(stream, {
							counter: metrics.stream.elements,
							labels: { stream: name },
							logInterval,
						})
					: MetricsService.trackStream(stream, metrics.stream.elements, { stream: name }),
		});
	});

// --- [SERVICES] --------------------------------------------------------------

const sse = <A, E>(
	events: Stream.Stream<A, E, never>,
	config: {
		readonly serialize: (a: A) => { readonly id?: string; readonly event?: string; readonly data: string };
		readonly name?: string;
		readonly buffer?: Partial<Streaming.BufferConfig>;
		readonly logInterval?: number;
		readonly onError?: (e: E) => { readonly event: string; readonly data: string };
	},
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
	Effect.gen(function* () {
		const tracked = config.name !== undefined
			? yield* _trackStream(events, config.name, config.logInterval)
			: events;

		const sseStream = tracked.pipe(
			Stream.map((a) => _encodeToBytes(_formatSseEvent(config.serialize(a)))),
			Stream.catchAll((e) =>
				config.onError !== undefined
					? Stream.succeed(_encodeToBytes(_formatSseEvent(config.onError(e))))
					: Stream.fail(e),
			),
			(s) => _applyBuffer(s, 'sse', config.buffer),
		);

		return HttpServerResponse.stream(sseStream, {
			contentType: 'text/event-stream',
			headers: Headers.fromInput({
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			}),
		});
	});

const response = <E>(
	stream: Stream.Stream<Uint8Array, E, never>,
	config: {
		readonly contentType: string;
		readonly headers?: Headers.Input;
		readonly buffer?: Partial<Streaming.BufferConfig>;
	},
): HttpServerResponse.HttpServerResponse => {
	const bufferedStream = _applyBuffer(stream, 'download', config.buffer);
	const baseHeaders = Headers.fromInput({ 'Content-Type': config.contentType });
	const mergedHeaders = config.headers !== undefined
		? Headers.merge(baseHeaders, Headers.fromInput(config.headers))
		: baseHeaders;

	return HttpServerResponse.stream(bufferedStream, {
		contentType: config.contentType,
		headers: mergedHeaders,
	});
};

const download = <E>(
	stream: Stream.Stream<Uint8Array, E, never>,
	config: {
		readonly filename: string;
		readonly contentType?: string;
		readonly size?: number;
		readonly buffer?: Partial<Streaming.BufferConfig>;
	},
): HttpServerResponse.HttpServerResponse => {
	const bufferedStream = _applyBuffer(stream, 'download', config.buffer);
	const contentType = config.contentType ?? 'application/octet-stream';
	const escapedFilename = config.filename.replaceAll('"', '\\"');

	const headers = Headers.fromInput({
		'Content-Disposition': `attachment; filename="${escapedFilename}"`,
		'Content-Type': contentType,
		...(config.size !== undefined ? { 'Content-Length': String(config.size) } : {}),
	});

	return HttpServerResponse.stream(bufferedStream, { contentType, headers });
};

const export_ = <A, E>(
	stream: Stream.Stream<A, E, never>,
	config: {
		readonly filename: string;
		readonly format: 'json' | 'csv' | 'ndjson';
		readonly serialize?: (a: A) => string;
		readonly buffer?: Partial<Streaming.BufferConfig>;
	},
): HttpServerResponse.HttpServerResponse => {
	const serialize = config.serialize ?? ((a: A) => JSON.stringify(a));

	const formatResult = Match.value(config.format).pipe(
		Match.when('json', () => ({
			contentType: 'application/json',
			stream: Stream.concat(
				Stream.succeed(_encodeToBytes('[')),
				Stream.concat(
					stream.pipe(
						Stream.zipWithIndex,
						Stream.map(([a, idx]) => _encodeToBytes(idx === 0 ? serialize(a) : `,${serialize(a)}`)),
					),
					Stream.succeed(_encodeToBytes(']')),
				),
			),
		})),
		Match.when('ndjson', () => ({
			contentType: 'application/x-ndjson',
			stream: Stream.map(stream, (a) => _encodeToBytes(`${serialize(a)}\n`)),
		})),
		Match.when('csv', () => ({
			contentType: 'text/csv',
			stream: Stream.map(stream, (a) => _encodeToBytes(`${serialize(a)}\n`)),
		})),
		Match.exhaustive,
	);

	const bufferedStream = _applyBuffer(formatResult.stream, 'export', config.buffer);
	const escapedFilename = config.filename.replaceAll('"', '\\"');
	const headers = Headers.fromInput({
		'Content-Disposition': `attachment; filename="${escapedFilename}"`,
		'Content-Type': formatResult.contentType,
	});

	return HttpServerResponse.stream(bufferedStream, {
		contentType: formatResult.contentType,
		headers,
	});
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Streaming = { download, export_, response, sse } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Streaming {
	export type BufferStrategy = 'sliding' | 'suspend' | 'dropping';
	export type BufferConfig = { readonly capacity: number; readonly strategy: BufferStrategy };
	export type SseConfig<A, E> = Parameters<typeof sse<A, E>>[1];
	export type ResponseConfig = Parameters<typeof response>[1];
	export type DownloadConfig = Parameters<typeof download>[1];
	export type ExportFormat = 'json' | 'csv' | 'ndjson';
	export type ExportConfig<A> = Parameters<typeof export_<A, unknown>>[1];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Streaming };
