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
import type { ApiKeyResult, OAuthProvider, SessionResult } from '@parametric-portal/database/schema';
import { Context, Effect, Layer, Match, Option, pipe, Redacted } from 'effect';

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

type OAuthProviderConfig = {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly redirectUri: string;
    readonly scopes: ReadonlyArray<string>;
};

type OAuthTokens = {
    readonly accessToken: string;
    readonly expiresAt: Option.Option<Date>;
    readonly refreshToken: Option.Option<string>;
    readonly scope: Option.Option<string>;
};

type OAuthUserInfo = {
    readonly avatarUrl: Option.Option<string>;
    readonly email: Option.Option<string>;
    readonly name: Option.Option<string>;
    readonly providerAccountId: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: {
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] as ReadonlyArray<string>,
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as ReadonlyArray<string>,
        allowedOrigins: ['*'] as ReadonlyArray<string>,
        credentials: false,
        maxAge: 86400,
    },
    hash: { multiplier: 31, seed: 0 },
    requestId: { headerName: 'x-request-id' },
    security: { apiKeyHeader: 'x-api-key' },
    securityHeaders: {
        contentTypeOptions: true,
        frameOptions: 'DENY' as const,
        hsts: { includeSubDomains: true, maxAge: 31536000 },
        referrerPolicy: 'strict-origin-when-cross-origin',
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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hashString = (input: string): Effect.Effect<string, never> =>
    Effect.promise(async () => {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    });
const hashApiKey = hashString;
const hashToken = hashString;
const isExpired = (expiresAt: Date | undefined): boolean => expiresAt !== undefined && expiresAt.getTime() < Date.now();
const validateNotExpired = <E>(expiresAt: Date | undefined, errorFactory: () => E): Effect.Effect<void, E> =>
    isExpired(expiresAt) ? Effect.fail(errorFactory()) : Effect.succeed(undefined);
const mapSqlError = (error: { readonly code?: string; readonly constraint?: string; readonly message?: string }) =>
    pipe(
        Match.value(error.code ?? ''),
        Match.when(
            '23505',
            () => new DatabaseConstraintError({ code: 'unique', constraint: error.constraint ?? '', table: '' }),
        ),
        Match.when(
            '23503',
            () => new DatabaseConstraintError({ code: 'foreign_key', constraint: error.constraint ?? '', table: '' }),
        ),
        Match.when(
            '23502',
            () => new DatabaseConstraintError({ code: 'not_null', constraint: error.constraint ?? '', table: '' }),
        ),
        Match.when(
            '23514',
            () => new DatabaseConstraintError({ code: 'check', constraint: error.constraint ?? '', table: '' }),
        ),
        Match.when('40P01', () => new DatabaseDeadlockError({ sqlState: error.code ?? '' })),
        Match.when('40001', () => new DatabaseDeadlockError({ sqlState: error.code ?? '' })),
        Match.when('57014', () => new DatabaseTimeoutError({ durationMs: 0, timeoutType: 'statement' })),
        Match.when('55P03', () => new DatabaseTimeoutError({ durationMs: 0, timeoutType: 'lock' })),
        Match.when('08006', () => new DatabaseConnectionError({ reason: 'connection_lost' })),
        Match.when('08001', () => new DatabaseConnectionError({ reason: 'connection_lost' })),
        Match.when('53300', () => new DatabaseConnectionError({ reason: 'pool_exhausted' })),
        Match.orElse(() => new InternalError({ cause: error.message })),
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
    lookup: (keyHash: string) => Effect.Effect<Option.Option<ApiKeyResult>, UnauthorizedError>,
) =>
    Layer.succeed(
        ApiKeyAuth,
        ApiKeyAuth.of({
            apiKey: (redactedKey: Redacted.Redacted<string>) =>
                pipe(
                    hashApiKey(Redacted.value(redactedKey)),
                    Effect.flatMap(lookup),
                    Effect.flatMap(
                        Option.match({
                            onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid API key' })),
                            onSome: (result) =>
                                pipe(
                                    validateNotExpired(
                                        Option.getOrUndefined(result.expiresAt),
                                        () => new UnauthorizedError({ reason: 'API key expired' }),
                                    ),
                                    Effect.as(result),
                                ),
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
    validate: (tokenHash: string) => Effect.Effect<Option.Option<SessionResult>, UnauthorizedError>,
) =>
    Layer.succeed(
        SessionAuth,
        SessionAuth.of({
            bearer: (token: Redacted.Redacted<string>) =>
                pipe(
                    hashToken(Redacted.value(token)),
                    Effect.flatMap(validate),
                    Effect.flatMap(
                        Option.match({
                            onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid session' })),
                            onSome: (session) =>
                                pipe(
                                    validateNotExpired(
                                        session.expiresAt,
                                        () => new UnauthorizedError({ reason: 'Session expired' }),
                                    ),
                                    Effect.as(session),
                                ),
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
            const hsts = config.hsts as { maxAge?: number; includeSubDomains?: boolean } | undefined;
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
    hashApiKey,
    hashToken,
    isExpired,
    mapSqlError,
    OAuthService,
    RequestIdContext,
    SessionAuth,
    SessionContext,
    validateNotExpired,
};
export type {
    BasicCredentials,
    CorsConfig,
    OAuthProviderConfig,
    OAuthTokens,
    OAuthUserInfo,
    RequestIdConfig,
    SecurityHeadersConfig,
};
