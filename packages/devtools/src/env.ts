/**
 * Validate Vite environment variables with type-safe schema defaults.
 */
import { Effect, pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type Env = S.Schema.Type<typeof EnvSchema>;
type RawEnv = Readonly<Record<string, unknown>>;

class EnvValidationError extends Error {
    readonly _tag = 'EnvValidationError';
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'EnvValidationError';
    }
}

// --- [SCHEMA] ----------------------------------------------------------------

const LogLevelLiteral = S.Union(S.Literal('Debug'), S.Literal('Error'), S.Literal('Info'), S.Literal('Warning'));

const BooleanString = S.Union(S.Literal('true'), S.Literal('false'));

const DevToolsEnvSchema = S.Struct({
    VITE_DEVTOOLS_CONSOLE: S.optional(BooleanString),
    VITE_DEVTOOLS_EXPERIMENTAL: S.optional(BooleanString),
    VITE_DEVTOOLS_LOG_LEVEL: S.optional(LogLevelLiteral),
    VITE_DEVTOOLS_PERFORMANCE: S.optional(BooleanString),
});

const EnvSchema = S.Struct({
    APP_VERSION: S.optional(S.String),
    BASE_URL: S.String,
    BUILD_MODE: S.optional(S.Union(S.Literal('development'), S.Literal('production'))),
    BUILD_TIME: S.optional(S.String),
    DEV: S.Boolean,
    MODE: S.String,
    PROD: S.Boolean,
    SSR: S.optional(S.Boolean),
    VITE_API_URL: S.optional(S.String),
    VITE_DEVTOOLS_CONSOLE: S.optional(BooleanString),
    VITE_DEVTOOLS_EXPERIMENTAL: S.optional(BooleanString),
    VITE_DEVTOOLS_LOG_LEVEL: S.optional(LogLevelLiteral),
    VITE_DEVTOOLS_PERFORMANCE: S.optional(BooleanString),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    buildModes: { development: 'development', production: 'production' } as const,
    defaults: {
        devtools: {
            console: 'true',
            experimental: 'true',
            logLevel: 'Debug',
            performance: 'true',
        },
        version: '0.0.0',
    },
    envKeys: {
        appVersion: 'APP_VERSION',
        baseUrl: 'BASE_URL',
        buildMode: 'BUILD_MODE',
        buildTime: 'BUILD_TIME',
        dev: 'DEV',
        devtoolsConsole: 'VITE_DEVTOOLS_CONSOLE',
        devtoolsExperimental: 'VITE_DEVTOOLS_EXPERIMENTAL',
        devtoolsLogLevel: 'VITE_DEVTOOLS_LOG_LEVEL',
        devtoolsPerformance: 'VITE_DEVTOOLS_PERFORMANCE',
        mode: 'MODE',
        prod: 'PROD',
        ssr: 'SSR',
        viteApiUrl: 'VITE_API_URL',
    } as const,
    required: ['MODE', 'BASE_URL', 'DEV', 'PROD'],
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

// Required fields (MODE, BASE_URL) get NO defaults - schema validation will fail if missing
const normalizeEnv = (raw: RawEnv): Record<string, unknown> => {
    const k = B.envKeys;
    const d = B.defaults;
    return {
        [k.appVersion]: raw[k.appVersion] ?? d.version,
        [k.baseUrl]: raw[k.baseUrl], // Required: no default
        [k.buildMode]: raw[k.buildMode],
        [k.buildTime]: raw[k.buildTime],
        [k.dev]: Boolean(raw[k.dev]),
        [k.devtoolsConsole]: raw[k.devtoolsConsole] ?? d.devtools.console,
        [k.devtoolsExperimental]: raw[k.devtoolsExperimental] ?? d.devtools.experimental,
        [k.devtoolsLogLevel]: raw[k.devtoolsLogLevel] ?? d.devtools.logLevel,
        [k.devtoolsPerformance]: raw[k.devtoolsPerformance] ?? d.devtools.performance,
        [k.mode]: raw[k.mode], // Required: no default
        [k.prod]: Boolean(raw[k.prod]),
        [k.ssr]: raw[k.ssr] === undefined ? undefined : Boolean(raw[k.ssr]),
        [k.viteApiUrl]: raw[k.viteApiUrl],
    };
};

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const createEnv = (raw: RawEnv): Effect.Effect<Env, EnvValidationError> =>
    pipe(
        Effect.try({
            catch: (e) => new EnvValidationError(e),
            try: () => {
                const normalized = normalizeEnv(raw);
                return S.decodeUnknownSync(EnvSchema)(normalized);
            },
        }),
    );

const createEnvSync = (raw: RawEnv): Env => {
    const normalized = normalizeEnv(raw);
    return S.decodeUnknownSync(EnvSchema)(normalized);
};

// --- [EXPORT] ----------------------------------------------------------------

export type { Env, RawEnv };
export { B as ENV_TUNING, createEnv, createEnvSync, DevToolsEnvSchema, EnvSchema, EnvValidationError };
