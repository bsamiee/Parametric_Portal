/**
 * Create Effect logger with accumulating buffer for error overlay debug display.
 */
import { Effect, Layer, List, Logger, LogLevel } from 'effect';
import type { LogEntry } from './types.ts';
import { formatLogEntry, parseLogLevel } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type LoggerConfig = {
    readonly logLevel?: string | undefined;
    readonly maxLogs?: number | undefined;
};

type AccumulatingLoggerResult = {
    readonly logger: Logger.Logger<unknown, void>;
    readonly logs: LogEntry[];
};

type CombinedLoggerResult = {
    readonly logger: Logger.Logger<unknown, void>;
    readonly logs: LogEntry[];
};

type LoggerLayerResult = {
    readonly layer: Layer.Layer<never, never, never>;
    readonly logs: LogEntry[];
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        level: LogLevel.Info,
        maxLogs: 200,
    },
    // Effect uses 'WARN' not 'WARNING'; map both to 'Warning'
    levelMap: Object.freeze({
        debug: 'Debug',
        error: 'Error',
        fatal: 'Fatal',
        info: 'Info',
        none: 'Debug',
        trace: 'Debug',
        warn: 'Warning',
        warning: 'Warning',
    }) as Readonly<Record<string, LogEntry['level']>>,
    noop: () => {},
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mapEffectLevel = (effectLabel: string): LogEntry['level'] => B.levelMap[effectLabel.toLowerCase()] ?? 'Info';

const extractMessage = (message: unknown): string => {
    const handlers = {
        array: (m: unknown[]) => m.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '),
        other: (m: unknown) => JSON.stringify(m),
        string: (m: string) => m,
    } as const;

    if (Array.isArray(message)) {
        return handlers.array(message);
    }
    if (typeof message === 'string') {
        return handlers.string(message);
    }
    return handlers.other(message);
};

// Circular buffer: O(n) splice amortized across many insertions
const truncateLogs = (logs: LogEntry[], maxLogs: number): void => {
    const excess = logs.length - maxLogs + 1;
    excess > 0 && logs.splice(0, excess);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createAccumulatingLogger = (config: { maxLogs: number }): AccumulatingLoggerResult => {
    const logs: LogEntry[] = [];
    const logger = Logger.make<unknown, void>(({ annotations, date, fiberId, logLevel, message, spans }) => {
        const spanEntries = List.toArray(
            List.map(spans, (span): [string, number] => [span.label, Date.now() - span.startTime]),
        );

        truncateLogs(logs, config.maxLogs);
        logs.push({
            annotations: Object.fromEntries(annotations),
            fiberId: String(fiberId),
            level: mapEffectLevel(logLevel.label),
            message: extractMessage(message),
            spans: Object.fromEntries(spanEntries),
            timestamp: date,
        });
    });

    return { logger, logs };
};

const createCombinedLogger = (config: { maxLogs: number; silent?: boolean | undefined }): CombinedLoggerResult => {
    const { logger: accumulating, logs } = createAccumulatingLogger(config);
    return {
        logger: config.silent ? accumulating : Logger.zip(Logger.prettyLogger(), accumulating),
        logs,
    };
};

const createLoggerLayer = (config: Partial<LoggerConfig & { silent?: boolean }> = {}): LoggerLayerResult => {
    const { logger, logs } = createCombinedLogger({
        maxLogs: config.maxLogs ?? B.defaults.maxLogs,
        silent: config.silent,
    });
    const level = parseLogLevel(config.logLevel);
    const layer = Layer.mergeAll(
        Logger.replace(Logger.defaultLogger, Logger.map(logger, B.noop)),
        Logger.minimumLogLevel(level),
    );

    return { layer, logs };
};

const getLogs = (logs: ReadonlyArray<LogEntry>): ReadonlyArray<LogEntry> => [...logs];
const getLogsFormatted = (logs: ReadonlyArray<LogEntry>): string =>
    logs.map((entry) => formatLogEntry(entry)).join('\n');
const getLogsJson = (logs: ReadonlyArray<LogEntry>): string => JSON.stringify(logs, null, 2);

// --- [HMR_SUPPORT] -----------------------------------------------------------

const clearLogs = (logs: LogEntry[]): void => {
    logs.length = 0;
};

const createHmrHandler = (logs: LogEntry[], loggerLayer: Layer.Layer<never, never, never>): (() => void) => {
    const handler = (): void => {
        clearLogs(logs);
        Effect.runSync(
            Effect.logInfo('HMR: Logs cleared').pipe(
                Effect.annotateLogs({ source: 'hmr' }),
                Effect.provide(loggerLayer),
            ),
        );
    };

    import.meta.hot?.on('vite:beforeUpdate', handler);

    return handler;
};

// --- [DEV_TOOLS] -------------------------------------------------------------

type DevToolsInstallConfig = {
    readonly env: string;
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly logs: ReadonlyArray<LogEntry>;
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

const installDevTools = (config: DevToolsInstallConfig): DevToolsGlobal => {
    const devTools: DevToolsGlobal = {
        appDebug: {
            env: config.env,
            logLevel: LogLevel.Debug,
            logs: config.logs,
            startTime: config.startTime,
        },
        appGetLogs: () => getLogsFormatted(config.logs),
        appGetLogsJson: () => getLogsJson(config.logs),
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
                ).pipe(Effect.provide(config.loggerLayer)),
            ),
        appRenderDebug: () => config.renderDebug(new Error('Manual debug render'), { source: 'devtools' }),
    };

    Object.assign(globalThis, devTools);
    return devTools;
};

// --- [EXPORT] ----------------------------------------------------------------

export type {
    AccumulatingLoggerResult,
    CombinedLoggerResult,
    DevToolsGlobal,
    DevToolsInstallConfig,
    LoggerConfig,
    LoggerLayerResult,
};
export {
    B as LOGGER_TUNING,
    clearLogs,
    createAccumulatingLogger,
    createCombinedLogger,
    createHmrHandler,
    createLoggerLayer,
    extractMessage,
    getLogs,
    getLogsFormatted,
    getLogsJson,
    installDevTools,
    mapEffectLevel,
};
