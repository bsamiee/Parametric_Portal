/**
 * HTTP API: Contract definition shared between server and client.
 * Type-safe HttpApiClient derivation, OpenAPI generation, endpoint groups.
 *
 * Convention: group-level middleware() + addError() for shared concerns.
 * Per-endpoint addError() only for endpoint-specific errors (NotFound, Conflict, Validation).
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, Multipart, OpenApi } from '@effect/platform';
import {ApiKey, App, AppSettingsSchema, Asset, AuditOperationSchema, AuditLog, Job, JobDlq, Notification, OAuthProviderSchema, Permission, PreferencesSchema, RoleSchema, Session, User,} from '@parametric-portal/database/models';
import { Url } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { HttpError } from './errors.ts';
import { WebhookService } from './infra/webhooks.ts';
import { FeatureService } from './domain/features.ts';
import { Middleware } from './middleware.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _PaginationBase = S.Struct({ cursor: S.optional(HttpApiSchema.param('cursor', S.String)), limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 20 }) });
const _Success = S.Struct({ success: S.Literal(true) });
const _DbObservabilitySectionName = S.Literal('io', 'activity', 'storage', 'partitions');
const _DbObservabilityPayload = S.Struct({
    limit: S.optionalWith(S.Int.pipe(S.between(1, 500)), { default: () => 100 }),
    sections: S.Array(S.Struct({
        name: _DbObservabilitySectionName,
        options: S.optional(S.Record({ key: S.String, value: S.Unknown })),
    })).pipe(S.minItems(1)),
});
const _DbObservabilityResponse = S.Struct({ sections: S.Record({ key: S.String, value: S.Unknown }) });
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
const TemporalQuery = S.extend(_PaginationBase, S.Struct({
    after: S.optional(HttpApiSchema.param('after', S.DateFromString)),
    before: S.optional(HttpApiSchema.param('before', S.DateFromString)),
}));
const Query = S.extend(TemporalQuery, S.Struct({
    includeDiff: S.optional(HttpApiSchema.param('includeDiff', S.BooleanFromString)),
    operation: S.optional(HttpApiSchema.param('operation', AuditOperationSchema)),
}));
const TransferQuery = S.Struct({
    after: S.optionalWith(HttpApiSchema.param('after',   S.DateFromString), { as: 'Option' }),
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
const AuditLogWithDiff = S.extend(AuditLog.json, S.Struct({
    diff: S.NullOr(S.Struct({
        ops: S.Array(S.Struct({
            from: S.optional(S.String),
            op: S.Literal('add', 'remove', 'replace', 'move', 'copy', 'test'),
            path: S.String,
            value: S.optional(S.Unknown),
        })),
    })),
}));
const SearchEntityType = S.Literal('app', 'asset', 'auditLog', 'user');
const _TenantOAuthProviderRead = S.Struct({ clientId: S.NonEmptyTrimmedString, clientSecretSet: S.Boolean, enabled: S.Boolean, keyId: S.optional(S.NonEmptyTrimmedString), provider: OAuthProviderSchema, scopes: S.optional(S.Array(S.String)), teamId: S.optional(S.NonEmptyTrimmedString), tenant: S.optional(S.NonEmptyTrimmedString) });
// --- [GROUPS] ----------------------------------------------------------------

// Auth: mixed public/protected endpoints — per-endpoint middleware
const _AuthGroup = HttpApiGroup.make('auth')
    .prefix('/v1/auth')
    .addError(HttpError.Conflict)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .addSuccess(S.Struct({ url: Url }))
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .addError(HttpError.OAuth)
            .annotate(OpenApi.Summary, 'Start OAuth flow')
            .annotate(OpenApi.Description, 'Initiates OAuth authorization flow for the specified provider.'),
    )
    .add(HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .setUrlParams(S.Struct({ code: S.String, state: S.String }))
            .addSuccess(AuthResponse)
            .addError(HttpError.Forbidden)
            .addError(HttpError.OAuth)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'OAuth callback')
            .annotate(OpenApi.Description, 'Handles OAuth provider callback. Validates state, exchanges code for tokens, and creates/updates user session.'),
    )
    .add(HttpApiEndpoint.post('refresh', '/refresh')
            .addSuccess(AuthResponse)
            .addError(HttpError.Auth)
            .annotate(OpenApi.Summary, 'Refresh access token')
            .annotate(OpenApi.Description, 'Exchanges refresh token (from HttpOnly cookie) for new access and refresh tokens.'),
    )
    .add(HttpApiEndpoint.post('logout', '/logout')
            .middleware(Middleware)
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'End session'),
    )
    .add(HttpApiEndpoint.get('me', '/me')
            .middleware(Middleware)
            .addSuccess(User.json)
            .addError(HttpError.NotFound)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Get current user'),
    )
    .add(HttpApiEndpoint.get('mfaStatus', '/mfa/status')
            .middleware(Middleware)
            .addSuccess(S.Struct({ enabled: S.Boolean, enrolled: S.Boolean, remainingBackupCodes: S.optional(S.Int) }))
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Get MFA status'),
    )
    .add(HttpApiEndpoint.post('mfaEnroll', '/mfa/enroll')
            .middleware(Middleware)
            .addSuccess(S.Struct({ backupCodes: S.Array(S.String), qrDataUrl: S.String, secret: S.String }))
            .addError(HttpError.Auth)
            .addError(HttpError.Conflict)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Enroll in MFA')
            .annotate(OpenApi.Description, 'Generates TOTP secret and backup codes for MFA enrollment.'),
    )
    .add(HttpApiEndpoint.post('mfaVerify', '/mfa/verify')
            .middleware(Middleware)
            .setPayload(S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) }))
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Verify MFA code')
            .annotate(OpenApi.Description, 'Verifies TOTP code and enables MFA if not already enabled.'),
    )
    .add(HttpApiEndpoint.del('mfaDisable', '/mfa')
            .middleware(Middleware)
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.Forbidden)
            .addError(HttpError.NotFound)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Disable MFA'),
    )
    .add(HttpApiEndpoint.post('mfaRecover', '/mfa/recover')
            .middleware(Middleware)
            .setPayload(S.Struct({ code: S.NonEmptyTrimmedString }))
            .addSuccess(S.Struct({ remainingCodes: S.Int, success: S.Literal(true) }))
            .addError(HttpError.Auth)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Use MFA recovery code')
            .annotate(OpenApi.Description, 'Validates backup code for account recovery when TOTP device is unavailable.'),
    )
    .add(HttpApiEndpoint.get('listApiKeys', '/apikeys')
            .middleware(Middleware)
            .addSuccess(S.Struct({ data: S.Array(ApiKey.json) }))
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'List API keys'),
    )
    .add(HttpApiEndpoint.post('createApiKey', '/apikeys')
            .middleware(Middleware)
            .setPayload(S.Struct({ expiresAt: S.optional(S.DateFromSelf), name: S.NonEmptyTrimmedString }))
            .addSuccess(S.extend(ApiKey.json, S.Struct({ apiKey: S.String })))
            .addError(HttpError.Auth)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Create API key')
            .annotate(OpenApi.Description, 'Creates new API key. The key value is returned only once in the response.'),
    )
    .add(HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
            .middleware(Middleware)
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.NotFound)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Revoke API key'),
    )
    .add(HttpApiEndpoint.post('rotateApiKey', '/apikeys/:id/rotate')
            .middleware(Middleware)
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(S.extend(ApiKey.json, S.Struct({ apiKey: S.String })))
            .addError(HttpError.Auth)
            .addError(HttpError.NotFound)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Rotate API key')
            .annotate(OpenApi.Description, 'Generates a new key value for an existing API key. The old key is invalidated immediately. The new key value is returned only once.'),
    )
    .add(HttpApiEndpoint.post('linkProvider', '/link/:provider')
            .middleware(Middleware)
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .setPayload(S.Struct({ externalId: S.NonEmptyTrimmedString }))
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.Conflict)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .annotate(OpenApi.Summary, 'Link OAuth provider')
            .annotate(OpenApi.Description, 'Links an OAuth provider to the authenticated user account using the provider external ID from a completed OAuth flow.'),
    )
    .add(HttpApiEndpoint.del('unlinkProvider', '/link/:provider')
            .middleware(Middleware)
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .addSuccess(_Success)
            .addError(HttpError.Auth)
            .addError(HttpError.Conflict)
            .addError(HttpError.Forbidden)
            .addError(HttpError.Internal)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Unlink OAuth provider')
            .annotate(OpenApi.Description, 'Removes an OAuth provider link from the authenticated user account. Cannot unlink the last authentication method.'),
    );

// Health: unauthenticated operational endpoints
const _HealthGroup = HttpApiGroup.make('health')
    .prefix('/health')
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ latencyMs: S.Number, status: S.Literal('ok', 'degraded') })))
    .add(HttpApiEndpoint.get('readiness', '/readiness')
            .addSuccess(S.Struct({
                checks: S.Struct({
                    cache: S.Struct({ connected: S.Boolean, latencyMs: S.Number }),
                    database: S.Struct({ healthy: S.Boolean, latencyMs: S.Number }),
                    metrics: S.Literal('healthy', 'degraded', 'alerted'),
                    polling: S.Struct({
                        criticalAlerts: S.Number,
                        lastFailureAtMs: S.optional(S.Number),
                        lastSuccessAtMs: S.optional(S.Number),
                        scope: S.Literal('global'),
                        stale: S.Boolean,
                        totalAlerts: S.Number,
                    }),
                    vector: S.Struct({ configured: S.Boolean }),
                }),
                status: S.Literal('ok'),
            }))
            .addError(HttpError.ServiceUnavailable),
    )
    .add(HttpApiEndpoint.get('clusterHealth', '/cluster')
            .addSuccess(S.Struct({
                cluster: S.Struct({
                    degraded: S.Boolean, healthy: S.Boolean,
                    metrics: S.Struct({ entities: S.Number, runners: S.Number, runnersHealthy: S.Number, shards: S.Number, singletons: S.Number }),
                }),
            }))
            .addError(HttpError.ServiceUnavailable)
            .annotate(OpenApi.Exclude, true),
    );

// Telemetry: unauthenticated OTLP ingest
const _TelemetryGroup = HttpApiGroup.make('telemetry')
    .prefix('/v1')
    .add(HttpApiEndpoint.post('ingestTraces', '/traces')
            .addSuccess(S.Void)
            .addError(HttpError.RateLimit)
            .addError(HttpError.ServiceUnavailable),
    )
    .add(HttpApiEndpoint.post('ingestMetrics', '/metrics')
            .addSuccess(S.Void)
            .addError(HttpError.RateLimit)
            .addError(HttpError.ServiceUnavailable),
    )
    .add(HttpApiEndpoint.post('ingestLogs', '/logs')
            .addSuccess(S.Void)
            .addError(HttpError.RateLimit)
            .addError(HttpError.ServiceUnavailable),
    );

// Users: group-level auth + common errors
const _UsersGroup = HttpApiGroup.make('users')
    .prefix('/v1/users')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('getMe', '/me')
            .addSuccess(User.json)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Get own profile'),
    )
    .add(HttpApiEndpoint.patch('updateProfile', '/me')
            .setPayload(S.Struct({email: S.String.pipe(S.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)).annotations({ description: 'New email address' }),}))
            .addSuccess(User.json)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Update own profile'),
    )
    .add(HttpApiEndpoint.post('deactivate', '/me/deactivate')
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Deactivate own account'),
    )
    .add(HttpApiEndpoint.patch('updateRole', '/:id/role')
            .setPath(S.Struct({ id: S.UUID }))
            .setPayload(S.Struct({ role: RoleSchema }))
            .addSuccess(User.json)
            .addError(HttpError.NotFound),
    )
    .add(HttpApiEndpoint.get('getNotificationPreferences', '/me/notifications/preferences')
            .addSuccess(PreferencesSchema)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Get notification preferences'),
    )
    .add(HttpApiEndpoint.put('updateNotificationPreferences', '/me/notifications/preferences')
            .setPayload(PreferencesSchema)
            .addSuccess(PreferencesSchema)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Update notification preferences'),
    )
    .add(HttpApiEndpoint.get('listNotifications', '/me/notifications')
            .setUrlParams(TemporalQuery)
            .addSuccess(KeysetResponse(Notification.json))
            .annotate(OpenApi.Summary, 'List own notifications'),
    )
    .add(HttpApiEndpoint.get('subscribeNotifications', '/me/notifications/subscribe')
            .addSuccess(S.Void)
            .annotate(OpenApi.Summary, 'Subscribe to own notifications'),
    );

// Audit: group-level auth + common errors
const _AuditGroup = HttpApiGroup.make('audit')
    .prefix('/v1/audit')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('getByEntity', '/entity/:subject/:subjectId')
            .setPath(S.Struct({ subject: S.Literal('ApiKey', 'App', 'Asset', 'MfaSecret', 'OauthAccount', 'Session', 'User'), subjectId: S.UUID }))
            .setUrlParams(Query)
            .addSuccess(KeysetResponse(AuditLogWithDiff)),
    )
    .add(HttpApiEndpoint.get('getByUser', '/user/:userId')
            .setPath(S.Struct({ userId: S.UUID }))
            .setUrlParams(Query)
            .addSuccess(KeysetResponse(AuditLogWithDiff)),
    )
    .add(HttpApiEndpoint.get('getMine', '/me')
            .setUrlParams(Query)
            .addSuccess(KeysetResponse(AuditLogWithDiff)),
    );

// Transfer: group-level auth + common errors
const _TransferGroup = HttpApiGroup.make('transfer')
    .prefix('/v1/transfer')
    .middleware(Middleware)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('export', '/export')
            .setUrlParams(TransferQuery)
            .addSuccess(TransferResult)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Description, 'Export assets in specified format. For xlsx/zip: returns JSON with base64-encoded data. For csv/ndjson: returns raw streaming response with Content-Disposition header.'),
    )
    .add(HttpApiEndpoint.post('import', '/import')
            .setUrlParams(TransferQuery)
            .addSuccess(TransferResult)
            .addError(HttpError.Validation),
    );

// Search: group-level auth + common errors
const _SearchGroup = HttpApiGroup.make('search')
    .prefix('/v1/search')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('search', '/')
            .setUrlParams(S.extend(_PaginationBase, S.Struct({
                entityTypes: S.optional(HttpApiSchema.param('entityTypes', S.transform(
                    S.String,
                    S.Array(SearchEntityType),
                    { decode: (input) => input.split(',').filter((value): value is typeof SearchEntityType.Type => ['app', 'asset', 'auditLog', 'user'].includes(value)), encode: (values) => values.join(',') },
                ))),
                includeFacets: S.optional(HttpApiSchema.param('includeFacets', S.BooleanFromString)),
                includeGlobal: S.optional(HttpApiSchema.param('includeGlobal', S.BooleanFromString)),
                includeSnippets: S.optional(HttpApiSchema.param('includeSnippets', S.BooleanFromString)),
                q: HttpApiSchema.param('q', S.String.pipe(S.minLength(2), S.maxLength(256))),
            })))
            .addSuccess(S.extend(
                KeysetResponse(S.Struct({
                    displayText: S.String, entityId: S.UUID, entityType: SearchEntityType,
                    metadata: S.NullOr(S.Unknown), rank: S.Number, snippet: S.NullOr(S.String),
                })),
                S.Struct({ facets: S.NullOr(S.Record({ key: SearchEntityType, value: S.Int })) }),
            ))
            .annotate(OpenApi.Description, 'Full-text + pg_trgm multi-channel + semantic ranking'),
    )
    .add(HttpApiEndpoint.get('suggest', '/suggest')
            .setUrlParams(S.Struct({
                includeGlobal: S.optional(HttpApiSchema.param('includeGlobal', S.BooleanFromString)),
                limit: S.optional(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 20)))),
                prefix: HttpApiSchema.param('prefix', S.String.pipe(S.minLength(2), S.maxLength(256))),
            }))
            .addSuccess(S.Array(S.Struct({ frequency: S.Int, term: S.String })))
            .annotate(OpenApi.Description, 'Prefix suggestions with pg_trgm typo fallback'),
    )
    .add(HttpApiEndpoint.post('refresh', '/refresh')
            .setPayload(S.Struct({ includeGlobal: S.optional(S.Boolean) }))
            .addSuccess(S.Struct({ status: S.Literal('ok') }))
            .annotate(OpenApi.Description, 'Refresh search index (admin only)'),
    )
    .add(HttpApiEndpoint.post('refreshEmbeddings', '/refresh/embeddings')
            .setPayload(S.Struct({ includeGlobal: S.optional(S.Boolean) }))
            .addSuccess(S.Struct({ count: S.Int }))
            .annotate(OpenApi.Description, 'Refresh search embeddings (admin only)'),
    );

// Jobs: group-level auth + common errors
const _JobsGroup = HttpApiGroup.make('jobs')
    .prefix('/v1/jobs')
    .middleware(Middleware)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('subscribe', '/subscribe')
            .addSuccess(S.Void)
            .annotate(OpenApi.Description, 'Subscribe to job status updates via SSE'),
    );

// WebSocket: group-level auth + common errors
const _WebSocketGroup = HttpApiGroup.make('websocket')
    .prefix('/v1/ws')
    .middleware(Middleware)
    .addError(HttpError.Auth)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('connect', '/')
            .addSuccess(S.Void)
            .annotate(OpenApi.Description, 'Upgrade to WebSocket for realtime events'),
    );

// Storage: group-level auth + common errors
const _StorageGroup = HttpApiGroup.make('storage')
    .prefix('/v1/storage')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.post('sign', '/sign')
            .setPayload(S.Struct({
                contentType: S.optional(S.String).annotations({ description: 'Content-Type for PUT operations (default: application/octet-stream)' }),
                expiresInSeconds: S.optionalWith(S.Int.pipe(S.between(60, 3600)), { default: () => 3600 }).annotations({ description: 'URL expiration in seconds (60-3600, default: 3600)' }),
                key: S.NonEmptyTrimmedString.annotations({ description: 'Storage key (path within tenant namespace)' }),
                op: S.Literal('get', 'put').annotations({ description: 'Operation type: get (download) or put (upload)' }),
            }))
            .addSuccess(S.Struct({
                expiresAt: S.DateTimeUtc.annotations({ description: 'URL expiration timestamp' }),
                key: S.String.annotations({ description: 'Storage key' }),
                op: S.Literal('get', 'put').annotations({ description: 'Operation type' }),
                url: Url.annotations({ description: 'Presigned URL for direct S3 access' }),
            }))
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Generate presigned URL')
            .annotate(OpenApi.Description, 'Generates a presigned URL for direct S3 upload or download. URLs are tenant-scoped and time-limited.'),
    )
    .add(HttpApiEndpoint.get('exists', '/exists/:key')
            .setPath(S.Struct({ key: S.String }))
            .addSuccess(S.Struct({ exists: S.Boolean, key: S.String })),
    )
    .add(HttpApiEndpoint.del('remove', '/:key')
            .setPath(S.Struct({ key: S.String }))
            .addSuccess(S.Struct({ key: S.String, success: S.Literal(true) })),
    )
    .add(HttpApiEndpoint.post('upload', '/upload')
            .setPayload(S.Struct({
                contentType: S.optional(S.String).annotations({ description: 'Optional content-type override' }),
                file: Multipart.SingleFileSchema.annotations({ description: 'File to upload' }),
                key: S.optional(S.String).annotations({ description: 'Optional storage key (defaults to filename)' }),
            }))
            .addSuccess(S.Struct({
                etag: S.String.annotations({ description: 'ETag of uploaded object' }),
                key: S.String.annotations({ description: 'Storage key where file was stored' }),
                size: S.Int.annotations({ description: 'File size in bytes' }),
            }))
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Upload file directly')
            .annotate(OpenApi.Description, 'Server-side file upload with multipart form data. Files are stored in tenant namespace with automatic content-type detection.'),
    )
    .add(HttpApiEndpoint.get('getAsset', '/assets/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(Asset.json)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Get asset by ID')
            .annotate(OpenApi.Description, 'Retrieves a single asset by its unique identifier.'),
    )
    .add(HttpApiEndpoint.post('createAsset', '/assets')
            .setPayload(S.Struct({
                content: S.String.annotations({ description: 'Asset content' }),
                hash: S.optional(S.String).annotations({ description: 'Content hash for deduplication' }),
                name: S.optional(S.String).annotations({ description: 'Display name' }),
                storageRef: S.optional(S.String).annotations({ description: 'S3 storage key reference' }),
                type: S.NonEmptyTrimmedString.annotations({ description: 'Asset type slug' }),
            }))
            .addSuccess(Asset.json)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Create asset')
            .annotate(OpenApi.Description, 'Creates a new asset in the current tenant namespace.'),
    )
    .add(HttpApiEndpoint.patch('updateAsset', '/assets/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .setPayload(S.Struct({
                content: S.optional(S.String).annotations({ description: 'Updated content' }),
                name: S.optional(S.String).annotations({ description: 'Updated display name' }),
                status: S.optional(S.Literal('active', 'processing', 'failed')).annotations({ description: 'Updated status' }),
                type: S.optional(S.NonEmptyTrimmedString).annotations({ description: 'Updated asset type' }),
            }))
            .addSuccess(Asset.json)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Update asset metadata')
            .annotate(OpenApi.Description, 'Updates metadata fields of an existing asset.'),
    )
    .add(HttpApiEndpoint.del('archiveAsset', '/assets/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(S.Struct({ id: S.UUID, success: S.Literal(true) }))
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Archive asset')
            .annotate(OpenApi.Description, 'Soft-deletes an asset. The asset can be restored later.'),
    )
    .add(HttpApiEndpoint.get('listAssets', '/assets')
            .setUrlParams(S.extend(_PaginationBase, S.Struct({
                after: S.optional(HttpApiSchema.param('after', S.DateFromString)).annotations({ description: 'Filter: created after this date' }),
                before: S.optional(HttpApiSchema.param('before', S.DateFromString)).annotations({ description: 'Filter: created before this date' }),
                sort: S.optionalWith(HttpApiSchema.param('sort', S.Literal('asc', 'desc')), { default: () => 'desc' as const }).annotations({ description: 'Sort direction' }),
                type: S.optional(HttpApiSchema.param('type', S.NonEmptyTrimmedString)).annotations({ description: 'Filter by asset type' }),
            })))
            .addSuccess(KeysetResponse(Asset.json.pipe(S.pick('id', 'name', 'status', 'storageRef', 'type', 'updatedAt'))))
            .annotate(OpenApi.Summary, 'List assets')
            .annotate(OpenApi.Description, 'Browse assets with cursor-based pagination, filtering by type and date range.'),
    );

// Webhooks: group-level auth + common errors
const _WebhooksGroup = HttpApiGroup.make('webhooks')
    .prefix('/v1/webhooks')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.NotFound)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get('list', '/')
            .addSuccess(S.Array(S.Struct({
                active: S.Boolean,
                eventTypes: S.Array(S.String),
                timeout: S.optionalWith(S.Number, { default: () => 5000 }),
                url: S.String,
            })))
            .annotate(OpenApi.Summary, 'List registered webhooks'),
    )
    .add(HttpApiEndpoint.post('register', '/')
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
    .add(HttpApiEndpoint.del('remove', '/:url')
            .setPath(S.Struct({ url: S.String }))
            .addSuccess(_Success)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Remove webhook'),
    )
    .add(HttpApiEndpoint.post('test', '/test')
            .setPayload(S.Struct({
                secret: S.String.pipe(S.minLength(32)),
                timeout: S.optionalWith(S.Number, { default: () => 5000 }),
                url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')),
            }))
            .addSuccess(S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number }))
            .annotate(OpenApi.Summary, 'Test webhook delivery'),
    )
    .add(HttpApiEndpoint.post('retry', '/retry/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Retry failed delivery'),
    )
    .add(HttpApiEndpoint.get('status', '/status')
            .setUrlParams(S.Struct({ url: S.optional(HttpApiSchema.param('url', S.String)) }))
            .addSuccess(S.Array(WebhookService.DeliveryRecord))
            .annotate(OpenApi.Summary, 'Delivery status')
            .annotate(OpenApi.Description, 'Returns the latest delivery snapshot per endpoint URL.'),
    );

// Admin: group-level auth + common errors — excluded from OpenAPI
const _AdminGroup = HttpApiGroup.make('admin')
    .prefix('/v1/admin')
    .middleware(Middleware)
    .addError(HttpError.Conflict)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .addError(HttpError.Validation)
    .add(HttpApiEndpoint.get('listUsers', '/users')
            .setUrlParams(_PaginationBase)
            .addSuccess(KeysetResponse(User.json))
            .annotate(OpenApi.Summary, 'List users'),
    )
    .add(HttpApiEndpoint.get('listSessions', '/sessions')
            .setUrlParams(S.Struct({
                cursor: S.optional(HttpApiSchema.param('cursor', S.String)),
                ipAddress: S.optional(HttpApiSchema.param('ipAddress', S.String)),
                limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), { default: () => 50 }),
                userId: S.optional(HttpApiSchema.param('userId', S.UUID)),
            }).pipe(S.filter(
                (parameters) => !(parameters.userId !== undefined && parameters.ipAddress !== undefined),
                { message: () => 'Provide either userId or ipAddress, not both' },
            )))
            .addSuccess(KeysetResponse(Session.json))
            .annotate(OpenApi.Summary, 'List sessions'),
    )
    .add(HttpApiEndpoint.del('deleteSession', '/sessions/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Force-end session'),
    )
    .add(HttpApiEndpoint.post('revokeSessionsByIp', '/sessions/revoke-ip')
            .setPayload(S.Struct({ ipAddress: S.String }))
            .addSuccess(S.Struct({ revoked: S.Int }))
            .annotate(OpenApi.Summary, 'Revoke all sessions by IP'),
    )
    .add(HttpApiEndpoint.get('listJobs', '/jobs')
            .setUrlParams(_PaginationBase)
            .addSuccess(KeysetResponse(Job.json))
            .annotate(OpenApi.Summary, 'List jobs'),
    )
    .add(HttpApiEndpoint.post('cancelJob', '/jobs/:id/cancel')
            .setPath(S.Struct({ id: S.String }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Cancel job'),
    )
    .add(HttpApiEndpoint.get('listDlq', '/dlq')
            .setUrlParams(_PaginationBase)
            .addSuccess(KeysetResponse(JobDlq.json))
            .annotate(OpenApi.Summary, 'List dead letters'),
    )
    .add(HttpApiEndpoint.post('replayDlq', '/dlq/:id/replay')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Replay dead letter'),
    )
    .add(HttpApiEndpoint.get('listNotifications', '/notifications')
            .setUrlParams(TemporalQuery)
            .addSuccess(KeysetResponse(Notification.json))
            .annotate(OpenApi.Summary, 'List notifications'),
    )
    .add(HttpApiEndpoint.post('replayNotification', '/notifications/:id/replay')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Replay notification'),
    )
    .add(HttpApiEndpoint.get('events', '/events')
            .addSuccess(S.Void)
            .annotate(OpenApi.Summary, 'SSE event stream'),
    )
    .add(HttpApiEndpoint.post('queryDbObservability', '/db/observability')
            .setPayload(_DbObservabilityPayload)
            .addSuccess(_DbObservabilityResponse)
            .annotate(OpenApi.Summary, 'Query database observability sections'),
    )
    .add(HttpApiEndpoint.get('listPermissions', '/permissions')
            .addSuccess(S.Array(S.Struct({
                action: Permission.fields.action,
                resource: Permission.fields.resource,
                role: Permission.fields.role,
            })))
            .annotate(OpenApi.Summary, 'List tenant permissions'),
    )
    .add(HttpApiEndpoint.put('grantPermission', '/permissions')
            .setPayload(S.Struct({ action: Permission.fields.action, resource: Permission.fields.resource, role: Permission.fields.role }))
            .addSuccess(S.Struct({ action: Permission.fields.action, resource: Permission.fields.resource, role: Permission.fields.role }))
            .annotate(OpenApi.Summary, 'Grant tenant permission'),
    )
    .add(HttpApiEndpoint.del('revokePermission', '/permissions')
            .setPayload(S.Struct({ action: Permission.fields.action, resource: Permission.fields.resource, role: Permission.fields.role }))
            .addSuccess(_Success)
            .annotate(OpenApi.Summary, 'Revoke tenant permission'),
    )
    .add(HttpApiEndpoint.get('listTenants', '/tenants')
            .addSuccess(S.Array(App.json))
            .annotate(OpenApi.Summary, 'List tenants'),
    )
    .add(HttpApiEndpoint.post('createTenant', '/tenants')
            .setPayload(S.Struct({
                name: S.NonEmptyTrimmedString,
                namespace: S.NonEmptyTrimmedString.pipe(S.pattern(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)),
                settings: S.optional(AppSettingsSchema),
            }))
            .addSuccess(App.json)
            .addError(HttpError.Conflict)
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Create tenant'),
    )
    .add(HttpApiEndpoint.get('getTenant', '/tenants/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(App.json)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Get tenant'),
    )
    .add(HttpApiEndpoint.patch('updateTenant', '/tenants/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .setPayload(S.Struct({name: S.optional(S.NonEmptyTrimmedString), settings: S.optional(AppSettingsSchema),}))
            .addSuccess(App.json)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Update tenant'),
    )
    .add(HttpApiEndpoint.del('deactivateTenant', '/tenants/:id')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Suspend tenant'),
    )
    .add(HttpApiEndpoint.post('resumeTenant', '/tenants/:id/resume')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Resume suspended tenant'),
    )
    .add(HttpApiEndpoint.post('archiveTenant', '/tenants/:id/archive')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Archive tenant'),
    )
    .add(HttpApiEndpoint.post('purgeTenant', '/tenants/:id/purge')
            .setPath(S.Struct({ id: S.UUID }))
            .setPayload(S.Struct({ confirm: S.Literal(true) }))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Purge tenant data'),
    )
    .add(HttpApiEndpoint.get('getTenantOAuth', '/tenants/:id/oauth')
            .setPath(S.Struct({ id: S.UUID }))
            .addSuccess(S.Struct({ providers: S.Array(_TenantOAuthProviderRead) }))
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Get tenant OAuth config'),
    )
    .add(HttpApiEndpoint.put('updateTenantOAuth', '/tenants/:id/oauth')
            .setPath(S.Struct({ id: S.UUID }))
            .setPayload(S.Struct({ providers: S.Array(S.Struct({ clientId: S.NonEmptyTrimmedString, clientSecret: S.optional(S.NonEmptyTrimmedString), enabled: S.Boolean, keyId: S.optional(S.NonEmptyTrimmedString), provider: OAuthProviderSchema, scopes: S.optional(S.Array(S.String)), teamId: S.optional(S.NonEmptyTrimmedString), tenant: S.optional(S.NonEmptyTrimmedString) })) }))
            .addSuccess(S.Struct({ providers: S.Array(_TenantOAuthProviderRead) }))
            .addError(HttpError.NotFound)
            .addError(HttpError.Validation)
            .annotate(OpenApi.Summary, 'Update tenant OAuth config'),
    )
    .add(HttpApiEndpoint.get('getFeatureFlags', '/features')
            .addSuccess(FeatureService.FeatureFlagsSchema)
            .annotate(OpenApi.Summary, 'Get tenant feature flags'),
    )
    .add(HttpApiEndpoint.put('setFeatureFlag', '/features')
            .setPayload(S.Struct({flag: S.keyof(FeatureService.FeatureFlagsSchema), value: S.Int.pipe(S.between(0, 100)),}))
            .addSuccess(_Success)
            .addError(HttpError.NotFound)
            .annotate(OpenApi.Summary, 'Set tenant feature flag'),
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
    .annotate(OpenApi.Version, '1.1.0')
    .annotate(OpenApi.License, { name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
    .annotate(OpenApi.ExternalDocs, { description: 'Developer Documentation', url: 'https://docs.parametric.dev' });

// --- [EXPORT] ----------------------------------------------------------------

export { AuthResponse, ParametricApi, Query, TransferQuery };
