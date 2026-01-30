/**
 * Unified telemetry: OTLP export + intelligent span for zero-ceremony observability.
 * [SPAN API] — Single intelligent wrapper that auto-captures everything
 * - pipe(effect, Telemetry.span('name'))      — Data-last (pipeable)
 * - Telemetry.span(effect, 'name', opts?)     — Data-first
 * [AUTO-CAPTURED] — No ceremony required, span() handles all:
 * - Context: tenant.id, request.id, user.id, session.id, client.ip, client.ua, ratelimit.*, circuit.*
 * - Fiber: fiber.id via FiberId.threadName
 * - Errors: OTEL-compliant via Cause.prettyErrors - exception.type, exception.message, exception.stacktrace
 * - Timing: Duration in span + log output (e.g., myspan=102ms)
 * - Metrics: Duration + error tracking via MetricsService (opt-out via metrics: false)
 * - SpanKind: Auto-inferred from name patterns + circuit context (override via kind option)
 * - Stack Traces: Always captured by default (opt-out via captureStackTrace: false)
 * - Correlation: Logs within span get trace/span IDs via withSpanAnnotations
 * [LAYER]
 * - Telemetry.Default — Provides OTLP export + configured logger
 */
/** biome-ignore-all lint/suspicious/noShadowRestrictedNames: <Boolean shadow> */
import { Otlp } from '@effect/opentelemetry';
import { FetchHttpClient } from '@effect/platform';
import { Array as A, Boolean, Cause, Clock, Config as Cfg, Duration, Effect, FiberId, HashSet, Layer, Logger, LogLevel, Option, pipe, type Tracer } from 'effect';
import { dual } from 'effect/Function';
import { Context } from '../context.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	defaults: { endpoint: 'https://alloy.monitoring.svc.cluster.local:4318', namespace: 'parametric-portal', service: { name: 'api', version: '0.0.0' } },
	exporters: {
		development: { batchSize: 64, interval: Duration.seconds(2), loggerExcludeLogSpans: false, shutdownTimeout: Duration.seconds(5), tracerInterval: Duration.millis(500) },
		production: { batchSize: 512, interval: Duration.seconds(10), loggerExcludeLogSpans: true, shutdownTimeout: Duration.seconds(30), tracerInterval: Duration.seconds(1) },
	},
	sdk: { language: 'nodejs', name: 'opentelemetry' },
} as const;
const _telemetryConfig = Cfg.all({
	endpoint: Cfg.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Cfg.withDefault(_config.defaults.endpoint), Cfg.map((url) => (url.includes(':4317') ? url.replace(':4317', ':4318') : url))),
	environment: Cfg.string('NODE_ENV').pipe(Cfg.withDefault('development'), Cfg.map((env): 'production' | 'development' => (env === 'production' ? 'production' : 'development'))),
	instanceId: Cfg.string('HOSTNAME').pipe(Cfg.withDefault(crypto.randomUUID())),
	k8sNamespace: Cfg.string('K8S_NAMESPACE').pipe(Cfg.withDefault('')),
	k8sPodName: Cfg.string('K8S_POD_NAME').pipe(Cfg.withDefault('')),
	logLevel: Cfg.logLevel('LOG_LEVEL').pipe(Cfg.withDefault(LogLevel.Info)),
	serviceName: Cfg.string('OTEL_SERVICE_NAME').pipe(Cfg.withDefault(_config.defaults.service.name)),
	serviceVersion: Cfg.string('npm_package_version').pipe(Cfg.withDefault(_config.defaults.service.version)),
});
const _kindPatterns: ReadonlyArray<readonly [Tracer.SpanKind, ReadonlyArray<string>]> = [
	['consumer',  ['jobs.process', 'jobs.poll']],
	['producer',  ['jobs.enqueue']],
	['server', 	  ['auth.', 'health.', 'transfer.', 'users.']],
] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _inferKind = (name: string): Tracer.SpanKind =>
	pipe(
		_kindPatterns,
		A.findFirst(([, prefixes]) => A.some(prefixes, (p) => name.startsWith(p))),
		Option.map(([kind]) => kind),
		Option.getOrElse((): Tracer.SpanKind => 'internal'),
	);
const _causeAttrs = (cause: Cause.Cause<unknown>): Record<string, unknown> => {
	const pretty = A.head(Cause.prettyErrors(cause));
	const msg = pipe(pretty, Option.map((e) => e.message), Option.getOrElse(() => Cause.pretty(cause)));
	const stack = pipe(pretty, Option.flatMap((e) => Option.fromNullable(e.stack)), Option.getOrUndefined);
	const base = { 'exception.message': msg, 'exception.stacktrace': stack };
	return Cause.match(cause, {
		onDie: (defect) => ({ ...base, 'error': true, 'exception.type': defect instanceof Error ? defect.constructor.name : 'Defect' }),
		onEmpty: {} as Record<string, unknown>,
		onFail: (error) => ({ ...base, 'error': true, 'exception.type': MetricsService.errorTag(error) }),
		onInterrupt: (fiberId) => ({ 'error': true, 'exception.message': `Interrupted by ${FiberId.threadName(fiberId)}`, 'exception.type': 'FiberInterrupted' }),
		onParallel: (left) => ({ ...left, 'error.parallel': HashSet.size(Cause.linearize(cause)) }),
		onSequential: (left) => ({ ...left, 'error.sequential': true }),
	});
};
const _recordErrorEvent = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
	Effect.flatMap(Effect.optionFromOptional(Effect.currentSpan), Option.match({
		onNone: () => Effect.void,
		onSome: (span) => Clock.currentTimeMillis.pipe(Effect.flatMap((nowMs) => Effect.sync(() => {
			const attrs = _causeAttrs(cause);
			Boolean.match('error' in attrs && attrs['error'] === true, {
				onFalse: () => undefined,
				onTrue: () => { span.event('exception', BigInt(nowMs * 1_000_000), { 'exception.message': attrs['exception.message'], 'exception.stacktrace': attrs['exception.stacktrace'], 'exception.type': attrs['exception.type'] }); },
			});
		}))),
	}));
const _span: {
	(name: string, opts?: Telemetry.SpanOpts): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	<A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R>;
} = dual(
	(args) => Effect.isEffect(args[0]),
	<A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R> =>
		Effect.all([Context.Request.current, Effect.fiberId], { concurrency: 'unbounded' }).pipe(
			Effect.flatMap(([ctx, fiberId]) => {
				const ctxAttrs = Context.Request.toAttrs(ctx, fiberId);
				const kind = opts?.kind ?? pipe(ctx.circuit, Option.map((): Tracer.SpanKind => 'client'), Option.getOrElse(() => _inferKind(name)));
				const coreSpan = self.pipe(
					Effect.tapErrorCause((cause) => Effect.all([_recordErrorEvent(cause), Effect.annotateCurrentSpan(_causeAttrs(cause))], { discard: true })),
					Effect.withSpan(name, { attributes: { ...ctxAttrs, ...opts }, captureStackTrace: opts?.captureStackTrace !== false, kind }),
					Effect.withLogSpan(name),
					Effect.annotateLogs(ctxAttrs),
				);
				return Boolean.match(opts?.metrics !== false, {
					onFalse: () => coreSpan,
					onTrue: () => Effect.flatMap(Effect.serviceOption(MetricsService), Option.match({
						onNone: () => coreSpan,
						onSome: (m) => MetricsService.trackEffect(coreSpan, { duration: m.http.duration, errors: m.errors, labels: MetricsService.label({ operation: name, tenant: ctx.tenantId }) }),
					})),
				});
			}),
			Effect.catchAll(() => self.pipe(
				Effect.tapErrorCause((cause) => Effect.all([_recordErrorEvent(cause), Effect.annotateCurrentSpan(_causeAttrs(cause))], { discard: true })),
				Effect.withSpan(name, { attributes: opts, captureStackTrace: opts?.captureStackTrace !== false, kind: opts?.kind ?? _inferKind(name) }),
				Effect.withLogSpan(name),
			)),
		),
);

// --- [LAYERS] ----------------------------------------------------------------

const _Default = Layer.unwrapEffect(
	_telemetryConfig.pipe(Effect.map((cfg) => {
		const exp = _config.exporters[cfg.environment];
		return Layer.mergeAll(
			Otlp.layerJson({
				baseUrl: cfg.endpoint,
				loggerExcludeLogSpans: exp.loggerExcludeLogSpans,
				loggerExportInterval: exp.interval,
				maxBatchSize: exp.batchSize,
				metricsExportInterval: exp.interval,
				resource: {
					attributes: {
						'deployment.environment.name': cfg.environment,
						...(cfg.k8sNamespace && { 'k8s.namespace.name': cfg.k8sNamespace }),
						...(cfg.k8sPodName && { 'k8s.pod.name': cfg.k8sPodName }),
						'process.pid': String(process.pid),
						'service.instance.id': cfg.instanceId,
						'service.namespace': _config.defaults.namespace,
						'telemetry.sdk.language': _config.sdk.language,
						'telemetry.sdk.name': _config.sdk.name,
					},
					serviceName: cfg.serviceName,
					serviceVersion: cfg.serviceVersion,
				},
				shutdownTimeout: exp.shutdownTimeout,
				tracerExportInterval: exp.tracerInterval,
			}),
			Logger.replace(Logger.defaultLogger, Logger.withSpanAnnotations(cfg.environment === 'production' ? Logger.jsonLogger : Logger.prettyLogger({ colors: 'auto', mode: 'auto' }))),
			Logger.minimumLogLevel(cfg.logLevel),
		);
	})),
).pipe(Layer.provide(FetchHttpClient.layer));

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Telemetry = {
	config: _config,
	Default: _Default,
	span: _span,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Telemetry {
	export type Config = Cfg.Config.Success<typeof _telemetryConfig>;
	export type Environment = Config['environment'];
	export type SpanOpts = Tracer.SpanOptions['attributes'] & {
		readonly captureStackTrace?: false;
		readonly kind?: Tracer.SpanKind;
		readonly metrics?: false;
	};
}

// --- [EXPORT] ----------------------------------------------------------------

export { Telemetry };
