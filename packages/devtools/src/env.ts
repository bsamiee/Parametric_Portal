/**
 * Validate Vite environment variables with type-safe schema defaults.
 */
import { Effect, pipe, Schema as S } from 'effect';
import { DEVTOOLS_TUNING } from './types.ts';

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

const T = DEVTOOLS_TUNING.env;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const normalizeEnv = (raw: RawEnv): Record<string, unknown> => ({
    [T.keys.appVersion]: raw[T.keys.appVersion] ?? T.defaults.version,
    [T.keys.baseUrl]: raw[T.keys.baseUrl],
    [T.keys.buildMode]: raw[T.keys.buildMode],
    [T.keys.buildTime]: raw[T.keys.buildTime],
    [T.keys.dev]: Boolean(raw[T.keys.dev]),
    [T.keys.console]: raw[T.keys.console] ?? T.defaults.console,
    [T.keys.experimental]: raw[T.keys.experimental] ?? T.defaults.experimental,
    [T.keys.logLevel]: raw[T.keys.logLevel] ?? T.defaults.logLevel,
    [T.keys.performance]: raw[T.keys.performance] ?? T.defaults.performance,
    [T.keys.mode]: raw[T.keys.mode],
    [T.keys.prod]: Boolean(raw[T.keys.prod]),
    [T.keys.ssr]: raw[T.keys.ssr] === undefined ? undefined : Boolean(raw[T.keys.ssr]),
    [T.keys.viteApiUrl]: raw[T.keys.viteApiUrl],
});

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
export { createEnv, createEnvSync, DevToolsEnvSchema, EnvSchema, EnvValidationError };
