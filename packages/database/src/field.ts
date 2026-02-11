/**
 * Layered field definition system for @effect/sql models.
 * Type-safe repo generation, SQL DDL generation, Model.Class generation.
 */
/** biome-ignore-all assist/source/useSortedKeys: <needed> */
import { Array as A, Match, Schema as S } from 'effect';
import type { Object as O, String as Str } from 'ts-toolbelt';
import type { Simplify } from 'type-fest';

// --- [TYPES] -----------------------------------------------------------------

type _RawMeta = Readonly<{ cat: string; sel: boolean; ins: boolean; upd: boolean; json: boolean; auto: string | false; store: string | false }>;
type _RawEntry = Readonly<{ col: string; sql: string; ts: string; mark: string | false; gen: string | false; null: boolean; ref: string | false; wrap: readonly _RawMeta[] | false }>;

// --- [METADATA_TABLES] -------------------------------------------------------

const _FK = {RESTRICT: 'RESTRICT', CASCADE: 'CASCADE', SETNULL:'SET NULL', SETDEFAULT:'SET DEFAULT', NOACTION:'NO ACTION',} as const;
const _SQL_CAST = { INET: 'inet', JSONB: 'jsonb', UUID: 'uuid' } as const;
const _WRAP_META = (<const T extends Record<string, _RawMeta>>(table: T) => Object.fromEntries((Object.keys(table) as (keyof T & string)[]).map(key => [key, { ...table[key], name: key }])) as { [K in keyof T]: T[K] & { readonly name: K } })({
	Generated:               { cat: 'generated', sel: true,  ins: false, upd: true,  json: true,  auto: false,    store: false   },
	GeneratedByApp:          { cat: 'generated', sel: true,  ins: true,  upd: true,  json: true,  auto: false,    store: false   },
	Sensitive:               { cat: 'sensitive', sel: true,  ins: true,  upd: true,  json: false, auto: false,    store: false   },
	FieldOption:             { cat: 'optional',  sel: true,  ins: true,  upd: true,  json: true,  auto: false,    store: false   },
	DateTimeInsert:          { cat: 'datetime',  sel: true,  ins: true,  upd: false, json: true,  auto: 'insert', store: 'string'},
	DateTimeUpdate:          { cat: 'datetime',  sel: true,  ins: true,  upd: true,  json: true,  auto: 'both',   store: 'string'},
	DateTimeInsertFromDate:  { cat: 'datetime',  sel: true,  ins: true,  upd: false, json: true,  auto: 'insert', store: 'Date'  },
	DateTimeUpdateFromDate:  { cat: 'datetime',  sel: true,  ins: true,  upd: true,  json: true,  auto: 'both',   store: 'Date'  },
	DateTimeInsertFromNumber:{ cat: 'datetime',  sel: true,  ins: true,  upd: false, json: true,  auto: 'insert', store: 'number'},
	DateTimeUpdateFromNumber:{ cat: 'datetime',  sel: true,  ins: true,  upd: true,  json: true,  auto: 'both',   store: 'number'},
	JsonFromString:          { cat: 'json',      sel: true,  ins: true,  upd: true,  json: true,  auto: false,    store: 'string'},
	BooleanFromNumber:       { cat: 'utility',   sel: true,  ins: true,  upd: true,  json: true,  auto: false,    store: 'number'},
});
const _REGISTRY = (<const T extends Record<string, _RawEntry>>(table: T) => Object.fromEntries((Object.keys(table) as (keyof T & string)[]).map(key => [key, { ...table[key], field: key }])) as { [K in keyof T]: T[K] & { readonly field: K } })({
	id:               { col: 'id',               sql: 'UUID',        ts: 'S.UUID',            mark: 'pk',        gen: 'uuidv7', null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	appId:            { col: 'app_id',           sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: false, ref: 'apps',     wrap: false                                                  },
	userId:           { col: 'user_id',          sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: true,  ref: 'users',    wrap: false                                                  },
	sessionId:        { col: 'session_id',       sql: 'UUID',        ts: 'S.UUID',            mark: 'fk',        gen: false,    null: true,  ref: 'sessions', wrap: [_WRAP_META.FieldOption]                                },
	subjectId:        { col: 'subject_id',       sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	requestId:        { col: 'request_id',       sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	externalId:       { col: 'external_id',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	deletedAt:        { col: 'deleted_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'soft',      gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	updatedAt:        { col: 'updated_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'time',      gen: false,    null: false, ref: false,      wrap: [_WRAP_META.DateTimeUpdateFromDate]                     },
	expiresAt:        { col: 'expires_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'exp',       gen: false,    null: true,  ref: false,      wrap: false                                                  },
	accessExpiresAt:  { col: 'access_expires_at',sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	refreshExpiresAt: { col: 'refresh_expires_at',sql: 'TIMESTAMPTZ',ts: 'S.DateFromSelf',    mark: 'exp',       gen: false,    null: false, ref: false,      wrap: false                                                  },
	verifiedAt:       { col: 'verified_at',      sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	enabledAt:        { col: 'enabled_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	lastUsedAt:       { col: 'last_used_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	hash:             { col: 'hash',             sql: 'TEXT',        ts: 'S.String',          mark: 'unique',    gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	refreshHash:      { col: 'refresh_hash',     sql: 'TEXT',        ts: 'S.String',          mark: 'unique',    gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	prefix:           { col: 'prefix',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: 'virtual',null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	encrypted:        { col: 'encrypted',        sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	accessEncrypted:  { col: 'access_encrypted', sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	refreshEncrypted: { col: 'refresh_encrypted',sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Sensitive]           },
	backupHashes:     { col: 'backup_hashes',    sql: 'TEXT[]',      ts: 'S.Array(S.String)', mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	size:             { col: 'size',             sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'stored', null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	remaining:        { col: 'remaining',        sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	settings:         { col: 'settings',         sql: 'JSONB',       ts: 'AppSettingsSchema', mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	notificationPreferences: { col: 'notification_preferences', sql: 'JSONB', ts: 'NotificationPreferencesSchema', mark: false, gen: false, null: false, ref: false, wrap: [_WRAP_META.Generated] },
	oldData:          { col: 'old_data',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	newData:          { col: 'new_data',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	ipAddress:        { col: 'ip_address',       sql: 'INET',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	userAgent:        { col: 'user_agent',       sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	name:             { col: 'name',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	storageRef:       { col: 'storage_ref',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	namespace:        { col: 'namespace',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	email:            { col: 'email',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	role:             { col: 'role',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	status:           { col: 'status',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	roleOrder:        { col: 'role_order',       sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	type:             { col: 'type',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	content:          { col: 'content',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	operation:        { col: 'operation',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	subject:          { col: 'subject',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	oauthProvider:    { col: 'provider',         sql: 'TEXT',        ts: 'OAuthProviderSchema', mark: false,      gen: false,    null: false, ref: false,      wrap: false                                                  },
	provider:         { col: 'provider',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	channel:          { col: 'channel',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	template:         { col: 'template',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	recipient:        { col: 'recipient',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	error:            { col: 'error',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	scope:            { col: 'scope',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	entityType:       { col: 'entity_type',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	entityId:         { col: 'entity_id',        sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scopeId:          { col: 'scope_id',         sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: true,  ref: 'apps',     wrap: [_WRAP_META.FieldOption]                                },
	displayText:      { col: 'display_text',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	contentText:      { col: 'content_text',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	metadata:         { col: 'metadata',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	documentHash:     { col: 'document_hash',    sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: 'stored', null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	searchVector:     { col: 'search_vector',    sql: 'TSVECTOR',    ts: 'S.Unknown',         mark: false,       gen: 'stored', null: false, ref: false,      wrap: [_WRAP_META.Generated]                                  },
	model:            { col: 'model',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	dimensions:       { col: 'dimensions',       sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	embedding:        { col: 'embedding',        sql: 'VECTOR',      ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	jobId:            { col: 'job_id',           sql: 'TEXT',        ts: 'S.String',          mark: 'pk',        gen: false,    null: false, ref: false,      wrap: false                                                  },
	batchId:          { col: 'batch_id',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	dedupeKey:        { col: 'dedupe_key',       sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	priority:         { col: 'priority',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	payload:          { col: 'payload',          sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	progress:         { col: 'progress',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	history:          { col: 'history',          sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	result:           { col: 'result',           sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	attempts:         { col: 'attempts',         sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	maxAttempts:      { col: 'max_attempts',     sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scheduledAt:      { col: 'scheduled_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	startedAt:        { col: 'started_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Generated]           },
	completedAt:      { col: 'completed_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Generated]           },
	deliveredAt:      { col: 'delivered_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Generated]           },
	lastError:        { col: 'last_error',       sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	lockedBy:         { col: 'locked_by',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	lockedUntil:      { col: 'locked_until',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	waitMs:           { col: 'wait_ms',          sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Generated]           },
	durationMs:       { col: 'duration_ms',      sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: true,  ref: false,      wrap: [_WRAP_META.FieldOption, _WRAP_META.Generated]           },
	source:           { col: 'source',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	originalJobId:    { col: 'original_job_id',  sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	errorReason:      { col: 'error_reason',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	errorHistory:     { col: 'error_history',    sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	replayedAt:       { col: 'replayed_at',      sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'soft',      gen: false,    null: true,  ref: false,      wrap: [_WRAP_META.FieldOption]                                },
	kvKey:            { col: 'key',              sql: 'TEXT',        ts: 'S.String',          mark: 'unique',    gen: false,    null: false, ref: false,      wrap: false                                                  },
	kvValue:          { col: 'value',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	resource:         { col: 'resource',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	action:           { col: 'action',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	credentialId:     { col: 'credential_id',    sql: 'TEXT',        ts: 'S.String',          mark: 'unique',    gen: false,    null: false, ref: false,      wrap: false                                                  },
	publicKey:        { col: 'public_key',       sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WRAP_META.Sensitive]                                  },
	counter:          { col: 'counter',          sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	deviceType:       { col: 'device_type',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	backedUp:         { col: 'backed_up',        sql: 'BOOLEAN',     ts: 'S.Boolean',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	transports:       { col: 'transports',       sql: 'TEXT[]',      ts: 'S.Array(S.String)', mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
});
const _TABLES = {
	apps:             { fields: [_REGISTRY.id, _REGISTRY.name, _REGISTRY.namespace, _REGISTRY.status, _REGISTRY.settings, _REGISTRY.updatedAt] },
	users:            { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.email, _REGISTRY.notificationPreferences, _REGISTRY.role, _REGISTRY.status, _REGISTRY.roleOrder, _REGISTRY.deletedAt, _REGISTRY.updatedAt] },
	sessions:         { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.userId, _REGISTRY.hash, _REGISTRY.accessExpiresAt, _REGISTRY.refreshHash, _REGISTRY.refreshExpiresAt, _REGISTRY.deletedAt, _REGISTRY.verifiedAt, _REGISTRY.ipAddress, _REGISTRY.userAgent, _REGISTRY.updatedAt, _REGISTRY.prefix], required: [_REGISTRY.appId, _REGISTRY.userId, _REGISTRY.accessExpiresAt, _REGISTRY.refreshHash, _REGISTRY.refreshExpiresAt] },
	apiKeys:          { fields: [_REGISTRY.id, _REGISTRY.userId, _REGISTRY.name, _REGISTRY.hash, _REGISTRY.encrypted, _REGISTRY.expiresAt, _REGISTRY.deletedAt, _REGISTRY.lastUsedAt, _REGISTRY.updatedAt, _REGISTRY.prefix], required: [_REGISTRY.userId] },
	oauthAccounts:    { fields: [_REGISTRY.id, _REGISTRY.userId, _REGISTRY.oauthProvider, _REGISTRY.externalId, _REGISTRY.accessEncrypted, _REGISTRY.refreshEncrypted, _REGISTRY.expiresAt, _REGISTRY.deletedAt, _REGISTRY.scope, _REGISTRY.updatedAt], required: [_REGISTRY.userId], unique: [[_REGISTRY.oauthProvider, _REGISTRY.externalId]] },
	assets:           { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.userId, _REGISTRY.type, _REGISTRY.content, _REGISTRY.status, _REGISTRY.deletedAt, _REGISTRY.updatedAt, _REGISTRY.size, _REGISTRY.hash, _REGISTRY.name, _REGISTRY.storageRef], nullable: [_REGISTRY.hash, _REGISTRY.name, _REGISTRY.storageRef], fk: [[_REGISTRY.userId, _FK.SETNULL]] as const },
	auditLogs:        { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.userId, _REGISTRY.requestId, _REGISTRY.operation, _REGISTRY.subject, _REGISTRY.subjectId, _REGISTRY.oldData, _REGISTRY.newData, _REGISTRY.ipAddress, _REGISTRY.userAgent] },
	mfaSecrets:       { fields: [_REGISTRY.id, _REGISTRY.userId, _REGISTRY.encrypted, _REGISTRY.backupHashes, _REGISTRY.enabledAt, _REGISTRY.deletedAt, _REGISTRY.updatedAt, _REGISTRY.remaining], required: [_REGISTRY.userId], unique: [[_REGISTRY.userId]] },
	searchDocuments:  { fields: [_REGISTRY.entityType, _REGISTRY.entityId, _REGISTRY.scopeId, _REGISTRY.displayText, _REGISTRY.contentText, _REGISTRY.metadata, _REGISTRY.documentHash, _REGISTRY.searchVector, _REGISTRY.updatedAt], pk: [_REGISTRY.entityType, _REGISTRY.entityId] },
	searchEmbeddings: { fields: [_REGISTRY.entityType, _REGISTRY.entityId, _REGISTRY.scopeId, _REGISTRY.model, _REGISTRY.dimensions, _REGISTRY.embedding, _REGISTRY.hash, _REGISTRY.updatedAt], pk: [_REGISTRY.entityType, _REGISTRY.entityId], fk: [[_REGISTRY.entityType, _REGISTRY.entityId], _FK.CASCADE] as const },
	jobs:             { fields: [_REGISTRY.jobId, _REGISTRY.appId, _REGISTRY.type, _REGISTRY.status, _REGISTRY.priority, _REGISTRY.payload, _REGISTRY.result, _REGISTRY.progress, _REGISTRY.history, _REGISTRY.attempts, _REGISTRY.maxAttempts, _REGISTRY.scheduledAt, _REGISTRY.batchId, _REGISTRY.dedupeKey, _REGISTRY.lastError, _REGISTRY.completedAt, _REGISTRY.updatedAt], required: [_REGISTRY.jobId, _REGISTRY.appId, _REGISTRY.type, _REGISTRY.status, _REGISTRY.priority, _REGISTRY.payload, _REGISTRY.history, _REGISTRY.attempts, _REGISTRY.maxAttempts] },
	jobDlq:           { fields: [_REGISTRY.id, _REGISTRY.source, _REGISTRY.originalJobId, _REGISTRY.appId, _REGISTRY.userId, _REGISTRY.requestId, _REGISTRY.type, _REGISTRY.payload, _REGISTRY.errorReason, _REGISTRY.attempts, _REGISTRY.errorHistory, _REGISTRY.replayedAt], fk: [[_REGISTRY.userId, _FK.RESTRICT]] as const },
	notifications:    { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.userId, _REGISTRY.channel, _REGISTRY.template, _REGISTRY.status, _REGISTRY.recipient, _REGISTRY.provider, _REGISTRY.payload, _REGISTRY.error, _REGISTRY.attempts, _REGISTRY.maxAttempts, _REGISTRY.jobId, _REGISTRY.dedupeKey, _REGISTRY.deliveredAt, _REGISTRY.updatedAt] },
	permissions:      { fields: [_REGISTRY.id, _REGISTRY.appId, _REGISTRY.role, _REGISTRY.resource, _REGISTRY.action, _REGISTRY.deletedAt, _REGISTRY.updatedAt] },
	webauthnCredentials: { fields: [_REGISTRY.id, _REGISTRY.userId, _REGISTRY.credentialId, _REGISTRY.publicKey, _REGISTRY.counter, _REGISTRY.deviceType, _REGISTRY.backedUp, _REGISTRY.transports, _REGISTRY.name, _REGISTRY.lastUsedAt, _REGISTRY.deletedAt, _REGISTRY.updatedAt] },
	kvStore:          { fields: [_REGISTRY.id, _REGISTRY.kvKey, _REGISTRY.kvValue, _REGISTRY.expiresAt, _REGISTRY.updatedAt], unique: [[_REGISTRY.kvKey]] },
} as const;

// --- [DERIVED_TYPES] ---------------------------------------------------------
type _Reg = typeof _REGISTRY; type _Fks = typeof _FK; type _Metas = typeof _WRAP_META; type _Tbls = typeof _TABLES;
type _FkAction = _Fks[keyof _Fks]; type _WrapName = keyof _Metas; type _Field = keyof _Reg; type _Table = keyof _Tbls;
type _Meta<W extends _WrapName = _WrapName> = _Metas[W]; type _Entry<F extends _Field = _Field> = _Reg[F]; type _Tbl<T extends _Table = _Table> = _Tbls[T];
type _WrapCat = _Meta['cat']; type _Mark = Exclude<_Entry['mark'], false>; type _Wrap = Exclude<_Entry['wrap'], false>; type _Gen = Exclude<_Entry['gen'], false>; type _Sql = _Entry['sql'];
type _EntryShape = { [K in keyof _Entry]: _Entry[K] }; type _MetaShape = { [K in keyof _Meta]: _Meta[K] };
type _ColToField = { [F in _Field as _Reg[F]['col']]: F }; type _Col = keyof _ColToField;
type _CatToWraps = { [C in _WrapCat]: O.SelectKeys<_Metas, { cat: C }, 'extends->'> & _WrapName };
type _FieldsOf<T extends _Table> = _Tbls[T]['fields'][number]['field'];
type _TablesOf<F extends _Field> = { [T in _Table]: F extends _FieldsOf<T> ? T : never }[_Table];
type _Has<C extends Partial<_EntryShape>> = O.SelectKeys<_Reg, C, 'extends->'> & _Field;
type _HasMeta<C extends Partial<_MetaShape>> = O.SelectKeys<_Metas, C, 'extends->'> & _WrapName;
type _HasWrap<C extends Partial<_MetaShape>> = { [F in _Field]: _Reg[F]['wrap'] extends readonly (infer W)[] ? Extract<W, C> extends never ? never : F : never }[_Field];
type _HasNot<P extends keyof _EntryShape> = Exclude<_Field, O.SelectKeys<_Reg, Record<P, false>, 'equals'>> & _Field;
type _FalsifiableProp = 'mark' | 'gen' | 'ref' | 'wrap';
type _WrapNames<W extends readonly { readonly name: string }[]> = { [K in keyof W]: W[K] extends { readonly name: infer N } ? N : never };
type _Dims = { [M in _Mark as `mark:${M}`]: _Has<{ mark: M }> } & { [W in _Wrap as `wrap:${Str.Join<_WrapNames<W>, ','>}`]: _Has<{ wrap: W }> };
type _Caps = _Dims & { [G in _Gen as `gen:${G}`]: _Has<{ gen: G }> } & { [Sq in _Sql as `sql:${Sq}`]: _Has<{ sql: Sq }> }
	& { nullable: _Has<{ null: true }>; required: _Has<{ null: false }>; unwrapped: _Has<{ wrap: false }> }
	& { [P in _FalsifiableProp as `has${Capitalize<P>}`]: _HasNot<P> }
	& { autoUpdate: _HasWrap<{ auto: 'both' }>; autoInsert: _HasWrap<{ auto: 'insert' | 'both' }> };
type _CapKey = keyof _Caps;
type _Resolved<F extends _Field = _Field> = Simplify<_Entry<F> & { readonly field: F }>;
type _LensIn = { fields: _Field[]; cols: _Col[]; first: { field: _Field; col: _Col } | undefined };
type _Lens = { fields: _Field[]; cols: _Col[]; marks: _Mark[]; wraps: _Wrap[]; first: _Resolved | undefined; in: (cols: Record<string, unknown>) => _LensIn };
type _DispatchDim = 'mark' | 'wrap' | 'sql' | 'gen';
type _DimHandlers<D extends _DispatchDim, R> = { none: (entry: _Entry, field: _Field) => R } & (D extends 'wrap'
		? { [C in _WrapCat]: (entry: _Entry, meta: _Meta, field: _Field) => R }
		: { [V in Exclude<_Entry[D], false> & string]: (entry: _Entry, field: _Field) => R });

// --- [CACHE_BUILDER] ---------------------------------------------------------

type _CacheIndex = { byField: Record<string, _Resolved>; byCol: Record<string, _Resolved>; cols: _Col[]; marks: _Mark[]; wraps: _Wrap[]; query: Record<string, _Field[]>; entries: Record<string, _Resolved[]>; wrapByCat: Record<string, _WrapName[]> };
const _addCap = (index: _CacheIndex, key: string | false | undefined, field: _Field, resolved: _Resolved): void => {
	// biome-ignore lint/suspicious/noAssignInExpressions: Builder pattern with nullish coalescing assignment
	key && (index.query[key] ??= []).push(field);
	// biome-ignore lint/suspicious/noAssignInExpressions: Builder pattern with nullish coalescing assignment
	key && (index.entries[key] ??= []).push(resolved);
};
const _indexField = (index: _CacheIndex, field: _Field): void => {
	const meta = _REGISTRY[field];
	const resolved = { ...meta, field } as _Resolved<typeof field>;
	const wraps = meta.wrap || undefined;
	// biome-ignore lint/style/noParameterAssign: Builder pattern mutation
	index.byField[field] = resolved;
	// biome-ignore lint/style/noParameterAssign: Builder pattern mutation
	index.byCol[meta.col] = resolved;
	index.cols.push(meta.col);
	meta.mark && index.marks.push(meta.mark);
	meta.wrap && index.wraps.push(meta.wrap);
	_addCap(index, meta.null ? 'nullable' : 'required', field, resolved);
	_addCap(index, `sql:${meta.sql}`, field, resolved);
	_addCap(index, meta.mark && `mark:${meta.mark}`, field, resolved);
	_addCap(index, meta.wrap ? `wrap:${meta.wrap.map(w => w.name).join(',')}` : 'unwrapped', field, resolved);
	_addCap(index, meta.gen && `gen:${meta.gen}`, field, resolved);
	_addCap(index, meta.mark && 'hasMark', field, resolved);
	_addCap(index, meta.gen && 'hasGen', field, resolved);
	_addCap(index, meta.ref && 'hasRef', field, resolved);
	_addCap(index, meta.wrap && 'hasWrap', field, resolved);
	_addCap(index, wraps?.some(w => (w.auto as string | false) === 'both') && 'autoUpdate', field, resolved);
	_addCap(index, wraps?.some(w => (w.auto as string | false) === 'insert' || (w.auto as string | false) === 'both') && 'autoInsert', field, resolved);
};
const _buildCache = () => {
	const keys = Object.keys(_REGISTRY) as _Field[];
	const tableNames = Object.keys(_TABLES) as _Table[];
	const index: _CacheIndex = { byField: {}, byCol: {}, cols: [], marks: [], wraps: [], query: {}, entries: {}, wrapByCat: {} };
	A.map(keys, (field) => _indexField(index, field));
	const wrapByCat = Object.groupBy(Object.keys(_WRAP_META) as _WrapName[], (name) => _WRAP_META[name].cat) as Record<string, _WrapName[]>;
	const tableByField = Object.fromEntries(keys.map(field => [field, tableNames.filter(table => _TABLES[table].fields.some(entry => entry.field === field))])) as { [F in _Field]: _Table[] };
	return {
		...(index.byField as { [FieldKey in _Field]: _Resolved<FieldKey> }),
		...(index.byCol as { [ColKey in _Col]: _Resolved<_ColToField[ColKey]> }),
		keys, cols: index.cols as readonly _Col[],
		marks: [...new Set(index.marks)] as readonly _Mark[],
		wraps: [...new Set(index.wraps)] as readonly _Wrap[],
		query: index.query as { [K in _CapKey]: _Caps[K][] },
		entries: index.entries as unknown as { readonly [K in _CapKey]: readonly _Resolved<_Caps[K]>[] },
		wrapByCat: wrapByCat as unknown as { readonly [C in _WrapCat]: readonly _WrapName[] },
		tableNames, tableByField,
	};
};
const _cache = _buildCache();

// --- [INTERNAL] --------------------------------------------------------------

const _pick = (cap: _CapKey, cols: Record<string, unknown>): _Resolved | undefined =>
	(_cache.entries[cap] as readonly _Resolved[] | undefined)?.find(entry => entry.field in cols || entry.col in cols);
const _has = (cap: _CapKey, field: string): boolean =>
	(_cache.query[cap] as readonly string[] | undefined)?.includes(field) ?? false;
const _resolve = (fieldOrCol: string): _Resolved | undefined => {
	const val = (_cache as Record<string, unknown>)[fieldOrCol];
	return val && typeof val === 'object' && 'field' in val ? val as _Resolved : undefined;
};
const _predMeta = (fieldOrCol: string): { cast: typeof _SQL_CAST[keyof typeof _SQL_CAST] | undefined; wrap: 'casefold' | undefined } => {
	const entry = _resolve(fieldOrCol);
	return entry ? { cast: _SQL_CAST[entry.sql as keyof typeof _SQL_CAST], wrap: undefined } : { cast: undefined, wrap: undefined };
};
const _isSqlType = (fieldOrCol: string, sqlType: _Sql): boolean => _resolve(fieldOrCol)?.sql === sqlType;
const _isGen = (fieldOrCol: string, gen: _Gen): boolean => _resolve(fieldOrCol)?.gen === gen;
function _get<F extends _Field>(key: F): _Resolved<F>;
function _get<C extends _Col>(key: C): _Resolved<_ColToField[C]>;
function _get<T extends _Table>(key: T, layer: 'table'): _Tbl<T>;
function _get<W extends _WrapName>(key: W, layer: 'wrap'): _Meta<W>;
function _get(key: string, layer?: 'table' | 'wrap') {
	return Match.value(layer).pipe(Match.when('table', () => _TABLES[key as _Table]), Match.when('wrap', () => _WRAP_META[key as _WrapName]), Match.orElse(() => _cache[key as _Field]));
}
function _from(mark: _Mark, cols: Record<string, unknown>): _Col | false;
function _from<MarkKey extends _Mark>(marks: readonly MarkKey[], cols: Record<string, unknown>): { [Key in MarkKey]?: _Col };
function _from(fields: readonly string[]): (row: Record<string, unknown>) => unknown;
function _from(fields: readonly string[], cols: Record<string, S.Schema.AnyNoContext>): S.Schema.AnyNoContext;
function _from(fields: readonly string[], cols: Record<string, unknown>, mode: 'any' | 'all'): boolean;
function _from(input: _Mark | readonly string[], cols?: Record<string, unknown>, mode?: 'any' | 'all'): unknown {
	return typeof input === 'string'
		? ((field: _Field | undefined) => field ? _REGISTRY[field].col : false)((_cache.query[`mark:${input}`] as _Field[] | undefined)?.find(fieldName => fieldName in (cols ?? {})))
		: ((arr: readonly string[], first: string | undefined) =>
			arr.length > 0 && cols && !mode && _cache.marks.includes(arr[0] as _Mark)
				? Object.fromEntries((arr as readonly _Mark[]).flatMap(mark => ((field: _Field | undefined) => field ? [[mark, _REGISTRY[field].col]] : [])((_cache.query[`mark:${mark}`] as _Field[] | undefined)?.find(fieldName => fieldName in cols))))
				: cols ? mode ? arr[mode === 'all' ? 'every' : 'some']((fieldName: string) => fieldName in cols)
				: ((schemas: Record<string, S.Schema.AnyNoContext>) =>
					arr.length === 1 && first !== undefined ? schemas[first] : S.Struct(schemas))(Object.fromEntries(arr.map(fieldName =>
					[fieldName, (cols as Record<string, S.Schema.AnyNoContext>)[fieldName] ?? S.Unknown]))) : (row: Record<string, unknown>) =>
					arr.length === 1 && first !== undefined ? row[first] : Object.fromEntries(arr.map(fieldName =>
					[fieldName, row[fieldName]]))
		)(input, input[0]);
}
function _lens(cap: _CapKey): _Lens;
function _lens(constraints: Partial<_Entry>): _Lens;
function _lens(input: _CapKey | Partial<_Entry>): _Lens {
	const fields = typeof input === 'string'
		? ((_cache.query as Record<string, _Field[] | undefined>)[input] ?? [])
		: (() => {
			const keys = Object.keys(input);
			const fastKey = keys.length === 1 && (keys[0] === 'mark' || keys[0] === 'wrap')
				? keys[0] === 'wrap' && Array.isArray(input.wrap) ? `wrap:${input.wrap.map(w => w.name).join(',')}` : `${keys[0]}:${input[keys[0] as keyof _Entry]}`
				: null;
			return (fastKey ? (_cache.query as Record<string, _Field[] | undefined>)[fastKey] : undefined)
				?? _cache.keys.filter(field => Object.entries(input).every(([key, v]) => _REGISTRY[field][key as keyof _Entry] === v));
		})();
	const resolved = fields.map(field => _cache[field]);
	return {
		fields, cols: resolved.map(entry => entry.col),
		marks: [...new Set(resolved.map(entry => entry.mark).filter((m): m is _Mark => m !== false))],
		wraps: [...new Set(resolved.map(entry => entry.wrap).filter((w): w is _Wrap => w !== false))],
		first: resolved[0],
		in: (cols: Record<string, unknown>): _LensIn => {
			const present = fields.filter(field => field in cols);
			const first = present[0];
			return { fields: present, cols: present.map(field => _REGISTRY[field].col), first: first === undefined ? undefined : { field: first, col: _REGISTRY[first].col } };
		},
	};
}
const _dispatch = <D extends _DispatchDim, R>(dim: D, targets: _Field | readonly _Field[], handlers: _DimHandlers<D, R>): R[] =>
	A.map(Array.isArray(targets) ? targets : [targets], (name): R => {
		const entry = _REGISTRY[name as _Field];
		const value = entry[dim];
		const dispatchKey = Match.value([value, dim] as const).pipe(
			Match.when(([v]) => v === false, () => 'none' as const),
			Match.when(([, d]) => d === 'wrap', () => 'wrap' as const),
			Match.orElse(() => 'handler' as const)
		);
		const dispatchTable = {
			none: () => handlers.none(entry, name),
			wrap: () => ((wrapMeta: _Meta) => (handlers as _DimHandlers<'wrap', R>)[wrapMeta.cat](entry, wrapMeta, name))((value as _Wrap)[0]),
			handler: () => {
				const h = (handlers as unknown as Record<string, (e: _Entry, f: _Field) => R>)[value as string];
				return Match.value(h).pipe(
					Match.when(Match.undefined, () => handlers.none(entry, name)),
					Match.orElse(fn => fn(entry, name))
				);
			}
		};
		return dispatchTable[dispatchKey]() as R;
	});

// --- [FIELD_OBJECT] ----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Field = Object.assign(_get, _cache.query, {
	from: _from, lens: _lens, dispatch: _dispatch, pick: _pick, has: _has, entries: _cache.entries,
	resolve: _resolve, predMeta: _predMeta, isSqlType: _isSqlType, isGen: _isGen,
	byCol: _cache as { readonly [ColKey in _Col]: _Resolved<_ColToField[ColKey]> },
	keys: _cache.keys, cols: _cache.cols, marks: _cache.marks, wrapByCat: _cache.wrapByCat,
	tables: _TABLES, tableNames: _cache.tableNames, tableByField: _cache.tableByField, fk: _FK, sqlCast: _SQL_CAST,
});

// --- [FIELD_NAMESPACE] -------------------------------------------------------

namespace Field {
	export type Name<F extends _Field = _Field> = F; export type Table<T extends _Table = _Table> = T; export type Col<C extends _Col = _Col> = C; export type Mark<M extends _Mark = _Mark> = M; export type Wrap<W extends _Wrap = _Wrap> = W;
	export type WrapName<W extends _WrapName = _WrapName> = W; export type Gen<G extends _Gen = _Gen> = G; export type FkAction<A extends _FkAction = _FkAction> = A; export type WrapCat<C extends _WrapCat = _WrapCat> = C;
	export type Entry<F extends _Field = _Field> = _Entry<F>; export type Resolved<F extends _Field = _Field> = _Resolved<F>;
	export type TableEntry<T extends _Table = _Table> = _Tbl<T>; export type WrapEntry<W extends _WrapName = _WrapName> = _Meta<W>;
	export type FieldsOf<T extends _Table = _Table> = _FieldsOf<T>; export type TablesOf<F extends _Field = _Field> = _TablesOf<F>; export type CatToWraps<C extends _WrapCat = _WrapCat> = _CatToWraps[C];
	export type Has<C extends Partial<_EntryShape> = Partial<_EntryShape>> = _Has<C>; export type HasMeta<C extends Partial<_MetaShape> = Partial<_MetaShape>> = _HasMeta<C>;
	export type HasWrap<C extends Partial<_MetaShape> = Partial<_MetaShape>> = _HasWrap<C>;
	export type Lens<L extends _Lens = _Lens> = L; export type DispatchDim<D extends _DispatchDim = _DispatchDim> = D; export type DimHandlers<D extends _DispatchDim = _DispatchDim, R = unknown> = _DimHandlers<D, R>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Field };
