/**
 * Define HTTP API contract shared between server and client.
 * Enables type-safe HttpApiClient derivation; domain modules use structural typing.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from '@effect/platform';
import { Codec } from '@parametric-portal/types/files';
import { IconRequest, IconResponse } from '@parametric-portal/types/icons';
import { Url } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { HttpError } from './http-errors.ts';
import { Middleware } from './middleware.ts';

// --- [PRIVATE_SCHEMAS] -------------------------------------------------------

const _Role = S.Literal('admin', 'guest', 'member', 'owner', 'viewer');
const _OAuthProvider = S.Literal('apple', 'github', 'google', 'microsoft');
const _SearchEntity = S.Literal('app', 'asset', 'auditLog', 'user');

const _authResponse = S.Struct({
	accessToken: S.String,
	expiresAt: S.DateTimeUtc,
	mfaPending: S.Boolean,
});

const _user = S.Struct({
	appId: S.UUID,
	email: S.String,
	id: S.UUID,
	role: _Role,
	state: S.String,
});

/** Unified API key schema - optional fields for read vs create context */
const _apiKey = S.Struct({
	apiKey: S.optional(S.String), 						// Present on create request only
	expiresAt: S.optional(S.NullOr(S.DateTimeUtc)),
	id: S.optional(S.UUID),
	name: S.NonEmptyTrimmedString,
	prefix: S.optional(S.NullOr(S.String)),
});

const _auditLog = S.Struct({
	actorEmail: S.NullOr(S.String),
	actorId: S.NullOr(S.UUID),
	appId: S.UUID,
	changes: S.NullOr(S.Unknown),
	entityId: S.UUID,
	entityType: S.String,
	id: S.UUID,
	ipAddress: S.NullOr(S.String),
	operation: S.String,
	userAgent: S.NullOr(S.String),
});

// --- [SCHEMA] ----------------------------------------------------------------

const SuccessResponse = S.Struct({ success: S.Literal(true) });
/** Keyset paginated response factory - matches Page.KeysetOut<T> */
const KeysetResponse = <T extends S.Schema.Any>(itemSchema: T) => S.Struct({
	cursor: S.NullOr(S.String),
	hasNext: S.Boolean,
	hasPrev: S.Boolean,
	items: S.Array(itemSchema),
	total: S.Int,
});
/** Unified transfer result - export: count/data/name/format; import: imported/failed. Mime derivable via Codec(format).mime */
const TransferResult = S.Struct({
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
/** Unified search result - keyset pagination + inline facets/items/suggestions */
const SearchResultResponse = S.Struct({
	...KeysetResponse(S.Struct({
		displayText: S.String,
		entityId: S.UUID,
		entityType: _SearchEntity,
		metadata: S.NullOr(S.Unknown),
		rank: S.Number,
		snippet: S.NullOr(S.String),
	})).fields,
	facets: S.NullOr(S.Record({ key: _SearchEntity, value: S.Int })),
	suggestions: S.optional(S.Array(S.Struct({ frequency: S.Int, term: S.String }))),
});
/** Unified MFA response - enroll: qrDataUrl/secret/backupCodes; status: enabled/enrolled/remaining */
const MfaResponse = S.Struct({
	backupCodes: S.optional(S.Array(S.String)),
	enabled: S.optional(S.Boolean),
	enrolled: S.optional(S.Boolean),
	qrDataUrl: S.optional(S.String),
	remainingBackupCodes: S.optional(S.Int),
	secret: S.optional(S.String),
});

// --- [QUERY_SCHEMAS] ---------------------------------------------------------

/** Comma-separated _SearchEntity array from URL param */
const EntityTypesParam = S.transform(
	S.String,
	S.Array(_SearchEntity),
	{
		decode: (value) => value.split(',').map((segment) => segment.trim()).filter(S.is(_SearchEntity)),
		encode: (value) => value.join(','),
	},
);
/** Unified query schema - all optional fields, endpoint determines required subset */
const Query = S.Struct({
	// Date filters (audit, search)
	after: S.optional(HttpApiSchema.param('after', S.DateFromString)),
	before: S.optional(HttpApiSchema.param('before', S.DateFromString)),
	// Pagination (base)
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	// Search-specific
	entityTypes: S.optionalWith(HttpApiSchema.param('entityTypes', EntityTypesParam), { default: () => [] as const }),
	includeFacets: S.optionalWith(HttpApiSchema.param('includeFacets', S.BooleanFromString), { default: () => false }),
	includeGlobal: S.optionalWith(HttpApiSchema.param('includeGlobal', S.BooleanFromString), { default: () => false }),
	includeSnippets: S.optionalWith(HttpApiSchema.param('includeSnippets', S.BooleanFromString), { default: () => true }),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }),
	// Audit-specific
	operation: S.optional(HttpApiSchema.param('operation', S.String)),
	prefix: S.optional(HttpApiSchema.param('prefix', S.String.pipe(S.minLength(2), S.maxLength(256)))),
	q: S.optional(HttpApiSchema.param('q', S.String.pipe(S.minLength(2), S.maxLength(256)))),
});

// --- [GROUPS] ----------------------------------------------------------------

const AuthGroup = HttpApiGroup.make('auth')
	.prefix('/auth')
	.add(
		HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
			.setPath(S.Struct({ provider: _OAuthProvider }))
			.addSuccess(S.Struct({ url: Url }))
			.addError(HttpError.OAuth)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
			.setPath(S.Struct({ provider: _OAuthProvider }))
			.setUrlParams(S.Struct({ code: S.String, state: S.String }))
			.addSuccess(_authResponse)
			.addError(HttpError.OAuth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.addSuccess(_authResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.post('logout', '/logout')
			.middleware(Middleware.Auth)
			.addSuccess(SuccessResponse)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.get('me', '/me')
			.middleware(Middleware.Auth)
			.addSuccess(_user)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.get('listApiKeys', '/apikeys')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ data: S.Array(_apiKey) }))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('createApiKey', '/apikeys')
			.middleware(Middleware.Auth)
			.setPayload(_apiKey)
			.addSuccess(_apiKey)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.Validation),
	)
	.add(
		HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(SuccessResponse)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	);
const IconsGroup = HttpApiGroup.make('icons')
	.prefix('/icons')
	.add(
		HttpApiEndpoint.get('list', '/')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(S.Struct({ id: S.UUID })))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('generate', '/')
			.middleware(Middleware.Auth)
			.setPayload(IconRequest)
			.addSuccess(IconResponse)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal),
	);
const HealthGroup = HttpApiGroup.make('health')
	.prefix('/health')
	.add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
	.add(
		HttpApiEndpoint.get('readiness', '/readiness')
			.addSuccess(S.Struct({ checks: S.Struct({ database: S.Boolean }), status: S.Literal('ok') }))
			.addError(HttpError.ServiceUnavailable),
	);
const TelemetryGroup = HttpApiGroup.make('telemetry')
	.prefix('/v1')
	.add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void));
const UsersGroup = HttpApiGroup.make('users')
	.prefix('/users')
	.add(
		HttpApiEndpoint.patch('updateRole', '/:id/role')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.setPayload(S.Struct({ role: _Role })) // Inline trivial request
			.addSuccess(_user)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound)
			.addError(HttpError.Internal),
	);
const MfaGroup = HttpApiGroup.make('mfa')
	.prefix('/mfa')
	.add(
		HttpApiEndpoint.get('status', '/status')
			.middleware(Middleware.Auth)
			.addSuccess(MfaResponse)
			.addError(HttpError.Internal),
	)
	.add(
		HttpApiEndpoint.post('enroll', '/enroll')
			.middleware(Middleware.Auth)
			.addSuccess(MfaResponse)
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
			.addSuccess(SuccessResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.del('disable', '/')
			.middleware(Middleware.Auth)
			.addSuccess(SuccessResponse)
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
const AuditPaginatedResponse = KeysetResponse(_auditLog);
const AuditGroup = HttpApiGroup.make('audit')
	.prefix('/audit')
	.add(
		HttpApiEndpoint.get('getByEntity', '/entity/:entityType/:entityId')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ entityId: S.UUID, entityType: S.String }))
			.setUrlParams(Query)
			.addSuccess(AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('getByActor', '/actor/:actorId')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ actorId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('getMine', '/me')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(AuditPaginatedResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);
const TransferGroup = HttpApiGroup.make('transfer')
	.prefix('/transfer')
	.add(
		HttpApiEndpoint.get('export', '/export')
			.middleware(Middleware.Auth)
			.setUrlParams(TransferQuery)
			.addSuccess(TransferResult)
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
			.addSuccess(TransferResult)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Validation)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);
const SearchGroup = HttpApiGroup.make('search')
	.prefix('/search')
	.add(
		HttpApiEndpoint.get('search', '/')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(SearchResultResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('suggest', '/suggest')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(SearchResultResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
	.add(AuditGroup)
	.add(AuthGroup)
	.add(IconsGroup)
	.add(HealthGroup)
	.add(MfaGroup)
	.add(SearchGroup)
	.add(TelemetryGroup)
	.add(TransferGroup)
	.add(UsersGroup)
	.prefix('/api')
	.annotate(OpenApi.Title, 'Parametric Portal API');

// --- [EXPORT] ----------------------------------------------------------------

export { ParametricApi, Query, TransferQuery };
