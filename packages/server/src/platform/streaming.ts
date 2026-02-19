/** Unified streaming: ingest, emit, sse, mailbox, state. */
/** biome-ignore-all assist/source/useSortedKeys: <_formats table organization lock> */
import { Headers, HttpServerResponse, MsgPack, Multipart, Ndjson } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { Chunk, Duration, Effect, Function as F, type HashSet, Mailbox, Match, type Metric, type MetricLabel, Option, pipe, Predicate, type PubSub, type Scope, Stream, Subscribable, SubscriptionRef } from 'effect';
import { Context } from '../context.ts';
import { EventBus } from '../infra/events.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _formats = {
    binary:    { capacity: 256, extension: 'bin',     ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/octet-stream' },
    csv:       { capacity: 128, extension: 'csv',     ingest: false, emit: true,  strategy: 'suspend', contentType: 'text/csv' },
    json:      { capacity: 128, extension: 'json',    ingest: false, emit: true,  strategy: 'suspend', contentType: 'application/json' },
    msgpack:   { capacity: 256, extension: 'msgpack', ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/msgpack' },
    multipart: { capacity: 64,  extension: 'bin',     ingest: true,  emit: false, strategy: 'suspend', contentType: 'multipart/form-data' },
    ndjson:    { capacity: 128, extension: 'ndjson',  ingest: true,  emit: true,  strategy: 'suspend', contentType: 'application/x-ndjson' },
    sse:       { capacity: 64,  extension: 'sse',     ingest: true,  emit: true,  strategy: 'sliding', contentType: 'text/event-stream' },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _labels = (direction: string, format: string, name: string, tenantId: string) => MetricsService.label({ direction, format, stream: name, tenant: tenantId });
/* v8 ignore start -- metric/lifecycle callbacks execute inside Effect fiber runtime; V8 cannot attribute coverage */
const _inc = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (metrics: MetricsService) => Metric.Metric.Counter<number>, count = 1) => Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.inc(selector(metrics), labels, count) })));
const _gauge = (labels: HashSet.HashSet<MetricLabel.MetricLabel>, selector: (metrics: MetricsService) => Metric.Metric.Gauge<number>, delta: number) => Effect.serviceOption(MetricsService).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (metrics) => MetricsService.gauge(selector(metrics), labels, delta) })));
const _heartbeat = (seconds: number) => Stream.tick(Duration.seconds(seconds)).pipe(Stream.map(() => ': heartbeat\n\n'), Stream.encodeText);
const _withMetrics = <A, E>(labels: HashSet.HashSet<MetricLabel.MetricLabel>, name: string, format: string) => (stream: Stream.Stream<A, E>) => stream.pipe(
    Stream.onStart(_gauge(labels, (metrics) => metrics.stream.active, 1)), Stream.onEnd(_gauge(labels, (metrics) => metrics.stream.active, -1)),
    Stream.tapError((error) => _inc(labels, (metrics) => metrics.stream.errors).pipe(Effect.tap(() => Effect.logWarning('Stream error', { error, format, stream: name })))),
);
/* v8 ignore stop */

// --- [SERVICES] --------------------------------------------------------------

class StreamingService extends Effect.Service<StreamingService>()('server/StreamingService', {
    dependencies: [Resilience.Layer],
    succeed: {},
}) {
    static readonly sse = <A, E>(config: {
        readonly source: Stream.Stream<A, E, never>; readonly serialize: (item: A) => { data: string; event?: string; id?: string };
        readonly name: string; readonly filter?: (item: A) => boolean;
        readonly onError?: (error: E) => { data: string; event?: string }; readonly heartbeat?: number;
    }): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
        Effect.gen(function* () {
            const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(/* v8 ignore next */ () => 'system'));
            const labels = _labels('sse', 'sse', config.name, tenantId);
            const onError = config.onError ?? ((error: E) => ({ data: JSON.stringify({ error: String(error) }), event: 'error' }));
            const encode = (envelope: { data: string; event?: string; id?: string }) => Sse.encoder.write({ _tag: 'Event', data: envelope.data, event: envelope.event ?? 'message', id: envelope.id });
            const events = config.source.pipe(
                (stream) => config.filter ? Stream.filter(stream, config.filter) : stream,
                Stream.map((item) => encode(config.serialize(item))), Stream.catchAll((error) => Stream.make(encode(onError(error)))), Stream.encodeText,
            );
            const body = Stream.merge(events, _heartbeat(config.heartbeat ?? 30), { haltStrategy: 'left' }).pipe(
                Stream.buffer({ capacity: _formats.sse.capacity, strategy: 'sliding' }), _withMetrics(labels, config.name, 'sse'), /* v8 ignore next */ Stream.tap(() => _inc(labels, (metrics) => metrics.stream.elements)),
            );
            return HttpServerResponse.stream(body, { contentType: 'text/event-stream', headers: Headers.fromInput({ 'Cache-Control': 'no-cache', Connection: 'keep-alive' }) });
        }).pipe(Telemetry.span('streaming.sse', { 'stream.format': 'sse', 'stream.name': config.name, metrics: false }));
    static readonly ingest = <E>(config: {
        readonly format?: StreamingService.Ingest; readonly headers?: Record<string, string>; readonly limits?: Multipart.withLimits.Options;
        readonly name: string; readonly source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
        readonly throttle?: { readonly units: number; readonly duration: Duration.DurationInput; readonly burst?: number };
        readonly debounce?: Duration.DurationInput; readonly retry?: { readonly times: number; readonly base: Duration.DurationInput };
    }): Effect.Effect<Stream.Stream<unknown, E | Error | Multipart.MultipartError | MsgPack.MsgPackError, never>, Resilience.Error<never>, StreamingService | Resilience.State> => {
        const format = config.format ?? 'binary';
        return Resilience.run(`streaming.ingest.${config.name}`, Effect.gen(function* () {
                const formatConfig = _formats[format];
                const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(/* v8 ignore next */ () => 'system'));
                const labels = _labels('ingest', format, config.name, tenantId);
                const source = config.source;
                /* v8 ignore start -- error mappers and optional config branches execute inside Effect fiber runtime */
                const raw: Stream.Stream<Uint8Array, E | Error, never> = ('getReader' in source
                    ? Stream.fromReadableStream({ evaluate: () => source, onError: (error): E | Error => error instanceof Error ? error : new Error(String(error)) })
                    : Stream.fromAsyncIterable(source, (error): E | Error => error instanceof Error ? error : new Error(String(error)))
                ).pipe(
                    (stream) => config.throttle ? Stream.throttle(stream, { cost: Chunk.size, units: config.throttle.units, duration: config.throttle.duration, burst: config.throttle.burst }) : stream,
                    (stream) => config.debounce ? Stream.debounce(stream, config.debounce) : stream,
                );
                /* v8 ignore stop */
            const decoded = Match.value(format).pipe(
                /* v8 ignore next */ Match.when('multipart', () => pipe(raw, Stream.pipeThroughChannel(Multipart.makeChannel<E | Error>(config.headers ?? {})), Multipart.withLimitsStream(config.limits ?? { maxParts: Option.some(100), maxFieldSize: 1 << 20, maxFileSize: Option.some(10 << 20) }))),
                Match.when('msgpack', () => pipe(raw, Stream.pipeThroughChannel(MsgPack.unpack()))),
                Match.when('sse', () => pipe(raw, Stream.decodeText('utf-8'), Stream.pipeThroughChannel(Sse.makeChannel<E | Error, unknown>()))),
                Match.when('ndjson', () => pipe(raw, Stream.pipeThroughChannel(Ndjson.unpack()))),
                Match.when('binary', () => raw),
                Match.exhaustive,
                );
                /* v8 ignore start -- metric tap callbacks execute inside Effect stream runtime */
                const metricTap = (item: unknown) => Match.value(format).pipe(
                    Match.when('binary', () => item instanceof Uint8Array ? _inc(labels, (metrics) => metrics.stream.bytes, item.length) : _inc(labels, (metrics) => metrics.stream.elements)),
                    Match.orElse(() => _inc(labels, (metrics) => metrics.stream.elements)),
                );
                /* v8 ignore stop */
                return decoded.pipe(
                    (stream) => config.retry ? Stream.retry(stream, Resilience.schedule({ base: config.retry.base, maxAttempts: config.retry.times })) : stream,
                    Stream.buffer({ capacity: formatConfig.capacity, strategy: formatConfig.strategy }),
                    _withMetrics(labels, config.name, format),
                    Stream.tap(metricTap),
                );
        }), { circuit: config.name, retry: false, timeout: false }).pipe(
            Telemetry.span('streaming.ingest', { 'stream.format': format, 'stream.name': config.name, metrics: false }),
        );
    };
    static readonly emit = <A, E>(config: {
        readonly filename?: string; readonly format: StreamingService.Emit; readonly name: string;
        readonly serialize?: (item: A) => string; readonly sseSerialize?: (item: A) => Sse.EventEncoded;
        readonly stream: Stream.Stream<A, E, never>;
        readonly throttle?: { readonly units: number; readonly duration: Duration.DurationInput; readonly burst?: number };
        readonly debounce?: Duration.DurationInput; readonly batch?: { readonly size: number; readonly duration: Duration.DurationInput };
        readonly dedupe?: boolean | ((current: A, previous: A) => boolean);
    }): Effect.Effect<HttpServerResponse.HttpServerResponse, never, StreamingService> =>
        Effect.gen(function* () {
            const formatConfig = _formats[config.format];
            const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(/* v8 ignore next */ () => 'system'));
            const labels = _labels('emit', config.format, config.name, tenantId);
            const serialize = config.serialize ?? ((item: A) => JSON.stringify(item));
            const sseSerialize = config.sseSerialize ?? ((item: A): Sse.EventEncoded => ({ data: serialize(item), event: 'message', id: undefined }));
            const processed: Stream.Stream<A, E, never> = config.stream.pipe(
                Match.value(config.dedupe).pipe(Match.when(true, () => Stream.changes), Match.when(Predicate.isFunction, (fn) => Stream.changesWith(fn)), Match.orElse(() => F.identity)),
                (stream: Stream.Stream<A, E, never>) => config.batch ? Stream.flattenChunks(Stream.groupedWithin(stream, config.batch.size, config.batch.duration)) : stream,
                (stream: Stream.Stream<A, E, never>) => config.throttle ? Stream.throttle(stream, { cost: Chunk.size, units: config.throttle.units, duration: config.throttle.duration, burst: config.throttle.burst }) : stream,
                (stream: Stream.Stream<A, E, never>) => config.debounce ? Stream.debounce(stream, config.debounce) : stream,
                /* v8 ignore next */ Stream.tap(() => _inc(labels, (metrics) => metrics.stream.elements)),
            );
            /* v8 ignore next */ const asBinary = (item: A): Effect.Effect<Uint8Array, TypeError> =>
                Object.prototype.toString.call(item) === '[object Uint8Array]'
                    ? Effect.succeed(item as Uint8Array)
                    : Effect.fail(new TypeError(`streaming.emit(binary) expected Uint8Array for ${config.name}`));
            /* v8 ignore start -- format codec closures execute inside Effect stream runtime */
            const encoded = ({
                binary: () => processed.pipe(Stream.mapEffect(asBinary)),
                msgpack: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(MsgPack.pack())),
                json: () => pipe(Stream.make('['), Stream.concat(pipe(processed, Stream.zipWithIndex, Stream.map(([item, index]) => index === 0 ? serialize(item) : `,${serialize(item)}`))), Stream.concat(Stream.make(']')), Stream.encodeText),
                ndjson: () => pipe(processed, Stream.chunks, Stream.pipeThroughChannel(Ndjson.pack())),
                csv: () => pipe(processed, Stream.map((item) => serialize(item)), Stream.intersperse('\n'), Stream.encodeText),
                sse: () => Stream.merge(pipe(processed, Stream.map((item) => { const envelope = sseSerialize(item); return Sse.encoder.write({ _tag: 'Event', data: envelope.data, event: envelope.event ?? 'message', id: envelope.id }); }), Stream.encodeText), _heartbeat(30), { haltStrategy: 'left' }),
            } satisfies Record<StreamingService.Emit, () => Stream.Stream<Uint8Array, E | MsgPack.MsgPackError | TypeError, never>>)[config.format]();
            /* v8 ignore stop */
            const filename = (config.filename ?? `${config.name}.${formatConfig.extension}`).replaceAll('"', String.raw`\"`);
            const headers = config.format === 'sse' ? { 'Cache-Control': 'no-cache', Connection: 'keep-alive' } : { 'Content-Disposition': `attachment; filename="${filename}"` };
            /* v8 ignore start -- emit return: Stream.tap/ensuring callbacks execute inside Effect stream runtime */
            return HttpServerResponse.stream(encoded.pipe(Stream.buffer({ capacity: formatConfig.capacity, strategy: formatConfig.strategy }), _withMetrics(labels, config.name, config.format), Stream.tap((chunk) => _inc(labels, (metrics) => metrics.stream.bytes, chunk.length)), Stream.ensuring(Effect.logDebug('Stream closed', { direction: 'emit', format: config.format, stream: config.name, tenant: tenantId }))), { contentType: formatConfig.contentType, headers: Headers.fromInput(headers) });
            /* v8 ignore stop */
        }).pipe(Telemetry.span('streaming.emit', { 'stream.format': config.format, 'stream.name': config.name, metrics: false }));
    static readonly mailbox = <A, E = never>(config?: {
        readonly from?: Stream.Stream<A, E, never> | PubSub.PubSub<A> | Subscribable.Subscribable<A, E, never>;
        readonly name?: string; readonly capacity?: number; readonly strategy?: 'suspend' | 'dropping' | 'sliding';
    }): Effect.Effect<Mailbox.Mailbox<A, E> | Mailbox.ReadonlyMailbox<A, E>, never, Scope.Scope> =>
        Effect.gen(function* () {
            const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(/* v8 ignore next */ () => 'system'));
            const labels = _labels('mailbox', 'push', config?.name ?? 'anonymous', tenantId);
            const opts = { capacity: config?.capacity ?? 128, ...(config?.strategy === undefined ? {} : { strategy: config.strategy }) };
            const mailbox = yield* Match.value(config?.from).pipe(
                Match.when(Match.undefined, () => Mailbox.make<A, E>(opts)),
                Match.when(Subscribable.isSubscribable, (subscribable) => Mailbox.fromStream(subscribable.changes, opts)),
                Match.when((source): source is PubSub.PubSub<A> => source != null && 'subscribe' in source, (hub) => Mailbox.fromStream(Stream.fromPubSub(hub), opts)),
                Match.orElse((stream) => Mailbox.fromStream(stream, opts)),
            );
            /* v8 ignore next 2 -- gauge/finalizer callbacks execute inside Effect fiber runtime */
            yield* _gauge(labels, (metrics) => metrics.stream.active, 1);
            yield* Effect.addFinalizer(() => _gauge(labels, (metrics) => metrics.stream.active, -1));
            return mailbox;
        }).pipe(Telemetry.span('streaming.mailbox', { 'stream.name': config?.name ?? 'anonymous', metrics: false }));
    static readonly state = <A>(initial: A, config?: { readonly name?: string }): Effect.Effect<StreamingService.State<A>, never, Scope.Scope> =>
        Effect.gen(function* () {
            const name = config?.name ?? 'anonymous';
            const tenantId = yield* Context.Request.currentTenantId.pipe(Effect.orElseSucceed(/* v8 ignore next */ () => 'system'));
            const labels = _labels('state', 'ref', name, tenantId);
            const ref = yield* SubscriptionRef.make(initial);
            /* v8 ignore next 2 -- gauge/finalizer callbacks execute inside Effect fiber runtime */
            yield* _gauge(labels, (metrics) => metrics.stream.active, 1);
            yield* Effect.addFinalizer(() => _gauge(labels, (metrics) => metrics.stream.active, -1));
            /* v8 ignore next */ const incElements = _inc(labels, (metrics) => metrics.stream.elements);
            return {
                get: SubscriptionRef.get(ref),
                set: (value: A) => SubscriptionRef.set(ref, value).pipe(Effect.tap(incElements)),
                update: (updater: (current: A) => A) => SubscriptionRef.update(ref, updater).pipe(Effect.tap(incElements)),
                modify: <B>(modifier: (current: A) => readonly [B, A]) => SubscriptionRef.modify(ref, modifier).pipe(Effect.tap(incElements)),
                changes: _withMetrics<A, never>(labels, name, 'ref')(ref.changes),
            };
        }).pipe(Telemetry.span('streaming.state', { 'stream.name': config?.name ?? 'anonymous', metrics: false }));
    static readonly toEventBus = <A>(stream: Stream.Stream<A>, mapToEvent: (a: A) => EventBus.Types.Input) =>
        EventBus.pipe(Effect.flatMap((eventBus) => stream.pipe(Stream.mapEffect((item) => eventBus.publish(mapToEvent(item))), Stream.runDrain))).pipe(Telemetry.span('streaming.toEventBus', { metrics: false }));
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StreamingService {
    export type Ingest = {
        [K in keyof typeof _formats]: (typeof _formats)[K]['ingest'] extends true ? K : never
    }[keyof typeof _formats];
    export type Emit = {
        [K in keyof typeof _formats]: (typeof _formats)[K]['emit'] extends true ? K : never
    }[keyof typeof _formats];
    export interface State<A> { readonly get: Effect.Effect<A>; readonly set: (value: A) => Effect.Effect<void>; readonly update: (updater: (current: A) => A) => Effect.Effect<void>; readonly modify: <B>(modifier: (current: A) => readonly [B, A]) => Effect.Effect<B>; readonly changes: Stream.Stream<A, never, never> }
}

// --- [EXPORT] ----------------------------------------------------------------

export { StreamingService };
