/**
 * HTTP middleware: security (API key, Bearer, Basic), CORS, logging, request ID, security headers.
 * Uses HttpApiMiddleware.Tag pattern with HttpApiSecurity definitions.
 */
import {
    Headers,
    HttpApiBuilder,
    HttpApiMiddleware,
    HttpApiSecurity,
    HttpMiddleware,
    HttpServerRequest,
    HttpServerResponse,
} from '@effect/platform';
import type {
    ApiKeyResult,
    OAuthProvider,
    OAuthTokens,
    OAuthUserInfo,
    SessionResult,
    TokenHash,
} from '@parametric-portal/types/database';

import { Context, Effect, Layer, Option, pipe, Redacted } from 'effect';
import { hashString, validateTokenHash } from './crypto.ts';
import {
    DatabaseConnectionError,
    DatabaseConstraintError,
    DatabaseDeadlockError,
    DatabaseTimeoutError,
    InternalError,
    type OAuthError,
    UnauthorizedError,
} from './errors.ts';

// --- [TYPES] -----------------------------------------------------------------

type CorsConfig = Partial<typeof B.cors>;

type SecurityHeadersConfig = {
    readonly contentTypeOptions?: boolean;
    readonly frameOptions?: 'DENY' | 'SAMEORIGIN';
    readonly hsts?: { maxAge: number; includeSubDomains: boolean } | false;
    readonly referrerPolicy?: string;
};

type BasicCredentials = {
    readonly password: Redacted.Redacted<string>;
    readonly username: string;
};

type RequestIdConfig = {
    readonly headerName?: string;
};

type SqlErrorInput = { readonly code?: string; readonly constraint?: string; readonly message?: string };
type SqlErrorCode = keyof typeof B.sqlCodes;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: {
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] as ReadonlyArray<string>,
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as ReadonlyArray<string>,
        allowedOrigins: ['*'] as ReadonlyArray<string>,
        credentials: true,
        maxAge: 86400,
    },
    requestId: { headerName: 'x-request-id' },
    security: { apiKeyHeader: 'x-api-key' },
    securityHeaders: {
        contentTypeOptions: true,
        frameOptions: 'DENY' as const,
        hsts: { includeSubDomains: true, maxAge: 31536000 },
        referrerPolicy: 'strict-origin-when-cross-origin',
    },
    // PostgreSQL error codes mapped to handler types. Multiple codes can map to same handler:
    // - 40P01 (serialization_failure) and 40001 (deadlock_detected) both indicate deadlock
    // - 08001 and 08006 both indicate connection issues
    sqlCodes: {
        '40P01': 'deadlock',
        '55P03': 'lockTimeout',
        '08001': 'connectionLost',
        '08006': 'connectionLost',
        '23502': 'notNull',
        '23503': 'foreignKey',
        '23505': 'unique',
        '23514': 'check',
        '40001': 'deadlock',
        '53300': 'poolExhausted',
        '57014': 'statementTimeout',
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class ApiKeyContext extends Context.Tag('ApiKeyContext')<ApiKeyContext, ApiKeyResult>() {}
class BearerTokenContext extends Context.Tag('BearerTokenContext')<BearerTokenContext, string>() {}
class BasicAuthContext extends Context.Tag('BasicAuthContext')<BasicAuthContext, BasicCredentials>() {}
class RequestIdContext extends Context.Tag('RequestIdContext')<RequestIdContext, string>() {}
class SessionContext extends Context.Tag('SessionContext')<SessionContext, SessionResult>() {}
class OAuthService extends Context.Tag('OAuthService')<
    OAuthService,
    {
        readonly createAuthorizationUrl: (provider: OAuthProvider, state: string) => Effect.Effect<URL, OAuthError>;
        readonly getUserInfo: (
            provider: OAuthProvider,
            accessToken: string,
        ) => Effect.Effect<OAuthUserInfo, OAuthError>;
        readonly validateCallback: (
            provider: OAuthProvider,
            code: string,
            state: string,
        ) => Effect.Effect<OAuthTokens, OAuthError>;
    }
>() {}

// --- [MIDDLEWARE] ------------------------------------------------------------

class ApiKeyAuth extends HttpApiMiddleware.Tag<ApiKeyAuth>()('ApiKeyAuth', {
    failure: UnauthorizedError,
    provides: ApiKeyContext,
    security: { apiKey: HttpApiSecurity.apiKey({ in: 'header', key: B.security.apiKeyHeader }) },
}) {}

class BearerAuth extends HttpApiMiddleware.Tag<BearerAuth>()('BearerAuth', {
    failure: UnauthorizedError,
    provides: BearerTokenContext,
    security: { bearer: HttpApiSecurity.bearer },
}) {}

class BasicAuth extends HttpApiMiddleware.Tag<BasicAuth>()('BasicAuth', {
    failure: UnauthorizedError,
    provides: BasicAuthContext,
    security: { basic: HttpApiSecurity.basic },
}) {}

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('SessionAuth', {
    failure: UnauthorizedError,
    provides: SessionContext,
    security: { bearer: HttpApiSecurity.bearer },
}) {}

// --- [DISPATCH_TABLES] -------------------------------------------------------

const sqlErrorHandlers = {
    check: (e: SqlErrorInput) =>
        new DatabaseConstraintError({ code: 'check', constraint: e.constraint ?? '', table: '' }),
    connectionLost: () => new DatabaseConnectionError({ reason: 'connection_lost' }),
    deadlock: (e: SqlErrorInput) => new DatabaseDeadlockError({ sqlState: e.code ?? '' }),
    foreignKey: (e: SqlErrorInput) =>
        new DatabaseConstraintError({ code: 'foreign_key', constraint: e.constraint ?? '', table: '' }),
    lockTimeout: () => new DatabaseTimeoutError({ durationMs: 0, timeoutType: 'lock' }),
    notNull: (e: SqlErrorInput) =>
        new DatabaseConstraintError({ code: 'not_null', constraint: e.constraint ?? '', table: '' }),
    poolExhausted: () => new DatabaseConnectionError({ reason: 'pool_exhausted' }),
    statementTimeout: () => new DatabaseTimeoutError({ durationMs: 0, timeoutType: 'statement' }),
    unique: (e: SqlErrorInput) =>
        new DatabaseConstraintError({ code: 'unique', constraint: e.constraint ?? '', table: '' }),
} as const satisfies Record<(typeof B.sqlCodes)[SqlErrorCode], (e: SqlErrorInput) => unknown>;
const mapSqlError = (error: SqlErrorInput) =>
    pipe(
        Option.fromNullable(error.code),
        Option.flatMap((code) => Option.fromNullable(B.sqlCodes[code as SqlErrorCode])),
        Option.match({
            onNone: () => new InternalError({ cause: error.message }),
            onSome: (errorType) => sqlErrorHandlers[errorType](error),
        }),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createCorsLayer = (config: CorsConfig = {}) =>
    HttpApiBuilder.middlewareCors({
        allowedHeaders: config.allowedHeaders ?? B.cors.allowedHeaders,
        allowedMethods: config.allowedMethods ?? B.cors.allowedMethods,
        allowedOrigins: config.allowedOrigins ?? B.cors.allowedOrigins,
        credentials: config.credentials ?? B.cors.credentials,
        maxAge: config.maxAge ?? B.cors.maxAge,
    });
const createLoggingMiddleware = () => HttpMiddleware.logger;
const createApiKeyAuthLayer = (
    lookup: (keyHash: TokenHash) => Effect.Effect<Option.Option<ApiKeyResult>, UnauthorizedError>,
) =>
    Layer.succeed(
        ApiKeyAuth,
        ApiKeyAuth.of({
            apiKey: (redactedKey: Redacted.Redacted<string>) =>
                pipe(
                    hashString(Redacted.value(redactedKey)),
                    Effect.catchTag('HashingError', () =>
                        Effect.fail(new UnauthorizedError({ reason: 'Key hashing failed' })),
                    ),
                    Effect.flatMap(
                        validateTokenHash(lookup, {
                            expired: 'API key expired',
                            hashingFailed: 'Key hashing failed',
                            notFound: 'Invalid API key',
                        }),
                    ),
                ),
        }),
    );
const createBearerAuthLayer = () =>
    Layer.succeed(
        BearerAuth,
        BearerAuth.of({
            bearer: (token: Redacted.Redacted<string>) =>
                Redacted.value(token).length > 0
                    ? Effect.succeed(Redacted.value(token))
                    : Effect.fail(new UnauthorizedError({ reason: 'Empty bearer token' })),
        }),
    );
const createBasicAuthLayer = (
    validate: (username: string, password: string) => Effect.Effect<boolean, UnauthorizedError>,
) =>
    Layer.succeed(
        BasicAuth,
        BasicAuth.of({
            basic: (credentials: { username: string; password: Redacted.Redacted<string> }) =>
                validate(credentials.username, Redacted.value(credentials.password)).pipe(
                    Effect.flatMap((valid) =>
                        valid
                            ? Effect.succeed({
                                  password: credentials.password,
                                  username: credentials.username,
                              })
                            : Effect.fail(new UnauthorizedError({ reason: 'Invalid credentials' })),
                    ),
                ),
        }),
    );
const createSessionAuthLayer = (
    validate: (tokenHash: TokenHash) => Effect.Effect<Option.Option<SessionResult>, UnauthorizedError>,
) =>
    Layer.succeed(
        SessionAuth,
        SessionAuth.of({
            bearer: (token: Redacted.Redacted<string>) =>
                pipe(
                    hashString(Redacted.value(token)),
                    Effect.catchTag('HashingError', () =>
                        Effect.fail(new UnauthorizedError({ reason: 'Token hashing failed' })),
                    ),
                    Effect.flatMap(
                        validateTokenHash(validate, {
                            expired: 'Session expired',
                            hashingFailed: 'Token hashing failed',
                            notFound: 'Invalid session',
                        }),
                    ),
                ),
        }),
    );
const createRequestIdMiddleware = (config: RequestIdConfig = {}) => {
    const headerName = config.headerName ?? B.requestId.headerName;
    return HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const incomingId = Headers.get(request.headers, headerName);
            const requestId = Option.getOrElse(incomingId, () => crypto.randomUUID());
            return yield* pipe(
                app,
                Effect.provideService(RequestIdContext, requestId),
                Effect.map((response) => HttpServerResponse.setHeader(response, headerName, requestId)),
            );
        }),
    );
};
const createSecurityHeadersMiddleware = (config: Partial<SecurityHeadersConfig> = {}) =>
    HttpMiddleware.make((app) =>
        Effect.map(app, (response) => {
            const hsts = config.hsts === false ? undefined : config.hsts;
            const maxAge = hsts?.maxAge ?? B.securityHeaders.hsts.maxAge;
            const subDomainsSuffix =
                (hsts?.includeSubDomains ?? B.securityHeaders.hsts.includeSubDomains) ? '; includeSubDomains' : '';
            const hstsValue = `max-age=${maxAge}${subDomainsSuffix}`;
            return pipe(
                response,
                (r) =>
                    config.hsts === false ? r : HttpServerResponse.setHeader(r, 'strict-transport-security', hstsValue),
                (r) =>
                    config.contentTypeOptions === false
                        ? r
                        : HttpServerResponse.setHeader(r, 'x-content-type-options', 'nosniff'),
                (r) =>
                    HttpServerResponse.setHeader(
                        r,
                        'x-frame-options',
                        config.frameOptions ?? B.securityHeaders.frameOptions,
                    ),
                (r) =>
                    HttpServerResponse.setHeader(
                        r,
                        'referrer-policy',
                        config.referrerPolicy ?? B.securityHeaders.referrerPolicy,
                    ),
            );
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export {
    ApiKeyAuth,
    ApiKeyContext,
    B as MIDDLEWARE_TUNING,
    BasicAuth,
    BasicAuthContext,
    BearerAuth,
    BearerTokenContext,
    createApiKeyAuthLayer,
    createBasicAuthLayer,
    createBearerAuthLayer,
    createCorsLayer,
    createLoggingMiddleware,
    createRequestIdMiddleware,
    createSecurityHeadersMiddleware,
    createSessionAuthLayer,
    mapSqlError,
    OAuthService,
    RequestIdContext,
    SessionAuth,
    SessionContext,
};
export type { BasicCredentials, CorsConfig, RequestIdConfig, SecurityHeadersConfig };
