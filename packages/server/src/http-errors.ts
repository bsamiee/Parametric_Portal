/**
 * Unified Domain Errors with HTTP status annotations.
 * Uses Schema.TaggedError for proper OpenAPI schema generation and error handling.
 */
import { HttpApiSchema } from '@effect/platform';
import { DurationMs } from '@parametric-portal/types/types';
import { Effect, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    AuthError: { description: 'Authentication required', status: 401 },
    Conflict: { description: 'Resource conflict', status: 409 },
    Forbidden: { description: 'Access denied', status: 403 },
    GatewayTimeout: { description: 'Upstream timeout', status: 504 },
    Gone: { description: 'Resource gone', status: 410 },
    InternalError: { description: 'Internal server error', status: 500 },
    NotFound: { description: 'Resource not found', status: 404 },
    OAuthError: { description: 'OAuth provider error', status: 400 },
    RateLimit: { description: 'Rate limit exceeded', status: 429 },
    ServiceUnavailable: { description: 'Service unavailable', status: 503 },
    Validation: { description: 'Validation failed', status: 400 },
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class AuthError extends S.TaggedError<AuthError>()(
    'AuthError',
    { reason: S.String },
    HttpApiSchema.annotations(B.AuthError),
) {}
class Conflict extends S.TaggedError<Conflict>()(
    'Conflict',
    { message: S.String, resource: S.String },
    HttpApiSchema.annotations(B.Conflict),
) {}
class Forbidden extends S.TaggedError<Forbidden>()(
    'Forbidden',
    { reason: S.String },
    HttpApiSchema.annotations(B.Forbidden),
) {}
class GatewayTimeout extends S.TaggedError<GatewayTimeout>()(
    'GatewayTimeout',
    { durationMs: DurationMs.schema, upstream: S.String },
    HttpApiSchema.annotations(B.GatewayTimeout),
) {}
class Gone extends S.TaggedError<Gone>()(
    'Gone',
    { id: S.String, resource: S.String },
    HttpApiSchema.annotations(B.Gone),
) {}
class InternalError extends S.TaggedError<InternalError>()(
    'InternalError',
    { message: S.String },
    HttpApiSchema.annotations(B.InternalError),
) {}
class NotFound extends S.TaggedError<NotFound>()(
    'NotFound',
    { id: S.optional(S.String), resource: S.String },
    HttpApiSchema.annotations(B.NotFound),
) {}
class OAuthError extends S.TaggedError<OAuthError>()(
    'OAuthError',
    { provider: S.String, reason: S.String },
    HttpApiSchema.annotations(B.OAuthError),
) {}
class RateLimit extends S.TaggedError<RateLimit>()(
    'RateLimit',
    { limit: S.optional(S.Number), remaining: S.optional(S.Number), resetAfterMs: S.optional(DurationMs.schema), retryAfterMs: DurationMs.schema },
    HttpApiSchema.annotations(B.RateLimit),
) {}
class ServiceUnavailable extends S.TaggedError<ServiceUnavailable>()(
    'ServiceUnavailable',
    { reason: S.String, retryAfterMs: DurationMs.schema },
    HttpApiSchema.annotations(B.ServiceUnavailable),
) {}
class Validation extends S.TaggedError<Validation>()(
    'Validation',
    { field: S.String, message: S.String },
    HttpApiSchema.annotations(B.Validation),
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
    chain,
    Forbidden: Forbidden,
    GatewayTimeout: GatewayTimeout,
    Gone: Gone,
    Internal: InternalError,
    NotFound: NotFound,
    OAuth: OAuthError,
    RateLimit: RateLimit,
    ServiceUnavailable: ServiceUnavailable,
    Validation: Validation,
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
