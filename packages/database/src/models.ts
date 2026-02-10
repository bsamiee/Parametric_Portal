/**
 * Define @effect/sql Model classes with VariantSchema integration.
 * Model.Class IS VariantSchema — field modifiers (Generated, Sensitive, FieldOption,
 * DateTimeUpdateFromDate) are VariantSchema.Field instances controlling behavior
 * across select/insert/update/json/jsonCreate/jsonUpdate variants.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Maintain registry organization> */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const RoleSchema = 		S.Literal('owner', 'admin', 'member', 'viewer', 'guest');
const OAuthProviderSchema = S.Literal('apple', 'github', 'google', 'microsoft');
const JobStatusSchema = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
const NotificationPreferencesSchema = S.Struct({
	channels: 	S.Struct({email: S.Boolean, inApp: S.Boolean, webhook: S.Boolean,}),
	mutedUntil: S.NullOr(S.String),
	templates: 	S.Record({key: S.String, value: S.Struct({email: S.optional(S.Boolean), inApp: S.optional(S.Boolean), webhook: S.optional(S.Boolean),}),}),
});
const FeatureFlagsDefaults = {
	enableAiSearch: false,
	enableApiKeys: true,
	enableAuditLog: true,
	enableExport: false,
	enableMfa: false,
	enableNotifications: true,
	enableOAuth: false,
	enableRealtime: true,
	enableWebhooks: false,
} as const;
const FeatureFlagsSchema = S.Struct({
	enableAiSearch: 		S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableAiSearch }),
	enableApiKeys: 			S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableApiKeys }),
	enableAuditLog: 		S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableAuditLog }),
	enableExport: 			S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableExport }),
	enableMfa: 				S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableMfa }),
	enableNotifications: 	S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableNotifications }),
	enableOAuth: 			S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableOAuth }),
	enableRealtime: 		S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableRealtime }),
	enableWebhooks: 		S.optionalWith(S.Boolean, { default: () => FeatureFlagsDefaults.enableWebhooks }),
});
const OAuthProviderConfigSchema = S.Struct({
	clientId: S.NonEmptyTrimmedString,
	clientSecret: S.NonEmptyTrimmedString,
	enabled: S.Boolean,
	keyId: S.optional(S.NonEmptyTrimmedString),
	provider: OAuthProviderSchema,
	scopes: S.optional(S.Array(S.String)),
	teamId: S.optional(S.NonEmptyTrimmedString),
	tenant: S.optional(S.NonEmptyTrimmedString),
});
const OAuthProviderStoredSchema = S.Struct({
	clientId: S.NonEmptyTrimmedString,
	clientSecretEncrypted: S.NonEmptyTrimmedString,
	enabled: S.Boolean,
	keyId: S.optional(S.NonEmptyTrimmedString),
	provider: OAuthProviderSchema,
	scopes: S.optional(S.Array(S.String)),
	teamId: S.optional(S.NonEmptyTrimmedString),
	tenant: S.optional(S.NonEmptyTrimmedString),
});
const AppWebhookSchema = S.Struct({
	active: S.Boolean,
	endpoint: S.Struct({
		secret: S.String.pipe(S.minLength(32)),
		timeout: S.optionalWith(S.Number, { default: () => 5000 }),
		url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/)),
	}),
	eventTypes: S.Array(S.String),
});
const AppSettingsSchema = S.Struct({
	featureFlags: S.optionalWith(FeatureFlagsSchema, { default: () => ({ ...FeatureFlagsDefaults }) }),
	oauthProviders: S.optionalWith(S.Array(OAuthProviderStoredSchema), { default: () => [] }),
	webhooks: S.optionalWith(S.Array(AppWebhookSchema), { default: () => [] }),
});
const AppSettingsDefaults = {
	featureFlags: { ...FeatureFlagsDefaults },
	oauthProviders: [],
	webhooks: [],
} as const satisfies S.Schema.Type<typeof AppSettingsSchema>;

// --- [AUTH: USER] ------------------------------------------------------------
class User extends Model.Class<User>('User')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	email: S.String,
	notificationPreferences: Model.Generated(NotificationPreferencesSchema),
	role: RoleSchema,
	status: S.Literal('active', 'inactive', 'suspended'),
	roleOrder: Model.Generated(S.Number),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: PERMISSION] -----------------------------------------------------
class Permission extends Model.Class<Permission>('Permission')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	role: RoleSchema,
	resource: S.NonEmptyTrimmedString,
	action: S.NonEmptyTrimmedString,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: SESSION] ---------------------------------------------------------
class Session extends Model.Class<Session>('Session')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: S.UUID,
	accessExpiresAt: S.DateFromSelf,
	refreshExpiresAt: S.DateFromSelf,
	verifiedAt: Model.FieldOption(S.DateFromSelf),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
	prefix: Model.Generated(S.String),
	hash: Model.Sensitive(S.String),
	refreshHash: Model.Sensitive(S.String),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: OAUTH_ACCOUNT] ---------------------------------------------------
class OauthAccount extends Model.Class<OauthAccount>('OauthAccount')({
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	provider: S.String,
	externalId: S.String,
	expiresAt: Model.FieldOption(S.DateFromSelf),
	scope: Model.FieldOption(S.String),
	accessEncrypted: Model.Sensitive(S.Uint8ArrayFromSelf),
	refreshEncrypted: Model.FieldOption(Model.Sensitive(S.Uint8ArrayFromSelf)),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: MFA_SECRET] ------------------------------------------------------
class MfaSecret extends Model.Class<MfaSecret>('MfaSecret')({
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	enabledAt: Model.FieldOption(S.DateFromSelf),
	remaining: Model.Generated(S.Number),
	encrypted: Model.Sensitive(S.Uint8ArrayFromSelf),
	backupHashes: Model.Sensitive(S.Array(S.String)),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: WEBAUTHN_CREDENTIAL] ---------------------------------------------
class WebauthnCredential extends Model.Class<WebauthnCredential>('WebauthnCredential')({
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	credentialId: S.String,
	publicKey: S.Uint8ArrayFromSelf,
	counter: S.Number,
	deviceType: S.Literal('singleDevice', 'multiDevice'),
	backedUp: S.Boolean,
	transports: S.Array(S.String),
	name: S.String,
	lastUsedAt: Model.FieldOption(S.DateFromSelf),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUTH: API_KEY] ---------------------------------------------------------
class ApiKey extends Model.Class<ApiKey>('ApiKey')({
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	name: S.String,
	prefix: Model.Generated(S.String),
	expiresAt: Model.FieldOption(S.DateFromSelf),
	lastUsedAt: Model.FieldOption(S.DateFromSelf),
	encrypted: Model.Sensitive(S.Uint8ArrayFromSelf),
	hash: Model.Sensitive(S.String),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [ASSETS: APP] -----------------------------------------------------------
class App extends Model.Class<App>('App')({
	id: Model.Generated(S.UUID),
	name: S.String,
	namespace: S.String,
	settings: Model.FieldOption(AppSettingsSchema),
	status: S.optionalWith(S.Literal('active', 'suspended', 'archived'), { default: () => 'active' as const }),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [ASSETS: ASSET] ---------------------------------------------------------
class Asset extends Model.Class<Asset>('Asset')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),
	type: S.String,
	content: S.String,
	size: Model.Generated(S.Number),
	status: S.Literal('active', 'processing', 'failed', 'deleted'),
	hash: Model.FieldOption(S.String),
	name: Model.FieldOption(S.String),
	storageRef: Model.FieldOption(S.String),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [AUDIT: AUDIT_LOG] ------------------------------------------------------
class AuditLog extends Model.Class<AuditLog>('AuditLog')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),
	requestId: Model.FieldOption(S.UUID),
	operation: S.String,
	subject: S.String,
	subjectId: S.UUID,
	oldData: Model.FieldOption(S.Unknown),
	newData: Model.FieldOption(S.Unknown),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
}) {}

// --- [JOBS: JOB] -------------------------------------------------------------
class Job extends Model.Class<Job>('Job')({
	jobId: S.String,
	appId: S.UUID,
	type: S.String,
	status: JobStatusSchema,
	priority: S.Literal('critical', 'high', 'normal', 'low'),
	payload: S.Unknown,
	result: Model.FieldOption(S.Unknown),
	progress: Model.FieldOption(S.Struct({ message: S.String, pct: S.Number })),
	history: S.Array(S.Struct({
		error: S.optional(S.String),
		status: JobStatusSchema,
		timestamp: S.Number
	})),
	attempts: S.Number,
	maxAttempts: S.Number,
	scheduledAt: Model.FieldOption(S.DateFromSelf),
	batchId: Model.FieldOption(S.String),
	dedupeKey: Model.FieldOption(S.String),
	lastError: Model.FieldOption(S.String),
	completedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [JOBS: JOB_DLQ] ---------------------------------------------------------
class JobDlq extends Model.Class<JobDlq>('JobDlq')({
	id: Model.Generated(S.UUID),
	source: S.Literal('job', 'event'),
	originalJobId: S.String,
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),
	requestId: Model.FieldOption(S.UUID),
	type: S.String,
	payload: S.Unknown,
	errorReason: S.Literal(
		'MaxRetries', 'Validation', 'HandlerMissing', 'RunnerUnavailable', 'Timeout', 'Panic', 'Processing', 'NotFound', 'AlreadyCancelled',
		'DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'ValidationFailed', 'AuditPersistFailed', 'HandlerTimeout',
	),
	attempts: S.Number,
	errorHistory: S.Array(S.Struct({
		error: S.String,
		timestamp: S.Number
	})),
	replayedAt: Model.FieldOption(S.DateFromSelf),
}) {}

// --- [INFRA: NOTIFICATION] ---------------------------------------------------
class Notification extends Model.Class<Notification>('Notification')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),
	channel: S.Literal('email', 'webhook', 'inApp'),
	template: S.NonEmptyTrimmedString,
	status: S.Literal('queued', 'sending', 'delivered', 'failed', 'dlq'),
	recipient: Model.FieldOption(S.String),
	provider: Model.FieldOption(S.String),
	payload: S.Unknown,
	error: Model.FieldOption(S.String),
	attempts: S.Number,
	maxAttempts: S.Number,
	jobId: Model.FieldOption(S.String),
	dedupeKey: Model.FieldOption(S.String),
	deliveredAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [INFRA: KV_STORE] -------------------------------------------------------
class KvStore extends Model.Class<KvStore>('KvStore')({
	id: Model.Generated(S.UUID),
	key: S.String,
	value: S.String,
	expiresAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export {
	ApiKey, App, Asset, AuditLog, Job, JobDlq, JobStatusSchema, KvStore, MfaSecret, Notification,
	AppSettingsDefaults, AppSettingsSchema, AppWebhookSchema, FeatureFlagsDefaults, FeatureFlagsSchema,
	NotificationPreferencesSchema, OAuthProviderConfigSchema, OAuthProviderSchema, OAuthProviderStoredSchema,
	OauthAccount, Permission, RoleSchema, Session, User, WebauthnCredential,
};
