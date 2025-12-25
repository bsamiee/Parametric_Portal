/**
 * Unified session factory composing all devtools features.
 * Reduces app entry from ~130 LOC to ~20 LOC.
 */
import { Effect, Layer } from 'effect';
import { createContext, type FC, type ReactNode, useContext, useMemo } from 'react';
import { interceptConsole } from './console.ts';
import { createDevToolsLayer } from './experimental.ts';
import { installGlobalHandlers } from './handlers.ts';
import { createLogger } from './logger.ts';
import { type DebugOverlayProps, renderDebugOverlay } from './overlay.tsx';
import { createPerformanceObserver } from './performance.ts';
import { DEVTOOLS_TUNING, isLogLevelKey, type LogEntry, type LogLevelKey } from './types.ts';

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
    readonly fatal: (error: Error) => void;
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
    readonly logLevel: LogLevelKey;
    readonly performance: boolean;
};
type SessionProviderProps = {
    readonly children: ReactNode;
    readonly value: SessionContextValue;
};

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING;

// --- [CONTEXT] ---------------------------------------------------------------

const SessionContext = createContext<SessionContextValue | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const parseBoolean = (value: unknown, fallback: boolean): boolean =>
    value === undefined ? fallback : value === 'true';
const parseEnvConfig = (env: Readonly<Record<string, unknown>>): EnvConfig => ({
    console: parseBoolean(env[T.env.keys.console], T.defaults.console),
    experimental: parseBoolean(env[T.env.keys.experimental], T.defaults.experimental),
    logLevel: (() => {
        const raw = env[T.env.keys.logLevel] as string | undefined;
        return raw !== undefined && isLogLevelKey(raw) ? raw : (T.env.defaults.logLevel as LogLevelKey);
    })(),
    performance: parseBoolean(env[T.env.keys.performance], T.defaults.performance),
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
    const logger = createLogger({
        logLevel: isDev ? envConfig.logLevel : 'Info',
    });
    const { isEnabled: effectDevToolsEnabled, layer: effectDevToolsLayer } = createDevToolsLayer({
        enabled: isDev && envConfig.experimental,
        timeoutMs: T.defaults.timeoutMs,
    });
    const combinedLayer: Layer.Layer<never> =
        isDev && effectDevToolsEnabled ? Layer.mergeAll(effectDevToolsLayer, logger.layer) : logger.layer;
    const renderDebug = (error: Error, context?: Readonly<Record<string, unknown>>): void => {
        const props: DebugOverlayProps = { context, env: envMode, error, logs: logger.logs, startTime };
        renderDebugOverlay(props);
    };
    const consoleInterceptor =
        isDev && envConfig.console ? interceptConsole({ logs: logger.logs }) : { restore: () => {} };
    const performanceObserver =
        isDev && envConfig.performance
            ? createPerformanceObserver({ loggerLayer: logger.layer, logs: logger.logs })
            : { disconnect: () => {} };
    const handlersResult = installGlobalHandlers({ loggerLayer: logger.layer, onError: renderDebug });
    isDev && logger.createHmrHandler();
    isDev && logger.installDevTools({ env: envMode, renderDebug, startTime });
    const dispose = (): void => {
        consoleInterceptor.restore();
        performanceObserver.disconnect();
        handlersResult.uninstall();
        logger.clear();
    };
    const debug = createDebugDispatch(combinedLayer);
    const fatal = (error: Error): void => renderDebug(error, { phase: 'fatal' });
    const sessionValue: SessionContextValue = {
        debug,
        dispose,
        fatal,
        layer: combinedLayer,
        logs: logger.logs,
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
export { createDevSession, SessionContext, useSession };
