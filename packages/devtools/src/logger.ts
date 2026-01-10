/**
 * Create Effect logger with accumulating buffer for error overlay debug display.
 * Single factory pattern returning frozen API object.
 */
import { Effect, Layer, List, Logger, LogLevel } from 'effect';
import {
    DEVTOOLS_TUNING,
    formatLogEntry,
    type LogEntry,
    type LoggerConfig,
    mapEffectLabel,
    parseLogLevel,
    stringifyMessage,
} from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type LoggerAPI = {
    readonly layer: Layer.Layer<never, never, never>;
    readonly logs: LogEntry[];
    readonly clear: () => void;
    readonly getFormatted: () => string;
    readonly getJson: () => string;
    readonly getLogs: () => ReadonlyArray<LogEntry>;
    readonly createHmrHandler: () => () => void;
    readonly installDevTools: (config: DevToolsInstallConfig) => DevToolsGlobal;
};
type DevToolsInstallConfig = {
    readonly env: string;
    readonly renderDebug: (error: Error, context?: Record<string, unknown>) => void;
    readonly startTime: number;
};
type DevToolsGlobal = {
    readonly appDebug: {
        readonly env: string;
        readonly logLevel: typeof LogLevel.Debug;
        readonly logs: ReadonlyArray<LogEntry>;
        readonly startTime: number;
    };
    readonly appGetLogs: () => string;
    readonly appGetLogsJson: () => string;
    readonly appLogTest: () => void;
    readonly appRenderDebug: () => void;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const truncateLogs = (logs: LogEntry[], maxLogs: number): void => {
    const excess = logs.length - maxLogs + 1;
    excess > 0 && logs.splice(0, excess);
};
const clearLogs = (logs: LogEntry[]): void => {
    // biome-ignore lint/style/noParameterAssign: HMR requires in-place clearing to preserve array reference across module reloads
    logs.length = 0;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createLogger = (config?: Partial<LoggerConfig>): LoggerAPI => {
    const maxLogs = config?.maxLogs ?? DEVTOOLS_TUNING.defaults.maxLogs;
    const silent = config?.silent ?? false;
    const logLevelString = config?.logLevel ?? DEVTOOLS_TUNING.defaults.logLevel;
    const logs: LogEntry[] = [];
    const accumulatingLogger = Logger.make<unknown, void>(
        ({ annotations, date, fiberId, logLevel, message, spans }) => {
            const spanEntries = List.toArray(
                List.map(spans, (span): [string, number] => [span.label, Date.now() - span.startTime]),
            );
            truncateLogs(logs, maxLogs);
            logs.push({
                annotations: Object.fromEntries(annotations),
                fiberId: String(fiberId),
                level: mapEffectLabel(logLevel.label),
                message: stringifyMessage(message),
                spans: Object.fromEntries(spanEntries),
                timestamp: date,
            });
        },
    );
    const combinedLogger = silent ? accumulatingLogger : Logger.zip(Logger.prettyLogger(), accumulatingLogger);
    const level = parseLogLevel(logLevelString);
    const layer = Layer.mergeAll(
        Logger.replace(
            Logger.defaultLogger,
            Logger.map(combinedLogger, () => {}),
        ),
        Logger.minimumLogLevel(level),
    );
    const clear = (): void => clearLogs(logs);
    const getLogs = (): ReadonlyArray<LogEntry> => [...logs];
    const getFormatted = (): string => logs.map((entry) => formatLogEntry(entry)).join('\n');
    const getJson = (): string => JSON.stringify(logs, null, 2);
    const createHmrHandler = (): (() => void) => {
        const handler = (): void => {
            clearLogs(logs);
            Effect.runSync(
                Effect.logInfo('HMR: Logs cleared').pipe(Effect.annotateLogs({ source: 'hmr' }), Effect.provide(layer)),
            );
        };
        import.meta.hot?.on('vite:beforeUpdate', handler);
        return handler;
    };
    const installDevTools = (installConfig: DevToolsInstallConfig): DevToolsGlobal => {
        const devTools: DevToolsGlobal = {
            appDebug: {
                env: installConfig.env,
                logLevel: LogLevel.Debug,
                logs,
                startTime: installConfig.startTime,
            },
            appGetLogs: getFormatted,
            appGetLogsJson: getJson,
            appLogTest: () =>
                Effect.runFork(
                    Logger.withMinimumLogLevel(
                        Effect.gen(function* () {
                            yield* Effect.logDebug('Debug test');
                            yield* Effect.logInfo('Info test');
                            yield* Effect.logWarning('Warning test');
                            yield* Effect.logError('Error test');
                        }).pipe(Effect.withLogSpan('manual-test'), Effect.annotateLogs({ source: 'devtools' })),
                        LogLevel.Debug,
                    ).pipe(Effect.provide(layer)),
                ),
            appRenderDebug: () => installConfig.renderDebug(new Error('Manual debug render'), { source: 'devtools' }),
        };
        Object.assign(globalThis, devTools);
        return devTools;
    };
    return Object.freeze({
        clear,
        createHmrHandler,
        getFormatted,
        getJson,
        getLogs,
        installDevTools,
        layer,
        logs,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsGlobal, DevToolsInstallConfig, LoggerAPI };
export { createLogger };
