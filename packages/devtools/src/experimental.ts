/**
 * Effect DevTools WebSocket layer with connection test to prevent startup hangs.
 * Unified factory with mode dispatch for immediate/safe connection handling.
 */
import { DevTools } from '@effect/experimental';
import { Effect, Layer, pipe } from 'effect';
import { DEVTOOLS_TUNING } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type DevToolsMode = 'immediate' | 'safe';
type DevToolsConfig = {
    readonly enabled?: boolean | undefined;
    readonly mode?: DevToolsMode | undefined;
    readonly timeoutMs?: number | undefined;
    readonly url?: string | undefined;
};
type DevToolsResult = {
    readonly isEnabled: boolean;
    readonly layer: Layer.Layer<never>;
};
type InternalConfig = {
    readonly enabled: boolean;
    readonly mode: DevToolsMode;
    readonly timeoutMs: number;
    readonly url: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING.experimental;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isBrowser = (): boolean => globalThis.window !== undefined && typeof WebSocket !== 'undefined';
const shouldEnable = (config: DevToolsConfig): boolean => (config.enabled ?? T.defaults.enabled) && isBrowser();
const testConnection = (url: string, timeoutMs: number): Promise<boolean> =>
    new Promise((resolve) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
        }, timeoutMs);
        ws.onopen = () => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        };
        ws.onerror = () => {
            clearTimeout(timeout);
            ws.close();
            resolve(false);
        };
    });
const normalizeConfig = (config: Partial<DevToolsConfig>): InternalConfig => ({
    enabled: shouldEnable(config),
    mode: config.mode ?? 'safe',
    timeoutMs: config.timeoutMs ?? T.defaults.timeoutMs,
    url: config.url ?? T.defaults.url,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const modeHandlers = {
    immediate: (cfg: InternalConfig): DevToolsResult => ({
        isEnabled: cfg.enabled,
        layer: cfg.enabled ? DevTools.layer(cfg.url) : Layer.empty,
    }),
    safe: (cfg: InternalConfig): DevToolsResult => ({
        isEnabled: cfg.enabled,
        layer: cfg.enabled
            ? Layer.unwrapEffect(
                  pipe(
                      Effect.tryPromise({
                          catch: () => false,
                          try: () => testConnection(cfg.url, cfg.timeoutMs),
                      }),
                      Effect.map((available) => (available ? DevTools.layer(cfg.url) : Layer.empty)),
                      Effect.catchAll(() => Effect.succeed(Layer.empty)),
                  ),
              )
            : Layer.empty,
    }),
} as const satisfies Record<DevToolsMode, (c: InternalConfig) => DevToolsResult>;

// --- [ENTRY_POINT] -----------------------------------------------------------

const createDevToolsLayer = (config: Partial<DevToolsConfig> = {}): DevToolsResult => {
    const internal = normalizeConfig(config);
    return Object.freeze(modeHandlers[internal.mode](internal));
};
const createDevToolsLayerEffect = (config: Partial<DevToolsConfig> = {}): Effect.Effect<DevToolsResult> =>
    pipe(
        Effect.sync(() => createDevToolsLayer({ ...config, mode: 'safe' })),
        Effect.tap(({ isEnabled }) =>
            isEnabled
                ? Effect.logDebug(T.messages.enabled, { url: config.url ?? T.defaults.url })
                : Effect.logDebug(T.messages.disabled),
        ),
        Effect.annotateLogs({ module: 'devtools', phase: 'init' }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsConfig, DevToolsMode, DevToolsResult };
export { createDevToolsLayer, createDevToolsLayerEffect };
