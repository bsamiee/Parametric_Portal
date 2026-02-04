/**
 * Unified streaming service: ingest, emit, sse, mailbox, state.
 * Format-aware encoding/decoding, circuit breaker integration, tenant-scoped metrics.
 */
/** biome-ignore-all assist/source/useSortedKeys: <_formats table organization lock> */
import { Headers, HttpServerResponse, MsgPack, Multipart, Ndjson } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Chunk, Duration, Effect, type HashSet, Mailbox, Match, type Metric, type MetricLabel, Option, pipe, Predicate, type PubSub, Schedule, Stream, Subscribable, SubscriptionRef } from 'effect';
import type { Scope } from 'effect/Scope';
import type { DurationInput } from 'effect/Duration';
import { Context } from '../context.ts';
import { ClusterService } from '../infra/cluster.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = { capacity: 64, capacityMedium: 128, capacityLarge: 256, heartbeat: 30, fieldSize: 1 << 20, fileSize: 10 << 20, maxParts: 100 } as const;
const _formats = {
	binary:    	 { capacity: _CONFIG.capacityLarge,  extension: 'bin',     ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/octet-stream' 	},
	csv:       	 { capacity: _CONFIG.capacityMedium, extension: 'csv',     ingest: false, emit: true,  strategy: 'suspend', contentType: 'text/csv'                  },
	json:      	 { capacity: _CONFIG.capacityMedium, extension: 'json',    ingest: false, emit: true,  strategy: 'suspend', contentType: 'application/json'          },
	msgpack:   	 { capacity: _CONFIG.capacityLarge,  extension: 'msgpack', ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/msgpack'       },
	multipart: 	 { capacity: _CONFIG.capacity,       extension: 'bin',     ingest: true,  emit: false, strategy: 'suspend', contentType: 'multipart/form-data'       },
	ndjson:    	 { capacity: _CONFIG.capacityMedium, extension: 'ndjson',  ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/x-ndjson'      },
	sse:       	 { capacity: _CONFIG.capacity,       extension: 'sse',     ingest: true,  emit: true,  strategy: 'sliding', contentType: 'text/event-stream'         },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _inc = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (metrics: MetricsService) => Metric.Metric.Counter<number>, count = 1) => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(selector(metrics), labels, count) }));
const _gauge = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (metrics: MetricsService) => Metric.Metric.Gauge<number>, delta: number) => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.gauge(selector(metrics), labels, delta) }));
const _heartbeat = (seconds: number) => Stream.tick(Duration.seconds(seconds)).pipe(Stream.map(() => ': heartbeat\n\n'), Stream.encodeText);
const _withMetrics = <A, E>(labels: HashSet.HashSet<MetricLabel.MetricLabel>, name: string, format: string) => (stream: Stream.Stream<A, E>) =>
	stream.pipe(
		Stream.onStart(_gauge(labels, (metrics) => metrics.stream.active, 1)),
		Stream.onEnd(_gauge(labels, (metrics) => metrics.stream.active, -1)),
		Stream.tapError((error) => _inc(labels, (metrics) => metrics.stream.errors).pipe(Effect.tap(() => Effect.logWarning('Stream error', { error, format, stream: name })))),
	);
const _labels = (direction: string, format: string, name: string, tenantId: string) => MetricsService.label({ direction, format, stream: name, tenant: tenantId });

// --- [SERVICES] --------------------------------------------------------------

class StreamingService extends Effect.Service<StreamingService>()('server/StreamingService', {
	dependencies: [ClusterService.Layer, Resilience.Layer],
	succeed: {},
}) {
	static readonly sse = <A, E>(config: {					// SSE response - handles 90% case with minimal config. Built-in heartbeat, error→SSE, tenant metrics.
		readonly source: Stream.Stream<A, E, never>;
		readonly serialize: (item: A) => { data: string; event?: string; id?: string };
		readonly name: string;
		readonly filter?: (item: A) => boolean;
		readonly onError?: (error: E) => { data: string; event?: string };
		readonly heartbeat?: number;}): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('sse', 'sse', config.name, tenantId);
			const onError = config.onError ?? ((error: E) => ({ data: JSON.stringify({ error: String(error) }), event: 'error' }));
			const filter = config.filter;
			const encode = (envelope: { data: string; event?: string; id?: string }) => Sse.encoder.write({ _tag: 'Event', data: envelope.data, event: envelope.event ?? 'message', id: envelope.id });
			const events = config.source.pipe(
				(stream) => filter ? Stream.filter(stream, filter) : stream,
				Stream.map((item) => encode(config.serialize(item))),
				Stream.catchAll((error) => Stream.make(encode(onError(error)))),
				Stream.encodeText,
			);
			const body = Stream.merge(events, _heartbeat(config.heartbeat ?? _CONFIG.heartbeat), { haltStrategy: 'left' }).pipe(
				Stream.buffer({ capacity: _CONFIG.capacity, strategy: 'sliding' }),
				_withMetrics(labels, config.name, 'sse'),
				Stream.tap(() => _inc(labels, (metrics) => metrics.stream.elements)),
			);
			return HttpServerResponse.stream(body, { contentType: 'text/event-stream', headers: Headers.fromInput({ 'Cache-Control': 'no-cache', Connection: 'keep-alive' }) });
		});
	static readonly ingest = <E>(config: {	// Pull-based ingestion from ReadableStream or AsyncIterable with format decoding, circuit breaker, retry
		readonly format?: StreamingService.Ingest;
		readonly headers?: Record<string, string>;
		readonly limits?: Multipart.withLimits.Options;
		readonly name: string;
		readonly source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
		readonly throttle?: { readonly units: number; readonly duration: DurationInput; readonly burst?: number };
		readonly debounce?: DurationInput;
		readonly retry?: { readonly times: number; readonly base: DurationInput };}): Effect.Effect<Stream.Stream<unknown, E | Error | Multipart.MultipartError | MsgPack.MsgPackError, never>, Resilience.Error<never>, StreamingService | Resilience.State> =>
		Resilience.run(`streaming.ingest.${config.name}`, Effect.gen(function* () {
			const format = config.format ?? 'binary';
			const formatConfig = _formats[format];
			const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('ingest', format, config.name, tenantId);
			const throttle = config.throttle, debounce = config.debounce;
			const raw = ('getReader' in config.source
				? Stream.fromReadableStream({ evaluate: () => config.source as ReadableStream<Uint8Array>, onError: (error) => error as E | Error })
				: Stream.fromAsyncIterable(config.source, (error) => error as E | Error)
			).pipe(
				(stream) => throttle ? Stream.throttle(stream, { cost: Chunk.size, units: throttle.units, duration: throttle.duration, burst: throttle.burst }) : stream,
				(stream) => debounce ? Stream.debounce(stream, debounce) : stream,
			);
			const decoded = Match.value(format).pipe(
				Match.when('multipart', () => pipe(raw, Stream.pipeThroughChannel(Multipart.makeChannel<E | Error>(config.headers ?? {})), Multipart.withLimitsStream(config.limits ?? { maxParts: Option.some(_CONFIG.maxParts), maxFieldSize: _CONFIG.fieldSize, maxFileSize: Option.some(_CONFIG.fileSize) }))),
				Match.when('msgpack', () => pipe(raw, Stream.pipeThroughChannel(MsgPack.unpack()))),
				Match.when('sse', () => pipe(raw, Stream.decodeText('utf-8'), Stream.pipeThroughChannel(Sse.makeChannel<E | Error, unknown>()))),
				Match.when('ndjson', () => pipe(raw, Stream.pipeThroughChannel(Ndjson.unpack())) as unknown as Stream.Stream<Sse.Event | Uint8Array, E | Error, never>),
				Match.when('binary', () => raw),
				Match.exhaustive,
			);
			const metricTap = (item: unknown) => format === 'binary' ? _inc(labels, (metrics) => metrics.stream.bytes, (item as Uint8Array).length) : _inc(labels, (metrics) => metrics.stream.elements);
			const retry = config.retry;
			return decoded.pipe(
				(stream) => retry ? Stream.retry(stream, Schedule.exponential(retry.base).pipe(Schedule.intersect(Schedule.recurs(retry.times)))) : stream,
				Stream.buffer({ capacity: formatConfig.capacity, strategy: formatConfig.strategy }),
				_withMetrics(labels, config.name, format),
				Stream.tap(metricTap),
			);
		}), { circuit: config.name, retry: false, timeout: false });
	static readonly emit = <A, E>(config: {	// Emit stream as HTTP response with format encoding, dedupe, batching, throttle
		readonly filename?: string;
		readonly format: StreamingService.Emit;
		readonly name: string;
		readonly serialize?: (item: A) => string;
		readonly sseSerialize?: (item: A) => Sse.EventEncoded;
		readonly stream: Stream.Stream<A, E, never>;
		readonly throttle?: { readonly units: number; readonly duration: DurationInput; readonly burst?: number };
		readonly debounce?: DurationInput;
		readonly batch?: { readonly size: number; readonly duration: DurationInput };
		readonly dedupe?: boolean | ((current: A, previous: A) => boolean);}): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const formatConfig = _formats[config.format];
			const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('emit', config.format, config.name, tenantId);
			const serialize = config.serialize ?? ((item: A) => JSON.stringify(item));
			const sseSerialize = config.sseSerialize ?? ((item: A): Sse.EventEncoded => ({ data: serialize(item), event: 'message', id: undefined }));
			const dedupe = Match.value(config.dedupe).pipe(
				Match.when(true, () => Stream.changes),
				Match.when(Predicate.isFunction, (comparator) => Stream.changesWith(comparator)),
				Match.orElse(() => <Source>(stream: Source) => stream),
			);
			const batch = config.batch, throttle = config.throttle, debounce = config.debounce;
			const processed: Stream.Stream<A, E, never> = config.stream.pipe(
				dedupe,
				(stream: Stream.Stream<A, E, never>) => batch ? Stream.flattenChunks(Stream.groupedWithin(stream, batch.size, batch.duration)) : stream,
				(stream: Stream.Stream<A, E, never>) => throttle ? Stream.throttle(stream, { cost: Chunk.size, units: throttle.units, duration: throttle.duration, burst: throttle.burst }) : stream,
				(stream: Stream.Stream<A, E, never>) => debounce ? Stream.debounce(stream, debounce) : stream,
				Stream.tap(() => _inc(labels, (metrics) => metrics.stream.elements)),
			);
			const _encode: Record<StreamingService.Emit, () => Stream.Stream<Uint8Array, E | MsgPack.MsgPackError, never>> = {
				binary: () => processed as unknown as Stream.Stream<Uint8Array, E, never>,
				msgpack: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(MsgPack.pack())),
				json: () => pipe(Stream.make('['), Stream.concat(pipe(processed, Stream.zipWithIndex, Stream.map(([item, index]) => index === 0 ? serialize(item) : `,${serialize(item)}`))), Stream.concat(Stream.make(']')), Stream.encodeText),
				ndjson: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(Ndjson.pack())) as unknown as Stream.Stream<Uint8Array, E, never>,
				csv: () => pipe(processed, Stream.map((item) => serialize(item)), Stream.intersperse('\n'), Stream.encodeText),
				sse: () => Stream.merge(pipe(processed, Stream.map((item) => Sse.encoder.write({ _tag: 'Event', data: sseSerialize(item).data, event: sseSerialize(item).event ?? 'message', id: sseSerialize(item).id })), Stream.encodeText), _heartbeat(_CONFIG.heartbeat), { haltStrategy: 'left' }),
			};
			const encoded = _encode[config.format]();
			const filename = (config.filename ?? `${config.name}.${formatConfig.extension}`).replaceAll('"', String.raw`\"`);
			const headers = config.format === 'sse' ? { 'Cache-Control': 'no-cache', Connection: 'keep-alive' } : { 'Content-Disposition': `attachment; filename="${filename}"` };
			return HttpServerResponse.stream(encoded.pipe(Stream.buffer({ capacity: formatConfig.capacity, strategy: formatConfig.strategy }), _withMetrics(labels, config.name, config.format), Stream.tap((chunk) => _inc(labels, (metrics) => metrics.stream.bytes, chunk.length)), Stream.ensuring(Effect.logDebug('Stream closed', { direction: 'emit', format: config.format, stream: config.name, tenant: tenantId }))), { contentType: formatConfig.contentType, headers: Headers.fromInput(headers) });
		});
	static readonly mailbox = <A, E = never>(config?: {	// Unified mailbox: writable (push) or from-stream/pubsub/subscribable (pull)
		readonly from?: Stream.Stream<A, E, never> | PubSub.PubSub<A> | Subscribable.Subscribable<A, E, never>;
		readonly name?: string;
		readonly capacity?: number;
		readonly strategy?: 'suspend' | 'dropping' | 'sliding';}): Effect.Effect<Mailbox.Mailbox<A, E> | Mailbox.ReadonlyMailbox<A, E>, never, Scope> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('mailbox', 'push', config?.name ?? 'anonymous', tenantId);
			const bufferCapacity = config?.capacity ?? _CONFIG.capacity << 1, strategy = config?.strategy;
			const mailbox = yield* Match.value(config?.from).pipe(
				Match.when(Match.undefined, () => Mailbox.make<A, E>({ capacity: bufferCapacity, strategy })),
				Match.when(Subscribable.isSubscribable, (subscribable) => Mailbox.fromStream(subscribable.changes, { capacity: bufferCapacity, strategy })),
				Match.when((source): source is PubSub.PubSub<A> => source != null && 'subscribe' in source, (hub) => Mailbox.fromStream(Stream.fromPubSub(hub), { capacity: bufferCapacity, strategy })),
				Match.orElse((stream) => Mailbox.fromStream(stream, { capacity: bufferCapacity, strategy })),
			);
			yield* _gauge(labels, (metrics) => metrics.stream.active, 1);
			yield* Effect.addFinalizer(() => _gauge(labels, (metrics) => metrics.stream.active, -1));
			return mailbox;
		});
	static readonly state = <A>(initial: A, config?: {	// Reactive state with SubscriptionRef - get/set/update + changes stream
		readonly name?: string }): Effect.Effect<StreamingService.State<A>, never, Scope> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('state', 'ref', config?.name ?? 'anonymous', tenantId);
			const ref = yield* SubscriptionRef.make(initial);
			yield* _gauge(labels, (metrics) => metrics.stream.active, 1);
			yield* Effect.addFinalizer(() => _gauge(labels, (metrics) => metrics.stream.active, -1));
			return {
				get: SubscriptionRef.get(ref),
				set: (value: A) => SubscriptionRef.set(ref, value).pipe(Effect.tap(_inc(labels, (metrics) => metrics.stream.elements))),
				update: (updater: (current: A) => A) => SubscriptionRef.update(ref, updater).pipe(Effect.tap(_inc(labels, (metrics) => metrics.stream.elements))),
				modify: <B>(modifier: (current: A) => readonly [B, A]) => SubscriptionRef.modify(ref, modifier).pipe(Effect.tap(_inc(labels, (metrics) => metrics.stream.elements))),
				changes: _withMetrics<A, never>(labels, config?.name ?? 'anonymous', 'ref')(ref.changes),
			};
		});
	static readonly toEventBus = <A>(	// Bridge stream to EventBus - maps stream elements to domain events
		stream: Stream.Stream<A>,
		mapToEvent: (a: A) => { aggregateId: string; eventType: string; payload: unknown; tenantId: string },
	) =>
		Effect.gen(function* () {
			const eventBus = yield* EventBus;
			yield* stream.pipe(
				Stream.mapEffect((item) => {
					const envelope = mapToEvent(item);
					return eventBus.emit(new EventBus.Event({ ...envelope, eventId: crypto.randomUUID() as typeof EventBus.Event.Type['eventId'] }));
				}),
				Stream.runDrain,
			);
		});
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StreamingService {
	export type Formats = typeof _formats;
	export type Ingest = { [K in keyof Formats]: Formats[K]['ingest'] extends true ? K : never }[keyof Formats];
	export type Emit = { [K in keyof Formats]: Formats[K]['emit'] extends true ? K : never }[keyof Formats];
	export interface State<A> {
		readonly get: Effect.Effect<A>;
		readonly set: (value: A) => Effect.Effect<void>;
		readonly update: (updater: (current: A) => A) => Effect.Effect<void>;
		readonly modify: <B>(modifier: (current: A) => readonly [B, A]) => Effect.Effect<B>;
		readonly changes: Stream.Stream<A, never, never>;
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { StreamingService };
