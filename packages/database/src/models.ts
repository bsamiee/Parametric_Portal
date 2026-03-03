/** biome-ignore-all assist/source/useSortedKeys: <Maintain registry organization> */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const RoleSchema =                   S.Literal('owner',  'admin',      'member',   'viewer', 'guest'    );
const OAuthProviderSchema =          S.Literal('apple',  'github',     'google',   'microsoft'          );
const JobStatusSchema =              S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
const AuditOperationSchema =         S.Literal(
    'create', 'update', 'delete', 'read', 'list', 'status',
    'login', 'refresh', 'revoke', 'revokeByIp',
    'verify', 'verifyMfa', 'register', 'enroll', 'disable',
    'sign', 'upload', 'stream_upload', 'copy', 'remove', 'abort_multipart',
    'export', 'import', 'validate',
    'cancel', 'replay',
    'auth_failure', 'permission_denied',
    'purge-sessions', 'purge-api-keys', 'purge-assets', 'purge-event-journal', 'purge-job-dlq', 'purge-kv-store',
    'purge-mfa-secrets', 'purge-oauth-accounts', 'archive', 'purge-tenant',
);
const PreferencesSchema =   S.Struct({
    channels:   S.Struct({email: S.Boolean, inApp: S.Boolean, webhook: S.Boolean,}),
    mutedUntil: S.NullOr(S.String),
    templates:  S.Record({key: S.String, value: S.Struct({email: S.optional(S.Boolean), inApp: S.optional(S.Boolean), webhook: S.optional(S.Boolean),}),}),
});
const FeatureFlagsSchema = S.Struct({
    enableAiSearch:        S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 0   }),
    enableApiKeys:         S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 100 }),
    enableAuditLog:        S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 100 }),
    enableExport:          S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 0   }),
    enableMfa:             S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 0   }),
    enableNotifications:   S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 100 }),
    enableOAuth:           S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 0   }),
    enableRealtime:        S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 100 }),
    enableWebhooks:        S.optionalWith(S.Int.pipe(S.between(0, 100)), { default: () => 0   }),
});
const AiProviderSchema = S.Literal('anthropic', 'gemini', 'openai');
const AiSettingsSchema = (() => {
    const embedding = S.Struct({
        cacheCapacity:   S.optionalWith(S.Int, { default: () => 1000 }),
        cacheTtlMinutes: S.optionalWith(S.Int, { default: () => 30   }),
        dimensions:      S.optionalWith(S.Int, { default: () => 1536 }),
        maxBatchSize:    S.optionalWith(S.Int, { default: () => 256  }),
        mode:            S.optionalWith(S.Literal('batched', 'data-loader'), { default: () => 'batched' as const }),
        model:           S.optionalWith(S.String, { default: () => 'text-embedding-3-small' }),
        provider:        S.optionalWith(S.Literal('openai'), { default: () => 'openai' as const }),
        windowMs:        S.optionalWith(S.Int, { default: () => 200 }),
    });
    const language = S.Struct({
        fallback:    S.optionalWith(S.Array(AiProviderSchema), { default: () => [] }),
        maxTokens:   S.optionalWith(S.Int,    { default: () => 4096 }),
        model:       S.optionalWith(S.String, { default: () => 'gpt-4o' }),
        provider:    S.optionalWith(AiProviderSchema, { default: () => 'openai' as const }),
        temperature: S.optionalWith(S.Number, { default: () => 1  }),
        topK:        S.optionalWith(S.Number, { default: () => 40 }),
        topP:        S.optionalWith(S.Number, { default: () => 1  }),
    });
    const policy = S.Struct({
        maxRequestsPerMinute: S.optionalWith(S.Int, { default: () => 60 }),
        maxTokensPerDay:      S.optionalWith(S.Int, { default: () => 1_000_000 }),
        maxTokensPerRequest:  S.optionalWith(S.Int, { default: () => 16_384 }),
        tools:                S.optionalWith(S.Struct({
            mode:  S.Literal('allow', 'deny'),
            names: S.Array(S.String),
        }), { default: () => ({ mode: 'allow' as const, names: [] as Array<string> }) }),
    });
    return S.Struct({
        embedding: S.optionalWith(embedding, { default: () => S.decodeSync(embedding)({}) }),
        language:  S.optionalWith(language,  { default: () => S.decodeSync(language)({})  }),
        policy:    S.optionalWith(policy,    { default: () => S.decodeSync(policy)({})    }),
    });
})();
const WebhookUrlSchema = S.String.pipe(
    S.filter((value) => {
        const parsed = URL.canParse(value) ? new URL(value) : null;
        return parsed !== null
            && parsed.protocol === 'https:'
            && parsed.username === ''
            && parsed.password === ''
            && parsed.hostname !== ''
            && !parsed.hostname.endsWith('.');
    }, { message: () => 'Expected a valid https webhook URL without embedded credentials' }),
    S.brand('WebhookUrl'),
);
const AppSettingsSchema = S.Struct({
    ai:             S.optionalWith(AiSettingsSchema,   { default: () => S.decodeSync(AiSettingsSchema)({})   }),
    featureFlags:   S.optionalWith(FeatureFlagsSchema, { default: () => S.decodeSync(FeatureFlagsSchema)({}) }),
    oauthProviders: S.optionalWith(S.Array(
        S.Struct({
            clientId:              S.NonEmptyTrimmedString,
            clientSecretEncrypted: S.String,
            enabled:               S.Boolean,
            keyId:                 S.optional(S.NonEmptyTrimmedString),
            provider:              OAuthProviderSchema,
            scopes:                S.optional(S.Array(S.String)),
            teamId:                S.optional(S.NonEmptyTrimmedString),
            tenant:                S.optional(S.NonEmptyTrimmedString) })),
        { default: () => [] }),
    webhooks: S.optionalWith(S.Array(S.Struct({
        active:     S.Boolean,
        endpoint:   S.Struct({ secret: S.String.pipe(S.minLength(32)), timeout: S.optionalWith(S.Number, { default: () => 5000 }), url: WebhookUrlSchema }),
        eventTypes: S.Array(S.String),
    })), { default: () => [] }),
});
const AppSettingsDefaults = S.decodeSync(AppSettingsSchema)({});

// --- [AUTH: USER] ------------------------------------------------------------
class User extends Model.Class<User>('User')({
    id:          Model.Generated(S.UUID),
    appId:       S.UUID,
    email:       S.String,
    preferences: Model.Generated(PreferencesSchema),
    role:        RoleSchema,
    status:      S.Literal('active', 'inactive', 'suspended'),
    deletedAt:   Model.FieldOption(S.DateFromSelf),
    updatedAt:   Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: PERMISSION] -----------------------------------------------------
class Permission extends Model.Class<Permission>('Permission')({
    id:        Model.Generated(S.UUID),
    appId:     S.UUID,
    role:      RoleSchema,
    resource:  S.NonEmptyTrimmedString,
    action:    S.NonEmptyTrimmedString,
    deletedAt: Model.FieldOption(S.DateFromSelf),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: SESSION] ---------------------------------------------------------
class Session extends Model.Class<Session>('Session')({
    id:            Model.Generated(S.UUID),
    appId:         S.UUID,
    userId:        S.UUID,
    expiryAccess:  S.DateFromSelf,
    expiryRefresh: S.DateFromSelf,
    verifiedAt:    Model.FieldOption(S.DateFromSelf),
    ipAddress:     Model.FieldOption(S.String),
    agent:         Model.FieldOption(S.String),
    tokenAccess:   Model.Sensitive(S.String),
    tokenRefresh:  Model.Sensitive(S.String),
    deletedAt:     Model.FieldOption(S.DateFromSelf),
    updatedAt:     Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: OAUTH_ACCOUNT] ---------------------------------------------------
class OauthAccount extends Model.Class<OauthAccount>('OauthAccount')({
    id:           Model.Generated(S.UUID),
    userId:       S.UUID,
    provider:     OAuthProviderSchema,
    externalId:   S.String,
    tokenPayload: Model.Sensitive(S.Uint8ArrayFromSelf),
    deletedAt:    Model.FieldOption(S.DateFromSelf),
    updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: MFA_SECRET] ------------------------------------------------------
class MfaSecret extends Model.Class<MfaSecret>('MfaSecret')({
    id:        Model.Generated(S.UUID),
    userId:    S.UUID,
    enabledAt: Model.FieldOption(S.DateFromSelf),
    encrypted: Model.Sensitive(S.Uint8ArrayFromSelf),
    backups:   Model.Sensitive(S.Array(S.String)),
    deletedAt: Model.FieldOption(S.DateFromSelf),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: WEBAUTHN_CREDENTIAL] ---------------------------------------------
class WebauthnCredential extends Model.Class<WebauthnCredential>('WebauthnCredential')({
    id:           Model.Generated(S.UUID),
    userId:       S.UUID,
    credentialId: S.String,
    publicKey:    S.Uint8ArrayFromSelf,
    counter:      S.Number,
    deviceType:   S.Literal('singleDevice', 'multiDevice'),
    backedUp:     S.Boolean,
    transports:   S.Array(S.String),
    name:         S.String,
    lastUsedAt:   Model.FieldOption(S.DateFromSelf),
    deletedAt:    Model.FieldOption(S.DateFromSelf),
    updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: API_KEY] ---------------------------------------------------------
class ApiKey extends Model.Class<ApiKey>('ApiKey')({
    id:         Model.Generated(S.UUID),
    userId:     S.UUID,
    name:       S.String,
    expiresAt:  Model.FieldOption(S.DateFromSelf),
    lastUsedAt: Model.FieldOption(S.DateFromSelf),
    encrypted:  Model.Sensitive(S.Uint8ArrayFromSelf),
    hash:       Model.Sensitive(S.String),
    deletedAt:  Model.FieldOption(S.DateFromSelf),
    updatedAt:  Model.DateTimeUpdateFromDate,
}) {}

// --- [ASSETS: APP] -----------------------------------------------------------
class App extends Model.Class<App>('App')({
    id:        Model.Generated(S.UUID),
    name:      S.String,
    namespace: S.String,
    settings:  Model.FieldOption(AppSettingsSchema),
    status:    S.optionalWith(S.Literal('active', 'suspended', 'archived', 'purging'), { default: () => 'active' as const }),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [ASSETS: ASSET] ---------------------------------------------------------
class Asset extends Model.Class<Asset>('Asset')({
    id:         Model.Generated(S.UUID),
    appId:      S.UUID,
    userId:     Model.FieldOption(S.UUID),
    type:       S.String,
    content:    S.String,
    status:     S.Literal('active', 'processing', 'failed', 'deleted'),
    hash:       Model.FieldOption(S.String),
    name:       Model.FieldOption(S.String),
    storageRef: Model.FieldOption(S.String),
    deletedAt:  Model.FieldOption(S.DateFromSelf),
    updatedAt:  Model.DateTimeUpdateFromDate,
}) {}

// --- [AUDIT: AUDIT_LOG] ------------------------------------------------------
class AuditLog extends Model.Class<AuditLog>('AuditLog')({
    id:           Model.Generated(S.UUID),
    appId:        S.UUID,
    userId:       Model.FieldOption(S.UUID),
    requestId:    Model.FieldOption(S.UUID),
    operation:    AuditOperationSchema,
    targetType:   S.String,
    targetId:     S.UUID,
    delta:        Model.FieldOption(S.Struct({ old: S.optional(S.Unknown), new: S.optional(S.Unknown) })),
    contextIp:    Model.FieldOption(S.String),
    contextAgent: Model.FieldOption(S.String),
}) {}

// --- [JOBS: JOB] -------------------------------------------------------------
class Job extends Model.Class<Job>('Job')({
    jobId:        S.String,
    appId:        S.UUID,
    type:         S.String,
    status:       JobStatusSchema,
    priority:     S.Literal('critical', 'high', 'normal', 'low'),
    payload:      S.Unknown,
    output:       Model.FieldOption(S.Struct({ result: S.optional(S.Unknown), progress: S.optional(S.Struct({ message: S.String, pct: S.Number })) })),
    history:      S.Array(S.Struct({ timestamp: S.Number, error: S.optional(S.String), status: JobStatusSchema })),
    retryCurrent: S.Number,
    retryMax:     S.Number,
    scheduledAt:  Model.FieldOption(S.DateFromSelf),
    correlation:  Model.FieldOption(S.Struct({ batch: S.optional(S.NonEmptyTrimmedString), dedupe: S.optional(S.NonEmptyTrimmedString) })),
    dedupeKey:    Model.Generated(S.NullOr(S.String)),
    batchKey:     Model.Generated(S.NullOr(S.String)),
    completedAt:  Model.FieldOption(S.DateFromSelf),
    updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

// --- [JOBS: JOB_DLQ] ---------------------------------------------------------
class JobDlq extends Model.Class<JobDlq>('JobDlq')({
    id:               Model.Generated(S.UUID),
    source:           S.Literal('job', 'event'),
    sourceId:         S.String,
    appId:            S.UUID,
    contextUserId:    Model.FieldOption(S.UUID),
    contextRequestId: Model.FieldOption(S.UUID),
    type:             S.String,
    payload:          S.Unknown,
    errorReason: S.Literal(
        'MaxRetries', 'Validation', 'HandlerMissing', 'RunnerUnavailable', 'Timeout', 'Panic', 'Processing', 'NotFound', 'AlreadyCancelled',
        'DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'ValidationFailed', 'AuditPersistFailed', 'HandlerTimeout',
    ),
    attempts:         S.Number,
    errors:           S.Array(S.Struct({ timestamp: S.Number, error: S.String })),
    replayedAt:       Model.FieldOption(S.DateFromSelf),
}) {}

// --- [INFRA: NOTIFICATION] ---------------------------------------------------
class Notification extends Model.Class<Notification>('Notification')({
    id:           Model.Generated(S.UUID),
    appId:        S.UUID,
    userId:       Model.FieldOption(S.UUID),
    channel:      S.Literal('email', 'webhook', 'inApp'),
    template:     S.NonEmptyTrimmedString,
    status:       S.Literal('queued', 'sending', 'delivered', 'failed', 'dlq'),
    recipient:    Model.FieldOption(S.String),
    payload:      S.Unknown,
    delivery:     Model.FieldOption(S.Struct({ at: S.optional(S.DateFromSelf), error: S.optional(S.String), provider: S.optional(S.String) })),
    retryCurrent: S.Number,
    retryMax:     S.Number,
    correlation:  Model.FieldOption(S.Struct({ dedupe: S.optional(S.NonEmptyTrimmedString), job: S.optional(S.String) })),
    dedupeKey:    Model.Generated(S.NullOr(S.String)),
    jobKey:       Model.Generated(S.NullOr(S.String)),
    updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

// --- [AGENT: JOURNAL] --------------------------------------------------------
class AgentJournal extends Model.Class<AgentJournal>('AgentJournal')({
    id:          Model.Generated(S.UUID),
    appId:       S.UUID,
    sessionId:   S.UUID,
    runId:       S.UUID,
    sequence:    S.Int.pipe(S.greaterThanOrEqualTo(0)),
    entryKind:   S.Literal('session_start', 'tool_call', 'checkpoint', 'session_complete'),
    status:      Model.FieldOption(S.Literal('running', 'completed', 'failed', 'interrupted', 'ok', 'error')),
    operation:   Model.FieldOption(S.NonEmptyTrimmedString),
    payloadJson: S.Unknown,
    stateHash:   Model.FieldOption(S.String),
    createdAt:   Model.Generated(S.DateFromSelf),
}) {}

// --- [INFRA: KV_STORE] -------------------------------------------------------
class KvStore extends Model.Class<KvStore>('KvStore')({
    id:        Model.Generated(S.UUID),
    key:       S.String,
    value:     S.String,
    expiresAt: Model.FieldOption(S.DateFromSelf),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export {
    AgentJournal, AiProviderSchema, AiSettingsSchema, ApiKey, App, Asset, AuditLog, Job, JobDlq, JobStatusSchema, KvStore, MfaSecret, Notification,
    AppSettingsDefaults, AppSettingsSchema, FeatureFlagsSchema,
    AuditOperationSchema, PreferencesSchema, OAuthProviderSchema, OauthAccount,
    Permission, RoleSchema, Session, User, WebauthnCredential, WebhookUrlSchema,
};
