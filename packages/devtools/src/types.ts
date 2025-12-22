/**
 * Define core schemas and utilities for devtools type validation and log formatting.
 */
import { LogLevel, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type LogEntry = S.Schema.Type<typeof LogEntrySchema>;
type DevToolsConfig = S.Schema.Type<typeof DevToolsConfigSchema>;
type OverlayConfig = S.Schema.Type<typeof OverlayConfigSchema>;
type EnvRecord = Readonly<Record<string, unknown>>;

// --- [SCHEMA] ----------------------------------------------------------------

const LogLevelLiteral = S.Union(
    S.Literal('Debug'),
    S.Literal('Info'),
    S.Literal('Warning'),
    S.Literal('Error'),
    S.Literal('Fatal'),
);

const LogEntrySchema = S.Struct({
    annotations: S.Record({ key: S.String, value: S.Unknown }),
    fiberId: S.String,
    level: LogLevelLiteral,
    message: S.String,
    spans: S.Record({ key: S.String, value: S.Number }),
    timestamp: S.DateFromSelf,
});

const OverlayConfigSchema = S.Struct({
    colors: S.optional(
        S.Struct({
            bg: S.String,
            errorBorder: S.String,
            errorColor: S.String,
            infoBorder: S.String,
            infoColor: S.String,
            preBg: S.String,
            successColor: S.String,
            textMuted: S.String,
            warnColor: S.String,
        }),
    ),
    font: S.optional(S.Struct({ mono: S.String })),
    layout: S.optional(
        S.Struct({
            borderRadius: S.String,
            maxWidth: S.String,
            padding: S.String,
        }),
    ),
});

const DevToolsConfigSchema = S.Struct({
    app: S.String,
    env: S.Record({ key: S.String, value: S.Unknown }),
    logLevel: S.optional(LogLevelLiteral),
    maxLogs: S.optional(S.Number.pipe(S.int(), S.between(50, 1000))),
    overlay: S.optional(OverlayConfigSchema),
    rootId: S.optional(S.String),
    verifyDelayMs: S.optional(S.Number.pipe(S.int(), S.positive())),
});

// --- [CONSTANTS] -------------------------------------------------------------

type LogLevelKey = S.Schema.Type<typeof LogLevelLiteral>;

const B = Object.freeze({
    defaults: {
        logLevel: 'Info' as const satisfies LogLevelKey,
        maxLogs: 200,
        rootId: 'root',
        verifyDelayMs: 100,
    },
    format: {
        durationPrecision: { ms: 1, seconds: 2 },
        levelPad: 5,
        msPerSecond: 1000,
        timeSlice: { end: 23, start: 11 },
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const safeString = (value: unknown): string =>
    (typeof value === 'string' ? value : null) ??
    (typeof value !== 'object' || value === null ? String(value) : null) ??
    Object.prototype.toString.call(value);

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(safeString(value)));

const formatDuration = (ms: number): string =>
    ms < B.format.msPerSecond
        ? `${ms.toFixed(B.format.durationPrecision.ms)}ms`
        : `${(ms / B.format.msPerSecond).toFixed(B.format.durationPrecision.seconds)}s`;

const formatLogEntry = (entry: LogEntry): string => {
    const time = entry.timestamp.toISOString().slice(B.format.timeSlice.start, B.format.timeSlice.end);
    const spans = Object.entries(entry.spans)
        .map(([k, v]) => `${k}=${v}ms`)
        .join(' ');
    const spanStr = spans ? ` [${spans}]` : '';
    return `${time} ${entry.level.padEnd(B.format.levelPad)} ${entry.message}${spanStr}`;
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const logLevelMap = Object.freeze({
    Debug: LogLevel.Debug,
    Error: LogLevel.Error,
    Fatal: LogLevel.Fatal,
    Info: LogLevel.Info,
    Warning: LogLevel.Warning,
} as const satisfies Record<string, LogLevel.LogLevel>);

const isLogLevelKey = (level: string): level is LogLevelKey => Object.hasOwn(logLevelMap, level);

const parseLogLevel = (level: string | undefined): LogLevel.LogLevel =>
    level !== undefined && isLogLevelKey(level) ? logLevelMap[level] : logLevelMap[B.defaults.logLevel];

// --- [EXPORT] ----------------------------------------------------------------

export type { DevToolsConfig, EnvRecord, LogEntry, LogLevelKey, OverlayConfig };
export {
    B as TYPES_TUNING,
    DevToolsConfigSchema,
    formatDuration,
    formatLogEntry,
    LogEntrySchema,
    LogLevelLiteral,
    OverlayConfigSchema,
    parseLogLevel,
    toError,
};
