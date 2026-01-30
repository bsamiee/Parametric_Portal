/**
 * @effect/sql Model classes with 6 auto-derived variants: select, insert, update, json, jsonCreate, jsonUpdate.
 * Model.json is the canonical API shape—field modifiers control which variants include each field.
 *
 * Model.Generated(S)        → DB-generated (select/update/json only, excluded from insert)
 * Model.GeneratedByApp(S)   → App-generated (all DB variants, optional in json variants)
 * Model.Sensitive(S)        → Internal-only (excluded from all json variants—passwords, tokens, secrets)
 * Model.FieldOption(F)      → Optional (nullable in DB, optional+nullable in json)
 * Model.FieldExcept(...V)   → Exclude from specified variants (e.g., 'json', 'jsonCreate', 'jsonUpdate')
 * Model.FieldOnly(...V)     → Include in only specified variants (inverse of FieldExcept)
 * Model.Field({...})        → Custom per-variant schemas (full control over each variant's shape)
 * Model.JsonFromString(S)   → JSON column (auto parse/stringify between string storage and typed object)
 * Model.DateTimeInsert*     → Creation timestamp (auto-generates on insert only)
 * Model.DateTimeUpdate*     → Modification timestamp (auto-generates on insert AND update)
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
class Session extends Model.Class<Session>('Session')({					// Active login. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,														// Internal: FK
	expiresAt: S.DateFromSelf,
	verifiedAt: Model.FieldOption(S.DateFromSelf),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
	prefix: Model.Generated(S.String),
	hash: Model.Sensitive(S.String),									// Sensitive: never in json
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
class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({ 	// Token rotation. Belongs to a User, optionally linked to Session.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,														// Internal: FK
	sessionId: Model.FieldOption(S.UUID),								// Internal: FK
	expiresAt: S.DateFromSelf,
	prefix: Model.Generated(S.String),
	hash: Model.Sensitive(S.String),									// Sensitive: never in json
	deletedAt: Model.FieldOption(S.DateFromSelf),						// Internal: soft delete
}) {}

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
	settings: Model.FieldOption(Model.JsonFromString(S.Unknown)),
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
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),									// Public: who did it
	requestId: Model.FieldOption(S.UUID),								// Public: correlation
	operation: S.String,
	subject: S.String,
	subjectId: S.UUID,
	changes: Model.FieldOption(Model.JsonFromString(S.Unknown)),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
}) {}

// --- [JOBS: JOB] -------------------------------------------------------------
class Job extends Model.Class<Job>('Job')({								// Background task. Belongs to an App.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),									// Public: who enqueued (attribution)
	requestId: Model.FieldOption(S.UUID),								// Public: correlation (same as audit_logs)
	type: S.String,
	payload: Model.JsonFromString(S.Unknown),
	priority: S.String,
	status: S.String,
	attempts: S.Number,
	maxAttempts: S.Number,
	scheduledAt: S.DateFromSelf,
	startedAt: Model.FieldOption(Model.Generated(S.DateFromSelf)),		// Trigger-derived: set on status → 'processing'
	completedAt: Model.FieldOption(Model.Generated(S.DateFromSelf)),	// Trigger-derived: set on status → 'completed'|'dead'
	lastError: Model.FieldOption(S.String),
	lockedBy: Model.FieldOption(S.String),
	lockedUntil: Model.FieldOption(S.DateFromSelf),
	waitMs: Model.FieldOption(Model.Generated(S.Number)),				// VIRTUAL: queue latency (started_at - scheduled_at)
	durationMs: Model.FieldOption(Model.Generated(S.Number)),			// VIRTUAL: execution time (completed_at - started_at)
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
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
	metadata: Model.FieldOption(Model.JsonFromString(S.Unknown)),
	hash: Model.FieldOption(S.String),
	searchVector: Model.Generated(S.Unknown),
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [SEARCH: EMBEDDING] -----------------------------------------------------
class SearchEmbedding extends Model.Class<SearchEmbedding>('SearchEmbedding')({
	entityType: S.String,
	entityId: S.UUID,
	scopeId: Model.FieldOption(S.UUID),
	embedding: S.Unknown,
	hash: Model.FieldOption(S.String),
	updatedAt: Model.DateTimeUpdateFromDate,							// Internal: timestamp
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, App, Asset, AuditLog, Job, KvStore, MfaSecret, OauthAccount, RefreshToken, SearchDocument, SearchEmbedding, Session, User };
