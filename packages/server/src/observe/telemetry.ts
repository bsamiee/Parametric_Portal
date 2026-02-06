/**
 * Expose unified telemetry: OTLP export, intelligent span wrapper, auto-captured context.
 * Zero-ceremony observability with auto-inferred SpanKind, error tracking, metrics integration.
 */
import { Otlp, OtlpMetrics, OtlpSerialization, OtlpTracer } from '@effect/opentelemetry';
import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Array as A, Cause, Clock, Config as Cfg, Duration, Effect, FiberId, HashSet, Layer, Logger, LogLevel, Match, Option, Record, pipe, type Tracer } from 'effect';
import { dual } from 'effect/Function';
import { Context } from '../context.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	defaults: {
		endpoint: 'https://alloy.monitoring.svc.cluster.local:4318',
		headers: '',
		logSink: 'stdout+otlp',
		namespace: 'parametric-portal',
		protocol: 'json',
		service: { name: 'api', version: '0.0.0' },
	},
	exporters: {
		development: { batchSize: 64, interval: Duration.seconds(2), loggerExcludeLogSpans: false, shutdownTimeout: Duration.seconds(5), tracerInterval: Duration.millis(500) },
		production:  { batchSize: 512, interval: Duration.seconds(10), loggerExcludeLogSpans: true, shutdownTimeout: Duration.seconds(30), tracerInterval: Duration.seconds(1) },
	},
	logSink: 		{ otlpOnly: 'otlp-only', stdoutOnly: 'stdout-only', stdoutOtlp: 'stdout+otlp' } as const,
	pii: 			{ keys: ['session.id', 'user.id'] } as const,
	sdk: 			{ language: 'nodejs', name: 'opentelemetry' },
	serialization: 	{ json: OtlpSerialization.layerJson, protobuf: OtlpSerialization.layerProtobuf } as const,
	urls: 			{ metrics: '/v1/metrics', traces: '/v1/traces' } as const,
} as const;
const _TELEMETRY_CONFIG = Cfg.all({
	endpoint: 		Cfg.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Cfg.withDefault(_CONFIG.defaults.endpoint), Cfg.map((url) => (url.includes(':4317') ? url.replace(':4317', ':4318') : url))),
	environment: 	Cfg.string('NODE_ENV').pipe(Cfg.withDefault('development'), Cfg.map((env): 'production' | 'development' => (env === 'production' ? 'production' : 'development'))),
	headers: 		Cfg.string('OTEL_EXPORTER_OTLP_HEADERS').pipe(Cfg.withDefault(_CONFIG.defaults.headers), Cfg.map((raw) => _parseHeaders(raw))),
	instanceId: 	Cfg.string('HOSTNAME').pipe(Cfg.withDefault(crypto.randomUUID())),
	k8sNamespace: 	Cfg.string('K8S_NAMESPACE').pipe(Cfg.withDefault('')),
	k8sPodName: 	Cfg.string('K8S_POD_NAME').pipe(Cfg.withDefault('')),
	logLevel: 		Cfg.logLevel('LOG_LEVEL').pipe(Cfg.withDefault(LogLevel.Info)),
	logSink: 		Cfg.string('TELEMETRY_LOG_SINK').pipe(Cfg.withDefault(_CONFIG.defaults.logSink), Cfg.map((raw) => Match.value(raw.toLowerCase()).pipe(
		Match.when(_CONFIG.logSink.otlpOnly, () => _CONFIG.logSink.otlpOnly),
		Match.when(_CONFIG.logSink.stdoutOnly, () => _CONFIG.logSink.stdoutOnly),
		Match.orElse(() => _CONFIG.logSink.stdoutOtlp),
	))),
	protocol: 		Cfg.string('OTEL_EXPORTER_OTLP_PROTOCOL').pipe(Cfg.withDefault(_CONFIG.defaults.protocol), Cfg.map((raw): 'json' | 'protobuf' => (raw.toLowerCase() === 'protobuf' ? 'protobuf' : 'json'))),
	serviceName: 	Cfg.string('OTEL_SERVICE_NAME').pipe(Cfg.withDefault(_CONFIG.defaults.service.name)),
	serviceVersion: Cfg.string('npm_package_version').pipe(Cfg.withDefault(_CONFIG.defaults.service.version)),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _inferKind = (name: string): Tracer.SpanKind => pipe(
	([['consumer', ['jobs.process', 'jobs.poll']], ['producer', ['jobs.enqueue']], ['server', ['auth.', 'health.', 'transfer.', 'users.']]] as const satisfies ReadonlyArray<readonly [Tracer.SpanKind, ReadonlyArray<string>]>),
	A.findFirst(([, prefixes]) => A.some(prefixes, (p) => name.startsWith(p))),
	Option.map(([kind]) => kind),
	Option.getOrElse((): Tracer.SpanKind => 'internal'),
);
function _parseHeaders(raw: string): Record.ReadonlyRecord<string, string> {
	return pipe(
		raw.split(','),
		A.filterMap((segment) => {
			const [key = '', value = ''] = segment.split('=', 2).map((part) => part.trim());
			return key !== '' && value !== '' ? Option.some([key, value] as const) : Option.none();
		}),
		Record.fromEntries,
	);
}
const _redact = (attrs: Record.ReadonlyRecord<string, unknown>): Record.ReadonlyRecord<string, unknown> => A.reduce(_CONFIG.pii.keys, attrs, (acc, key) => Record.remove(acc, key));
const _annotateError = Effect.tapErrorCause((cause: Cause.Cause<unknown>) => {
	const pretty = A.head(Cause.prettyErrors(cause));
	const msg = Option.match(pretty, { onNone: () => Cause.pretty(cause), onSome: (entry) => entry.message });
	const stack = pipe(pretty, Option.flatMapNullable((entry) => entry.stack), Option.getOrUndefined);
	const base = { 'exception.message': msg, 'exception.stacktrace': stack };
	const attrs = Cause.match(cause, {
		onDie: (defect) => ({ ...base, 'error': true, 'exception.type': defect instanceof Error ? defect.constructor.name : 'Defect' }),
		onEmpty: {} as Record.ReadonlyRecord<string, unknown>,
		onFail: (error) => ({ ...base, 'error': true, 'exception.type': MetricsService.errorTag(error) }),
		onInterrupt: (fiberId) => ({ 'error': true, 'exception.message': `Interrupted by ${FiberId.threadName(fiberId)}`, 'exception.type': 'FiberInterrupted' }),
		onParallel: (left) => ({ ...left, 'error.parallel': HashSet.size(Cause.linearize(cause)) }),
		onSequential: (left) => ({ ...left, 'error.sequential': true }),
	});
	return pipe(
		Effect.all({ nowNs: Clock.currentTimeNanos, span: Effect.optionFromOptional(Effect.currentSpan) }),
		Effect.flatMap(({ span, nowNs }) =>
			Effect.all([
				Option.match(span, {
					onNone: () => Effect.void,
					onSome: (currentSpan) => Effect.when(Effect.sync(() => currentSpan.event('exception', nowNs, { 'exception.message': attrs['exception.message'], 'exception.stacktrace': attrs['exception.stacktrace'], 'exception.type': attrs['exception.type'] })), () => attrs['error'] === true),
				}),
				Effect.annotateCurrentSpan(attrs),
			], { discard: true }),
		),
	);
});
const _span: {
	(name: string, opts?: Telemetry.SpanOpts): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	<A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R>;
} = dual(
	(args) => Effect.isEffect(args[0]),
	<A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R> => {
		const { captureStackTrace, kind, metrics, ...attrs } = opts ?? {};
		const safeAttrs = _redact(attrs);
		const capture = captureStackTrace !== false;
		return Effect.all({ ctx: Context.Request.current, fiberId: Effect.fiberId }, { concurrency: 'unbounded' }).pipe(
			Effect.flatMap(({ ctx, fiberId }) => {
				const ctxAttrs = Context.Request.toAttrs(ctx, fiberId);
				const redacted = _redact(ctxAttrs);
				const spanKind = kind ?? pipe(ctx.circuit, Option.map((): Tracer.SpanKind => 'client'), Option.getOrElse(() => _inferKind(name)));
				const spanAttrs = { ...redacted, ...safeAttrs };
				const coreSpan = self.pipe(
					_annotateError,
					Effect.withSpan(name, { attributes: spanAttrs, captureStackTrace: capture, kind: spanKind }),
					Effect.withLogSpan(name),
					Effect.annotateLogs(redacted),
				);
				return metrics === false
					? coreSpan
					: Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({
							onNone: () => coreSpan,
							onSome: (metricsService) => MetricsService.trackEffect(coreSpan, { duration: metricsService.http.duration, errors: metricsService.errors, labels: MetricsService.label({ operation: name, tenant: ctx.tenantId }) }),
						}));
			}),
			Effect.catchAll(() => self.pipe(_annotateError, Effect.withSpan(name, { attributes: safeAttrs, captureStackTrace: capture, kind: kind ?? _inferKind(name) }), Effect.withLogSpan(name))),
		) as Effect.Effect<A, E, R>;
	},
);

// --- [LAYERS] ----------------------------------------------------------------

const _Default = Layer.unwrapEffect(
	_TELEMETRY_CONFIG.pipe(Effect.map((configuration) => {
		const exp = _CONFIG.exporters[configuration.environment];
		const resource = {
			attributes: {
				'deployment.environment.name': configuration.environment,
				...(configuration.k8sNamespace && { 'k8s.namespace.name': configuration.k8sNamespace }),
				...(configuration.k8sPodName && { 'k8s.pod.name': configuration.k8sPodName }),
				'process.pid': String(process.pid),
				'service.instance.id': configuration.instanceId,
				'service.namespace': _CONFIG.defaults.namespace,
				'telemetry.sdk.language': _CONFIG.sdk.language,
				'telemetry.sdk.name': _CONFIG.sdk.name,
			},
			serviceName: configuration.serviceName,
			serviceVersion: configuration.serviceVersion,
		} as const;
		const envLogger = configuration.environment === 'production' ? Logger.jsonLogger : Logger.prettyLogger({ colors: 'auto', mode: 'auto' });
		const stdoutLayer = configuration.logSink === _CONFIG.logSink.otlpOnly
			? Layer.empty
			: Logger.replace(Logger.defaultLogger, Logger.withSpanAnnotations(envLogger));
		const base = configuration.endpoint.replace(/\/$/, '');
		const otlpLayer = configuration.logSink === _CONFIG.logSink.stdoutOnly
			? Layer.mergeAll(
				OtlpMetrics.layer({
					exportInterval: exp.interval,
					headers: configuration.headers,
					resource,
					shutdownTimeout: exp.shutdownTimeout,
					url: `${base}${_CONFIG.urls.metrics}`,
				}),
				OtlpTracer.layer({
					exportInterval: exp.tracerInterval,
					headers: configuration.headers,
					maxBatchSize: exp.batchSize,
					resource,
					shutdownTimeout: exp.shutdownTimeout,
				url: `${base}${_CONFIG.urls.traces}`,
			}),
		).pipe(Layer.provide(_CONFIG.serialization[configuration.protocol]))
		: ({
			json: Otlp.layerJson,
			protobuf: Otlp.layerProtobuf,
		})[configuration.protocol]({
				baseUrl: configuration.endpoint,
				headers: configuration.headers,
				loggerExcludeLogSpans: exp.loggerExcludeLogSpans,
				loggerExportInterval: exp.interval,
				maxBatchSize: exp.batchSize,
				metricsExportInterval: exp.interval,
				replaceLogger: configuration.logSink === _CONFIG.logSink.otlpOnly ? Logger.defaultLogger : undefined,
				resource,
				shutdownTimeout: exp.shutdownTimeout,
				tracerExportInterval: exp.tracerInterval,
			});
		return Layer.mergeAll(
			otlpLayer,
			stdoutLayer,
			Logger.minimumLogLevel(configuration.logLevel),
		);
	})),
).pipe(Layer.provide(Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, HttpClient.withTracerPropagation(false)))), Layer.provide(FetchHttpClient.layer));

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Telemetry = { config: _CONFIG, Default: _Default, parseHeaders: _parseHeaders, span: _span } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Telemetry {
	export type Config = Cfg.Config.Success<typeof _TELEMETRY_CONFIG>;
	export type Environment = Config['environment'];
	export type LogSink = Config['logSink'];
	export type Protocol = 'json' | 'protobuf';
	export type SpanOpts = Tracer.SpanOptions['attributes'] & { readonly captureStackTrace?: false; readonly kind?: Tracer.SpanKind; readonly metrics?: false };
}

// --- [EXPORT] ----------------------------------------------------------------

export { Telemetry };
