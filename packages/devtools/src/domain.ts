import { Data, LogLevel, Predicate, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = (() => {
    const LogLevel = S.Literal('Debug', 'Info', 'Warning', 'Error', 'Fatal');
    const ConsoleMethod = S.Literal('debug', 'log', 'info', 'warn', 'error');
    const Context = S.Struct({
        appNamespace: S.optional(S.String),
        causationId: S.optional(S.String),
        correlationId: S.optional(S.String),
        requestId: S.optional(S.String),
        runnerId: S.optional(S.String),
        shardId: S.optional(S.String),
        tenantId: S.optional(S.String),
    });
    const EventLog = S.Struct({
        disablePing: S.optionalWith(S.Boolean, { default: () => false }),
        enabled: S.optionalWith(S.Boolean, { default: () => true }),
        path: S.optionalWith(S.String, { default: () => '/internal/devtools/events' }),
        remoteUrl: S.optionalWith(S.String, { default: () => 'ws://localhost:34438/internal/devtools/events' }),
    });
    return {
        BootstrapConfig: S.Struct({
            appName: S.optionalWith(S.String, { default: () => 'app' }),
            appVersion: S.optional(S.String),
            isDev: S.optionalWith(S.Boolean, { default: () => false }),
            rootId: S.optionalWith(S.String, { default: () => 'root' }),
            verifyDelayMs: S.optionalWith(S.Number.pipe(S.int(), S.positive()), { default: () => 16 }),
        }),
        ConsoleMethod,
        Context,
        LogEntry: S.Struct({
            annotations: S.Record({ key: S.String, value: S.Unknown }),
            context: Context,
            fiberId: S.String,
            level: LogLevel,
            message: S.String,
            spans: S.Record({ key: S.String, value: S.Number }),
            timestamp: S.Date,
        }),
        LogLevel,
        RelayConfig: S.Struct({
            context: S.optionalWith(Context, { default: () => ({}) }),
            eventLog: S.optionalWith(EventLog, {
                default: () => ({
                    disablePing: false,
                    enabled: true,
                    path: '/internal/devtools/events',
                    remoteUrl: 'ws://localhost:34438/internal/devtools/events',
                }),
            }),
            requestMetricsEveryMs: S.optionalWith(S.Number.pipe(S.int(), S.positive()), { default: () => 1000 }),
        }),
        RelayEnvelope: S.Struct({
            context: Context,
            payload: S.Unknown,
            receivedAt: S.Date,
            tag: S.Literal('MetricsSnapshot', 'Span', 'SpanEvent'),
        }),
        SessionConfig: S.Struct({
            app: S.optionalWith(S.String, { default: () => 'app' }),
            console: S.optionalWith(S.Boolean, { default: () => true }),
            context: S.optionalWith(Context, { default: () => ({}) }),
            env: S.optionalWith(S.Record({ key: S.String, value: S.Unknown }), { default: () => ({}) }),
            experimental: S.optionalWith(S.Boolean, { default: () => true }),
            logLevel: S.optionalWith(LogLevel, { default: () => 'Info' as const }),
            maxLogs: S.optionalWith(S.Number.pipe(S.int(), S.between(50, 2000)), { default: () => 200 }),
            perf: S.optionalWith(S.Boolean, { default: () => true }),
            rootId: S.optionalWith(S.String, { default: () => 'root' }),
            verifyDelayMs: S.optionalWith(S.Number.pipe(S.int(), S.positive()), { default: () => 16 }),
            wsUrl: S.optionalWith(S.String, { default: () => 'ws://localhost:34437' }),
        }),
        ViteConfig: S.Struct({ app: S.optionalWith(S.String, { default: () => 'app' }) }),
    } as const;
})();

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    env: {
        keys: {
            console: 'VITE_DEVTOOLS_CONSOLE',
            experimental: 'VITE_DEVTOOLS_EXPERIMENTAL',
            logLevel: 'VITE_DEVTOOLS_LOG_LEVEL',
            perf: 'VITE_DEVTOOLS_PERFORMANCE',
        },
    },
    levels: {
        fromConsole: {
            debug: 'Debug',
            error: 'Error',
            info: 'Info',
            log: 'Info',
            warn: 'Warning',
        } as const satisfies Record<
            S.Schema.Type<typeof _SCHEMA.ConsoleMethod>,
            S.Schema.Type<typeof _SCHEMA.LogLevel>
        >,
        fromEffect: {
            debug: 'Debug',
            error: 'Error',
            fatal: 'Fatal',
            info: 'Info',
            none: 'Debug',
            trace: 'Debug',
            warn: 'Warning',
            warning: 'Warning',
        } as const satisfies Record<string, S.Schema.Type<typeof _SCHEMA.LogLevel>>,
        toColor: {
            Debug: 'var(--pp-devtools-log-debug)',
            Error: 'var(--pp-devtools-log-error)',
            Fatal: 'var(--pp-devtools-log-fatal)',
            Info: 'var(--pp-devtools-log-info)',
            Warning: 'var(--pp-devtools-log-warning)',
        } as const satisfies Record<S.Schema.Type<typeof _SCHEMA.LogLevel>, string>,
        toEffect: {
            Debug: LogLevel.Debug,
            Error: LogLevel.Error,
            Fatal: LogLevel.Fatal,
            Info: LogLevel.Info,
            Warning: LogLevel.Warning,
        } as const satisfies Record<S.Schema.Type<typeof _SCHEMA.LogLevel>, LogLevel.LogLevel>,
    },
    performance: {
        entryTypes: ['longtask', 'layout-shift', 'first-input', 'largest-contentful-paint'] as const,
        longTaskThresholdMs: 50,
    },
    trace: { levelPad: 7, timeSlice: { end: 23, start: 11 } },
    vite: { virtualModule: { id: 'virtual:devtools', resolvedId: '\u0000virtual:devtools' } },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class DevtoolsError extends Data.TaggedError('DevtoolsError')<{
    readonly cause?: unknown;
    readonly reason: 'bootstrap' | 'config' | 'relay' | 'runtime';
}> {
    static readonly from = (reason: DevtoolsError['reason'], cause?: unknown) => new DevtoolsError({ cause, reason });
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _isLogLevel = S.is(_SCHEMA.LogLevel);
const _safeString = (value: unknown): string =>
    typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint' ||
            typeof value === 'symbol'
          ? String(value)
          : Object.prototype.toString.call(value);
const _stringifyMessage = (value: unknown): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? value.map(_safeString).join(' ') : _safeString(value);
const _formatDuration = (ms: number): string => (ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`);
const _formatLogEntry = (entry: S.Schema.Type<typeof _SCHEMA.LogEntry>): string => {
    const time = entry.timestamp.toISOString().slice(_CONFIG.trace.timeSlice.start, _CONFIG.trace.timeSlice.end);
    const spans = Object.entries(entry.spans)
        .map(([key, value]) => `${key}=${value}ms`)
        .join(' ');
    return `${time} ${entry.level.padEnd(_CONFIG.trace.levelPad)} ${entry.message}${spans.length > 0 ? ` [${spans}]` : ''}`;
};

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _normalizeSession = (input: unknown) => {
    const raw = Predicate.isRecord(input) ? input : {};
    const env = Predicate.isRecord(raw['env']) ? (raw['env'] as Record<string, unknown>) : {};
    const envBool = (key: string) => {
        const value = env[key];
        return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
    };
    return S.decodeUnknown(_SCHEMA.SessionConfig)({
        ...raw,
        console: typeof raw['console'] === 'boolean' ? raw['console'] : envBool(_CONFIG.env.keys.console),
        experimental:
            typeof raw['experimental'] === 'boolean' ? raw['experimental'] : envBool(_CONFIG.env.keys.experimental),
        logLevel: _isLogLevel(raw['logLevel'])
            ? raw['logLevel']
            : _isLogLevel(env[_CONFIG.env.keys.logLevel])
              ? env[_CONFIG.env.keys.logLevel]
              : undefined,
        perf: typeof raw['perf'] === 'boolean' ? raw['perf'] : envBool(_CONFIG.env.keys.perf),
    });
};
const _normalizeBootstrap = (input: unknown) =>
    S.decodeUnknownSync(_SCHEMA.BootstrapConfig)(Predicate.isRecord(input) ? input : {});
const _normalizeRelay = (input: unknown) =>
    S.decodeUnknown(_SCHEMA.RelayConfig)(Predicate.isRecord(input) ? input : {});
const _normalizeVite = (input: unknown) =>
    S.decodeUnknownSync(_SCHEMA.ViteConfig)(Predicate.isRecord(input) ? input : {});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Domain = {
    _CONFIG,
    Error: DevtoolsError,
    formatDuration: _formatDuration,
    formatLogEntry: _formatLogEntry,
    isLogLevel: _isLogLevel,
    mapConsoleMethod: (method: S.Schema.Type<typeof _SCHEMA.ConsoleMethod>): S.Schema.Type<typeof _SCHEMA.LogLevel> =>
        _CONFIG.levels.fromConsole[method],
    mapEffectLevel: (label: string): S.Schema.Type<typeof _SCHEMA.LogLevel> =>
        (_CONFIG.levels.fromEffect as Record<string, S.Schema.Type<typeof _SCHEMA.LogLevel>>)[label.toLowerCase()] ??
        'Info',
    normalizeBootstrap: _normalizeBootstrap,
    normalizeRelay: _normalizeRelay,
    normalizeSession: _normalizeSession,
    normalizeVite: _normalizeVite,
    parseLogLevel: (value: unknown): LogLevel.LogLevel =>
        _isLogLevel(value) ? _CONFIG.levels.toEffect[value] : _CONFIG.levels.toEffect.Info,
    Schema: _SCHEMA,
    stringifyMessage: _stringifyMessage,
    toError: (value: unknown): Error => (value instanceof Error ? value : new Error(_safeString(value))),
    toLevelColor: (value: S.Schema.Type<typeof _SCHEMA.LogLevel>): string => _CONFIG.levels.toColor[value],
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Domain };
