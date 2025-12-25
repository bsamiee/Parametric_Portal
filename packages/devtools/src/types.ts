/**
 * Core schemas, constants, and utilities for devtools type validation and log formatting.
 * Single source of truth for all devtools configuration and level transformations.
 */
import { type Effect, LogLevel, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type LogEntry = S.Schema.Type<typeof LogEntrySchema>;
type DevToolsConfig = S.Schema.Type<typeof DevToolsConfigSchema>;
type OverlayConfig = S.Schema.Type<typeof OverlayConfigSchema>;
type LoggerConfig = S.Schema.Type<typeof LoggerConfigSchema>;
type ConsoleMethod = S.Schema.Type<typeof ConsoleMethodLiteral>;
type PerformanceEntryType = S.Schema.Type<typeof PerformanceEntryTypeLiteral>;
type LogLevelKey = S.Schema.Type<typeof LogLevelLiteral>;
type EnvRecord = Readonly<Record<string, unknown>>;
type LogEntrySource = { readonly fiberId: string; readonly annotations: Record<string, unknown> };

// --- [SCHEMA] ----------------------------------------------------------------

const LogLevelLiteral = S.Union(
    S.Literal('Debug'),
    S.Literal('Info'),
    S.Literal('Warning'),
    S.Literal('Error'),
    S.Literal('Fatal'),
);
const ConsoleMethodLiteral = S.Union(
    S.Literal('debug'),
    S.Literal('error'),
    S.Literal('info'),
    S.Literal('log'),
    S.Literal('warn'),
);
const PerformanceEntryTypeLiteral = S.Union(
    S.Literal('first-input'),
    S.Literal('largest-contentful-paint'),
    S.Literal('layout-shift'),
    S.Literal('longtask'),
    S.Literal('resource'),
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
const LoggerConfigSchema = S.Struct({
    logLevel: S.optional(LogLevelLiteral),
    maxLogs: S.optional(S.Number.pipe(S.int(), S.between(50, 1000))),
    silent: S.optional(S.Boolean),
});
const ConsoleInterceptConfigSchema = S.Struct({
    methods: S.optional(S.Array(ConsoleMethodLiteral)),
});
const PerformanceObserverConfigSchema = S.Struct({
    entryTypes: S.optional(S.Array(PerformanceEntryTypeLiteral)),
});
const DevSessionConfigSchema = S.Struct({
    app: S.String,
    env: S.Record({ key: S.String, value: S.Unknown }),
    startTime: S.optional(S.Number),
});

// --- [CONSTANTS] -------------------------------------------------------------

const DEVTOOLS_TUNING = Object.freeze({
    boundary: {
        fallbackText: 'Something went wrong',
        messages: {
            boundaryCaught: 'Error boundary caught',
            reactCaught: 'React caught error',
            reactRecoverable: 'React recoverable error',
            reactUncaught: 'React uncaught error',
        },
        phases: {
            boundary: 'error-boundary',
            caught: 'react-caught',
            recoverable: 'react-recoverable',
            uncaught: 'react-uncaught',
        },
    },
    console: {
        methods: ['log', 'info', 'warn', 'error', 'debug'] as ReadonlyArray<ConsoleMethod>,
    },
    defaults: {
        console: true,
        experimental: false,
        logLevel: 'Info' as const satisfies LogLevelKey,
        maxLogs: 200,
        performance: true,
        rootId: 'root',
        timeoutMs: 1000,
        verifyDelayMs: 16,
    },
    env: {
        buildModes: { development: 'development', production: 'production' } as const,
        defaults: {
            console: 'true',
            experimental: 'true',
            logLevel: 'Debug',
            performance: 'true',
            version: '0.0.0',
        },
        keys: {
            appVersion: 'APP_VERSION',
            baseUrl: 'BASE_URL',
            buildMode: 'BUILD_MODE',
            buildTime: 'BUILD_TIME',
            console: 'VITE_DEVTOOLS_CONSOLE',
            dev: 'DEV',
            experimental: 'VITE_DEVTOOLS_EXPERIMENTAL',
            logLevel: 'VITE_DEVTOOLS_LOG_LEVEL',
            mode: 'MODE',
            performance: 'VITE_DEVTOOLS_PERFORMANCE',
            prod: 'PROD',
            ssr: 'SSR',
            viteApiUrl: 'VITE_API_URL',
        } as const,
        required: ['MODE', 'BASE_URL', 'DEV', 'PROD'] as const,
    },
    experimental: {
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
    },
    format: {
        durationPrecision: { ms: 1, seconds: 2 },
        levelPad: 5,
        msPerSecond: 1000,
        timeSlice: { end: 23, start: 11 },
    },
    handlers: {
        messages: {
            globalError: 'Global error',
            unhandledRejection: 'Unhandled rejection',
        },
        phases: {
            global: 'global',
            rejection: 'unhandled-rejection',
        },
    },
    hooks: {
        errors: {
            missingProvider: 'useDevSession requires DevSession.SessionProvider in component tree',
        },
    },
    overlay: {
        colors: {
            bg: 'oklch(0.12 0.02 260)',
            errorBorder: 'oklch(0.55 0.25 25)',
            errorColor: 'oklch(0.70 0.20 25)',
            infoBorder: 'oklch(0.50 0.20 260)',
            infoColor: 'oklch(0.75 0.15 260)',
            preBg: 'oklch(0.15 0.02 260)',
            successColor: 'oklch(0.70 0.20 145)',
            text: '#fff',
            textMuted: 'oklch(0.70 0.02 260)',
            warnColor: 'oklch(0.75 0.20 85)',
        },
        font: {
            mono: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
        },
        layout: {
            accentBorder: '4px',
            borderRadius: '8px',
            cardMinWidth: '200px',
            fontSize: { h1: '1.5rem', h2: '1rem', label: '0.75rem', logEntry: '0.8rem', stackTrace: '0.85rem' },
            fontWeight: { bold: 600 },
            lineHeight: 1.6,
            logMaxHeight: '400px',
            maxWidth: '900px',
            padding: '2rem',
            spacing: { lg: '1.5rem', md: '1rem', sm: '0.5rem', xs: '0.25rem' },
        },
        text: {
            emptyLogs: 'No logs captured',
            noStack: 'No stack trace available',
            title: 'Application Failed to Load',
        },
    },
    performance: {
        entryTypes: [
            'longtask',
            'layout-shift',
            'first-input',
            'largest-contentful-paint',
        ] as ReadonlyArray<PerformanceEntryType>,
        thresholds: {
            longTask: 50,
        },
    },
    trace: {
        noop: () => {},
        noopEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
    },
    vitePlugin: {
        defaults: {
            app: 'app',
        },
        virtualModule: {
            id: 'virtual:devtools',
            resolvedId: '\0virtual:devtools',
        },
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const LEVEL_TRANSFORMS = Object.freeze({
    fromConsoleMethod: {
        debug: 'Debug',
        error: 'Error',
        info: 'Info',
        log: 'Info',
        warn: 'Warning',
    } as const satisfies Record<ConsoleMethod, LogLevelKey>,
    fromEffectLabel: {
        debug: 'Debug',
        error: 'Error',
        fatal: 'Fatal',
        info: 'Info',
        none: 'Debug',
        trace: 'Debug',
        warn: 'Warning',
        warning: 'Warning',
    } as const satisfies Record<string, LogLevelKey>,
    toColor: {
        Debug: 'oklch(0.70 0.02 260)',
        Error: 'oklch(0.70 0.20 25)',
        Fatal: 'oklch(0.55 0.25 25)',
        Info: 'oklch(0.75 0.15 260)',
        Warning: 'oklch(0.75 0.20 85)',
    } as const satisfies Record<LogLevelKey, string>,
    toEffectLevel: {
        Debug: LogLevel.Debug,
        Error: LogLevel.Error,
        Fatal: LogLevel.Fatal,
        Info: LogLevel.Info,
        Warning: LogLevel.Warning,
    } as const satisfies Record<LogLevelKey, LogLevel.LogLevel>,
} as const);
const isLogLevelKey = (level: string): level is LogLevelKey => Object.hasOwn(LEVEL_TRANSFORMS.toEffectLevel, level);
const parseLogLevel = (level: string | undefined): LogLevel.LogLevel =>
    level !== undefined && isLogLevelKey(level)
        ? LEVEL_TRANSFORMS.toEffectLevel[level]
        : LEVEL_TRANSFORMS.toEffectLevel[DEVTOOLS_TUNING.defaults.logLevel];
const getLevelColor = (level: LogLevelKey): string => LEVEL_TRANSFORMS.toColor[level];
const mapEffectLabel = (effectLabel: string): LogLevelKey =>
    (LEVEL_TRANSFORMS.fromEffectLabel as Record<string, LogLevelKey>)[effectLabel.toLowerCase()] ?? 'Info';
const mapConsoleMethod = (method: ConsoleMethod): LogLevelKey => LEVEL_TRANSFORMS.fromConsoleMethod[method];

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const safeString = (value: unknown): string =>
    (typeof value === 'string' ? value : null) ??
    (typeof value !== 'object' || value === null ? String(value) : null) ??
    Object.prototype.toString.call(value);
const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(safeString(value)));
const formatDuration = (ms: number): string =>
    ms < DEVTOOLS_TUNING.format.msPerSecond
        ? `${ms.toFixed(DEVTOOLS_TUNING.format.durationPrecision.ms)}ms`
        : `${(ms / DEVTOOLS_TUNING.format.msPerSecond).toFixed(DEVTOOLS_TUNING.format.durationPrecision.seconds)}s`;
const formatLogEntry = (entry: LogEntry): string => {
    const time = entry.timestamp
        .toISOString()
        .slice(DEVTOOLS_TUNING.format.timeSlice.start, DEVTOOLS_TUNING.format.timeSlice.end);
    const spans = Object.entries(entry.spans)
        .map(([k, v]) => `${k}=${v}ms`)
        .join(' ');
    const spanStr = spans ? ` [${spans}]` : '';
    return `${time} ${entry.level.padEnd(DEVTOOLS_TUNING.format.levelPad)} ${entry.message}${spanStr}`;
};
const createLogEntry = (
    source: LogEntrySource,
    level: LogLevelKey,
    message: string,
    spans?: Record<string, number>,
): LogEntry => ({
    annotations: source.annotations,
    fiberId: source.fiberId,
    level,
    message,
    spans: spans ?? {},
    timestamp: new Date(),
});
const stringifyArgs = (args: ReadonlyArray<unknown>): string =>
    args.map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg))).join(' ');
const stringifyMessage = (message: unknown): string =>
    (Array.isArray(message) ? message.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') : null) ??
    (typeof message === 'string' ? message : null) ??
    JSON.stringify(message);

// --- [EXPORT] ----------------------------------------------------------------

export type {
    ConsoleMethod,
    DevToolsConfig,
    EnvRecord,
    LogEntry,
    LogEntrySource,
    LoggerConfig,
    LogLevelKey,
    OverlayConfig,
    PerformanceEntryType,
};
export {
    ConsoleInterceptConfigSchema,
    ConsoleMethodLiteral,
    createLogEntry,
    DevSessionConfigSchema,
    DevToolsConfigSchema,
    DEVTOOLS_TUNING,
    formatDuration,
    formatLogEntry,
    getLevelColor,
    isLogLevelKey,
    LEVEL_TRANSFORMS,
    LogEntrySchema,
    LoggerConfigSchema,
    LogLevelLiteral,
    mapConsoleMethod,
    mapEffectLabel,
    OverlayConfigSchema,
    parseLogLevel,
    PerformanceEntryTypeLiteral,
    PerformanceObserverConfigSchema,
    safeString,
    stringifyArgs,
    stringifyMessage,
    toError,
};
