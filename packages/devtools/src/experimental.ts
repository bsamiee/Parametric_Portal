/**
 * Effect DevTools WebSocket layer with connection test to prevent startup hangs.
 */
import { DevTools } from '@effect/experimental';
import { Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type DevToolsConfig = {
    readonly enabled?: boolean | undefined;
    readonly timeoutMs?: number | undefined;
    readonly url?: string | undefined;
};

type DevToolsResult = {
    readonly layer: Layer.Layer<never>;
    readonly isEnabled: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        enabled: true,
        timeoutMs: 1000,
        url: 'ws://localhost:34437',
    },
    messages: {
        connectionFailed: 'DevTools connection failed, continuing without',
        disabled: 'DevTools disabled',
        enabled: 'DevTools connected',
        timeout: 'DevTools connection timeout, continuing without',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isBrowser = (): boolean => globalThis.window !== undefined && typeof WebSocket !== 'undefined';

const shouldEnable = (config: DevToolsConfig): boolean => (config.enabled ?? B.defaults.enabled) && isBrowser();

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

// --- [ENTRY_POINT] -----------------------------------------------------------

// May hang if server unavailable - prefer createDevToolsLayerSafe
const createDevToolsLayer = (config: Partial<DevToolsConfig> = {}): DevToolsResult => {
    const enabled = shouldEnable(config);
    const url = config.url ?? B.defaults.url;
    const layer: Layer.Layer<never> = enabled ? DevTools.layer(url) : Layer.empty;
    return { isEnabled: enabled, layer };
};

const createDevToolsLayerSafe = (config: Partial<DevToolsConfig> = {}): DevToolsResult => {
    const enabled = shouldEnable(config);
    const url = config.url ?? B.defaults.url;
    const timeoutMs = config.timeoutMs ?? B.defaults.timeoutMs;

    const layer: Layer.Layer<never> = enabled
        ? Layer.unwrapEffect(
              pipe(
                  Effect.tryPromise({
                      catch: () => false,
                      try: () => testConnection(url, timeoutMs),
                  }),
                  Effect.map((available) => (available ? DevTools.layer(url) : Layer.empty)),
                  Effect.catchAll(() => Effect.succeed(Layer.empty)),
              ),
          )
        : Layer.empty;

    return { isEnabled: enabled, layer };
};

const createDevToolsLayerEffect = (config: Partial<DevToolsConfig> = {}): Effect.Effect<DevToolsResult> =>
    pipe(
        Effect.sync(() => createDevToolsLayerSafe(config)),
        Effect.tap(({ isEnabled }) =>
            isEnabled
                ? Effect.logDebug(B.messages.enabled, { url: config.url ?? B.defaults.url })
                : Effect.logDebug(B.messages.disabled),
        ),
        Effect.annotateLogs({ module: 'devtools', phase: 'init' }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsConfig, DevToolsResult };
export { B as EXPERIMENTAL_TUNING, createDevToolsLayer, createDevToolsLayerEffect, createDevToolsLayerSafe };
