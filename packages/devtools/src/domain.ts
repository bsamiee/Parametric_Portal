import { Data, LogLevel, Match, Option, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = (() => {
    const SessionConfig = S.Struct({
        app: S.String,
        console: S.Boolean,
        env: S.Record({ key: S.String, value: S.Unknown }),
        experimental: S.Boolean,
        logLevel: S.Literal('Debug', 'Info', 'Warning', 'Error', 'Fatal'),
        maxLogs: S.Number.pipe(S.int(), S.between(50, 2000)),
        perf: S.Boolean,
        rootId: S.String,
        verifyDelayMs: S.Number.pipe(S.int(), S.positive()),
        wsUrl: S.String,
    });
    return {
        BootstrapConfig: S.Struct({
            appName: S.String,
            appVersion: S.Union(S.String, S.Undefined),
            isDev: S.Boolean,
            rootId: S.String,
            verifyDelayMs: S.Number.pipe(S.int(), S.positive()),
        }),
        ConsoleMethod: S.Literal('debug', 'log', 'info', 'warn', 'error'),
        LogLevelKey: S.Literal('Debug', 'Info', 'Warning', 'Error', 'Fatal'),
        RelayConfig: S.Struct({ requestMetricsEveryMs: S.Number.pipe(S.int(), S.positive()) }),
        SessionConfig,
        ViteConfig: SessionConfig.pipe(S.pick('app')),
    } as const;
})();

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    defaults: {
        app: 'app',
        console: true,
        experimental: true,
        logLevel: 'Info',
        maxLogs: 200,
        perf: true,
        rootId: 'root',
        verifyDelayMs: 16,
        wsUrl: 'ws://localhost:34437',
    },
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
            S.Schema.Type<typeof _SCHEMA.LogLevelKey>
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
        } as const satisfies Record<string, S.Schema.Type<typeof _SCHEMA.LogLevelKey>>,
        toColor: {
            Debug: 'oklch(0.70 0.02 260)',
            Error: 'oklch(0.70 0.20 25)',
            Fatal: 'oklch(0.55 0.25 25)',
            Info: 'oklch(0.75 0.15 260)',
            Warning: 'oklch(0.75 0.20 85)',
        } as const satisfies Record<S.Schema.Type<typeof _SCHEMA.LogLevelKey>, string>,
        toEffect: {
            Debug: LogLevel.Debug,
            Error: LogLevel.Error,
            Fatal: LogLevel.Fatal,
            Info: LogLevel.Info,
            Warning: LogLevel.Warning,
        } as const satisfies Record<S.Schema.Type<typeof _SCHEMA.LogLevelKey>, LogLevel.LogLevel>,
    },
    performance: {
        entryTypes: ['longtask', 'layout-shift', 'first-input', 'largest-contentful-paint'] as const,
        longTaskThresholdMs: 50,
    },
    relay: { requestMetricsEveryMs: 1000 },
    trace: { levelPad: 7, timeSlice: { end: 23, start: 11 } },
    vite: {
        virtualModule: {
            id: 'virtual:devtools',
            resolvedId: '\u0000virtual:devtools',
        },
    },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class DevtoolsError extends Data.TaggedError('DevtoolsError')<{
    readonly cause?: unknown;
    readonly reason: 'bootstrap' | 'config' | 'relay' | 'runtime';
}> {
    static readonly from = (reason: DevtoolsError['reason'], cause?: unknown) => new DevtoolsError({ cause, reason });
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _record = (value: unknown): Readonly<Record<string, unknown>> =>
    Match.value(value).pipe(
        Match.when(
            (raw: unknown): raw is Readonly<Record<string, unknown>> => typeof raw === 'object' && raw !== null,
            (raw) => raw,
        ),
        Match.orElse(() => ({})),
    );
const _string = (value: unknown, fallback: string): string =>
    Match.value(value).pipe(
        Match.when(
            (raw: unknown): raw is string => typeof raw === 'string',
            (raw) => raw,
        ),
        Match.orElse(() => fallback),
    );
const _number = (value: unknown, fallback: number): number =>
    Match.value(value).pipe(
        Match.when(
            (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw),
            (raw) => raw,
        ),
        Match.orElse(() => fallback),
    );
const _parseBoolean = (value: unknown, fallback: boolean): boolean =>
    Match.value(value).pipe(
        Match.when(undefined, () => fallback),
        Match.when(true, () => true),
        Match.when(false, () => false),
        Match.when('true', () => true),
        Match.when('false', () => false),
        Match.orElse(() => fallback),
    );
const _safeString = (value: unknown): string =>
    (typeof value === 'string' ? value : null) ??
    (typeof value !== 'object' || value === null ? String(value) : null) ??
    Object.prototype.toString.call(value);
const _isLogLevelKey = (value: unknown): value is S.Schema.Type<typeof _SCHEMA.LogLevelKey> =>
    typeof value === 'string' && Object.hasOwn(_CONFIG.levels.toEffect, value);
const _stringifyMessage = (value: unknown): string =>
    Match.value(value).pipe(
        Match.when(
            (input: unknown): input is string => typeof input === 'string',
            (message) => message,
        ),
        Match.when(
            (input: unknown): input is ReadonlyArray<unknown> => Array.isArray(input),
            (items) => items.map((item) => _safeString(item)).join(' '),
        ),
        Match.orElse((input) => _safeString(input)),
    );
const _formatDuration = (ms: number): string => (ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`);
const _makeLogEntry = (entry: {
    readonly annotations: Readonly<Record<string, unknown>>;
    readonly fiberId: string;
    readonly level: S.Schema.Type<typeof _SCHEMA.LogLevelKey>;
    readonly message: string;
    readonly spans: Readonly<Record<string, number>>;
    readonly timestamp: Date;
}) => entry;
const _formatLogEntry = (entry: ReturnType<typeof _makeLogEntry>): string => {
    const time = entry.timestamp.toISOString().slice(_CONFIG.trace.timeSlice.start, _CONFIG.trace.timeSlice.end);
    const spans = Object.entries(entry.spans)
        .map(([key, value]) => `${key}=${value}ms`)
        .join(' ');
    const suffix = Match.value(spans.length > 0).pipe(
        Match.when(true, () => ` [${spans}]`),
        Match.orElse(() => ''),
    );
    return `${time} ${entry.level.padEnd(_CONFIG.trace.levelPad)} ${entry.message}${suffix}`;
};

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _normalizeSession = (input: unknown) => {
    const raw = _record(input);
    const env = _record(raw['env']);
    const envLogLevel = Match.value(env[_CONFIG.env.keys.logLevel]).pipe(
        Match.when(_isLogLevelKey, (level) => level),
        Match.orElse(() => _CONFIG.defaults.logLevel),
    );
    return S.decodeUnknown(_SCHEMA.SessionConfig)({
        app: _string(raw['app'], _CONFIG.defaults.app),
        console: Match.value(raw['console']).pipe(
            Match.when(true, () => true),
            Match.when(false, () => false),
            Match.orElse(() => _parseBoolean(env[_CONFIG.env.keys.console], _CONFIG.defaults.console)),
        ),
        env,
        experimental: Match.value(raw['experimental']).pipe(
            Match.when(true, () => true),
            Match.when(false, () => false),
            Match.orElse(() => _parseBoolean(env[_CONFIG.env.keys.experimental], _CONFIG.defaults.experimental)),
        ),
        logLevel: Match.value(raw['logLevel']).pipe(
            Match.when(_isLogLevelKey, (level) => level),
            Match.orElse(() => envLogLevel),
        ),
        maxLogs: _number(raw['maxLogs'], _CONFIG.defaults.maxLogs),
        perf: Match.value(raw['perf']).pipe(
            Match.when(true, () => true),
            Match.when(false, () => false),
            Match.orElse(() => _parseBoolean(env[_CONFIG.env.keys.perf], _CONFIG.defaults.perf)),
        ),
        rootId: _string(raw['rootId'], _CONFIG.defaults.rootId),
        verifyDelayMs: _number(raw['verifyDelayMs'], _CONFIG.defaults.verifyDelayMs),
        wsUrl: _string(raw['wsUrl'], _CONFIG.defaults.wsUrl),
    });
};
const _normalizeBootstrap = (input: unknown): S.Schema.Type<typeof _SCHEMA.BootstrapConfig> => {
    const raw = _record(input);
    return S.decodeUnknownSync(_SCHEMA.BootstrapConfig)({
        appName: _string(raw['appName'], _CONFIG.defaults.app),
        appVersion: Match.value(raw['appVersion']).pipe(
            Match.when(
                (value: unknown): value is string => typeof value === 'string',
                (value) => value,
            ),
            Match.orElse(() => undefined),
        ),
        isDev: _parseBoolean(raw['isDev'], false),
        rootId: _string(raw['rootId'], _CONFIG.defaults.rootId),
        verifyDelayMs: _number(raw['verifyDelayMs'], _CONFIG.defaults.verifyDelayMs),
    });
};
const _normalizeRelay = (input: unknown) =>
    S.decodeUnknown(_SCHEMA.RelayConfig)({
        requestMetricsEveryMs: _number(_record(input)['requestMetricsEveryMs'], _CONFIG.relay.requestMetricsEveryMs),
    });
const _normalizeVite = (input: unknown): S.Schema.Type<typeof _SCHEMA.ViteConfig> =>
    S.decodeUnknownSync(_SCHEMA.ViteConfig)({
        app: _string(_record(input)['app'], _CONFIG.defaults.app),
    });

// --- [ENTRY_POINT] -----------------------------------------------------------

const Domain = {
    _CONFIG,
    Error: DevtoolsError,
    formatDuration: _formatDuration,
    formatLogEntry: _formatLogEntry,
    isLogLevelKey: _isLogLevelKey,
    makeLogEntry: _makeLogEntry,
    mapConsoleMethod: (
        method: S.Schema.Type<typeof _SCHEMA.ConsoleMethod>,
    ): S.Schema.Type<typeof _SCHEMA.LogLevelKey> => _CONFIG.levels.fromConsole[method],
    mapEffectLevel: (label: string): S.Schema.Type<typeof _SCHEMA.LogLevelKey> =>
        Option.getOrElse(
            Option.fromNullable(
                (_CONFIG.levels.fromEffect as Record<string, S.Schema.Type<typeof _SCHEMA.LogLevelKey>>)[
                    label.toLowerCase()
                ],
            ),
            () => _CONFIG.defaults.logLevel,
        ),
    normalizeBootstrap: _normalizeBootstrap,
    normalizeRelay: _normalizeRelay,
    normalizeSession: _normalizeSession,
    normalizeVite: _normalizeVite,
    parseBoolean: _parseBoolean,
    parseLogLevel: (value: unknown): LogLevel.LogLevel =>
        Match.value(value).pipe(
            Match.when(_isLogLevelKey, (level) => _CONFIG.levels.toEffect[level]),
            Match.orElse(() => _CONFIG.levels.toEffect[_CONFIG.defaults.logLevel]),
        ),
    Schema: _SCHEMA,
    stringifyMessage: _stringifyMessage,
    toError: (value: unknown): Error => (value instanceof Error ? value : new Error(_safeString(value))),
    toLevelColor: (value: S.Schema.Type<typeof _SCHEMA.LogLevelKey>): string => _CONFIG.levels.toColor[value],
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Domain, DevtoolsError };
