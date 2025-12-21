/**
 * Unified session factory composing all devtools features.
 * Reduces app entry from ~130 LOC to ~20 LOC.
 */
import { Effect, Layer } from 'effect';
import { createContext, type FC, type ReactNode, useContext, useMemo } from 'react';
import { interceptConsole } from './console.ts';
import { createDevToolsLayerSafe } from './experimental.ts';
import { installGlobalHandlers } from './handlers.ts';
import { clearLogs, createHmrHandler, createLoggerLayer, installDevTools } from './logger.ts';
import { type DebugOverlayProps, renderDebugOverlay } from './overlay.tsx';
import { observePerformance } from './performance.ts';
import type { LogEntry } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type DevSessionConfig = {
    readonly app: string;
    readonly env: Readonly<Record<string, unknown>>;
    readonly startTime?: number;
};

type DebugDispatch = {
    readonly error: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
    readonly info: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
    readonly log: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
    readonly warn: (msg: string, ctx?: Readonly<Record<string, unknown>>) => void;
};

type SessionContextValue = {
    readonly debug: DebugDispatch;
    readonly dispose: () => void;
    readonly layer: Layer.Layer<never>;
    readonly logs: LogEntry[];
    readonly renderDebug: (error: Error, context?: Readonly<Record<string, unknown>>) => void;
    readonly startTime: number;
};

type DevSession = SessionContextValue & {
    readonly SessionProvider: FC<{ readonly children: ReactNode }>;
};

type EnvConfig = {
    readonly console: boolean;
    readonly experimental: boolean;
    readonly logLevel: string;
    readonly performance: boolean;
};

type SessionProviderProps = {
    readonly children: ReactNode;
    readonly value: SessionContextValue;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        console: true,
        experimental: false,
        logLevel: 'Debug',
        performance: true,
        timeoutMs: 1000,
    },
    envKeys: {
        console: 'VITE_DEVTOOLS_CONSOLE',
        experimental: 'VITE_DEVTOOLS_EXPERIMENTAL',
        logLevel: 'VITE_DEVTOOLS_LOG_LEVEL',
        performance: 'VITE_DEVTOOLS_PERFORMANCE',
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

const SessionContext = createContext<SessionContextValue | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const parseBoolean = (value: unknown, fallback: boolean): boolean =>
    value === undefined ? fallback : value === 'true';

const parseEnvConfig = (env: Readonly<Record<string, unknown>>): EnvConfig => ({
    console: parseBoolean(env[B.envKeys.console], B.defaults.console),
    experimental: parseBoolean(env[B.envKeys.experimental], B.defaults.experimental),
    logLevel: (env[B.envKeys.logLevel] as string | undefined) ?? B.defaults.logLevel,
    performance: parseBoolean(env[B.envKeys.performance], B.defaults.performance),
});

const createDebugDispatch = (layer: Layer.Layer<never>): DebugDispatch => {
    const dispatch =
        (level: 'logDebug' | 'logError' | 'logInfo' | 'logWarning') =>
        (msg: string, ctx?: Readonly<Record<string, unknown>>): void => {
            Effect.runFork(Effect[level](msg).pipe(Effect.annotateLogs(ctx ?? {}), Effect.provide(layer)));
        };

    return Object.freeze({
        error: dispatch('logError'),
        info: dispatch('logInfo'),
        log: dispatch('logDebug'),
        warn: dispatch('logWarning'),
    });
};

// --- [COMPONENTS] ------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Internal component, not meant for external use
const SessionProviderInner: FC<SessionProviderProps> = ({ children, value }) => {
    const memoizedValue = useMemo(() => value, [value]);
    return <SessionContext.Provider value={memoizedValue}>{children}</SessionContext.Provider>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createDevSession = (config: DevSessionConfig): DevSession => {
    const isDev = Boolean(config.env['DEV']);
    const envConfig = parseEnvConfig(config.env);
    const startTime = config.startTime ?? performance.now();
    const envMode = (config.env['MODE'] as string | undefined) ?? 'production';

    const { layer: loggerLayer, logs } = createLoggerLayer({
        logLevel: isDev ? envConfig.logLevel : 'Info',
    });

    const { isEnabled: effectDevToolsEnabled, layer: effectDevToolsLayer } = createDevToolsLayerSafe({
        enabled: isDev && envConfig.experimental,
        timeoutMs: B.defaults.timeoutMs,
    });

    const combinedLayer: Layer.Layer<never> =
        isDev && effectDevToolsEnabled ? Layer.mergeAll(effectDevToolsLayer, loggerLayer) : loggerLayer;

    const renderDebug = (error: Error, context?: Readonly<Record<string, unknown>>): void => {
        const props: DebugOverlayProps = { context, env: envMode, error, logs, startTime };
        renderDebugOverlay(props);
    };

    const consoleInterceptor = isDev && envConfig.console ? interceptConsole({ logs }) : { restore: () => {} };

    const performanceObserver =
        isDev && envConfig.performance ? observePerformance({ loggerLayer, logs }) : { disconnect: () => {} };

    const handlersResult = installGlobalHandlers({ loggerLayer, onError: renderDebug });

    isDev && createHmrHandler(logs, loggerLayer);

    isDev && installDevTools({ env: envMode, loggerLayer, logs, renderDebug, startTime });

    const dispose = (): void => {
        consoleInterceptor.restore();
        performanceObserver.disconnect();
        handlersResult.uninstall();
        clearLogs(logs);
    };

    const debug = createDebugDispatch(combinedLayer);

    const sessionValue: SessionContextValue = {
        debug,
        dispose,
        layer: combinedLayer,
        logs,
        renderDebug,
        startTime,
    };

    const SessionProvider: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <SessionProviderInner value={sessionValue}>{children}</SessionProviderInner>
    );

    return Object.freeze({ ...sessionValue, SessionProvider });
};

const useSession = (): SessionContextValue | null => useContext(SessionContext);

// --- [EXPORT] ----------------------------------------------------------------

export type { DebugDispatch, DevSession, DevSessionConfig, EnvConfig, SessionContextValue };
export { B as SESSION_TUNING, createDevSession, SessionContext, useSession };
