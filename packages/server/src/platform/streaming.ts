/**
 * Unified streaming service: ingest, emit, sse, channel, broadcast, mailbox.
 */
/** biome-ignore-all assist/source/useSortedKeys: <_formats table organization lock> */
import { Headers, HttpServerResponse, MsgPack, Multipart, Ndjson } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Chunk, Duration, Effect, Function as F, type HashSet, Mailbox, Match, type Metric, type MetricLabel, Option, pipe, PubSub, Schedule, Stream, Subscribable, SubscriptionRef } from 'effect';
import type { Scope } from 'effect/Scope';
import type { DurationInput } from 'effect/Duration';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _B = 		 { cap: 64, cap2: 128, cap4: 256, heartbeat: 30, fieldSize: 1 << 20, fileSize: 10 << 20, maxParts: 100 } as const;
const _formats = {
	binary:    	 { capacity: _B.cap4, ext: 'bin',     ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/octet-stream' 	},
	csv:       	 { capacity: _B.cap2, ext: 'csv',     ingest: false, emit: true,  strategy: 'suspend', contentType: 'text/csv'                  },
	json:      	 { capacity: _B.cap2, ext: 'json',    ingest: false, emit: true,  strategy: 'suspend', contentType: 'application/json'          },
	msgpack:   	 { capacity: _B.cap4, ext: 'msgpack', ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/msgpack'       },
	multipart: 	 { capacity: _B.cap,  ext: 'bin',     ingest: true,  emit: false, strategy: 'suspend', contentType: 'multipart/form-data'       },
	ndjson:    	 { capacity: _B.cap2, ext: 'ndjson',  ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/x-ndjson'      },
	sse:       	 { capacity: _B.cap,  ext: 'sse',     ingest: true,  emit: true,  strategy: 'sliding', contentType: 'text/event-stream'         },
} as const;
const _channels = new Map<string, { hub: PubSub.PubSub<unknown>; refs: number }>();
const _channelSem = Effect.runSync(Effect.makeSemaphore(1));

// --- [FUNCTIONS] -------------------------------------------------------------

const _inc = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (m: MetricsService) => Metric.Metric.Counter<number>, n = 1) =>
	Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (m) => MetricsService.inc(selector(m), labels, n) }));
const _gauge = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (m: MetricsService) => Metric.Metric.Gauge<number>, delta: number) =>
	Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({ onNone: () => Effect.void, onSome: (m) => MetricsService.gauge(selector(m), labels, delta) }));
const _heartbeat = (seconds: number) => Stream.tick(Duration.seconds(seconds)).pipe(Stream.map(() => ': heartbeat\n\n'), Stream.encodeText);
const _withMetrics = <A, E>(labels: HashSet.HashSet<MetricLabel.MetricLabel>, name: string, format: string) => (stream: Stream.Stream<A, E>) =>
	stream.pipe(
		Stream.onStart(_gauge(labels, (m) => m.stream.active, 1)),
		Stream.onEnd(_gauge(labels, (m) => m.stream.active, -1)),
		Stream.tapError((err) => _inc(labels, (m) => m.stream.errors).pipe(Effect.tap(() => Effect.logWarning('Stream error', { error: err, format, stream: name })))),
	);
const _labels = (direction: string, format: string, name: string, tenantId: string) => MetricsService.label({ direction, format, stream: name, tenant: tenantId });

// --- [SERVICES] --------------------------------------------------------------

class StreamingService extends Effect.Service<StreamingService>()('server/StreamingService', { effect: Effect.succeed({}) }) {
	static readonly sse = <A, E>(config: {					// SSE response - handles 90% case with minimal config. Built-in heartbeat, error→SSE, tenant metrics.
		readonly source: Stream.Stream<A, E, never>;
		readonly serialize: (a: A) => { data: string; event?: string; id?: string };
		readonly name: string;
		readonly filter?: (a: A) => boolean;
		readonly onError?: (e: E) => { data: string; event?: string };
		readonly heartbeat?: number;}): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('sse', 'sse', config.name, tenantId);
			const onError = config.onError ?? ((e: E) => ({ data: JSON.stringify({ error: String(e) }), event: 'error' }));
			const filter = config.filter;
			const encode = (e: { data: string; event?: string; id?: string }) => Sse.encoder.write({ _tag: 'Event', data: e.data, event: e.event ?? 'message', id: e.id });
			const events = config.source.pipe(
				filter ? Stream.filter((a: A) => filter(a)) : F.identity,
				Stream.map((a) => encode(config.serialize(a))),
				Stream.catchAll((e) => Stream.make(encode(onError(e)))),
				Stream.encodeText,
			);
			const body = Stream.merge(events, _heartbeat(config.heartbeat ?? _B.heartbeat), { haltStrategy: 'left' }).pipe(
				Stream.buffer({ capacity: _B.cap, strategy: 'sliding' }),
				_withMetrics(labels, config.name, 'sse'),
				Stream.tap(() => _inc(labels, (m) => m.stream.elements)),
			);
			return HttpServerResponse.stream(body, { contentType: 'text/event-stream', headers: Headers.fromInput({ 'Cache-Control': 'no-cache', Connection: 'keep-alive' }) });
		});
	static readonly channel = <A>(name: string, config?: {	// Tenant-scoped pub/sub channel - lazy creation, shared across routes.
		readonly capacity?: number }): Effect.Effect<StreamingService.Channel<A>, never, Scope> =>
		_channelSem.withPermits(1)(Effect.gen(function* () {
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const key = `${tenantId}:${name}`;
			const labels = _labels('channel', 'pubsub', name, tenantId);
			const entry = Option.fromNullable(_channels.get(key));
			const hub = yield* Option.match(entry, {
				onNone: () => PubSub.sliding<A>(config?.capacity ?? _B.cap4).pipe(Effect.tap((h) => _channels.set(key, { hub: h as PubSub.PubSub<unknown>, refs: 1 }))),
				onSome: (e) => Effect.sync(() => { _channels.set(key, { hub: e.hub, refs: e.refs + 1 }); return e.hub as PubSub.PubSub<A>; }),
			});
			yield* _gauge(labels, (m) => m.stream.active, 1);
			yield* Effect.addFinalizer(() => Effect.gen(function* () {
				yield* pipe(
					Option.fromNullable(_channels.get(key)),
					Option.match({
						onNone: () => Effect.void,
						onSome: (e) => { const next = e.refs - 1; _channels.set(key, { hub: e.hub, refs: next }); return next <= 0 ? PubSub.shutdown(e.hub).pipe(Effect.tap(() => _channels.delete(key))) : Effect.void; },
					}),
				);
				yield* _gauge(labels, (m) => m.stream.active, -1);
			}));
			const stream = yield* Stream.fromPubSub(hub, { scoped: true });
			return {
				publish: (a: A) => PubSub.publish(hub, a).pipe(Effect.tap(() => _inc(labels, (m) => m.stream.elements)), Effect.asVoid),
				subscribe: _withMetrics<A, never>(labels, name, 'pubsub')(stream),
				shutdown: pipe(
					Option.fromNullable(_channels.get(key)),
					Option.match({
						onNone: () => Effect.void,
						onSome: (e) => PubSub.shutdown(e.hub).pipe(Effect.tap(() => _channels.delete(key))),
					}),
				),
				keys: Effect.sync(() => [..._channels.keys()]),
			};
		}));
	static readonly ingest = <E>(config: {	// Pull-based ingestion from ReadableStream or AsyncIterable with format decoding, circuit breaker, retry
		readonly format?: StreamingService.Ingest;
		readonly headers?: Record<string, string>;
		readonly limits?: Multipart.withLimits.Options;
		readonly name: string;
		readonly source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
		readonly throttle?: { readonly units: number; readonly duration: DurationInput; readonly burst?: number };
		readonly debounce?: DurationInput;
		readonly retry?: { readonly times: number; readonly base: DurationInput };}): Effect.Effect<Stream.Stream<unknown, E | Error | Multipart.MultipartError | MsgPack.MsgPackError, never>, Resilience.Error<never>, StreamingService> =>
		Resilience.run(`streaming.ingest.${config.name}`, Effect.gen(function* () {
			const format = config.format ?? 'binary';
			const cfg = _formats[format];
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('ingest', format, config.name, tenantId);
			const raw = ('getReader' in config.source
				? Stream.fromReadableStream({ evaluate: () => config.source as ReadableStream<Uint8Array>, onError: (e) => e as E | Error })
				: Stream.fromAsyncIterable(config.source, (e) => e as E | Error)
			).pipe(
				config.throttle ? Stream.throttle({ cost: Chunk.size, units: config.throttle.units, duration: config.throttle.duration, burst: config.throttle.burst }) : F.identity,
				config.debounce ? Stream.debounce(config.debounce) : F.identity,
			);
			const decoded = Match.value(format).pipe(
				Match.when('multipart', () => pipe(raw, Stream.pipeThroughChannel(Multipart.makeChannel<E | Error>(config.headers ?? {})), Multipart.withLimitsStream(config.limits ?? { maxParts: Option.some(_B.maxParts), maxFieldSize: _B.fieldSize, maxFileSize: Option.some(_B.fileSize) }))),
				Match.when('msgpack', () => pipe(raw, Stream.pipeThroughChannel(MsgPack.unpack()))),
				Match.when('sse', () => pipe(raw, Stream.decodeText('utf-8'), Stream.pipeThroughChannel(Sse.makeChannel<E | Error, unknown>()))),
				Match.when('ndjson', () => pipe(raw, Stream.pipeThroughChannel(Ndjson.unpack())) as unknown as Stream.Stream<Sse.Event | Uint8Array, E | Error, never>),
				Match.when('binary', () => raw),
				Match.exhaustive,
			);
			const metricTap = (item: unknown) => format === 'binary' ? _inc(labels, (m) => m.stream.bytes, (item as Uint8Array).length) : _inc(labels, (m) => m.stream.elements);
			return decoded.pipe(
				config.retry ? Stream.retry(Schedule.exponential(config.retry.base).pipe(Schedule.intersect(Schedule.recurs(config.retry.times)))) : F.identity,
				Stream.buffer({ capacity: cfg.capacity, strategy: cfg.strategy }),
				_withMetrics(labels, config.name, format),
				Stream.tap(metricTap),
			);
		}), { circuit: config.name, retry: false, timeout: false });
	static readonly emit = <A, E>(config: {	// Emit stream as HTTP response with format encoding, dedupe, batching, throttle
		readonly filename?: string;
		readonly format: StreamingService.Emit;
		readonly name: string;
		readonly serialize?: (a: A) => string;
		readonly sseSerialize?: (a: A) => Sse.EventEncoded;
		readonly stream: Stream.Stream<A, E, never>;
		readonly throttle?: { readonly units: number; readonly duration: DurationInput; readonly burst?: number };
		readonly debounce?: DurationInput;
		readonly batch?: { readonly size: number; readonly duration: DurationInput };
		readonly dedupe?: boolean | ((a: A, b: A) => boolean);}): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
		Effect.gen(function* () {
			const cfg = _formats[config.format];
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('emit', config.format, config.name, tenantId);
			const serialize = config.serialize ?? ((a: A) => JSON.stringify(a));
			const sseSerialize = config.sseSerialize ?? ((a: A): Sse.EventEncoded => ({ data: serialize(a), event: 'message', id: undefined }));
			const dedupe = config.dedupe === true ? Stream.changes : typeof config.dedupe === 'function' ? Stream.changesWith(config.dedupe) : F.identity;
			const batch = config.batch;
			const processed = config.stream.pipe(
				dedupe,
				batch ? (s: Stream.Stream<A, E, never>) => s.pipe(Stream.groupedWithin(batch.size, batch.duration), Stream.flattenChunks) : F.identity,
				config.throttle ? Stream.throttle({ cost: Chunk.size, units: config.throttle.units, duration: config.throttle.duration, burst: config.throttle.burst }) : F.identity,
				config.debounce ? Stream.debounce(config.debounce) : F.identity,
				Stream.tap(() => _inc(labels, (m) => m.stream.elements)),
			);
			const _encode: Record<StreamingService.Emit, () => Stream.Stream<Uint8Array, E | MsgPack.MsgPackError, never>> = {
				binary: () => processed as unknown as Stream.Stream<Uint8Array, E, never>,
				msgpack: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(MsgPack.pack())),
				json: () => pipe(Stream.make('['), Stream.concat(pipe(processed, Stream.zipWithIndex, Stream.map(([a, i]) => i === 0 ? serialize(a) : `,${serialize(a)}`))), Stream.concat(Stream.make(']')), Stream.encodeText),
				ndjson: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(Ndjson.pack())) as unknown as Stream.Stream<Uint8Array, E, never>,
				csv: () => pipe(processed, Stream.map((a) => serialize(a)), Stream.intersperse('\n'), Stream.encodeText),
				sse: () => Stream.merge(pipe(processed, Stream.map((a) => Sse.encoder.write({ _tag: 'Event', data: sseSerialize(a).data, event: sseSerialize(a).event ?? 'message', id: sseSerialize(a).id })), Stream.encodeText), _heartbeat(_B.heartbeat), { haltStrategy: 'left' }),
			};
			const encoded = _encode[config.format]();
			const filename = (config.filename ?? `${config.name}.${cfg.ext}`).replaceAll('"', String.raw`\"`);
			const headers = config.format === 'sse' ? { 'Cache-Control': 'no-cache', Connection: 'keep-alive' } : { 'Content-Disposition': `attachment; filename="${filename}"` };
			return HttpServerResponse.stream(encoded.pipe(Stream.buffer({ capacity: cfg.capacity, strategy: cfg.strategy }), _withMetrics(labels, config.name, config.format), Stream.tap((chunk) => _inc(labels, (m) => m.stream.bytes, chunk.length)), Stream.ensuring(Effect.logDebug('Stream closed', { direction: 'emit', format: config.format, stream: config.name, tenant: tenantId }))), { contentType: cfg.contentType, headers: Headers.fromInput(headers) });
		});
	static readonly broadcast = <A, E>(config: {	// Unified broadcast for fan-out - mode inferred: subscribers=1 → share, undefined → broadcastDynamic, N → broadcast(N)
		readonly source: Stream.Stream<A, E, never> | Subscribable.Subscribable<A, E, never>;
		readonly name?: string;
		readonly subscribers?: number;
		readonly capacity?: number | 'unbounded';
		readonly strategy?: 'suspend' | 'dropping' | 'sliding';
		readonly replay?: number;
		readonly idleTimeToLive?: DurationInput;}): Effect.Effect<Stream.Stream<A, E> | ReadonlyArray<Stream.Stream<A, E>>, never, Scope> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('broadcast', 'fanout', config.name ?? 'anonymous', tenantId);
			const cap = { capacity: config.capacity ?? _B.cap4, strategy: config.strategy, replay: config.replay };
			const stream = Subscribable.isSubscribable(config.source) ? config.source.changes : config.source;
			const withMetrics = <T extends Stream.Stream<A, E>>(s: T) => _withMetrics<A, E>(labels, config.name ?? 'anonymous', 'fanout')(s) as T;
			const raw = yield* Match.value(config.subscribers).pipe(
				Match.when(1, () => stream.pipe(Stream.share({ ...cap, idleTimeToLive: config.idleTimeToLive }))),
				Match.when(Match.undefined, () => stream.pipe(Stream.broadcastDynamic(cap))),
				Match.orElse((n) => stream.pipe(Stream.broadcast(n, cap))),
			);
			return Match.value(raw).pipe(
				Match.when(Array.isArray, (arr) => arr.map((s) => withMetrics(s))),
				Match.orElse((s) => withMetrics(s)),
			);
		});
	static readonly mailbox = <A, E = never>(config?: {	// Unified mailbox: writable (push) or from-stream/pubsub/subscribable (pull)
		readonly from?: Stream.Stream<A, E, never> | PubSub.PubSub<A> | Subscribable.Subscribable<A, E, never>;
		readonly name?: string;
		readonly capacity?: number;
		readonly strategy?: 'suspend' | 'dropping' | 'sliding';}): Effect.Effect<Mailbox.Mailbox<A, E> | Mailbox.ReadonlyMailbox<A, E>, never, Scope> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('mailbox', 'push', config?.name ?? 'anonymous', tenantId);
			const cap = config?.capacity ?? _B.cap << 1, strategy = config?.strategy;
			const mailbox = yield* Match.value(config?.from).pipe(
				Match.when(Match.undefined, () => Mailbox.make<A, E>({ capacity: cap, strategy })),
				Match.when(Subscribable.isSubscribable, (sub) => Mailbox.fromStream(sub.changes, { capacity: cap, strategy })),
				Match.when((f): f is PubSub.PubSub<A> => f != null && 'subscribe' in f, (hub) => Mailbox.fromStream(Stream.fromPubSub(hub), { capacity: cap, strategy })),
				Match.orElse((stream) => Mailbox.fromStream(stream, { capacity: cap, strategy })),
			);
			yield* _gauge(labels, (m) => m.stream.active, 1);
			yield* Effect.addFinalizer(() => _gauge(labels, (m) => m.stream.active, -1));
			return mailbox;
		});
	static readonly state = <A>(initial: A, config?: {	// Reactive state with SubscriptionRef - get/set/update + changes stream
		readonly name?: string }): Effect.Effect<StreamingService.State<A>, never, Scope> =>
		Effect.gen(function* () {
			const tenantId = yield* Context.Request.tenantId.pipe(Effect.orElseSucceed(() => 'system'));
			const labels = _labels('state', 'ref', config?.name ?? 'anonymous', tenantId);
			const ref = yield* SubscriptionRef.make(initial);
			yield* _gauge(labels, (m) => m.stream.active, 1);
			yield* Effect.addFinalizer(() => _gauge(labels, (m) => m.stream.active, -1));
			return {
				get: SubscriptionRef.get(ref),
				set: (a: A) => SubscriptionRef.set(ref, a).pipe(Effect.tap(() => _inc(labels, (m) => m.stream.elements))),
				update: (f: (a: A) => A) => SubscriptionRef.update(ref, f).pipe(Effect.tap(() => _inc(labels, (m) => m.stream.elements))),
				modify: <B>(f: (a: A) => readonly [B, A]) => SubscriptionRef.modify(ref, f).pipe(Effect.tap(() => _inc(labels, (m) => m.stream.elements))),
				changes: _withMetrics<A, never>(labels, config?.name ?? 'anonymous', 'ref')(ref.changes),
			};
		});
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StreamingService {
	export type Formats = typeof _formats;
	export type Ingest = { [K in keyof Formats]: Formats[K]['ingest'] extends true ? K : never }[keyof Formats];
	export type Emit = { [K in keyof Formats]: Formats[K]['emit'] extends true ? K : never }[keyof Formats];
	export interface Channel<A> {
		readonly publish: (a: A) => Effect.Effect<void>;
		readonly subscribe: Stream.Stream<A, never, never>;
		readonly shutdown: Effect.Effect<void>;
		readonly keys: Effect.Effect<ReadonlyArray<string>>;
	}
	export interface State<A> {
		readonly get: Effect.Effect<A>;
		readonly set: (a: A) => Effect.Effect<void>;
		readonly update: (f: (a: A) => A) => Effect.Effect<void>;
		readonly modify: <B>(f: (a: A) => readonly [B, A]) => Effect.Effect<B>;
		readonly changes: Stream.Stream<A, never, never>;
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { StreamingService };
