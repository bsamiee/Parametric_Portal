/**
 * HTTP API: Contract definition shared between server and client.
 * Type-safe HttpApiClient derivation, OpenAPI generation, endpoint groups.
 *
 * Convention: group-level middleware() + addError() for shared concerns.
 * Per-endpoint addError() only for endpoint-specific errors (NotFound, Conflict, Validation).
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart, OpenApi } from '@effect/platform';
import { ApiKey, App, AuditLog, Job, JobDlq, Session, User } from '@parametric-portal/database/models';
import { Url } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { Context } from './context.ts';
import { HttpError } from './errors.ts';
import { Middleware } from './middleware.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _Success = S.Struct({ success: S.Literal(true) });
const AuthResponse = S.Struct({
	accessToken: S.String.annotations({ description: 'Opaque access token for API authentication' }),
	expiresAt: S.DateTimeUtc.annotations({ description: 'Token expiration timestamp (UTC)' }),
	mfaPending: S.Boolean.annotations({ description: 'True if MFA verification is required before full access' }),
}).annotations({ description: 'Authentication response containing access token and session info', title: 'AuthResponse' });
const KeysetResponse = <T extends S.Schema.Any>(itemSchema: T) => S.Struct({
	cursor: S.NullOr(S.String).annotations({ description: 'Cursor for next page, null if no more results' }),
	hasNext: S.Boolean.annotations({ description: 'True if more results exist after this page' }),
	hasPrev: S.Boolean.annotations({ description: 'True if results exist before this page' }),
	items: S.Array(itemSchema).annotations({ description: 'Page of results' }),
	total: S.Int.annotations({ description: 'Total count of matching items' }),
}).annotations({ description: 'Cursor-based pagination wrapper', title: 'KeysetResponse' });
const Query = S.Struct({
	after: S.optional(HttpApiSchema.param('after', S.DateFromString)),
	before: S.optional(HttpApiSchema.param('before', S.DateFromString)),
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	includeDiff: S.optional(HttpApiSchema.param('includeDiff', S.BooleanFromString)),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }),
	operation: S.optional(HttpApiSchema.param('operation', S.String)),
});
const TransferQuery = S.Struct({
	after: S.optionalWith(HttpApiSchema.param('after', S.DateFromString), { as: 'Option' }),
	before: S.optionalWith(HttpApiSchema.param('before', S.DateFromString), { as: 'Option' }),
	dryRun: S.optionalWith(HttpApiSchema.param('dryRun', S.BooleanFromString), { as: 'Option' }),
	format: S.optionalWith(HttpApiSchema.param('format', S.String), { default: () => 'ndjson' }),
	typeSlug: S.optionalWith(HttpApiSchema.param('type', S.NonEmptyTrimmedString), { as: 'Option' }),
});
const TransferResult = S.Struct({
	count: S.optional(S.Int),
	data: S.optional(S.String),
	failed: S.optional(S.Array(S.Struct({ error: S.String, ordinal: S.NullOr(S.Int) }))),
	format: S.optional(S.String),
	imported: S.optional(S.Int),
	name: S.optional(S.String),
});
const AuditSubject = S.Literal('ApiKey', 'App', 'Asset', 'MfaSecret', 'OauthAccount', 'Session', 'User');
const PatchOperation = S.Struct({
	from: S.optional(S.String),
	op: S.Literal('add', 'remove', 'replace', 'move', 'copy', 'test'),
	path: S.String,
	value: S.optional(S.Unknown),
});
const AuditLogWithDiff = S.extend(AuditLog.json, S.Struct({diff: S.NullOr(S.Struct({ ops: S.Array(PatchOperation) })),}));
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
	displayText: S.String, entityId: S.UUID, entityType: SearchEntityType,
	metadata: S.NullOr(S.Unknown), rank: S.Number, snippet: S.NullOr(S.String),
});
const _SearchResponse = S.extend(
	KeysetResponse(_SearchResult),
	S.Struct({ facets: S.NullOr(S.Record({ key: SearchEntityType, value: S.Int })) }),
);
const _SuggestResponse = S.Array(S.Struct({ frequency: S.Int, term: S.String }));

// --- [STORAGE_SCHEMAS] -------------------------------------------------------

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

// --- [WEBHOOK_SCHEMAS] -------------------------------------------------------

const _WebhookRegistration = S.Struct({
	active: S.Boolean,
	eventTypes: S.Array(S.String),
	timeout: S.optionalWith(S.Number, { default: () => 5000 }),
	url: S.String,
});
const _WebhookTestResult = S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number });
const _DeliveryRecord = S.Struct({
	deliveredAt: S.optional(S.Number), deliveryId: S.String, durationMs: S.optional(S.Number), endpointUrl: S.String,
	error: S.optional(S.String), status: S.Literal('delivered', 'failed'), statusCode: S.optional(S.Number),
	tenantId: S.String, timestamp: S.Number, type: S.String,
});
const _WebhookStatusQuery = S.Struct({
	url: S.optional(HttpApiSchema.param('url', S.String)),
});

// --- [ADMIN_SCHEMAS] ---------------------------------------------------------

const _AdminSessionFilter = S.Struct({
	cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
	ipAddress: S.optional(HttpApiSchema.param('ipAddress', S.String)),
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 50 }),
	userId: S.optional(HttpApiSchema.param('userId', S.UUID)),
});
const _AdminStatementQuery = S.Struct({
	limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 500))), { default: () => 100 }),
});

// --- [GROUPS] ----------------------------------------------------------------

// Auth: mixed public/protected endpoints — per-endpoint middleware
const _AuthGroup = HttpApiGroup.make('auth')
	.prefix('/auth')
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
			.setPath(S.Struct({ provider: Context.OAuthProvider }))
			.addSuccess(S.Struct({ url: Url }))
			.addError(HttpError.OAuth)
			.annotate(OpenApi.Summary, 'Start OAuth flow')
			.annotate(OpenApi.Description, 'Initiates OAuth authorization flow for the specified provider.'),
	)
	.add(
		HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
			.setPath(S.Struct({ provider: Context.OAuthProvider }))
			.setUrlParams(S.Struct({ code: S.String, state: S.String }))
			.addSuccess(AuthResponse)
			.addError(HttpError.OAuth)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'OAuth callback')
			.annotate(OpenApi.Description, 'Handles OAuth provider callback. Validates state, exchanges code for tokens, and creates/updates user session.'),
	)
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.addSuccess(AuthResponse)
			.addError(HttpError.Auth)
			.annotate(OpenApi.Summary, 'Refresh access token')
			.annotate(OpenApi.Description, 'Exchanges refresh token (from HttpOnly cookie) for new access and refresh tokens.'),
	)
	.add(
		HttpApiEndpoint.post('logout', '/logout')
			.middleware(Middleware.Auth)
			.addSuccess(_Success)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'End session'),
	)
	.add(
		HttpApiEndpoint.get('me', '/me')
			.middleware(Middleware.Auth)
			.addSuccess(User.json)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Get current user'),
	)
	.add(
		HttpApiEndpoint.get('mfaStatus', '/mfa/status')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ enabled: S.optional(S.Boolean), enrolled: S.optional(S.Boolean), remainingBackupCodes: S.optional(S.Int) }))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Get MFA status'),
	)
	.add(
		HttpApiEndpoint.post('mfaEnroll', '/mfa/enroll')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ backupCodes: S.optional(S.Array(S.String)), qrDataUrl: S.optional(S.String), secret: S.optional(S.String) }))
			.addError(HttpError.Auth)
			.addError(HttpError.Conflict)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.addError(HttpError.NotFound)
			.annotate(OpenApi.Summary, 'Enroll in MFA')
			.annotate(OpenApi.Description, 'Generates TOTP secret and backup codes for MFA enrollment.'),
	)
	.add(
		HttpApiEndpoint.post('mfaVerify', '/mfa/verify')
			.middleware(Middleware.Auth)
			.setPayload(S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) }))
			.addSuccess(_Success)
			.addError(HttpError.Auth)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Verify MFA code')
			.annotate(OpenApi.Description, 'Verifies TOTP code and enables MFA if not already enabled.'),
	)
	.add(
		HttpApiEndpoint.del('mfaDisable', '/mfa')
			.middleware(Middleware.Auth)
			.addSuccess(_Success)
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
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Use MFA recovery code')
			.annotate(OpenApi.Description, 'Validates backup code for account recovery when TOTP device is unavailable.'),
	)
	.add(
		HttpApiEndpoint.get('listApiKeys', '/apikeys')
			.middleware(Middleware.Auth)
			.addSuccess(S.Struct({ data: S.Array(ApiKey.json) }))
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
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
			.annotate(OpenApi.Summary, 'Create API key')
			.annotate(OpenApi.Description, 'Creates new API key. The key value is returned only once in the response.'),
	)
	.add(
		HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
			.middleware(Middleware.Auth)
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(_Success)
			.addError(HttpError.Auth)
			.addError(HttpError.NotFound)
			.addError(HttpError.Forbidden)
			.addError(HttpError.Internal)
			.annotate(OpenApi.Summary, 'Revoke API key'),
	);

// Health: unauthenticated operational endpoints
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
						polling: S.Struct({ criticalAlerts: S.Number, totalAlerts: S.Number }),
						vector: S.Struct({ configured: S.Boolean }),
					}),
					status: S.Literal('ok'),
				}))
			.addError(HttpError.ServiceUnavailable),
	)
	.add(
		HttpApiEndpoint.get('clusterHealth', '/cluster')
			.addSuccess(S.Struct({
				cluster: S.Struct({
					degraded: S.Boolean, healthy: S.Boolean,
					metrics: S.Struct({ entities: S.Number, runners: S.Number, runnersHealthy: S.Number, shards: S.Number, singletons: S.Number }),
				}),
			}))
			.addError(HttpError.ServiceUnavailable)
			.annotate(OpenApi.Exclude, true),
	)
		.add(
			HttpApiEndpoint.get('metrics', '/metrics')
				.addSuccess(S.Void)
				.annotate(OpenApi.Exclude, true),
		);

// Telemetry: unauthenticated OTLP ingest
const _TelemetryGroup = HttpApiGroup.make('telemetry')
	.prefix('/v1')
	.add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void).addError(HttpError.RateLimit));

// Users: group-level auth + common errors
const _UsersGroup = HttpApiGroup.make('users')
	.prefix('/users')
	.middleware(Middleware.Auth)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.patch('updateRole', '/:id/role')
			.setPath(S.Struct({ id: S.UUID }))
			.setPayload(S.Struct({ role: Context.UserRole.schema }))
			.addSuccess(User.json)
			.addError(HttpError.Forbidden)
			.addError(HttpError.NotFound),
	);

// Audit: group-level auth + common errors
const _AuditGroup = HttpApiGroup.make('audit')
	.prefix('/audit')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('getByEntity', '/entity/:subject/:subjectId')
			.setPath(S.Struct({ subject: AuditSubject, subjectId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(AuditLogWithDiff)),
	)
	.add(
		HttpApiEndpoint.get('getByUser', '/user/:userId')
			.setPath(S.Struct({ userId: S.UUID }))
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(AuditLogWithDiff)),
	)
	.add(
		HttpApiEndpoint.get('getMine', '/me')
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(AuditLogWithDiff)),
	);

// Transfer: group-level auth + common errors
const _TransferGroup = HttpApiGroup.make('transfer')
	.prefix('/transfer')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('export', '/export')
			.setUrlParams(TransferQuery)
			.addSuccess(TransferResult)
			.addError(HttpError.NotFound)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Description, 'Export assets in specified format. For xlsx/zip: returns JSON with base64-encoded data. For csv/ndjson: returns raw streaming response with Content-Disposition header.'),
	)
	.add(
		HttpApiEndpoint.post('import', '/import')
			.setUrlParams(TransferQuery)
			.addSuccess(TransferResult)
			.addError(HttpError.Validation),
	);

// Search: group-level auth + common errors
const _SearchGroup = HttpApiGroup.make('search')
	.prefix('/search')
	.middleware(Middleware.Auth)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('search', '/')
			.setUrlParams(_SearchQuery)
			.addSuccess(_SearchResponse)
			.annotate(OpenApi.Description, 'Full-text search with semantic ranking'),
	)
	.add(
		HttpApiEndpoint.get('suggest', '/suggest')
			.setUrlParams(_SuggestQuery)
			.addSuccess(_SuggestResponse)
			.annotate(OpenApi.Description, 'Search term suggestions'),
	)
	.add(
		HttpApiEndpoint.post('refresh', '/refresh')
			.setPayload(S.Struct({ includeGlobal: S.optional(S.Boolean) }))
			.addSuccess(S.Struct({ status: S.Literal('ok') }))
			.addError(HttpError.Forbidden)
			.annotate(OpenApi.Description, 'Refresh search index (admin only)'),
	)
	.add(
		HttpApiEndpoint.post('refreshEmbeddings', '/refresh/embeddings')
			.setPayload(S.Struct({ includeGlobal: S.optional(S.Boolean) }))
			.addSuccess(S.Struct({ count: S.Int }))
			.addError(HttpError.Forbidden)
			.annotate(OpenApi.Description, 'Refresh search embeddings (admin only)'),
	);

// Jobs: group-level auth + common errors
const _JobsGroup = HttpApiGroup.make('jobs')
	.prefix('/jobs')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('subscribe', '/subscribe')
			.addSuccess(S.Void)
			.annotate(OpenApi.Description, 'Subscribe to job status updates via SSE'),
	);

// WebSocket: group-level auth + common errors
const _WebSocketGroup = HttpApiGroup.make('websocket')
	.prefix('/ws')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('connect', '/')
			.addSuccess(S.Void)
			.annotate(OpenApi.Description, 'Upgrade to WebSocket for realtime events'),
	);

// Storage: group-level auth + common errors
const _StorageGroup = HttpApiGroup.make('storage')
	.prefix('/storage')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.post('sign', '/sign')
			.setPayload(_StorageSignRequest)
			.addSuccess(_StorageSignResponse)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Summary, 'Generate presigned URL')
			.annotate(OpenApi.Description, 'Generates a presigned URL for direct S3 upload or download. URLs are tenant-scoped and time-limited.'),
	)
	.add(
		HttpApiEndpoint.get('exists', '/exists/:key')
			.setPath(S.Struct({ key: S.String }))
			.addSuccess(S.Struct({ exists: S.Boolean, key: S.String })),
	)
	.add(
		HttpApiEndpoint.del('remove', '/:key')
			.setPath(S.Struct({ key: S.String }))
			.addSuccess(S.Struct({ key: S.String, success: S.Literal(true) })),
	)
	.add(
		HttpApiEndpoint.post('upload', '/upload')
			.setPayload(_StorageUploadRequest)
			.addSuccess(_StorageUploadResponse)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Summary, 'Upload file directly')
			.annotate(OpenApi.Description, 'Server-side file upload with multipart form data. Files are stored in tenant namespace with automatic content-type detection.'),
	);

// Webhooks: group-level auth + common errors
const _WebhooksGroup = HttpApiGroup.make('webhooks')
	.prefix('/webhooks')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('list', '/')
			.addSuccess(S.Array(_WebhookRegistration))
			.annotate(OpenApi.Summary, 'List registered webhooks'),
	)
	.add(
		HttpApiEndpoint.post('register', '/')
			.setPayload(S.Struct({
				active: S.Boolean,
				eventTypes: S.Array(S.String),
				secret: S.String.pipe(S.minLength(32)),
				timeout: S.optionalWith(S.Number, { default: () => 5000 }),
				url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')),
			}))
			.addSuccess(_Success)
			.addError(HttpError.Validation)
			.annotate(OpenApi.Summary, 'Register webhook'),
	)
	.add(
		HttpApiEndpoint.del('remove', '/:url')
			.setPath(S.Struct({ url: S.String }))
			.addSuccess(_Success)
			.annotate(OpenApi.Summary, 'Remove webhook'),
	)
	.add(
		HttpApiEndpoint.post('test', '/test')
			.setPayload(S.Struct({
				secret: S.String.pipe(S.minLength(32)),
				timeout: S.optionalWith(S.Number, { default: () => 5000 }),
				url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')),
			}))
			.addSuccess(_WebhookTestResult)
			.annotate(OpenApi.Summary, 'Test webhook delivery'),
	)
	.add(
		HttpApiEndpoint.post('retry', '/retry/:id')
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(_Success)
			.addError(HttpError.NotFound)
			.annotate(OpenApi.Summary, 'Retry failed delivery'),
	)
		.add(
			HttpApiEndpoint.get('status', '/status')
				.setUrlParams(_WebhookStatusQuery)
				.addSuccess(S.Array(_DeliveryRecord))
				.annotate(OpenApi.Summary, 'Delivery status'),
		);

// Admin: group-level auth + common errors — excluded from OpenAPI
const _AdminGroup = HttpApiGroup.make('admin')
	.prefix('/admin')
	.middleware(Middleware.Auth)
	.addError(HttpError.Forbidden)
	.addError(HttpError.Internal)
	.addError(HttpError.RateLimit)
	.add(
		HttpApiEndpoint.get('listUsers', '/users')
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(User.json))
			.annotate(OpenApi.Summary, 'List users'),
	)
		.add(
			HttpApiEndpoint.get('listSessions', '/sessions')
				.setUrlParams(_AdminSessionFilter)
				.addSuccess(KeysetResponse(Session.json))
				.annotate(OpenApi.Summary, 'List sessions'),
		)
	.add(
		HttpApiEndpoint.del('deleteSession', '/sessions/:id')
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(_Success)
			.addError(HttpError.NotFound)
			.annotate(OpenApi.Summary, 'Force-end session'),
	)
	.add(
		HttpApiEndpoint.post('revokeSessionsByIp', '/sessions/revoke-ip')
			.setPayload(S.Struct({ ipAddress: S.String }))
			.addSuccess(S.Struct({ revoked: S.Int }))
			.annotate(OpenApi.Summary, 'Revoke all sessions by IP'),
	)
	.add(
		HttpApiEndpoint.get('listJobs', '/jobs')
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(Job.json))
			.annotate(OpenApi.Summary, 'List jobs'),
	)
	.add(
		HttpApiEndpoint.post('cancelJob', '/jobs/:id/cancel')
			.setPath(S.Struct({ id: S.String }))
			.addSuccess(_Success)
			.addError(HttpError.NotFound)
			.annotate(OpenApi.Summary, 'Cancel job'),
	)
	.add(
		HttpApiEndpoint.get('listDlq', '/dlq')
			.setUrlParams(Query)
			.addSuccess(KeysetResponse(JobDlq.json))
			.annotate(OpenApi.Summary, 'List dead letters'),
	)
	.add(
		HttpApiEndpoint.post('replayDlq', '/dlq/:id/replay')
			.setPath(S.Struct({ id: S.UUID }))
			.addSuccess(_Success)
			.addError(HttpError.NotFound)
			.annotate(OpenApi.Summary, 'Replay dead letter'),
	)
	.add(
		HttpApiEndpoint.get('events', '/events')
			.addSuccess(S.Void)
			.annotate(OpenApi.Summary, 'SSE event stream'),
	)
		.add(
			HttpApiEndpoint.get('listApps', '/apps')
				.addSuccess(S.Array(App.json))
				.annotate(OpenApi.Summary, 'List tenant apps'),
		)
		.add(
			HttpApiEndpoint.get('dbIoStats', '/db/io-stats')
				.addSuccess(S.Array(S.Unknown))
				.annotate(OpenApi.Summary, 'Database IO statistics'),
		)
		.add(
			HttpApiEndpoint.get('dbIoConfig', '/db/io-config')
				.addSuccess(S.Array(S.Struct({ name: S.String, setting: S.String })))
				.annotate(OpenApi.Summary, 'Database IO configuration'),
		)
		.add(
			HttpApiEndpoint.get('dbStatements', '/db/statements')
				.setUrlParams(_AdminStatementQuery)
				.addSuccess(S.Array(S.Unknown))
				.annotate(OpenApi.Summary, 'Database statement statistics'),
		);

// --- [ENTRY_POINT] -----------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
	.add(_AdminGroup.annotate(OpenApi.Exclude, true))
	.add(_AuditGroup)
	.add(_AuthGroup)
	.add(_HealthGroup.annotate(OpenApi.Exclude, true))
	.add(_JobsGroup)
	.add(_SearchGroup)
	.add(_StorageGroup)
	.add(_TelemetryGroup.annotate(OpenApi.Exclude, true))
	.add(_TransferGroup)
	.add(_UsersGroup)
	.add(_WebhooksGroup)
	.add(_WebSocketGroup)
	.prefix('/api')
	.annotate(OpenApi.Identifier, 'parametric-portal-api')
	.annotate(OpenApi.Title, 'Parametric Portal API')
	.annotate(OpenApi.Version, '1.0.0')
	.annotate(OpenApi.License, { name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
	.annotate(OpenApi.ExternalDocs, { description: 'Developer Documentation', url: 'https://docs.parametric.dev' });

// --- [EXPORT] ----------------------------------------------------------------

export { AuthResponse, ParametricApi, Query, TransferQuery };
