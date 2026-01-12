/**
 * HTTP middleware: session auth, CORS, logging, request ID, security headers, role enforcement.
 * Effect.Tag + HttpApiMiddleware.Tag + frozen dispatch table.
 */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import type { OAuthProvider, RoleKey } from '@parametric-portal/types/schema';
import { SCHEMA_TUNING } from '@parametric-portal/types/schema';
import type { Hex64 } from '@parametric-portal/types/types';
import { Effect, Layer, Option, Redacted } from 'effect';
import type { AuthContext, OAuthResult } from './auth.ts';
import { Crypto } from './crypto.ts';
import { HttpError } from './http-errors.ts';
import { MetricsService } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type OAuthError = InstanceType<typeof HttpError.OAuth>;
type ForbiddenError = InstanceType<typeof HttpError.Forbidden>;
type UserLookup = { readonly findById: (userId: string) => Effect.Effect<Option.Option<{ readonly role: RoleKey }>, unknown> };
type OAuthService = {
    readonly authenticate: (
        provider: typeof OAuthProvider.Type,
        code: string,
        state: string,
        stateCookie: string,
    ) => Effect.Effect<OAuthResult, OAuthError>;
    readonly createAuthorizationUrl: (
        provider: typeof OAuthProvider.Type,
    ) => Effect.Effect<{ readonly stateCookie: string; readonly url: URL }, OAuthError>;
    readonly refreshToken: (
        provider: typeof OAuthProvider.Type,
        refreshToken: string,
    ) => Effect.Effect<OAuthResult, OAuthError>;
};
type SessionLookupService = { readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<AuthContext>> };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: {
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedOrigins: ['*'],
        credentials: true,
        maxAge: 86400,
    },
    headers: { requestId: 'x-request-id' },
    security: {
        frameOptions: 'DENY',
        hsts: { includeSubDomains: true, maxAge: 31536000 },
        referrerPolicy: 'strict-origin-when-cross-origin',
    },
    tracerDisabledUrls: ['/health', '/ready', '/metrics'],
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class OAuth extends Effect.Tag('server/OAuth')<OAuth, OAuthService>() {}
class RequestId extends Effect.Tag('server/RequestId')<RequestId, string>() {}
class Session extends Effect.Tag('server/Session')<Session, AuthContext>() {}
class SessionLookup extends Effect.Tag('server/SessionLookup')<SessionLookup, SessionLookupService>() {}
class UserLookupService extends Effect.Tag('server/UserLookup')<UserLookupService, UserLookup>() {}

// --- [MIDDLEWARE] ------------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('SessionAuth', {
    failure: HttpError.Auth,
    provides: Session,
    security: { bearer: HttpApiSecurity.bearer },
}) {
    static readonly layer = Layer.effect(
        this,
        Effect.all([SessionLookup, MetricsService]).pipe(
            Effect.map(([{ lookup }, metrics]) =>
                SessionAuth.of({
                    bearer: (token: Redacted.Redacted<string>) =>
                        Crypto.Token.hash(Redacted.value(token)).pipe(
                            Effect.mapError(() => new HttpError.Auth({ reason: 'Token hashing failed' })),
                            Effect.flatMap(lookup),
                            Effect.flatMap(
                                Option.match({
                                    onNone: () => Effect.fail(new HttpError.Auth({ reason: 'Invalid session' })),
                                    onSome: Effect.succeed,
                                }),
                            ),
                            Effect.provideService(MetricsService, metrics),
                        ),
                }),
            ),
        ),
    );
}
const requestId = (header = B.headers.requestId) =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const req = yield* HttpServerRequest.HttpServerRequest;
            const id = Option.getOrElse(Headers.get(req.headers, header), crypto.randomUUID);
            return yield* Effect.provideService(app, RequestId, id).pipe(
                Effect.map((r) => HttpServerResponse.setHeader(r, header, id)),
            );
        }),
    );
const applySecurityHeaders = (response: HttpServerResponse.HttpServerResponse, hsts: typeof B.security.hsts | false = B.security.hsts): HttpServerResponse.HttpServerResponse => {
    const baseHeaders: ReadonlyArray<readonly [string, string]> = [
        ['x-content-type-options', 'nosniff'],
        ['x-frame-options', B.security.frameOptions],
        ['referrer-policy', B.security.referrerPolicy],
    ];
    const headers: ReadonlyArray<readonly [string, string]> = hsts
        ? [['strict-transport-security', `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}`], ...baseHeaders]
        : baseHeaders;
    return headers.reduce((acc, [k, v]) => HttpServerResponse.setHeader(acc, k, v), response);
};
const security = (hsts: typeof B.security.hsts | false = B.security.hsts) =>
    HttpMiddleware.make((app) => Effect.map(app, (r) => applySecurityHeaders(r, hsts)));
const trace = HttpMiddleware.make((app) =>
    Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        const parent = HttpTraceContext.fromHeaders(req.headers);
        const spanOptions = { attributes: { 'http.method': req.method, 'http.target': req.url } };
        const runApp = Option.isSome(parent)
            ? Effect.withParentSpan(app, parent.value)
            : Effect.withSpan(app, 'http.request', spanOptions);
        const res = yield* runApp;
        yield* Effect.annotateCurrentSpan('http.status_code', res.status);
        const spanOpt = yield* Effect.optionFromOptional(Effect.currentSpan);
        return Option.isSome(spanOpt) ? HttpServerResponse.setHeaders(res, HttpTraceContext.toHeaders(spanOpt.value)) : res;
    }),
);
const withTracerDisabled = <A, E, R>(layer: Layer.Layer<A, E, R>, urls = B.tracerDisabledUrls) =>
    HttpMiddleware.withTracerDisabledForUrls(layer, urls);

// --- [ROLE_ENFORCEMENT] ------------------------------------------------------

/** Creates role enforcement middleware that gates endpoints by minimum role level. Requires `Session` (provided by `SessionAuth`) and `UserLookupService` to be available. */
const requireRole = (min: RoleKey): Effect.Effect<void, ForbiddenError | InstanceType<typeof HttpError.Internal>, Session | UserLookupService> =>
    Effect.gen(function* () {
        const { userId } = yield* Session;
        const { findById } = yield* UserLookupService;
        const user = yield* findById(userId).pipe(
            Effect.mapError(() => new HttpError.Internal({ message: 'User lookup failed' })),
            Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new HttpError.Forbidden({ reason: 'User not found' })),
                onSome: Effect.succeed,
            })),
        );
        yield* SCHEMA_TUNING.roleLevels[user.role] >= SCHEMA_TUNING.roleLevels[min]
            ? Effect.void
            : Effect.fail(new HttpError.Forbidden({ reason: 'Insufficient permissions' }));
    });

// --- [MFA_ENFORCEMENT] -------------------------------------------------------

/** Requires MFA verification for the current session if user has MFA enabled. Use for sensitive operations. */
const requireMfaVerified: Effect.Effect<void, ForbiddenError, Session> = Effect.gen(function* () {
    const session = yield* Session;
    yield* session.isPendingMfa
        ? Effect.fail(new HttpError.Forbidden({ reason: 'MFA verification required' }))
        : Effect.void;
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Middleware = Object.freeze({
    Auth: SessionAuth,
    cors: (config?: { readonly allowedOrigins?: ReadonlyArray<string> }) => {
        const allowedOrigins = (config?.allowedOrigins ?? B.cors.allowedOrigins)
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0);
        const hasWildcard = allowedOrigins.includes('*');
        return HttpApiBuilder.middlewareCors({
            ...B.cors,
            allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : B.cors.allowedOrigins,
            credentials: hasWildcard ? false : B.cors.credentials,
        });
    },
    log: HttpMiddleware.logger,
    OAuth,
    RequestId,
    requestId,
    requireMfaVerified,
    requireRole,
    Session,
    SessionLookup,
    security,
    trace,
    UserLookupService,
    withTracerDisabled,
    xForwardedHeaders: HttpMiddleware.xForwardedHeaders,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { B as MIDDLEWARE_TUNING, Middleware, OAuth, requireMfaVerified, requireRole };
export type { OAuthService, SessionLookupService, UserLookup };
