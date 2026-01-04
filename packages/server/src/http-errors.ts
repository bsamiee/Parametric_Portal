/**
 * Unified Domain Errors with HTTP status annotations.
 * Uses Schema.TaggedError for proper OpenAPI schema generation and error handling.
 */
import { HttpApiSchema } from '@effect/platform';
import { DurationMs } from '@parametric-portal/types/types';
import { Effect, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    status: {
        authError: 401,
        badRequest: 400,
        conflict: 409,
        forbidden: 403,
        gatewayTimeout: 504,
        gone: 410,
        internal: 500,
        notFound: 404,
        rateLimit: 429,
        serviceUnavailable: 503,
    },
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class AuthError extends S.TaggedError<AuthError>()(
    'AuthError',
    { reason: S.String },
    HttpApiSchema.annotations({ description: 'Authentication required', status: B.status.authError }),
) {}
class Forbidden extends S.TaggedError<Forbidden>()(
    'Forbidden',
    { reason: S.String },
    HttpApiSchema.annotations({ description: 'Access denied', status: B.status.forbidden }),
) {}
class NotFound extends S.TaggedError<NotFound>()(
    'NotFound',
    { id: S.optional(S.String), resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource not found', status: B.status.notFound }),
) {}
class Conflict extends S.TaggedError<Conflict>()(
    'Conflict',
    { message: S.String, resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource conflict', status: B.status.conflict }),
) {}
class Gone extends S.TaggedError<Gone>()(
    'Gone',
    { id: S.String, resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource gone', status: B.status.gone }),
) {}
class Validation extends S.TaggedError<Validation>()(
    'Validation',
    { field: S.String, message: S.String },
    HttpApiSchema.annotations({ description: 'Validation failed', status: B.status.badRequest }),
) {}
class RateLimit extends S.TaggedError<RateLimit>()(
    'RateLimit',
    { retryAfterMs: DurationMs.schema },
    HttpApiSchema.annotations({ description: 'Rate limit exceeded', status: B.status.rateLimit }),
) {}
class OAuthError extends S.TaggedError<OAuthError>()(
    'OAuthError',
    { provider: S.String, reason: S.String },
    HttpApiSchema.annotations({ description: 'OAuth provider error', status: B.status.badRequest }),
) {}
class InternalError extends S.TaggedError<InternalError>()(
    'InternalError',
    { message: S.String },
    HttpApiSchema.annotations({ description: 'Internal server error', status: B.status.internal }),
) {}
class ServiceUnavailable extends S.TaggedError<ServiceUnavailable>()(
    'ServiceUnavailable',
    { reason: S.String, retryAfterMs: DurationMs.schema },
    HttpApiSchema.annotations({ description: 'Service unavailable', status: B.status.serviceUnavailable }),
) {}
class GatewayTimeout extends S.TaggedError<GatewayTimeout>()(
    'GatewayTimeout',
    { durationMs: DurationMs.schema, upstream: S.String },
    HttpApiSchema.annotations({ description: 'Upstream timeout', status: B.status.gatewayTimeout }),
) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Generic error chain - maps any error to specified HTTP error type. */
const chain = <C extends new (props: never) => unknown>(
    ErrorClass: C,
    props: ConstructorParameters<C>[0],
): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, InstanceType<C>, R>) =>
    Effect.mapError(() => new ErrorClass(props) as InstanceType<C>);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const HttpError = Object.freeze({
    Auth: AuthError,
    Conflict: Conflict,
    Forbidden: Forbidden,
    GatewayTimeout: GatewayTimeout,
    Gone: Gone,
    Internal: InternalError,
    NotFound: NotFound,
    OAuth: OAuthError,
    RateLimit: RateLimit,
    ServiceUnavailable: ServiceUnavailable,
    Validation: Validation,
    chain,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { HttpError };
export {
    AuthError,
    Conflict,
    Forbidden,
    GatewayTimeout,
    Gone,
    InternalError,
    NotFound,
    OAuthError,
    RateLimit,
    ServiceUnavailable,
    Validation,
};
