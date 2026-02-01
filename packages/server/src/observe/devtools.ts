/**
 * DevTools: Optional development tracer via @effect/experimental.
 * Auto-connects when DevTools server available in non-production.
 */
import { DevTools } from '@effect/experimental';
import { Config, Duration, Effect, Layer } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = { timeout: Duration.seconds(1), url: 'ws://localhost:34437' } as const;

// --- [LAYERS] ----------------------------------------------------------------

/**
 * DevTools layer with availability check.
 * - Only connects in non-production AND when DEVTOOLS_ENABLED=true
 * - Checks WebSocket availability before enabling tracer
 * - Gracefully degrades to empty layer if server unavailable
 */
const DevToolsLayer = Layer.unwrapEffect(
	Effect.all({
		enabled: Config.boolean('DEVTOOLS_ENABLED').pipe(Config.withDefault(false)),
		env: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
	}).pipe(
		Effect.map(({ env, enabled }) => env !== 'production' && enabled),
		Effect.filterOrElse(
			(shouldConnect) => shouldConnect,
			() => Effect.succeed(Layer.empty),
		),
		Effect.flatMap(() =>
			Effect.async<boolean>((resume) => {
				const ws = new WebSocket(_CONFIG.url);
				ws.onopen = () => {
					ws.close();
					resume(Effect.succeed(true));
				};
				ws.onerror = () => {
					ws.close();
					resume(Effect.succeed(false));
				};
				return Effect.sync(() => ws.close());
			}).pipe(Effect.timeoutTo({ duration: _CONFIG.timeout, onSuccess: (a) => a, onTimeout: () => false })),
		),
		Effect.filterOrElse(
			(available: boolean) => available,
			() => Effect.logDebug('DevTools server unavailable').pipe(Effect.as(Layer.empty)),
		),
		Effect.flatMap(() =>
			Effect.logInfo('DevTools tracer enabled').pipe(Effect.as(DevTools.layer(_CONFIG.url))),
		),
	),
);

// --- [EXPORT] ----------------------------------------------------------------

export { DevToolsLayer };
