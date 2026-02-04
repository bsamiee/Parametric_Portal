/**
 * Define @effect/sql Model classes with auto-derived variants.
 * Field modifiers: Generated, Sensitive, FieldOption, DateTimeUpdate.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Maintain registry organization> */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [PRIMITIVES] ------------------------------------------------------------

const BufferSchema = S.Uint8ArrayFromSelf;

// --- [AUTH: USER] ------------------------------------------------------------
class User extends Model.Class<User>('User')({							// The principal identity. Belongs to an App.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	email: S.String,
	role: S.String,
	status: S.String,
	roleOrder: Model.Generated(S.Number),
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [AUTH: SESSION] ---------------------------------------------------------
class Session extends Model.Class<Session>('Session')({					// Active login. Belongs to a User, scoped to an App.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,															// Internal: FK — tenant binding
	userId: S.UUID,														// Internal: FK
	accessExpiresAt: S.DateFromSelf,
	refreshExpiresAt: S.DateFromSelf,
	verifiedAt: Model.FieldOption(S.DateFromSelf),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
	prefix: Model.Generated(S.String),
	hash: Model.Sensitive(S.String),									// Sensitive: never in json
	refreshHash: Model.Sensitive(S.String),								// Sensitive: never in json
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [AUTH: OAUTH_ACCOUNT] ---------------------------------------------------
class OauthAccount extends Model.Class<OauthAccount>('OauthAccount')({ 	// External auth provider link. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,														// Internal: FK
	provider: S.String,
	externalId: S.String,
	expiresAt: Model.FieldOption(S.DateFromSelf),
	scope: Model.FieldOption(S.String),
	accessEncrypted: Model.Sensitive(BufferSchema),						// Sensitive: never in json
	refreshEncrypted: Model.FieldOption(Model.Sensitive(BufferSchema)),	// Sensitive: never in json
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [AUTH: REFRESH_TOKEN] ---------------------------------------------------
// --- [AUTH: MFA_SECRET] ------------------------------------------------------
class MfaSecret extends Model.Class<MfaSecret>('MfaSecret')({ 			// TOTP second factor. Belongs to a User (one per user).
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,														// Internal: FK
	enabledAt: Model.FieldOption(S.DateFromSelf),
	remaining: Model.Generated(S.Number),
	encrypted: Model.Sensitive(BufferSchema),							// Sensitive: never in json
	backupHashes: Model.Sensitive(S.Array(S.String)),					// Sensitive: never in json
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [AUTH: API_KEY] ---------------------------------------------------------
class ApiKey extends Model.Class<ApiKey>('ApiKey')({ 					// Programmatic access token. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,														// Internal: FK
	name: S.String,
	prefix: Model.Generated(S.String),
	expiresAt: Model.FieldOption(S.DateFromSelf),						// Public: shown in API
	lastUsedAt: Model.FieldOption(S.DateFromSelf),						// Internal: activity tracking
	encrypted: Model.Sensitive(BufferSchema),							// Sensitive: never in json
	hash: Model.Sensitive(S.String),									// Sensitive: never in json
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [ASSETS: APP] -----------------------------------------------------------
class App extends Model.Class<App>('App')({ 							// Tenant namespace. Top-level container.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	name: S.String,
	namespace: S.String,
	settings: Model.FieldOption(S.Unknown),
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [ASSETS: ASSET] ---------------------------------------------------------
class Asset extends Model.Class<Asset>('Asset')({ 						// User-created content. Belongs to an App, optionally created by User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),									// Public: attribution
	type: S.String,
	content: S.String,
	size: Model.Generated(S.Number),
	status: S.String,
	hash: Model.FieldOption(S.String),									// Public: content verification
	name: Model.FieldOption(S.String),									// Public: original filename
	storageRef: Model.FieldOption(S.String),							// Internal: S3 key when binary
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [AUDIT: AUDIT_LOG] ------------------------------------------------------
class AuditLog extends Model.Class<AuditLog>('AuditLog')({ 				// Append-only operation history. Belongs to an App. No updatedAt (immutable).
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	// PG18.1: Use RETURNING OLD/NEW to capture before/after in single DML statement
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),									// Public: who did it
	requestId: Model.FieldOption(S.UUID),								// Public: correlation
	operation: S.String,												// Constrained: create|update|delete|restore|login|logout|verify|revoke
	subject: S.String,
	subjectId: S.UUID,
	oldData: Model.FieldOption(S.Unknown),								// PG18.1: Pre-modification state via RETURNING OLD.*
	newData: Model.FieldOption(S.Unknown),								// PG18.1: Post-modification state via RETURNING NEW.*
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
}) {}

// --- [JOBS: JOB] -------------------------------------------------------------
class Job extends Model.Class<Job>('Job')({								// Durable job registry. Belongs to an App.
	jobId: S.String,
	appId: S.UUID,
	type: S.String,
	status: S.String,
	priority: S.String,
	payload: S.Unknown,
	result: Model.FieldOption(S.Unknown),
	progress: Model.FieldOption(S.Struct({ message: S.String, pct: S.Number })),
	history: S.Array(S.Struct({ error: S.optional(S.String), status: S.String, timestamp: S.Number })),
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
class JobDlq extends Model.Class<JobDlq>('JobDlq')({					// Unified dead-letter queue for jobs and events. Belongs to an App. No updatedAt (append-mostly).
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract DLQ creation time — NO dlqAt COLUMN
	id: Model.Generated(S.UUID),
	source: S.String,													// Discriminant: 'job' | 'event' — identifies origin type
	originalJobId: S.String,											// Link to original job/event (NO FK — source may be purged before replay)
	appId: S.UUID,														// Tenant scope
	userId: Model.FieldOption(S.UUID),									// Audit trail (FK RESTRICT — users never hard-deleted)
	requestId: Model.FieldOption(S.UUID),								// Correlation for cross-pod traces
	type: S.String,														// Job type or event type
	payload: S.Unknown,													// Original payload
	errorReason: S.String,												// Job: MaxRetries | Validation | HandlerMissing | RunnerUnavailable | Timeout | Panic; Event: DeliveryFailed | DeserializationFailed | DuplicateEvent | HandlerMissing | HandlerTimeout
	attempts: S.Number,													// Total attempts before dead-letter
	errorHistory: S.Array(S.Struct({ error: S.String, timestamp: S.Number })),	// Error trail
	replayedAt: Model.FieldOption(S.DateFromSelf),						// When job/event was replayed (null = pending)
}) {}

// --- [INFRA: KV_STORE] -------------------------------------------------------
class KvStore extends Model.Class<KvStore>('KvStore')({					// Cluster infrastructure state (singleton state, feature flags).
	// IMPORTANT: No appId — cluster-wide infrastructure state, NOT tenant-scoped
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	key: S.String,
	value: S.String,
	expiresAt: Model.FieldOption(S.DateFromSelf),						// Optional TTL for automatic purge
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [SEARCH: DOCUMENT] ------------------------------------------------------
class SearchDocument extends Model.Class<SearchDocument>('SearchDocument')({
	entityType: S.String,
	entityId: S.UUID,
	scopeId: Model.FieldOption(S.UUID),
	displayText: S.String,
	contentText: Model.FieldOption(S.String),
	metadata: Model.FieldOption(S.Unknown),
	documentHash: Model.Generated(S.String),
	searchVector: Model.Generated(S.Unknown),
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [SEARCH: EMBEDDING] -----------------------------------------------------
class SearchEmbedding extends Model.Class<SearchEmbedding>('SearchEmbedding')({
	entityType: S.String,
	entityId: S.UUID,
	scopeId: Model.FieldOption(S.UUID),
	model: S.String,
	dimensions: S.Number,
	embedding: S.Unknown,
	hash: S.String,
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, App, Asset, AuditLog, Job, JobDlq, KvStore, MfaSecret, OauthAccount, SearchDocument, SearchEmbedding, Session, User };
