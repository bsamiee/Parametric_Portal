/**
 * Define @effect/sql Model classes with VariantSchema integration.
 * Model.Class IS VariantSchema — field modifiers (Generated, Sensitive, FieldOption,
 * DateTimeUpdateFromDate) are VariantSchema.Field instances controlling behavior
 * across select/insert/update/json/jsonCreate/jsonUpdate variants.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Maintain registry organization> */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [AUTH: USER] ------------------------------------------------------------
class User extends Model.Class<User>('User')({
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	email: S.String,
	role: S.Literal('owner', 'admin', 'member', 'viewer', 'guest'),
	status: S.Literal('active', 'inactive', 'suspended'),
	roleOrder: Model.Generated(S.Number),
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
	settings: Model.FieldOption(S.Unknown),
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
	status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'),
	priority: S.Literal('critical', 'high', 'normal', 'low'),
	payload: S.Unknown,
	result: Model.FieldOption(S.Unknown),
	progress: Model.FieldOption(S.Struct({ message: S.String, pct: S.Number })),
	history: S.Array(S.Struct({
		error: S.optional(S.String),
		status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'),
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
	ApiKey, App, Asset, AuditLog, Job, JobDlq, KvStore, MfaSecret, OauthAccount, Session,
	User, WebauthnCredential,
};
