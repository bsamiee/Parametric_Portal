/**
 * Define @effect/sql Model classes for Auth, Assets, Audit bounded contexts.
 * UUIDv7 id columns provide creation timestamps via uuid_extract_timestamp().
 */
/** biome-ignore-all assist/source/useSortedKeys: <Maintain registry organization> */
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

// --- [PRIMITIVES] ------------------------------------------------------------

const BufferSchema: S.Schema<Buffer, Buffer> = S.instanceOf(Buffer);

// --- [AUTH: USER] ------------------------------------------------------------

class User extends Model.Class<User>('User')({							// The principal identity. Belongs to an App.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
	state: S.String,
	role: S.String,
	email: S.String,
}) {}

// --- [AUTH: SESSION] ---------------------------------------------------------

class Session extends Model.Class<Session>('Session')({					// Active login. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	userAgent: Model.FieldOption(S.String),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	expiresAt: S.DateFromSelf,
	updatedAt: Model.DateTimeUpdateFromDate,
	verifiedAt: Model.FieldOption(S.DateFromSelf),
	hash: Model.Sensitive(S.String),
	ipAddress: Model.FieldOption(S.String),
	prefix: Model.Generated(S.String),
}) {}

// --- [AUTH: OAUTH_ACCOUNT] ---------------------------------------------------

class OauthAccount extends Model.Class<OauthAccount>('OauthAccount')({ 	// External auth provider link. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	externalId: S.String,
	provider: S.String,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	expiresAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
	accessEncrypted: Model.Sensitive(BufferSchema),
	refreshEncrypted: Model.FieldOption(Model.Sensitive(BufferSchema)),
	scope: Model.FieldOption(S.String),
}) {}

// --- [AUTH: REFRESH_TOKEN] ---------------------------------------------------

class RefreshToken extends Model.Class<RefreshToken>('RefreshToken')({ 	// Token rotation. Belongs to a User, optionally linked to Session.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	sessionId: Model.FieldOption(S.UUID),
	deletedAt: Model.FieldOption(S.DateFromSelf),
	expiresAt: S.DateFromSelf,
	hash: Model.Sensitive(S.String),
	prefix: Model.Generated(S.String),
}) {}

// --- [AUTH: MFA_SECRET] ------------------------------------------------------

class MfaSecret extends Model.Class<MfaSecret>('MfaSecret')({ 			// TOTP second factor. Belongs to a User (one per user).
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	enabledAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
	encrypted: Model.Sensitive(BufferSchema),
	remaining: Model.Generated(S.Number),
	backupHashes: Model.Sensitive(S.Array(S.String)),
}) {}

// --- [AUTH: API_KEY] ---------------------------------------------------------

class ApiKey extends Model.Class<ApiKey>('ApiKey')({ 					// Programmatic access token. Belongs to a User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	userId: S.UUID,
	name: S.String,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	expiresAt: Model.FieldOption(S.DateFromSelf),
	lastUsedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
	encrypted: Model.Sensitive(BufferSchema),
	hash: Model.Sensitive(S.String),
	prefix: Model.Generated(S.String),
}) {}

// --- [ASSETS: APP] -----------------------------------------------------------

class App extends Model.Class<App>('App')({ 							// Tenant namespace. Top-level container.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	name: S.String,
	namespace: S.String,
	settings: Model.FieldOption(Model.JsonFromString(S.Unknown)),
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}

// --- [ASSETS: ASSET] ---------------------------------------------------------

class Asset extends Model.Class<Asset>('Asset')({ 						// User-created content. Belongs to an App, optionally created by User.
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),
	kind: S.String,
	content: S.String,
	size: Model.Generated(S.Number),
	state: S.String,
	deletedAt: Model.FieldOption(S.DateFromSelf),
	updatedAt: Model.DateTimeUpdateFromDate,
	hash: Model.FieldOption(S.String),									// Content hash (SHA-256) for verification/deduplication
	name: Model.FieldOption(S.String),									// Original filename: ZIP manifest reconstruction, and other assets to use
}) {}

// --- [AUDIT: AUDIT_LOG] ------------------------------------------------------

class AuditLog extends Model.Class<AuditLog>('AuditLog')({ 				// Append-only operation history. Belongs to an App. No updatedAt (immutable).
	// IMPORTANT `UUIDv7` uuid_extract_timestamp(uuid): Extract creation time from UUIDv7 — REPLACES created_at COLUMN
	id: Model.Generated(S.UUID),
	appId: S.UUID,
	userId: Model.FieldOption(S.UUID),									// FK to users - JOIN to get email when needed
	requestId: Model.FieldOption(S.UUID),								// Correlation ID from request context
	operation: S.String,
	subject: S.String,
	subjectId: S.UUID,
	changes: Model.FieldOption(Model.JsonFromString(S.Unknown)),
	ipAddress: Model.FieldOption(S.String),
	userAgent: Model.FieldOption(S.String),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, App, Asset, AuditLog, MfaSecret, OauthAccount, RefreshToken, Session, User };
