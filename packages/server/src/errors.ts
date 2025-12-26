/**
 * Typed API error hierarchy using Schema.TaggedError for Effect-native HTTP error handling.
 * HTTP status codes are set via endpoint.addError(Error, { status: N }), not in schema.
 */
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ApiError =
    | AnthropicAuthError
    | AnthropicContentError
    | AnthropicOverloadedError
    | AnthropicRateLimitError
    | BadGatewayError
    | BadRequestError
    | ConflictError
    | DatabaseConnectionError
    | DatabaseConstraintError
    | DatabaseDeadlockError
    | DatabaseTimeoutError
    | EncryptionError
    | ForbiddenError
    | GatewayTimeoutError
    | GoneError
    | HashingError
    | InternalError
    | MethodNotAllowedError
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
    | UnprocessableEntityError
    | UnsupportedMediaTypeError
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
        gateway: { baseDelayMs: 2000, maxAttempts: 3 },
        oauth: { baseDelayMs: 500, maxAttempts: 2 },
    },
    status: {
        badGateway: 502,
        badRequest: 400,
        conflict: 409,
        forbidden: 403,
        gatewayTimeout: 504,
        gone: 410,
        internal: 500,
        methodNotAllowed: 405,
        notFound: 404,
        rateLimit: 429,
        requestTimeout: 408,
        serviceUnavailable: 503,
        unauthorized: 401,
        unprocessableEntity: 422,
        unsupportedMediaType: 415,
        validation: 400,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

// HTTP 4xx Client Errors
class BadRequestError extends S.TaggedError<BadRequestError>()('BadRequestError', {
    message: S.String,
}) {}
class UnauthorizedError extends S.TaggedError<UnauthorizedError>()('UnauthorizedError', {
    reason: S.String,
}) {}
class ForbiddenError extends S.TaggedError<ForbiddenError>()('ForbiddenError', {
    reason: S.String,
}) {}
class NotFoundError extends S.TaggedError<NotFoundError>()('NotFoundError', {
    id: S.String,
    resource: S.String,
}) {}
class MethodNotAllowedError extends S.TaggedError<MethodNotAllowedError>()('MethodNotAllowedError', {
    allowed: S.Array(S.String),
    method: S.String,
}) {}
class RequestTimeoutError extends S.TaggedError<RequestTimeoutError>()('RequestTimeoutError', {
    durationMs: S.Number,
    operation: S.String,
}) {}
class ConflictError extends S.TaggedError<ConflictError>()('ConflictError', {
    message: S.String,
    resource: S.String,
}) {}
class GoneError extends S.TaggedError<GoneError>()('GoneError', {
    id: S.String,
    resource: S.String,
}) {}
class UnsupportedMediaTypeError extends S.TaggedError<UnsupportedMediaTypeError>()('UnsupportedMediaTypeError', {
    received: S.String,
    supported: S.Array(S.String),
}) {}
class UnprocessableEntityError extends S.TaggedError<UnprocessableEntityError>()('UnprocessableEntityError', {
    errors: S.Array(S.Struct({ field: S.String, message: S.String })),
}) {}
class RateLimitError extends S.TaggedError<RateLimitError>()('RateLimitError', {
    retryAfterMs: S.optionalWith(S.Number, { default: () => B.defaults.rateLimitRetryMs }),
}) {}
class ValidationError extends S.TaggedError<ValidationError>()('ValidationError', {
    field: S.String,
    message: S.String,
}) {}
// HTTP 5xx Server Errors
class InternalError extends S.TaggedError<InternalError>()('InternalError', {
    cause: S.optional(S.String),
}) {}
class BadGatewayError extends S.TaggedError<BadGatewayError>()('BadGatewayError', {
    reason: S.String,
    upstream: S.optional(S.String),
}) {}
class ServiceUnavailableError extends S.TaggedError<ServiceUnavailableError>()('ServiceUnavailableError', {
    reason: S.String,
    retryAfterSeconds: S.optionalWith(S.Number, { default: () => B.defaults.serviceUnavailableRetrySeconds }),
}) {}
class GatewayTimeoutError extends S.TaggedError<GatewayTimeoutError>()('GatewayTimeoutError', {
    durationMs: S.Number,
    upstream: S.String,
}) {}
// OAuth Errors
class OAuthError extends S.TaggedError<OAuthError>()('OAuthError', {
    code: S.optional(S.String),
    provider: S.String,
    reason: S.String,
}) {}
class OAuthInvalidGrantError extends S.TaggedError<OAuthInvalidGrantError>()('OAuthInvalidGrantError', {
    provider: S.Literal('google', 'github', 'microsoft'),
    reason: S.Literal('clock_skew', 'expired', 'revoked', 'inactive', 'rate_limited'),
}) {}
class OAuthConsentError extends S.TaggedError<OAuthConsentError>()('OAuthConsentError', {
    provider: S.Literal('google', 'github', 'microsoft'),
    scopes: S.Array(S.String),
}) {}
class OAuthTokenRefreshError extends S.TaggedError<OAuthTokenRefreshError>()('OAuthTokenRefreshError', {
    provider: S.Literal('google', 'github', 'microsoft'),
    userId: S.String,
}) {}
// Anthropic API Errors
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
// Database Errors
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
// Crypto Errors
class HashingError extends S.TaggedError<HashingError>()('HashingError', {
    cause: S.Unknown,
}) {}
class EncryptionError extends S.TaggedError<EncryptionError>()('EncryptionError', {
    cause: S.Unknown,
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export {
    AnthropicAuthError,
    AnthropicContentError,
    AnthropicOverloadedError,
    AnthropicRateLimitError,
    BadGatewayError,
    BadRequestError,
    ConflictError,
    DatabaseConnectionError,
    DatabaseConstraintError,
    DatabaseDeadlockError,
    DatabaseTimeoutError,
    EncryptionError,
    B as ERROR_TUNING,
    ForbiddenError,
    GatewayTimeoutError,
    GoneError,
    HashingError,
    InternalError,
    MethodNotAllowedError,
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
    UnprocessableEntityError,
    UnsupportedMediaTypeError,
    ValidationError,
};
export type { ApiError };
