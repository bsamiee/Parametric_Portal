/**
 * Define HTTP API contract shared between server and client.
 * Enables type-safe HttpApiClient derivation; domain modules use structural typing.
 *
 * Schema Strategy:
 * - Entity responses: Use Model.json directly (models define their own API shape)
 * - HTTP concerns: Pagination, query params, auth responses (not entity models)
 * - Inline schemas: Single-use response shapes defined at endpoint
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart, OpenApi } from '@effect/platform';
import { ApiKey, AuditLog, User } from '@parametric-portal/database/models';
import { Codec } from '@parametric-portal/types/files';
import { Url } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { Context } from './context.ts';
import { HttpError } from './errors.ts';
import { Middleware } from './middleware.ts';

// --- [HTTP_SCHEMAS] ----------------------------------------------------------
// These are HTTP-layer concerns, NOT entity models. They define API contract shapes.

const AuthResponse = S.Struct({		/** Auth token response - returned by OAuth callback, refresh */
	accessToken: S.String.annotations({ description: 'JWT access token for API authentication' }),
	expiresAt: S.DateTimeUtc.annotations({ description: 'Token expiration timestamp (UTC)' }),
	mfaPending: S.Boolean.annotations({ description: 'True if MFA verification is required before full access' }),
}).annotations({ description: 'Authentication response containing access token and session info', title: 'AuthResponse' });
const KeysetResponse = <T extends S.Schema.Any>(itemSchema: T) => S.Struct({	/** Keyset pagination wrapper - generic container for paginated responses */
	cursor: S.NullOr(S.String).annotations({ description: 'Cursor for next page, null if no more results' }),
	hasNext: S.Boolean.annotations({ description: 'True if more results exist after this page' }),
	hasPrev: S.Boolean.annotations({ description: 'True if results exist before this page' }),
	items: S.Array(itemSchema).annotations({ description: 'Page of results' }),
	total: S.Int.annotations({ description: 'Total count of matching items' }),
}).annotations({ description: 'Cursor-based pagination wrapper', title: 'KeysetResponse' });
const Query = S.Struct({			/** Pagination query params - cursor-based with optional filters */
	after: S.optional(HttpApiSchema.param('after', S.DateFromString)),
	before: S.optional(HttpApiSchema.param('before', S.DateFromString)),
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }),
	operation: S.optional(HttpApiSchema.param('operation', S.String)),
});
const TransferQuery = S.Struct({	/** Transfer operation query params */
	after: S.optionalWith(HttpApiSchema.param('after', S.DateFromString), { as: 'Option' }),
	before: S.optionalWith(HttpApiSchema.param('before', S.DateFromString), { as: 'Option' }),
	dryRun: S.optionalWith(HttpApiSchema.param('dryRun', S.BooleanFromString), { as: 'Option' }),
	format: S.optionalWith(HttpApiSchema.param('format', Codec.Transfer), { default: () => 'ndjson' as const }),
	typeSlug: S.optionalWith(HttpApiSchema.param('type', S.NonEmptyTrimmedString), { as: 'Option' }),
});
const TransferResult = S.Struct({	/** Transfer operation result */
	count: S.optional(S.Int),
	data: S.optional(S.String),
	failed: S.optional(S.Array(S.Struct({ error: S.String, ordinal: S.NullOr(S.Int) }))),
	format: S.optional(Codec.Transfer),
	imported: S.optional(S.Int),
	name: S.optional(S.String),
});
/** Auditable resource types */
const AuditSubject = S.Literal('ApiKey', 'App', 'Asset', 'MfaSecret', 'OauthAccount', 'RefreshToken', 'Session', 'User');
/** Searchable entity types */
const SearchEntityType = S.Literal('app', 'asset', 'auditLog', 'user');

// --- [SEARCH_SCHEMAS] --------------------------------------------------------

type SearchEntityTypeValue = typeof SearchEntityType.Type;
const _EntityTypesFromString = S.transform(
	S.String,
	S.Array(SearchEntityType),
	{ decode: (s) => s.split(',').filter((t): t is SearchEntityTypeValue => ['app', 'asset', 'auditLog', 'user'].includes(t)), encode: (a) => a.join(',') },
);
const _SearchQuery = S.Struct({
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	entityTypes: S.optional(HttpApiSchema.param('entityTypes', _EntityTypesFromString)),
	includeFacets: S.optional(HttpApiSchema.param('includeFacets', S.BooleanFromString)),
	includeGlobal: S.optional(HttpApiSchema.param('includeGlobal', S.BooleanFromString)),
	includeSnippets: S.optional(HttpApiSchema.param('includeSnippets', S.BooleanFromString)),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }),
	q: HttpApiSchema.param('q', S.String.pipe(S.minLength(2), S.maxLength(256))),
});
const _SuggestQuery = S.Struct({
	includeGlobal: S.optional(HttpApiSchema.param('includeGlobal', S.BooleanFromString)),
	limit: S.optional(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 20)))),
	prefix: HttpApiSchema.param('prefix', S.String.pipe(S.minLength(2), S.maxLength(256))),
});
const _SearchResult = S.Struct({
	displayText: S.String,
	entityId: S.UUID,
	entityType: SearchEntityType,
	metadata: S.NullOr(S.Unknown),
	rank: S.Number,
	snippet: S.NullOr(S.String),
});
const _SearchResponse = S.extend(
	KeysetResponse(_SearchResult),
	S.Struct({ facets: S.NullOr(S.Record({ key: SearchEntityType, value: S.Int })) }),
);
const _SuggestResponse = S.Array(S.Struct({ frequency: S.Int, term: S.String }));

// --- [GROUPS] ----------------------------------------------------------------

const _AuthGroup = HttpApiGroup.make('auth')
	.prefix('/auth')
	// OAuth endpoints
	.add(
		HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
			.setPath(S.Struct({ provider: Context.OAuthProvider }))
			.addSuccess(S.Struct({ url: Url }))
			.addError(HttpError.OAuth)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Start OAuth flow')
			.annotate(OpenApi.Description, 'Initiates OAuth authorization flow for the specified provider. Returns the authorization URL to redirect the user.'),
	)
	.add(
		HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
			.setPath(S.Struct({ provider: Context.OAuthProvider }))
			.setUrlParams(S.Struct({ code: S.String, state: S.String }))
			.addSuccess(AuthResponse)
			.addError(HttpError.OAuth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'OAuth callback')
			.annotate(OpenApi.Description, 'Handles OAuth provider callback. Validates state, exchanges code for tokens, and creates/updates user session.'),
	)
	// Session endpoints
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.addSuccess(AuthResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Refresh access token')
			.annotate(OpenApi.Description, 'Exchanges refresh token (from HttpOnly cookie) for new access and refresh tokens.'),
	)
	.add(
		HttpApiEndpoint.post('logout', '/logout')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'End session'),
	)
	.add(
		HttpApiEndpoint.get('me', '/me')
			.middleware(Middleware.Auth)
			.addSuccess(User.json)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Get current user'),
	)
	// MFA endpoints
	.add(
		HttpApiEndpoint.get('mfaStatus', '/mfa/status')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ enabled: S.optional(S.Boolean), enrolled: S.optional(S.Boolean), remainingBackupCodes: S.optional(S.Int) }))
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Get MFA status'),
	)
	.add(
		HttpApiEndpoint.post('mfaEnroll', '/mfa/enroll')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ backupCodes: S.optional(S.Array(S.String)), qrDataUrl: S.optional(S.String), secret: S.optional(S.String) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Conflict)
			.addError(HttpError.Internal)
			.addError(HttpError.NotFound)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Enroll in MFA')
			.annotate(OpenApi.Description, 'Generates TOTP secret and backup codes for MFA enrollment.'),
	)
	.add(
		HttpApiEndpoint.post('mfaVerify', '/mfa/verify')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) }))
			.addSuccess(S.Struct({ success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Verify MFA code')
			.annotate(OpenApi.Description, 'Verifies TOTP code and enables MFA if not already enabled.'),
	)
	.add(
		HttpApiEndpoint.del('mfaDisable', '/mfa')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Disable MFA'),
	)
	.add(
		HttpApiEndpoint.post('mfaRecover', '/mfa/recover')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ code: S.NonEmptyTrimmedString }))
			.addSuccess(S.Struct({ remainingCodes: S.Int, success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Use MFA recovery code')
			.annotate(OpenApi.Description, 'Validates backup code for account recovery when TOTP device is unavailable.'),
	)
	// API key endpoints
	.add(
		HttpApiEndpoint.get('listApiKeys', '/apikeys')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ data: S.Array(ApiKey.json) }))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'List API keys'),
	)
	.add(
		HttpApiEndpoint.post('createApiKey', '/apikeys')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ expiresAt: S.optional(S.DateFromSelf), name: S.NonEmptyTrimmedString }))
			.addSuccess(S.extend(ApiKey.json, S.Struct({ apiKey: S.optional(S.String) })))
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.Validation)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Create API key')
			.annotate(OpenApi.Description, 'Creates new API key. The key value is returned only once in the response.'),
	)
	.add(
		HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(S.Struct({ success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Revoke API key'),
	);
const _HealthGroup = HttpApiGroup.make('health')
	.prefix('/health')
	.add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
	.add(
		HttpApiEndpoint.get('readiness', '/readiness')
			.addSuccess(S.Struct({
				checks: S.Struct({
					cache: S.Struct({ connected: S.Boolean, latencyMs: S.Number }),
					database: S.Struct({ healthy: S.Boolean, latencyMs: S.Number }),
					metrics: S.Literal('healthy', 'degraded', 'alerted'),
				}),
				status: S.Literal('ok'),
			}))
			.addError(HttpError.ServiceUnavailable),
	)
	.add(
		HttpApiEndpoint.get('clusterHealth', '/cluster')
			.addSuccess(S.Struct({
				cluster: S.Struct({
					degraded: S.Boolean,
					healthy: S.Boolean,
					metrics: S.Struct({
						entities: S.Number,
						runners: S.Number,
						runnersHealthy: S.Number,
						shards: S.Number,
						singletons: S.Number,
					}),
				}),
			}))
			.addError(HttpError.ServiceUnavailable)
			.annotate(OpenApi.Exclude, true),
	);
const _TelemetryGroup = HttpApiGroup.make('telemetry')
	.prefix('/v1')
	.add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void).addError(HttpError.RateLimit));
const _UsersGroup = HttpApiGroup.make('users')
	.prefix('/users')
	.add(
		HttpApiEndpoint.patch('updateRole', '/:id/role')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.setPayload(S.Struct({ role: Context.UserRole.schema }))
			.addSuccess(User.json)										// Model.json: canonical API shape
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	);
const _AuditGroup = HttpApiGroup.make('audit')
	.prefix('/audit')
	.add(
		HttpApiEndpoint.get('getByEntity', '/entity/:subject/:subjectId')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ subject: AuditSubject, subjectId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(AuditLog.json))					// Model.json: canonical API shape
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
			.addSuccess(KeysetResponse(AuditLog.json))					// Model.json: canonical API shape
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit),
	)
	.add(
		HttpApiEndpoint.get('getMine', '/me')
			.middleware(Middleware.Auth)
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(AuditLog.json))					// Model.json: canonical API shape
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
const _SearchGroup = HttpApiGroup.make('search')
	.prefix('/search')
	.add(
		HttpApiEndpoint.get('search', '/')
			.middleware(Middleware.Auth)
			.setUrlParams(_SearchQuery)
			.addSuccess(_SearchResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.RateLimit)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Description, 'Full-text search with semantic ranking'),
	)
	.add(
		HttpApiEndpoint.get('suggest', '/suggest')
			.middleware(Middleware.Auth)
			.setUrlParams(_SuggestQuery)
			.addSuccess(_SuggestResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.RateLimit)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Description, 'Search term suggestions'),
	)
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ includeGlobal: S.optional(S.Boolean) }))
			.addSuccess(S.Struct({ status: S.Literal('ok') }))
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Description, 'Refresh search index (admin only)'),
	);
const _JobsGroup = HttpApiGroup.make('jobs')
	.prefix('/jobs')
	.add(
		HttpApiEndpoint.get('subscribe', '/subscribe')
			.middleware(Middleware.Auth)
			.addSuccess(S.Void)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Description, 'Subscribe to job status updates via SSE'),
	);
const _StorageSignOp = S.Literal('get', 'put');
const _StorageSignRequest = S.Struct({
	contentType: S.optional(S.String).annotations({ description: 'Content-Type for PUT operations (default: application/octet-stream)' }),
	expiresInSeconds: S.optionalWith(S.Int.pipe(S.between(60, 3600)), { default: () => 3600 }).annotations({ description: 'URL expiration in seconds (60-3600, default: 3600)' }),
	key: S.NonEmptyTrimmedString.annotations({ description: 'Storage key (path within tenant namespace)' }),
	op: _StorageSignOp.annotations({ description: 'Operation type: get (download) or put (upload)' }),
});
const _StorageSignResponse = S.Struct({
	expiresAt: S.DateTimeUtc.annotations({ description: 'URL expiration timestamp' }),
	key: S.String.annotations({ description: 'Storage key' }),
	op: _StorageSignOp.annotations({ description: 'Operation type' }),
	url: Url.annotations({ description: 'Presigned URL for direct S3 access' }),
});
const _StorageUploadRequest = S.Struct({
	contentType: S.optional(S.String).annotations({ description: 'Optional content-type override' }),
	file: Multipart.SingleFileSchema.annotations({ description: 'File to upload' }),
	key: S.optional(S.String).annotations({ description: 'Optional storage key (defaults to filename)' }),
});
const _StorageUploadResponse = S.Struct({
	etag: S.String.annotations({ description: 'ETag of uploaded object' }),
	key: S.String.annotations({ description: 'Storage key where file was stored' }),
	size: S.Int.annotations({ description: 'File size in bytes' }),
});
const _StorageGroup = HttpApiGroup.make('storage')
	.prefix('/storage')
	.add(
		HttpApiEndpoint.post('sign', '/sign')
			.middleware(Middleware.Auth)
			.setPayload(_StorageSignRequest)
			.addSuccess(_StorageSignResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Summary, 'Generate presigned URL')
			.annotate(OpenApi.Description, 'Generates a presigned URL for direct S3 upload or download. URLs are tenant-scoped and time-limited.'),
	)
	.add(
		HttpApiEndpoint.get('exists', '/exists/:key')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ key: S.String }))
			.addSuccess(S.Struct({ exists: S.Boolean, key: S.String }))
			.addError(HttpError.Auth)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Check if object exists'),
	)
	.add(
		HttpApiEndpoint.del('remove', '/:key')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ key: S.String }))
			.addSuccess(S.Struct({ key: S.String, success: S.Literal(true) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.annotate(OpenApi.Summary, 'Delete object'),
	)
	.add(
		HttpApiEndpoint.post('upload', '/upload')
			.middleware(Middleware.Auth)
			.setPayload(_StorageUploadRequest)
			.addSuccess(_StorageUploadResponse)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.RateLimit)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Summary, 'Upload file directly')
			.annotate(OpenApi.Description, 'Server-side file upload with multipart form data. Files are stored in tenant namespace with automatic content-type detection.'),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
	.add(_AuditGroup)
	.add(_AuthGroup)
	.add(_HealthGroup.annotate(OpenApi.Exclude, true))
	.add(_JobsGroup)
	.add(_SearchGroup)
	.add(_StorageGroup)
	.add(_TelemetryGroup.annotate(OpenApi.Exclude, true))
	.add(_TransferGroup)
	.add(_UsersGroup)
	.prefix('/api')
	.annotate(OpenApi.Identifier, 'parametric-portal-api')
	.annotate(OpenApi.Title, 'Parametric Portal API')
	.annotate(OpenApi.Version, '1.0.0')
	.annotate(OpenApi.License, { name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
	.annotate(OpenApi.ExternalDocs, { description: 'Developer Documentation', url: 'https://docs.parametric.dev' });

// --- [EXPORT] ----------------------------------------------------------------

export { AuthResponse, ParametricApi, Query, TransferQuery };
