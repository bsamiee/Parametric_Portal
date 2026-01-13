/**
 * Unified Domain Errors with HTTP status annotations.
 * Uses Schema.TaggedError for OpenAPI schema generation and Effect error handling.
 */
import { HttpApiSchema } from '@effect/platform';
import { DurationMs } from '@parametric-portal/types/types';
import { Effect, Schema as S } from 'effect';

// --- [CLASSES] ---------------------------------------------------------------

class AuthError extends S.TaggedError<AuthError>()('AuthError',
    { reason: S.String },
    HttpApiSchema.annotations({ description: 'Authentication required', status: 401 }),
) {}
class Conflict extends S.TaggedError<Conflict>()('Conflict',
    { message: S.String, resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource conflict', status: 409 }),
) {}
class Forbidden extends S.TaggedError<Forbidden>()('Forbidden',
    { reason: S.String },
    HttpApiSchema.annotations({ description: 'Access denied', status: 403 }),
) {}
class GatewayTimeout extends S.TaggedError<GatewayTimeout>()('GatewayTimeout',
    { durationMs: DurationMs.schema, upstream: S.String },
    HttpApiSchema.annotations({ description: 'Upstream timeout', status: 504 }),
) {}
class Gone extends S.TaggedError<Gone>()('Gone',
    { id: S.String, resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource gone', status: 410 }),
) {}
class InternalError extends S.TaggedError<InternalError>()('InternalError',
    { message: S.String },
    HttpApiSchema.annotations({ description: 'Internal server error', status: 500 }),
) {}
class NotFound extends S.TaggedError<NotFound>()('NotFound',
    { id: S.optional(S.String), resource: S.String },
    HttpApiSchema.annotations({ description: 'Resource not found', status: 404 }),
) {}
class OAuthError extends S.TaggedError<OAuthError>()('OAuthError',
    { provider: S.String, reason: S.String },
    HttpApiSchema.annotations({ description: 'OAuth provider error', status: 400 }),
) {}
class RateLimit extends S.TaggedError<RateLimit>()('RateLimit',
    {
        limit: S.optional(S.Number),
        recoveryAction: S.optional(S.Literal('email-verify', 'support-ticket')),
        remaining: S.optional(S.Number),
        resetAfterMs: S.optional(DurationMs.schema),
        retryAfterMs: DurationMs.schema,
    },
    HttpApiSchema.annotations({ description: 'Rate limit exceeded', status: 429 }),
) {}
class ServiceUnavailable extends S.TaggedError<ServiceUnavailable>()('ServiceUnavailable',
    { reason: S.String, retryAfterMs: DurationMs.schema },
    HttpApiSchema.annotations({ description: 'Service unavailable', status: 503 }),
) {}
class Validation extends S.TaggedError<Validation>()('Validation',
    { field: S.String, message: S.String },
    HttpApiSchema.annotations({ description: 'Validation failed', status: 400 }),
) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Convert any error to specified HttpError type. Use at infra boundaries. */
const chain = <C extends new (props: never) => unknown>(
    ErrorClass: C,
    props: ConstructorParameters<C>[0],
): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, InstanceType<C>, R>) =>
    Effect.mapError(() => new ErrorClass(props) as InstanceType<C>);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const HttpError = Object.freeze({
    Auth: AuthError,
    Conflict,
    chain,
    Forbidden,
    GatewayTimeout,
    Gone,
    Internal: InternalError,
    NotFound,
    OAuth: OAuthError,
    RateLimit,
    ServiceUnavailable,
    Validation,
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { HttpError };
