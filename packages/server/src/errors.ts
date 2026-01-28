/**
 * HTTP errors as Schema.TaggedError with static of() factories.
 * Single export per error type; use HttpError.Auth.of('reason').
 */
import { HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class Auth extends S.TaggedError<Auth>()('Auth',
	{ cause: S.optional(S.Unknown), details: S.String },
	HttpApiSchema.annotations({ description: 'Authentication required', status: 401 }),
) {
	static readonly of = (details: string, cause?: unknown) => new Auth({ cause, details });
	override get message() { return `Auth: ${this.details}`; }}

class Conflict extends S.TaggedError<Conflict>()('Conflict',
	{ cause: S.optional(S.Unknown), details: S.String, resource: S.String },
	HttpApiSchema.annotations({ description: 'Resource conflict', status: 409 }),
) {
	static readonly of = (resource: string, details: string, cause?: unknown) => new Conflict({ cause, details, resource });
	override get message() { return `Conflict: ${this.resource} - ${this.details}`; }}

class Forbidden extends S.TaggedError<Forbidden>()('Forbidden',
	{ cause: S.optional(S.Unknown), details: S.String },
	HttpApiSchema.annotations({ description: 'Access denied', status: 403 }),
) {
	static readonly of = (details: string, cause?: unknown) => new Forbidden({ cause, details });
	override get message() { return `Forbidden: ${this.details}`; }}

class GatewayTimeout extends S.TaggedError<GatewayTimeout>()('GatewayTimeout',
	{ cause: S.optional(S.Unknown), durationMs: S.Number, upstream: S.String },
	HttpApiSchema.annotations({ description: 'Upstream timeout', status: 504 }),
) {
	static readonly of = (upstream: string, durationMs: number, cause?: unknown) => new GatewayTimeout({ cause, durationMs, upstream });
	override get message() { return `GatewayTimeout: ${this.upstream} after ${this.durationMs}ms`; }}

class Gone extends S.TaggedError<Gone>()('Gone',
	{ cause: S.optional(S.Unknown), id: S.String, resource: S.String },
	HttpApiSchema.annotations({ description: 'Resource gone', status: 410 }),
) {
	static readonly of = (resource: string, id: string, cause?: unknown) => new Gone({ cause, id, resource });
	override get message() { return `Gone: ${this.resource} ${this.id}`; }}

class Internal extends S.TaggedError<Internal>()('Internal',
	{ cause: S.optional(S.Unknown), details: S.String },
	HttpApiSchema.annotations({ description: 'Internal server error', status: 500 }),
) {
	static readonly of = (details: string, cause?: unknown) => new Internal({ cause, details });
	override get message() { return `Internal: ${this.details}`; }}

class NotFound extends S.TaggedError<NotFound>()('NotFound',
	{ cause: S.optional(S.Unknown), id: S.optional(S.String), resource: S.String },
	HttpApiSchema.annotations({ description: 'Resource not found', status: 404 }),
) {
	static readonly of = (resource: string, id?: string, cause?: unknown) => new NotFound({ cause, id, resource });
	override get message() { return this.id ? `NotFound: ${this.resource}/${this.id}` : `NotFound: ${this.resource}`; }}

class OAuth extends S.TaggedError<OAuth>()('OAuth',
	{ cause: S.optional(S.Unknown), details: S.String, provider: S.String },
	HttpApiSchema.annotations({ description: 'OAuth provider error', status: 400 }),
) {
	static readonly of = (provider: string, details: string, cause?: unknown) => new OAuth({ cause, details, provider });
	override get message() { return `OAuth: ${this.provider} - ${this.details}`; }}

class RateLimit extends S.TaggedError<RateLimit>()('RateLimit',
	{ cause: S.optional(S.Unknown), limit: S.optional(S.Number), recoveryAction: S.optional(S.Literal('email-verify', 'support-ticket')), remaining: S.optional(S.Number), resetAfterMs: S.optional(S.Number), retryAfterMs: S.Number },
	HttpApiSchema.annotations({ description: 'Rate limit exceeded', status: 429 }),
) {
	static readonly of = (retryAfterMs: number, opts?: { cause?: unknown; limit?: number; recoveryAction?: 'email-verify' | 'support-ticket'; remaining?: number; resetAfterMs?: number }) =>
		new RateLimit({ cause: opts?.cause, limit: opts?.limit, recoveryAction: opts?.recoveryAction, remaining: opts?.remaining, resetAfterMs: opts?.resetAfterMs, retryAfterMs });
	override get message() { return `RateLimit: retry after ${this.retryAfterMs}ms`; }}

class ServiceUnavailable extends S.TaggedError<ServiceUnavailable>()('ServiceUnavailable',
	{ cause: S.optional(S.Unknown), details: S.String, retryAfterMs: S.Number },
	HttpApiSchema.annotations({ description: 'Service unavailable', status: 503 }),
) {
	static readonly of = (details: string, retryAfterMs: number, cause?: unknown) => new ServiceUnavailable({ cause, details, retryAfterMs });
	override get message() { return `ServiceUnavailable: ${this.details}, retry after ${this.retryAfterMs}ms`; }}

class Validation extends S.TaggedError<Validation>()('Validation',
	{ cause: S.optional(S.Unknown), details: S.String, field: S.String },
	HttpApiSchema.annotations({ description: 'Validation failed', status: 400 }),
) {
	static readonly of = (field: string, details: string, cause?: unknown) => new Validation({ cause, details, field });
	override get message() { return `Validation: ${this.field} - ${this.details}`; }}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const HttpError = {
	Auth, Conflict, Forbidden, GatewayTimeout, Gone, Internal, NotFound, OAuth,
	RateLimit, ServiceUnavailable, Validation
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace HttpError {
	export type Any = Auth | Conflict | Forbidden | GatewayTimeout | Gone | Internal | NotFound | OAuth | RateLimit | ServiceUnavailable | Validation;
	export type Auth = InstanceType<typeof HttpError.Auth>; export type Conflict = InstanceType<typeof HttpError.Conflict>; export type Forbidden = InstanceType<typeof HttpError.Forbidden>;
	export type GatewayTimeout = InstanceType<typeof HttpError.GatewayTimeout>; export type Gone = InstanceType<typeof HttpError.Gone>; export type Internal = InstanceType<typeof HttpError.Internal>;
	export type NotFound = InstanceType<typeof HttpError.NotFound>; export type OAuth = InstanceType<typeof HttpError.OAuth>; export type RateLimit = InstanceType<typeof HttpError.RateLimit>;
	export type ServiceUnavailable = InstanceType<typeof HttpError.ServiceUnavailable>; export type Validation = InstanceType<typeof HttpError.Validation>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { HttpError };
