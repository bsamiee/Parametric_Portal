/**
 * Layered field definition system for @effect/sql models.
 * Enables: (1) Type-safe repo generation (2) SQL DDL generation (3) Model.Class generation.
 *
 * Architecture:
 *   - _Fk: FK action constants (RESTRICT, CASCADE, etc.)
 *   - _WrapMeta: Effect SQL wrapper behaviors (Generated, Sensitive, FieldOption, etc.)
 *   - _Registry: Field definitions with col/sql/ts/mark/gen/null/ref/wrap
 *   - _Tables: Composed from resolved Registry entries (not strings)
 *   - Type-level bi-directional lookups via ts-toolbelt O.SelectKeys/O.Invert
 */
/** biome-ignore-all assist/source/useSortedKeys: <needed> */
import { Schema as S } from 'effect';
import type { Object as O, String as Str } from 'ts-toolbelt';
import type { Simplify } from 'type-fest';

// --- [TYPES] -----------------------------------------------------------------

type _RawMeta = Readonly<{ cat: string; sel: boolean; ins: boolean; upd: boolean; json: boolean; auto: string | false; store: string | false }>;
type _RawEntry = Readonly<{ col: string; sql: string; ts: string; mark: string | false; gen: string | false; null: boolean; ref: string | false; wrap: readonly _RawMeta[] | false }>;

// --- [METADATA_TABLES] -------------------------------------------------------
// - fields: Which registry entries belong to this table | - fk: FK action overrides as [entry, action] tuples (RESTRICT is default, omit if not overriding)
// - required: Entries where null:true should be NOT NULL in this table | - unique: Composite unique constraints as entry arrays
// Note: Array defaults (e.g., TEXT[] NOT NULL → '{}') are inferred algorithmically in generate.ts

const _Fk = {RESTRICT: 'RESTRICT', CASCADE: 'CASCADE', SETNULL:'SET NULL', SETDEFAULT:'SET DEFAULT', NOACTION:'NO ACTION',} as const;
const _SqlCast = { INET: 'inet', JSONB: 'jsonb', UUID: 'uuid' } as const; /** SQL type → PostgreSQL cast string (types requiring explicit cast for comparisons) */
const _WrapMeta = (<const T extends Record<string, _RawMeta>>(t: T) => Object.fromEntries((Object.keys(t) as (keyof T & string)[]).map(k => [k, { ...t[k], name: k }])) as { [K in keyof T]: T[K] & { readonly name: K } })({
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
const _Registry = (<const T extends Record<string, _RawEntry>>(t: T) => Object.fromEntries((Object.keys(t) as (keyof T & string)[]).map(k => [k, { ...t[k], field: k }])) as { [K in keyof T]: T[K] & { readonly field: K } })({
	id:               { col: 'id',               sql: 'UUID',        ts: 'S.UUID',            mark: 'pk',        gen: 'uuidv7', null: false, ref: false,      wrap: [_WrapMeta.Generated]                                  },
	appId:            { col: 'app_id',           sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: false, ref: 'apps',     wrap: false                                                  },
	userId:           { col: 'user_id',          sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: true,  ref: 'users',    wrap: false                                                  },
	sessionId:        { col: 'session_id',       sql: 'UUID',        ts: 'S.UUID',            mark: 'fk',        gen: false,    null: true,  ref: 'sessions', wrap: [_WrapMeta.FieldOption]                                },
	subjectId:        { col: 'subject_id',       sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	requestId:        { col: 'request_id',       sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	externalId:       { col: 'external_id',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	deletedAt:        { col: 'deleted_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'soft',      gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	updatedAt:        { col: 'updated_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'time',      gen: false,    null: false, ref: false,      wrap: [_WrapMeta.DateTimeUpdateFromDate]                     },
	expiresAt:        { col: 'expires_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'exp',       gen: false,    null: true,  ref: false,      wrap: false                                                  },
	verifiedAt:       { col: 'verified_at',      sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	enabledAt:        { col: 'enabled_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	lastUsedAt:       { col: 'last_used_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	hash:             { col: 'hash',             sql: 'TEXT',        ts: 'S.String',          mark: 'unique',    gen: false,    null: false, ref: false,      wrap: [_WrapMeta.Sensitive]                                  },
	prefix:           { col: 'prefix',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: 'virtual',null: false, ref: false,      wrap: [_WrapMeta.Generated]                                  },
	encrypted:        { col: 'encrypted',        sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WrapMeta.Sensitive]                                  },
	accessEncrypted:  { col: 'access_encrypted', sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WrapMeta.Sensitive]                                  },
	refreshEncrypted: { col: 'refresh_encrypted',sql: 'BYTEA',       ts: 'BufferSchema',      mark: 'sensitive', gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.Sensitive]           },
	backupHashes:     { col: 'backup_hashes',    sql: 'TEXT[]',      ts: 'S.Array(S.String)', mark: 'sensitive', gen: false,    null: false, ref: false,      wrap: [_WrapMeta.Sensitive]                                  },
	size:             { col: 'size',             sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'stored', null: false, ref: false,      wrap: [_WrapMeta.Generated]                                  },
	remaining:        { col: 'remaining',        sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: false, ref: false,      wrap: [_WrapMeta.Generated]                                  },
	settings:         { col: 'settings',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.JsonFromString]      },
	changes:          { col: 'changes',          sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.JsonFromString]      },
	ipAddress:        { col: 'ip_address',       sql: 'INET',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	userAgent:        { col: 'user_agent',       sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	name:             { col: 'name',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	storageRef:       { col: 'storage_ref',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	namespace:        { col: 'namespace',        sql: 'TEXT',        ts: 'S.String',          mark: 'casefold',  gen: false,    null: false, ref: false,      wrap: false                                                  },
	email:            { col: 'email',            sql: 'CITEXT',      ts: 'S.String',          mark: 'casefold',  gen: false,    null: false, ref: false,      wrap: false                                                  },
	role:             { col: 'role',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	status:           { col: 'status',           sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	type:             { col: 'type',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	content:          { col: 'content',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	operation:        { col: 'operation',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	subject:          { col: 'subject',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	provider:         { col: 'provider',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scope:            { col: 'scope',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	entityType:       { col: 'entity_type',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	entityId:         { col: 'entity_id',        sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scopeId:          { col: 'scope_id',         sql: 'UUID',        ts: 'S.UUID',            mark: 'scope',     gen: false,    null: true,  ref: 'apps',     wrap: [_WrapMeta.FieldOption]                                },
	displayText:      { col: 'display_text',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	contentText:      { col: 'content_text',     sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	metadata:         { col: 'metadata',         sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.JsonFromString]      },
	searchVector:     { col: 'search_vector',    sql: 'TSVECTOR',    ts: 'S.Unknown',         mark: false,       gen: 'stored', null: false, ref: false,      wrap: [_WrapMeta.Generated]                                  },
	embedding:        { col: 'embedding',        sql: 'VECTOR',      ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	// Job-specific fields
	priority:         { col: 'priority',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	payload:          { col: 'payload',          sql: 'JSONB',       ts: 'S.Unknown',         mark: false,       gen: false,    null: false, ref: false,      wrap: [_WrapMeta.JsonFromString]                             },
	attempts:         { col: 'attempts',         sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	maxAttempts:      { col: 'max_attempts',     sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scheduledAt:      { col: 'scheduled_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	startedAt:        { col: 'started_at',       sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.Generated]           },
	completedAt:      { col: 'completed_at',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: 'stamp',     gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.Generated]           },
	lastError:        { col: 'last_error',       sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	lockedBy:         { col: 'locked_by',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	lockedUntil:      { col: 'locked_until',     sql: 'TIMESTAMPTZ', ts: 'S.DateFromSelf',    mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
	waitMs:           { col: 'wait_ms',          sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.Generated]           },
	durationMs:       { col: 'duration_ms',      sql: 'INTEGER',     ts: 'S.Number',          mark: false,       gen: 'virtual',null: true,  ref: false,      wrap: [_WrapMeta.FieldOption, _WrapMeta.Generated]           },
});
const _Tables = {
	apps: {
		fields: 	[_Registry.id, _Registry.name, _Registry.namespace, _Registry.settings, _Registry.updatedAt]},
	users: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.email, _Registry.role, _Registry.status, _Registry.deletedAt, _Registry.updatedAt]},
	sessions: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.hash, _Registry.expiresAt, _Registry.deletedAt, _Registry.verifiedAt, _Registry.ipAddress, _Registry.userAgent, _Registry.updatedAt, _Registry.prefix],
		required: 	[_Registry.userId, _Registry.expiresAt]},
	apiKeys: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.name, _Registry.hash, _Registry.encrypted, _Registry.expiresAt, _Registry.deletedAt, _Registry.lastUsedAt, _Registry.updatedAt, _Registry.prefix],
		required: 	[_Registry.userId]},
	oauthAccounts: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.provider, _Registry.externalId, _Registry.accessEncrypted, _Registry.refreshEncrypted, _Registry.expiresAt, _Registry.deletedAt, _Registry.scope, _Registry.updatedAt],
		required: 	[_Registry.userId],
		unique: 	[[_Registry.provider, _Registry.externalId]]},
	refreshTokens: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.sessionId, _Registry.hash, _Registry.expiresAt, _Registry.deletedAt, _Registry.prefix],
		required: 	[_Registry.userId, _Registry.expiresAt],
		fk: 		[[_Registry.sessionId, _Fk.CASCADE]] as const},
	assets: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.userId, _Registry.type, _Registry.content, _Registry.status, _Registry.deletedAt, _Registry.updatedAt, _Registry.size, _Registry.hash, _Registry.name, _Registry.storageRef],
		nullable:	[_Registry.hash, _Registry.name, _Registry.storageRef],	// Override: hash/name/storageRef are optional metadata in assets
		fk: 		[[_Registry.userId, _Fk.SETNULL]] as const},
	auditLogs: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.userId, _Registry.requestId, _Registry.operation, _Registry.subject, _Registry.subjectId, _Registry.changes, _Registry.ipAddress, _Registry.userAgent]},
	mfaSecrets: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.encrypted, _Registry.backupHashes, _Registry.enabledAt, _Registry.deletedAt, _Registry.updatedAt, _Registry.remaining],
		required: 	[_Registry.userId],
		unique:		[[_Registry.userId]]},
	searchDocuments: {
		fields: 	[_Registry.entityType, _Registry.entityId, _Registry.scopeId, _Registry.displayText, _Registry.contentText, _Registry.metadata, _Registry.hash, _Registry.searchVector, _Registry.updatedAt],
		pk: 		[_Registry.entityType, _Registry.entityId]},
	searchEmbeddings: {
		fields: 	[_Registry.entityType, _Registry.entityId, _Registry.scopeId, _Registry.embedding, _Registry.hash, _Registry.updatedAt],
		pk: 		[_Registry.entityType, _Registry.entityId],
		fk: 		[[_Registry.entityType, _Registry.entityId], _Fk.CASCADE] as const},
	jobs: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.userId, _Registry.requestId, _Registry.type, _Registry.payload, _Registry.priority, _Registry.status, _Registry.attempts, _Registry.maxAttempts, _Registry.scheduledAt, _Registry.startedAt, _Registry.completedAt, _Registry.lastError, _Registry.lockedBy, _Registry.lockedUntil, _Registry.waitMs, _Registry.durationMs, _Registry.updatedAt],
		fk: 		[[_Registry.userId, _Fk.RESTRICT]] as const},
} as const;

// --- [DERIVED_TYPES] ---------------------------------------------------------
type _Reg = typeof _Registry; type _Fks = typeof _Fk; type _Metas = typeof _WrapMeta; type _Tbls = typeof _Tables;
// Tier 1: Key unions (from consts)
type _FkAction = _Fks[keyof _Fks]; type _WrapName = keyof _Metas; type _Field = keyof _Reg; type _Table = keyof _Tbls;
// Tier 2: Entry lookups (parameterized)
type _Meta<W extends _WrapName = _WrapName> = _Metas[W]; type _Entry<F extends _Field = _Field> = _Reg[F]; type _Tbl<T extends _Table = _Table> = _Tbls[T];
// Tier 3: Entry value unions
type _WrapCat = _Meta['cat']; type _Mark = Exclude<_Entry['mark'], false>; type _Wrap = Exclude<_Entry['wrap'], false>; type _Gen = Exclude<_Entry['gen'], false>; type _Sql = _Entry['sql'];
// Tier 4: Widened shapes (single object with union values, not union of objects)
type _EntryShape = { [K in keyof _Entry]: _Entry[K] }; type _MetaShape = { [K in keyof _Meta]: _Meta[K] };
// Tier 5: Bi-directional mappings
type _ColToField = { [F in _Field as _Reg[F]['col']]: F };
type _Col = keyof _ColToField;
type _CatToWraps = { [C in _WrapCat]: O.SelectKeys<_Metas, { cat: C }, 'extends->'> & _WrapName };
type _FieldsOf<T extends _Table> = _Tbls[T]['fields'][number]['field'];
type _TablesOf<F extends _Field> = { [T in _Table]: F extends _FieldsOf<T> ? T : never }[_Table];
// Tier 6: Capability selection (ts-toolbelt O.SelectKeys)
type _Has<C extends Partial<_EntryShape>> = O.SelectKeys<_Reg, C, 'extends->'> & _Field;
type _HasMeta<C extends Partial<_MetaShape>> = O.SelectKeys<_Metas, C, 'extends->'> & _WrapName;
type _HasWrap<C extends Partial<_MetaShape>> = { [F in _Field]: _Reg[F]['wrap'] extends readonly (infer W)[] ? Extract<W, C> extends never ? never : F : never }[_Field];
type _HasNot<P extends keyof _EntryShape> = Exclude<_Field, O.SelectKeys<_Reg, Record<P, false>, 'equals'>> & _Field;
// Tier 6b: Capability definition tables (type-level data driving derived caps)
type _FalsifiableProp = 'mark' | 'gen' | 'ref' | 'wrap';
type _FilterDef = { nullable: { null: true }; required: { null: false }; unwrapped: { wrap: false } };
type _WrapMetaDef = { autoUpdate: { auto: 'both' }; autoInsert: { auto: 'insert' | 'both' } };
// Tier 7: Capability aggregation (all derived from registry + definition tables)
type _WrapNames<W extends readonly { readonly name: string }[]> = { [K in keyof W]: W[K] extends { readonly name: infer N } ? N : never };
type _Dims = { [M in _Mark as `mark:${M}`]: _Has<{ mark: M }> } & { [W in _Wrap as `wrap:${Str.Join<_WrapNames<W>, ','>}`]: _Has<{ wrap: W }> };
type _FilterCaps = { [K in keyof _FilterDef]: _Has<_FilterDef[K]> };
type _ExistsCaps = { [P in _FalsifiableProp as `has${Capitalize<P>}`]: _HasNot<P> };
type _WrapMetaCaps = { [K in keyof _WrapMetaDef]: _HasWrap<_WrapMetaDef[K]> };
type _Caps = _Dims & { [G in _Gen as `gen:${G}`]: _Has<{ gen: G }> } & { [S in _Sql as `sql:${S}`]: _Has<{ sql: S }> } & _FilterCaps & _ExistsCaps & _WrapMetaCaps;
type _CapKey = keyof _Caps;
// Tier 8: Resolved (enriched with field name)
type _Resolved<F extends _Field = _Field> = Simplify<_Entry<F> & { readonly field: F }>;
// Tier 9: Function signatures (TERMINAL)
type _LensIn = { fields: _Field[]; cols: _Col[]; first: { field: _Field; col: _Col } | undefined };
type _Lens = { fields: _Field[]; cols: _Col[]; marks: _Mark[]; wraps: _Wrap[]; first: _Resolved | undefined; in: (cols: Record<string, unknown>) => _LensIn };
type _DispatchDim = 'mark' | 'wrap' | 'sql' | 'gen';
type _DimHandlers<D extends _DispatchDim, R> = { none: (entry: _Entry, field: _Field) => R } & (D extends 'wrap'
		? { [C in _WrapCat]: (entry: _Entry, meta: _Meta, field: _Field) => R }
		: { [V in Exclude<_Entry[D], false> & string]: (entry: _Entry, field: _Field) => R });

// --- [CACHE_BUILDER] ---------------------------------------------------------

type _CacheIndex = {
	byField: Record<string, _Resolved>;
	byCol: Record<string, _Resolved>;
	cols: _Col[];
	marks: _Mark[];
	wraps: _Wrap[];
	query: Record<string, _Field[]>;
	entries: Record<string, _Resolved[]>;
	wrapByCat: Record<string, _WrapName[]>;
};
const _addCap = (index: _CacheIndex, key: string | false | undefined, field: _Field, resolved: _Resolved): void => {
	// biome-ignore lint/suspicious/noAssignInExpressions: Builder pattern with nullish coalescing assignment
	key && (index.query[key] ??= []).push(field);
	// biome-ignore lint/suspicious/noAssignInExpressions: Builder pattern with nullish coalescing assignment
	key && (index.entries[key] ??= []).push(resolved);
};
const _indexField = (index: _CacheIndex, field: _Field): void => {
	const meta = _Registry[field];
	const resolved = { ...meta, field } as _Resolved<typeof field>;
	const wraps = meta.wrap || undefined;
	const wrapAuto = (w: _RawMeta) => w.auto;
	// biome-ignore lint/style/noParameterAssign: Builder pattern mutation
	index.byField[field] = resolved;
	// biome-ignore lint/style/noParameterAssign: Builder pattern mutation
	index.byCol[meta.col] = resolved;
	index.cols.push(meta.col);
	meta.mark && index.marks.push(meta.mark);
	meta.wrap && index.wraps.push(meta.wrap);
	// Non-falsifiable caps: null → nullable/required, sql → sql:X
	_addCap(index, meta.null ? 'nullable' : 'required', field, resolved);
	_addCap(index, `sql:${meta.sql}`, field, resolved);
	// Falsifiable dimension caps: mark:X, wrap:X/unwrapped, gen:X
	_addCap(index, meta.mark && `mark:${meta.mark}`, field, resolved);
	_addCap(index, meta.wrap ? `wrap:${meta.wrap.map(w => w.name).join(',')}` : 'unwrapped', field, resolved);
	_addCap(index, meta.gen && `gen:${meta.gen}`, field, resolved);
	// Existence caps: hasX for falsifiable props
	_addCap(index, meta.mark && 'hasMark', field, resolved);
	_addCap(index, meta.gen && 'hasGen', field, resolved);
	_addCap(index, meta.ref && 'hasRef', field, resolved);
	_addCap(index, meta.wrap && 'hasWrap', field, resolved);
	// Wrap meta caps: autoUpdate, autoInsert
	_addCap(index, wraps?.some(w => wrapAuto(w) === 'both') && 'autoUpdate', field, resolved);
	_addCap(index, wraps?.some(w => wrapAuto(w) === 'insert' || wrapAuto(w) === 'both') && 'autoInsert', field, resolved);
};
const _indexWrapCategories = (index: _CacheIndex): _CacheIndex => ({
	...index,
	wrapByCat: Object.groupBy(Object.keys(_WrapMeta) as _WrapName[], (name) => _WrapMeta[name].cat) as Record<string, _WrapName[]>,
})
const _buildTableIndex = (keys: readonly _Field[], tableNames: readonly _Table[]) => Object.fromEntries(keys.map(f => [f, tableNames.filter(t => _Tables[t].fields.some(e => e.field === f))])) as { [F in _Field]: _Table[] };
const _finalizeCache = (index: _CacheIndex, keys: readonly _Field[], tableNames: readonly _Table[]) => Object.freeze({
	...(index.byField as { [FieldKey in _Field]: _Resolved<FieldKey> }),
	...(index.byCol as { [ColKey in _Col]: _Resolved<_ColToField[ColKey]> }),
	keys,
	cols: index.cols as readonly _Col[],
	marks: [...new Set(index.marks)] as readonly _Mark[],
	wraps: [...new Set(index.wraps)] as readonly _Wrap[],
	query: index.query as { [K in _CapKey]: _Caps[K][] },
	entries: index.entries as unknown as { readonly [K in _CapKey]: readonly _Resolved<_Caps[K]>[] },
	wrapByCat: index.wrapByCat as unknown as { readonly [C in _WrapCat]: readonly _WrapName[] },
	tableNames,
	tableByField: _buildTableIndex(keys, tableNames),
});
const _buildCache = () => {
	const keys = Object.keys(_Registry) as _Field[];
	const tableNames = Object.keys(_Tables) as _Table[];
	const index: _CacheIndex = { byField: {}, byCol: {}, cols: [], marks: [], wraps: [], query: {}, entries: {}, wrapByCat: {} };
	keys.forEach(field => { _indexField(index, field); });
	return _finalizeCache(_indexWrapCategories(index), keys, tableNames);
};
const _cache = _buildCache();	// Field Cache

// --- [INTERNAL] --------------------------------------------------------------

const _pick = (cap: _CapKey, cols: Record<string, unknown>): _Resolved | undefined =>						/** Find first entry matching cap whose field OR col exists in cols object */
	(_cache.entries[cap] as readonly _Resolved[] | undefined)?.find(e => e.field in cols || e.col in cols);
const _has = (cap: _CapKey, field: string): boolean =>														/** Check if field belongs to capability set (type-safe membership test) */
	(_cache.query[cap] as readonly string[] | undefined)?.includes(field) ?? false;
const _resolve = (fieldOrCol: string): _Resolved | undefined => {											/** Resolve field or column name to entry (unified lookup via spread cache keys) */
	const val = (_cache as Record<string, unknown>)[fieldOrCol];
	return val && typeof val === 'object' && 'field' in val ? val as _Resolved : undefined;
};
const _predMeta = (fieldOrCol: string): { cast: string | undefined; wrap: 'casefold' | undefined } => {		/** Derive predicate metadata from field registry (cast + wrap for SQL predicates) */
	const entry = _resolve(fieldOrCol);
	return entry
		? { cast: _SqlCast[entry.sql as keyof typeof _SqlCast], wrap: entry.mark === 'casefold' ? 'casefold' : undefined }
		: { cast: undefined, wrap: undefined };
};
const _isSqlType = (fieldOrCol: string, sqlType: _Sql): boolean => _resolve(fieldOrCol)?.sql === sqlType;	/** Check if field has specific SQL type */
const _isGen = (fieldOrCol: string, gen: _Gen): boolean => _resolve(fieldOrCol)?.gen === gen;				/** Check if field has specific generation type */
function _get<F extends _Field>(key: F): _Resolved<F>;
function _get<C extends _Col>(key: C): _Resolved<_ColToField[C]>;
function _get<T extends _Table>(key: T, layer: 'table'): _Tbl<T>;
function _get<W extends _WrapName>(key: W, layer: 'wrap'): _Meta<W>;
function _get(key: string, layer?: 'table' | 'wrap') {return layer === 'table' ? _Tables[key as _Table] : layer === 'wrap' ? _WrapMeta[key as _WrapName] : _cache[key as _Field];}
function _from(mark: _Mark, cols: Record<string, unknown>): _Col | false;
function _from<MarkKey extends _Mark>(marks: readonly MarkKey[], cols: Record<string, unknown>): { [Key in MarkKey]?: _Col };
function _from(fields: readonly string[]): (row: Record<string, unknown>) => unknown;
function _from(fields: readonly string[], cols: Record<string, S.Schema.AnyNoContext>): S.Schema.AnyNoContext;
function _from(fields: readonly string[], cols: Record<string, unknown>, mode: 'any' | 'all'): boolean;
function _from(input: _Mark | readonly string[], cols?: Record<string, unknown>, mode?: 'any' | 'all'): unknown {
	return typeof input === 'string'
		? ((field: _Field | undefined) => field ? _Registry[field].col : false)((_cache.query[`mark:${input}`] as _Field[] | undefined)?.find(fieldName => fieldName in (cols ?? {})))
		: ((arr: readonly string[], first: string | undefined) =>
			arr.length > 0 && cols && !mode && _cache.marks.includes(arr[0] as _Mark)
				? Object.fromEntries((arr as readonly _Mark[]).flatMap(mark => ((field: _Field | undefined) => field ? [[mark, _Registry[field].col]] : [])((_cache.query[`mark:${mark}`] as _Field[] | undefined)?.find(fieldName => fieldName in cols))))
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
	const fields = typeof input === 'string'	// Fast path: cap key string → direct cache lookup
		? ((_cache.query as Record<string, _Field[] | undefined>)[input] ?? [])
		: (() => {
			const keys = Object.keys(input);
			const fastKey = keys.length === 1 && (keys[0] === 'mark' || keys[0] === 'wrap')
				? keys[0] === 'wrap' && Array.isArray(input.wrap) ? `wrap:${input.wrap.map(w => w.name).join(',')}` : `${keys[0]}:${input[keys[0] as keyof _Entry]}`
				: null;
			return (fastKey ? (_cache.query as Record<string, _Field[] | undefined>)[fastKey] : undefined)
				?? _cache.keys.filter(f => Object.entries(input).every(([k, v]) => _Registry[f][k as keyof _Entry] === v));
		})();
	const resolved = fields.map(f => _cache[f]);
	return {
		fields, cols: resolved.map(e => e.col),
		marks: [...new Set(resolved.map(e => e.mark).filter((m): m is _Mark => m !== false))],
		wraps: [...new Set(resolved.map(e => e.wrap).filter((w): w is _Wrap => w !== false))],
		first: resolved[0],
		in: (cols: Record<string, unknown>): _LensIn => {
			const present = fields.filter(f => f in cols);
			const first = present[0];
			return { fields: present, cols: present.map(f => _Registry[f].col), first: first ? { field: first, col: _Registry[first].col } : undefined };
		},
	};
}
const _dispatch = <D extends _DispatchDim, R>(dim: D, targets: _Field | readonly _Field[], handlers: _DimHandlers<D, R>): R[] =>
	(typeof targets === 'string' ? [targets] : targets).map(name =>
		((entry: _Entry, value: _Entry[D]) =>
			value === false ? handlers.none(entry, name)
			: dim === 'wrap' ? ((wrapMeta: _Meta) => (handlers as _DimHandlers<'wrap', R>)[wrapMeta.cat](entry, wrapMeta, name))((value as _Wrap)[0])
			: ((handler: ((e: _Entry, f: _Field) => R) | undefined) => handler ? handler(entry, name) : handlers.none(entry, name))((handlers as unknown as Record<string, (e: _Entry, f: _Field) => R>)[value as string])
		)(_Registry[name], _Registry[name][dim])
	);

// --- [FIELD_OBJECT] ----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Field = Object.assign(_get, _cache.query, {
	from: _from, lens: _lens, dispatch: _dispatch, pick: _pick, has: _has, entries: _cache.entries,
	resolve: _resolve, predMeta: _predMeta, isSqlType: _isSqlType, isGen: _isGen,
	byCol: _cache as { readonly [ColKey in _Col]: _Resolved<_ColToField[ColKey]> },
	keys: _cache.keys, cols: _cache.cols, marks: _cache.marks, wrapByCat: _cache.wrapByCat,
	tables: _Tables, tableNames: _cache.tableNames, tableByField: _cache.tableByField, fk: _Fk, sqlCast: _SqlCast,
});

// --- [FIELD_NAMESPACE] -------------------------------------------------------

namespace Field {
	// Key unions (parameterized for narrowing)
	export type Name<F extends _Field = _Field> = F; export type Table<T extends _Table = _Table> = T; export type Col<C extends _Col = _Col> = C; export type Mark<M extends _Mark = _Mark> = M; export type Wrap<W extends _Wrap = _Wrap> = W;
	export type WrapName<W extends _WrapName = _WrapName> = W; export type Gen<G extends _Gen = _Gen> = G; export type FkAction<A extends _FkAction = _FkAction> = A; export type WrapCat<C extends _WrapCat = _WrapCat> = C;
	// Entry lookups (parameterized)
	export type Entry<F extends _Field = _Field> = _Entry<F>; export type Resolved<F extends _Field = _Field> = _Resolved<F>;
	export type TableEntry<T extends _Table = _Table> = _Tbl<T>; export type WrapEntry<W extends _WrapName = _WrapName> = _Meta<W>;
	// Bi-directional mappings
	export type FieldsOf<T extends _Table = _Table> = _FieldsOf<T>; export type TablesOf<F extends _Field = _Field> = _TablesOf<F>; export type CatToWraps<C extends _WrapCat = _WrapCat> = _CatToWraps[C];
	// Capability selection (use shape types for valid constraints)
	export type Has<C extends Partial<_EntryShape> = Partial<_EntryShape>> = _Has<C>; export type HasMeta<C extends Partial<_MetaShape> = Partial<_MetaShape>> = _HasMeta<C>;
	export type HasWrap<C extends Partial<_MetaShape> = Partial<_MetaShape>> = _HasWrap<C>;
	// Function signatures
	export type Lens<L extends _Lens = _Lens> = L; export type DispatchDim<D extends _DispatchDim = _DispatchDim> = D; export type DimHandlers<D extends _DispatchDim = _DispatchDim, R = unknown> = _DimHandlers<D, R>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Field };
