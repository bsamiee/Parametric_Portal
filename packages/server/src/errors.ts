/**
 * Typed API error hierarchy using Schema.TaggedError for Effect-native HTTP error handling.
 * HTTP status codes are set via endpoint.addError(Error, { status: N }), not in schema.
 */
import { OAuthProviderSchema } from '@parametric-portal/types/database';
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ApiError =
    | AnthropicAuthError
    | AnthropicContentError
    | AnthropicOverloadedError
    | AnthropicRateLimitError
    | ConflictError
    | DatabaseConnectionError
    | DatabaseConstraintError
    | DatabaseDeadlockError
    | DatabaseTimeoutError
    | ForbiddenError
    | GoneError
    | InternalError
    | NotFoundError
    | OAuthConsentError
    | OAuthError
    | OAuthInvalidGrantError
    | OAuthTokenRefreshError
    | OptimisticLockError
    | RateLimitError
    | RequestTimeoutError
    | ServiceUnavailableError
    | UnauthorizedError
    | ValidationError;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        rateLimitRetryMs: 60000,
        serviceUnavailableRetrySeconds: 60,
    },
    retry: {
        anthropic: { baseDelayMs: 1000, maxAttempts: 3 },
        database: { baseDelayMs: 100, maxAttempts: 3 },
        oauth: { baseDelayMs: 500, maxAttempts: 2 },
    },
    status: {
        anthropicOverloaded: 503,
        conflict: 409,
        constraintViolation: 409,
        deadlock: 409,
        forbidden: 403,
        gone: 410,
        internal: 500,
        notFound: 404,
        optimisticLock: 409,
        rateLimit: 429,
        requestTimeout: 408,
        serviceUnavailable: 503,
        unauthorized: 401,
        validation: 400,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

class NotFoundError extends S.TaggedError<NotFoundError>()('NotFoundError', {
    id: S.String,
    resource: S.String,
}) {}

class ValidationError extends S.TaggedError<ValidationError>()('ValidationError', {
    field: S.String,
    message: S.String,
}) {}

class UnauthorizedError extends S.TaggedError<UnauthorizedError>()('UnauthorizedError', {
    reason: S.String,
}) {}

class ForbiddenError extends S.TaggedError<ForbiddenError>()('ForbiddenError', {
    reason: S.String,
}) {}

class RateLimitError extends S.TaggedError<RateLimitError>()('RateLimitError', {
    retryAfterMs: S.optionalWith(S.Number, { default: () => B.defaults.rateLimitRetryMs }),
}) {}

class ConflictError extends S.TaggedError<ConflictError>()('ConflictError', {
    message: S.String,
    resource: S.String,
}) {}

class InternalError extends S.TaggedError<InternalError>()('InternalError', {
    cause: S.optional(S.String),
}) {}

class RequestTimeoutError extends S.TaggedError<RequestTimeoutError>()('RequestTimeoutError', {
    durationMs: S.Number,
    operation: S.String,
}) {}

class GoneError extends S.TaggedError<GoneError>()('GoneError', {
    id: S.String,
    resource: S.String,
}) {}

class ServiceUnavailableError extends S.TaggedError<ServiceUnavailableError>()('ServiceUnavailableError', {
    reason: S.String,
    retryAfterSeconds: S.optionalWith(S.Number, { default: () => B.defaults.serviceUnavailableRetrySeconds }),
}) {}

class OAuthError extends S.TaggedError<OAuthError>()('OAuthError', {
    code: S.optional(S.String),
    provider: S.String,
    reason: S.String,
}) {}

// Anthropic API errors
class AnthropicRateLimitError extends S.TaggedError<AnthropicRateLimitError>()('AnthropicRateLimitError', {
    limitType: S.Literal('rpm', 'tpm', 'daily'),
    retryAfterMs: S.Number,
}) {}

class AnthropicOverloadedError extends S.TaggedError<AnthropicOverloadedError>()('AnthropicOverloadedError', {
    requestId: S.optional(S.String),
}) {}

class AnthropicAuthError extends S.TaggedError<AnthropicAuthError>()('AnthropicAuthError', {
    reason: S.Literal('invalid_key', 'expired', 'revoked'),
}) {}

class AnthropicContentError extends S.TaggedError<AnthropicContentError>()('AnthropicContentError', {
    reason: S.Literal('content_filter', 'max_tokens', 'invalid_request'),
}) {}

// Database errors
class DatabaseConstraintError extends S.TaggedError<DatabaseConstraintError>()('DatabaseConstraintError', {
    code: S.Literal('unique', 'foreign_key', 'not_null', 'check'),
    constraint: S.String,
    table: S.String,
}) {}

class DatabaseDeadlockError extends S.TaggedError<DatabaseDeadlockError>()('DatabaseDeadlockError', {
    sqlState: S.String,
}) {}

class DatabaseConnectionError extends S.TaggedError<DatabaseConnectionError>()('DatabaseConnectionError', {
    reason: S.Literal('pool_exhausted', 'connection_lost', 'timeout', 'shutdown'),
}) {}

class DatabaseTimeoutError extends S.TaggedError<DatabaseTimeoutError>()('DatabaseTimeoutError', {
    durationMs: S.Number,
    timeoutType: S.Literal('statement', 'lock', 'transaction'),
}) {}

class OptimisticLockError extends S.TaggedError<OptimisticLockError>()('OptimisticLockError', {
    actualVersion: S.Number,
    expectedVersion: S.Number,
    resourceId: S.String,
    resourceType: S.String,
}) {}

// Enhanced OAuth errors - use shared OAuthProviderSchema
class OAuthInvalidGrantError extends S.TaggedError<OAuthInvalidGrantError>()('OAuthInvalidGrantError', {
    provider: OAuthProviderSchema,
    reason: S.Literal('clock_skew', 'expired', 'revoked', 'inactive', 'rate_limited'),
}) {}

class OAuthConsentError extends S.TaggedError<OAuthConsentError>()('OAuthConsentError', {
    provider: OAuthProviderSchema,
    scopes: S.Array(S.String),
}) {}

class OAuthTokenRefreshError extends S.TaggedError<OAuthTokenRefreshError>()('OAuthTokenRefreshError', {
    provider: OAuthProviderSchema,
    userId: S.String,
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export {
    AnthropicAuthError,
    AnthropicContentError,
    AnthropicOverloadedError,
    AnthropicRateLimitError,
    ConflictError,
    DatabaseConnectionError,
    DatabaseConstraintError,
    DatabaseDeadlockError,
    DatabaseTimeoutError,
    B as ERROR_TUNING,
    ForbiddenError,
    GoneError,
    InternalError,
    NotFoundError,
    OAuthConsentError,
    OAuthError,
    OAuthInvalidGrantError,
    OAuthTokenRefreshError,
    OptimisticLockError,
    RateLimitError,
    RequestTimeoutError,
    ServiceUnavailableError,
    UnauthorizedError,
    ValidationError,
};
export type { ApiError };
