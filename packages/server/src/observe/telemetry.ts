/**
 * Export OpenTelemetry traces, metrics, logs via unified Otlp.layer.
 * Config-driven intervals; annotates spans with RequestContext for app segmentation.
 * Structured logging with span annotations for trace correlation.
 */
import { Otlp, OtlpSerialization } from '@effect/opentelemetry';
import { FetchHttpClient } from '@effect/platform';
import { Config as Cfg, Duration, Effect, Layer, Logger, LogLevel, Option } from 'effect';
import { Context } from '../context.ts';
import { Circuit } from '../security/circuit.ts';

// --- [TYPES] -----------------------------------------------------------------

type LogLevelLiteral = 'All' | 'Fatal' | 'Error' | 'Warning' | 'Info' | 'Debug' | 'Trace' | 'None';

// --- [CONSTANTS] -------------------------------------------------------------

const config = {
	defaults: {
		endpointHttp: 'https://alloy.monitoring.svc.cluster.local:4318',
		environment: 'development' as 'production' | 'development',
		logLevel: 'Info' as LogLevelLiteral,
		namespace: 'parametric-portal',
		serviceName: 'api',
		serviceVersion: '0.0.0',
	},
	exporters: {
		development: {
			batchSize: 64,
			interval: Duration.seconds(2),
			loggerExcludeLogSpans: false,
			shutdownTimeout: Duration.seconds(5),
			tracerInterval: Duration.millis(500),
		},
		production: {
			batchSize: 512,
			interval: Duration.seconds(10),
			loggerExcludeLogSpans: true,
			shutdownTimeout: Duration.seconds(30),
			tracerInterval: Duration.seconds(1),
		},
	},
	sdk: { language: 'nodejs', name: 'opentelemetry' },
} as const;
const _telemetryConfig = Cfg.all({
	endpointHttp: Cfg.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
		Cfg.withDefault(config.defaults.endpointHttp),
		Cfg.map((url) => (url.includes(':4317') ? url.replace(':4317', ':4318') : url)),
	),
	environment: Cfg.string('NODE_ENV').pipe(
		Cfg.withDefault(config.defaults.environment),
		Cfg.map((env): 'production' | 'development' => (env === 'production' ? 'production' : 'development')),
	),
	instanceId: Cfg.string('HOSTNAME').pipe(Cfg.withDefault(crypto.randomUUID())),
	k8sNamespace: Cfg.string('K8S_NAMESPACE').pipe(Cfg.withDefault('')),
	k8sPodName: Cfg.string('K8S_POD_NAME').pipe(Cfg.withDefault('')),
	logLevel: Cfg.string('LOG_LEVEL').pipe(
		Cfg.withDefault(config.defaults.logLevel),
		Cfg.map((level): LogLevelLiteral => {
			const normalized = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
			const validLevels = ['All', 'Fatal', 'Error', 'Warning', 'Info', 'Debug', 'Trace', 'None'];
			return validLevels.includes(normalized) ? (normalized as LogLevelLiteral) : config.defaults.logLevel;
		}),
	),
	serviceName: Cfg.string('OTEL_SERVICE_NAME').pipe(Cfg.withDefault(config.defaults.serviceName)),
	serviceVersion: Cfg.string('npm_package_version').pipe(Cfg.withDefault(config.defaults.serviceVersion)),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _circuitStateToString = (state: number): string => {	// Safely serialize Circuit.State to string, handling invalid values.
	const name = Circuit.State[state];
	return typeof name === 'string' ? name : `unknown(${state})`;
};
const annotateSpan: Effect.Effect<void, never, never> = Effect.gen(function* () {
	const ctx = yield* Context.Request.current;
	yield* Effect.annotateCurrentSpan('tenant.id', ctx.tenantId);
	yield* Option.match(ctx.circuit, {
		onNone: () => Effect.void,
		onSome: (c) => Effect.all([
			Effect.annotateCurrentSpan('circuit.name', c.name),
			Effect.annotateCurrentSpan('circuit.state', _circuitStateToString(c.state)),
		], { discard: true }),
	});
});
const withSpan = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const ctx = yield* Context.Request.current;
		const tenantAttrs = { 'tenant.id': ctx.tenantId };
		const circuitAttrs = Option.match(ctx.circuit, {
			onNone: () => ({}),
			onSome: (c) => ({
				'circuit.name': c.name,
				'circuit.state': _circuitStateToString(c.state),
			}),
		});
		return yield* Effect.withSpan(effect, name, { attributes: { ...tenantAttrs, ...circuitAttrs } });
	});
const Default = Layer.unwrapEffect(	// Unified OTLP layer: traces + metrics + logs with structured logger and log level filtering.
	_telemetryConfig.pipe(Effect.map((cfg) => {
		const exp = config.exporters[cfg.environment];
		return Layer.merge(
			Otlp.layer({
				baseUrl: cfg.endpointHttp,
				loggerExcludeLogSpans: exp.loggerExcludeLogSpans,
				loggerExportInterval: exp.interval,
				maxBatchSize: exp.batchSize,
				metricsExportInterval: exp.interval,
				resource: {
					attributes: {
						'deployment.environment.name': cfg.environment,
						...(cfg.k8sNamespace && { 'k8s.namespace.name': cfg.k8sNamespace }),
						...(cfg.k8sPodName && { 'k8s.pod.name': cfg.k8sPodName }),
						'service.instance.id': cfg.instanceId,
						'service.namespace': config.defaults.namespace,
						'telemetry.sdk.language': config.sdk.language,
						'telemetry.sdk.name': config.sdk.name,
					},
					serviceName: cfg.serviceName,
					serviceVersion: cfg.serviceVersion,
				},
				shutdownTimeout: exp.shutdownTimeout,
				tracerExportInterval: exp.tracerInterval,
			}),
			Layer.merge(
				Logger.replace(Logger.defaultLogger, Logger.withSpanAnnotations(cfg.environment === 'production' ? Logger.jsonLogger : Logger.prettyLogger())),
				Logger.minimumLogLevel(LogLevel.fromLiteral(cfg.logLevel)),
			),
		);
	})),
).pipe(
	Layer.provide(OtlpSerialization.layerJson),
	Layer.provide(FetchHttpClient.layer),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Telemetry = {
	annotateSpan,
	config,
	Default,
	withSpan,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Telemetry {
	export type Config = Cfg.Config.Success<typeof _telemetryConfig>;
	export type Environment = typeof Telemetry.config.defaults.environment;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Telemetry };
