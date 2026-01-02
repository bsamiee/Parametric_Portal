/**
 * HTTP middleware: session auth, CORS, logging, request ID, security headers.
 * Effect.Tag + HttpApiMiddleware.Tag + frozen dispatch table.
 */
import {
    Headers,
    HttpApiBuilder,
    HttpApiMiddleware,
    HttpApiSecurity,
    HttpMiddleware,
    HttpServerRequest,
    HttpServerResponse,
    HttpTraceContext,
} from '@effect/platform';
import { AuthContext, OAuthResult, type OAuthProvider } from '@parametric-portal/types/database';
import type { Hex64 } from '@parametric-portal/types/types';
import { Effect, Layer, Option, Redacted } from 'effect';
import { Crypto } from './crypto.ts';
import { AuthError, type OAuthError } from './domain-errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: {
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedOrigins: ['*'],
        credentials: true,
        maxAge: 86400,
    },
    requestId: 'x-request-id',
    security: {
        frameOptions: 'DENY',
        hsts: { includeSubDomains: true, maxAge: 31536000 },
        referrerPolicy: 'strict-origin-when-cross-origin',
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class RequestId extends Effect.Tag('server/RequestId')<RequestId, string>() {}
class Session extends Effect.Tag('server/Session')<Session, AuthContext>() {}
class SessionLookup extends Effect.Tag('server/SessionLookup')<
    SessionLookup,
    { readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<AuthContext>> }
>() {}
class OAuth extends Effect.Tag('server/OAuth')<
    OAuth,
    {
        readonly authenticate: (
            provider: typeof OAuthProvider.Type,
            code: string,
            state: string,
        ) => Effect.Effect<OAuthResult, OAuthError>;
        readonly createAuthorizationUrl: (provider: typeof OAuthProvider.Type) => Effect.Effect<URL, OAuthError>;
        readonly refreshToken: (
            provider: typeof OAuthProvider.Type,
            refreshToken: string,
        ) => Effect.Effect<OAuthResult, OAuthError>;
    }
>() {}

// --- [MIDDLEWARE] ------------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('SessionAuth', {
    failure: AuthError,
    provides: Session,
    security: { bearer: HttpApiSecurity.bearer },
}) {
    static readonly layer = Layer.effect(
        this,
        Effect.map(SessionLookup, ({ lookup }) =>
            SessionAuth.of({
                bearer: (token: Redacted.Redacted<string>) =>
                    Crypto.Token.hash(Redacted.value(token)).pipe(
                        Effect.mapError(() => new AuthError({ reason: 'Token hashing failed' })),
                        Effect.flatMap(lookup),
                        Effect.flatMap(
                            Option.match({
                                onNone: () => Effect.fail(new AuthError({ reason: 'Invalid session' })),
                                onSome: Effect.succeed,
                            }),
                        ),
                    ),
            }),
        ),
    );
}
const requestId = (header = B.requestId) =>
    HttpMiddleware.make((app) =>
        Effect.gen(function* () {
            const req = yield* HttpServerRequest.HttpServerRequest;
            const id = Option.getOrElse(Headers.get(req.headers, header), crypto.randomUUID);
            return yield* Effect.provideService(app, RequestId, id).pipe(
                Effect.map((r) => HttpServerResponse.setHeader(r, header, id)),
            );
        }),
    );
const security = (hsts: typeof B.security.hsts | false = B.security.hsts) =>
    HttpMiddleware.make((app) =>
        Effect.map(app, (r) =>
            [
                ...(hsts
                    ? [
                          [
                              'strict-transport-security',
                              `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}`,
                          ] as const,
                      ]
                    : []),
                ['x-content-type-options', 'nosniff'] as const,
                ['x-frame-options', B.security.frameOptions] as const,
                ['referrer-policy', B.security.referrerPolicy] as const,
            ].reduce((acc, [k, v]) => HttpServerResponse.setHeader(acc, k, v), r),
        ),
    );
const trace = () =>
    HttpMiddleware.make((app) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (req) =>
            Option.match(HttpTraceContext.fromHeaders(req.headers), {
                onNone: () => app,
                onSome: (span) => Effect.withParentSpan(app, span),
            }),
        ),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Middleware = Object.freeze({
    Auth: SessionAuth,
    cors: (config?: { readonly allowedOrigins?: ReadonlyArray<string> }) =>
        HttpApiBuilder.middlewareCors({
            ...B.cors,
            ...(config?.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
        }),
    log: HttpMiddleware.logger,
    OAuth,
    RequestId,
    requestId,
    Session,
    SessionLookup,
    security,
    trace,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { B as MIDDLEWARE_TUNING, Middleware, OAuth };
