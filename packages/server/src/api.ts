/**
 * Define HTTP API contract shared between server and client.
 * Enables type-safe HttpApiClient derivation; domain modules use structural typing.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from '@effect/platform';
import { ApiKey, AuditLog, User } from '@parametric-portal/database/models';
import { Codec } from '@parametric-portal/types/files';
import { Url } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { Context } from './context.ts';
import { HttpError } from './errors.ts';
import { Middleware } from './middleware.ts';

// --- [INTERNAL_SCHEMAS] ------------------------------------------------------

/** Auth response - returned by OAuth callback, refresh */
const AuthResponse = S.Struct({
	accessToken: S.String,
	expiresAt: S.DateTimeUtc,
	mfaPending: S.Boolean,
});

// --- [MODEL_DERIVED_SCHEMAS] -------------------------------------------------

/** OAuth identity providers - derived from Context.OAuthProvider */
const OAuthProvider = S.Literal(...Object.values(Context.OAuthProvider) as [Context.OAuthProvider, ...Context.OAuthProvider[]]);
/** User public projection - derived from User.json */
const _UserPublic = User.json.pipe(S.pick('id', 'appId', 'email', 'role', 'state'));
/** ApiKey public projection - derived from ApiKey.json */
const _ApiKeyPublic = ApiKey.json.pipe(S.pick('id', 'name', 'prefix', 'expiresAt'));
/** ApiKey create response - extends public with one-time apiKey reveal */
const _ApiKeyCreateResponse = S.extend(_ApiKeyPublic, S.Struct({ apiKey: S.optional(S.String) }));
/** ApiKey create payload - derived from ApiKey.insert with API-level validation */
const _ApiKeyPayload = S.Struct({ expiresAt: S.optional(S.DateFromSelf), name: S.NonEmptyTrimmedString });

// --- [SCHEMA] ----------------------------------------------------------------

/** Auditable resource types - used for audit endpoint validation */
const AuditSubject = S.Literal('ApiKey', 'App', 'Asset', 'MfaSecret', 'OauthAccount', 'RefreshToken', 'Session', 'User');
const _SuccessResponse = S.Struct({ success: S.Literal(true) });
/** Keyset paginated response factory - matches Page.KeysetOut<T> */
const _KeysetResponse = <T extends S.Schema.Any>(itemSchema: T) => S.Struct({
	cursor: S.NullOr(S.String),
	hasNext: S.Boolean,
	hasPrev: S.Boolean,
	items: S.Array(itemSchema),
	total: S.Int,
});
/** Unified transfer result - export: count/data/name/format; import: imported/failed. Mime derivable via Codec(format).mime */
const _TransferResult = S.Struct({
	count: S.optional(S.Int),
	data: S.optional(S.String),
	failed: S.optional(S.Array(S.Struct({ error: S.String, ordinal: S.NullOr(S.Int) }))),
	format: S.optional(Codec.Transfer),
	imported: S.optional(S.Int),
	name: S.optional(S.String),
});
/** Unified transfer query - all fields optional, context determines usage */
const TransferQuery = S.Struct({
	after: S.optionalWith(HttpApiSchema.param('after', S.DateFromString), { as: 'Option' }),
	before: S.optionalWith(HttpApiSchema.param('before', S.DateFromString), { as: 'Option' }),
	dryRun: S.optionalWith(HttpApiSchema.param('dryRun', S.BooleanFromString), { as: 'Option' }),
	format: S.optionalWith(HttpApiSchema.param('format', Codec.Transfer), { default: () => 'ndjson' as const }),
	typeSlug: S.optionalWith(HttpApiSchema.param('type', S.NonEmptyTrimmedString), { as: 'Option' }),
});
/** Unified MFA response - enroll: qrDataUrl/secret/backupCodes; status: enabled/enrolled/remaining */
const _MfaResponse = S.Struct({
	backupCodes: S.optional(S.Array(S.String)),
	enabled: S.optional(S.Boolean),
	enrolled: S.optional(S.Boolean),
	qrDataUrl: S.optional(S.String),
	remainingBackupCodes: S.optional(S.Int),
	secret: S.optional(S.String),
});

// --- [QUERY_SCHEMAS] ---------------------------------------------------------

/** Unified query schema - audit pagination and filtering */
const Query = S.Struct({
	after: S.optional(HttpApiSchema.param('after', S.DateFromString)),
	before: S.optional(HttpApiSchema.param('before', S.DateFromString)),
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }),
	operation: S.optional(HttpApiSchema.param('operation', S.String)),
});

// --- [GROUPS] ----------------------------------------------------------------

const _AuthGroup = HttpApiGroup.make('auth')
	.prefix('/auth')
	.add(
		HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
			.setPath(S.Struct({ provider: OAuthProvider }))
			.addSuccess(S.Struct({ url: Url }))
			.addError(HttpError.OAuth)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
			.setPath(S.Struct({ provider: OAuthProvider }))
			.setUrlParams(S.Struct({ code: S.String, state: S.String }))
			.addSuccess(AuthResponse)
			.addError(HttpError.OAuth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.addSuccess(AuthResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.post('logout', '/logout')
			.middleware(Middleware.Auth)
			.addSuccess(_SuccessResponse)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.get('me', '/me')
			.middleware(Middleware.Auth)
			.addSuccess(_UserPublic)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.get('listApiKeys', '/apikeys')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ data: S.Array(_ApiKeyPublic) }))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('createApiKey', '/apikeys')
			.middleware(Middleware.Auth)
			.setPayload(_ApiKeyPayload)
			.addSuccess(_ApiKeyCreateResponse)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.Validation),
	)
	.add(
		HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(_SuccessResponse)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	);
const _HealthGroup = HttpApiGroup.make('health')
	.prefix('/health')
	.add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
	.add(
		HttpApiEndpoint.get('readiness', '/readiness')
			.addSuccess(S.Struct({ checks: S.Struct({ audit: S.optional(S.Literal('healthy', 'degraded', 'alerted')), database: S.Boolean }), status: S.Literal('ok') }))
			.addError(HttpError.ServiceUnavailable),
	);
const _TelemetryGroup = HttpApiGroup.make('telemetry')
	.prefix('/v1')
	.add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void));
const _UsersGroup = HttpApiGroup.make('users')
	.prefix('/users')
	.add(
		HttpApiEndpoint.patch('updateRole', '/:id/role')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.setPayload(S.Struct({ role: Context.UserRole }))
			.addSuccess(_UserPublic)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound)
			.addError(HttpError.Internal),
	);
const _MfaGroup = HttpApiGroup.make('mfa')
	.prefix('/mfa')
	.add(
		HttpApiEndpoint.get('status', '/status')
			.middleware(Middleware.Auth)
			.addSuccess(_MfaResponse)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('enroll', '/enroll')
			.middleware(Middleware.Auth)
			.addSuccess(_MfaResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Conflict)
			.addError(HttpError.Internal)
			.addError(HttpError.NotFound)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.post('verify', '/verify')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) })) // Inline: single-use
			.addSuccess(_SuccessResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.del('disable', '/')
			.middleware(Middleware.Auth)
			.addSuccess(_SuccessResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('recover', '/recover')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ code: S.NonEmptyTrimmedString })) // Inline: single-use
			.addSuccess(S.Struct({ remainingCodes: S.Int, success: S.Literal(true) })) // Inline: single-use
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);
const _AuditPaginatedResponse = _KeysetResponse(AuditLog.json);
const _AuditGroup = HttpApiGroup.make('audit')
	.prefix('/audit')
	.add(
		HttpApiEndpoint.get('getByEntity', '/entity/:subject/:subjectId')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ subject: AuditSubject, subjectId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(_AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('getByUser', '/user/:userId')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ userId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(_AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('getMine', '/me')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(_AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);
const _TransferGroup = HttpApiGroup.make('transfer')
	.prefix('/transfer')
	.add(
		HttpApiEndpoint.get('export', '/export')
			.middleware(Middleware.Auth)
			.setUrlParams(TransferQuery)
			.addSuccess(_TransferResult)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.NotFound)
			.addError(HttpError.RateLimit)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Description, 'Export assets in specified format. For xlsx/zip: returns JSON with base64-encoded data. For csv/ndjson: returns raw streaming response with Content-Disposition header.'),
	)
	.add(
		HttpApiEndpoint.post('import', '/import')
			.middleware(Middleware.Auth)
			.setUrlParams(TransferQuery)
			.addSuccess(_TransferResult)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Validation)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
	.add(_AuditGroup)
	.add(_AuthGroup)
	.add(_HealthGroup)
	.add(_MfaGroup)
	.add(_TelemetryGroup)
	.add(_TransferGroup)
	.add(_UsersGroup)
	.prefix('/api')
	.annotate(OpenApi.Title, 'Parametric Portal API');

// --- [EXPORT] ----------------------------------------------------------------

export { AuthResponse, ParametricApi, Query, TransferQuery };
