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
type _RawEntry = Readonly<{ col: string; sql: string; ts: string; mark: string | false; gen: string | false; null: boolean; ref: string | false; wrap: readonly { readonly name: string }[] | false }>;

// --- [METADATA_TABLES] -------------------------------------------------------
// - fields: Which registry entries belong to this table | - fk: FK action overrides as [entry, action] tuples (RESTRICT is default, omit if not overriding)
// - required: Entries where null:true should be NOT NULL in this table | - unique: Composite unique constraints as entry arrays
// Note: Array defaults (e.g., TEXT[] NOT NULL → '{}') are inferred algorithmically in generate.ts

const _Fk = {RESTRICT: 'RESTRICT', CASCADE: 'CASCADE', SETNULL:'SET NULL', SETDEFAULT:'SET DEFAULT', NOACTION:'NO ACTION',} as const;
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
	actorId:          { col: 'actor_id',         sql: 'UUID',        ts: 'S.UUID',            mark: 'fk',        gen: false,    null: true,  ref: 'users',    wrap: false                                                  },
	entityId:         { col: 'entity_id',        sql: 'UUID',        ts: 'S.UUID',            mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
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
	namespace:        { col: 'namespace',        sql: 'TEXT',        ts: 'S.String',          mark: 'casefold',  gen: false,    null: false, ref: false,      wrap: false                                                  },
	email:            { col: 'email',            sql: 'CITEXT',      ts: 'S.String',          mark: 'casefold',  gen: false,    null: false, ref: false,      wrap: false                                                  },
	actorEmail:       { col: 'actor_email',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: false                                                  },
	role:             { col: 'role',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	state:            { col: 'state',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	kind:             { col: 'kind',             sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	content:          { col: 'content',          sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	operation:        { col: 'operation',        sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	entityType:       { col: 'entity_type',      sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	provider:         { col: 'provider',         sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: false, ref: false,      wrap: false                                                  },
	scope:            { col: 'scope',            sql: 'TEXT',        ts: 'S.String',          mark: false,       gen: false,    null: true,  ref: false,      wrap: [_WrapMeta.FieldOption]                                },
});
const _Tables = {
	apps: {
		fields: 	[_Registry.id, _Registry.name, _Registry.namespace, _Registry.settings, _Registry.updatedAt]},
	users: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.email, _Registry.role, _Registry.state, _Registry.deletedAt, _Registry.updatedAt]},
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
		fields: 	[_Registry.id, _Registry.appId, _Registry.userId, _Registry.kind, _Registry.content, _Registry.state, _Registry.deletedAt, _Registry.updatedAt, _Registry.size],
		fk: 		[[_Registry.userId, _Fk.SETNULL]] as const},
	auditLogs: {
		fields: 	[_Registry.id, _Registry.appId, _Registry.operation, _Registry.entityType, _Registry.entityId, _Registry.actorId, _Registry.actorEmail, _Registry.changes, _Registry.ipAddress, _Registry.userAgent]},
	mfaSecrets: {
		fields: 	[_Registry.id, _Registry.userId, _Registry.encrypted, _Registry.backupHashes, _Registry.enabledAt, _Registry.deletedAt, _Registry.updatedAt, _Registry.remaining],
		required: 	[_Registry.userId],
		unique:		[[_Registry.userId]]},
} as const;

// --- [DERIVED_TYPES] ---------------------------------------------------------
type _Reg = typeof _Registry; type _Fks = typeof _Fk; type _Metas = typeof _WrapMeta; type _Tbls = typeof _Tables;
// Tier 1: Key unions (from consts)
type _FkAction = _Fks[keyof _Fks]; type _WrapName = keyof _Metas; type _Field = keyof _Reg; type _Table = keyof _Tbls;
// Tier 2: Entry lookups (parameterized)
type _Meta<W extends _WrapName = _WrapName> = _Metas[W]; type _Entry<F extends _Field = _Field> = _Reg[F]; type _Tbl<T extends _Table = _Table> = _Tbls[T];
// Tier 3: Entry value unions
type _WrapCat = _Meta['cat']; type _Mark = Exclude<_Entry['mark'], false>; type _Wrap = Exclude<_Entry['wrap'], false>; type _Gen = Exclude<_Entry['gen'], false>;
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
// Tier 7: Capability aggregation
type _WrapNames<W extends readonly { readonly name: string }[]> = { [K in keyof W]: W[K] extends { readonly name: infer N } ? N : never };
type _Dims = { [M in _Mark as `mark:${M}`]: _Has<{ mark: M }> } & { [W in _Wrap as `wrap:${Str.Join<_WrapNames<W>, ','>}`]: _Has<{ wrap: W }> };
type _Caps = _Dims & {
	nullable: _Has<{ null: true }>; required: _Has<{ null: false }>; unwrapped: _Has<{ wrap: false }>;
	generated: Exclude<_Field, O.SelectKeys<_Reg, { gen: false }, 'equals'>> & _Field;
	hasRef: Exclude<_Field, O.SelectKeys<_Reg, { ref: false }, 'equals'>> & _Field;
};
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

// --- [FIELD CACHE] -----------------------------------------------------------

const _cache = (() => {
	const keys = Object.keys(_Registry) as _Field[];
	const index = { byField: {} as Record<string, _Resolved>, byCol: {} as Record<string, _Resolved>, cols: [] as _Col[], marks: [] as _Mark[], wraps: [] as _Wrap[], query: {} as Record<string, _Field[]>, entries: {} as Record<string, _Resolved[]>, wrapByCat: {} as Record<string, _WrapName[]> };
	keys.forEach(field => {
		const meta = _Registry[field], resolved = { ...meta, field } as _Resolved<typeof field>;
		const nullKey = meta.null ? 'nullable' : 'required', markKey = meta.mark && `mark:${meta.mark}`, wrapKey = meta.wrap ? `wrap:${meta.wrap.map(w => w.name).join(',')}` : 'unwrapped';
		const genKey = meta.gen && 'generated', refKey = meta.ref && 'hasRef';
		index.byField[field] = resolved; index.byCol[meta.col] = resolved; index.cols.push(meta.col);
		meta.mark && index.marks.push(meta.mark); meta.wrap && index.wraps.push(meta.wrap);
		index.query[nullKey] ??= []; index.query[nullKey].push(field); index.entries[nullKey] ??= []; index.entries[nullKey].push(resolved);
		if (markKey) { index.query[markKey] ??= []; index.query[markKey].push(field); index.entries[markKey] ??= []; index.entries[markKey].push(resolved); }
		index.query[wrapKey] ??= []; index.query[wrapKey].push(field); index.entries[wrapKey] ??= []; index.entries[wrapKey].push(resolved);
		if (genKey) { index.query[genKey] ??= []; index.query[genKey].push(field); index.entries[genKey] ??= []; index.entries[genKey].push(resolved); }
		if (refKey) { index.query[refKey] ??= []; index.query[refKey].push(field); index.entries[refKey] ??= []; index.entries[refKey].push(resolved); }
	});
	(Object.entries(_WrapMeta) as [_WrapName, _Meta][]).forEach(([name, meta]) => { index.wrapByCat[meta.cat] ??= []; index.wrapByCat[meta.cat]?.push(name); });
	const tableNames = Object.keys(_Tables) as _Table[];
	const tableByField = Object.fromEntries(keys.map(f => [f, tableNames.filter(t => _Tables[t].fields.some(e => e.field === f))])) as { [F in _Field]: _Table[] };
	return Object.freeze({
		...(index.byField as { [FieldKey in _Field]: _Resolved<FieldKey> }),
		...(index.byCol as { [ColKey in _Col]: _Resolved<_ColToField[ColKey]> }),
		keys, cols: index.cols as readonly _Col[],
		marks: [...new Set(index.marks)] as readonly _Mark[],
		wraps: [...new Set(index.wraps)] as readonly _Wrap[],
		query: index.query as { [K in _CapKey]: _Caps[K][] },
		entries: index.entries as unknown as { readonly [K in _CapKey]: readonly _Resolved<_Caps[K]>[] },
		wrapByCat: index.wrapByCat as unknown as { readonly [C in _WrapCat]: readonly _WrapName[] },
		tableNames: tableNames as readonly _Table[],
		tableByField,
	});
})();

// --- [INTERNAL] --------------------------------------------------------------

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
	if (typeof input === 'string') {
		const field = (_cache.query[`mark:${input}`] as _Field[] | undefined)?.find(fieldName => fieldName in (cols ?? {}));
		return field ? _Registry[field].col : false;
	}
	const arr = input;
	if (arr.length > 0 && cols && !mode && _cache.marks.includes(arr[0] as _Mark)) {
		return Object.fromEntries((arr as readonly _Mark[]).flatMap(mark => {
			const field = (_cache.query[`mark:${mark}`] as _Field[] | undefined)?.find(fieldName => fieldName in cols);
			return field ? [[mark, _Registry[field].col]] : [];
		}));
	}
	const first = arr[0];
	if (!cols) return (row: Record<string, unknown>) => arr.length === 1 && first !== undefined ? row[first] : Object.fromEntries(arr.map(fieldName => [fieldName, row[fieldName]]));
	if (mode) return arr[mode === 'all' ? 'every' : 'some']((fieldName: string) => fieldName in cols);
	const schemas = Object.fromEntries(arr.map(fieldName => [fieldName, (cols as Record<string, S.Schema.AnyNoContext>)[fieldName] ?? S.Unknown]));
	return arr.length === 1 && first !== undefined ? schemas[first] : S.Struct(schemas);
}
const _lens = (constraints: Partial<_Entry>): _Lens => {
	const keys = Object.keys(constraints); 	// Fast path: single mark/wrap constraint uses pre-computed _cache.query
	const fastKey = keys.length === 1 && (keys[0] === 'mark' || keys[0] === 'wrap')
		? keys[0] === 'wrap' && Array.isArray(constraints.wrap) ? `wrap:${constraints.wrap.map(w => w.name).join(',')}` : `${keys[0]}:${constraints[keys[0]]}`
		: null;
	const cached = fastKey ? (_cache.query as Record<string, _Field[] | undefined>)[fastKey] : undefined;
	const fields = cached ?? _cache.keys.filter(fieldName => Object.entries(constraints).every(([key, value]) => _Registry[fieldName][key as keyof _Entry] === value));
	const resolved = fields.map(fieldName => _cache[fieldName]);
	return {
		fields, cols: resolved.map(entry => entry.col),
		marks: [...new Set(resolved.map(entry => entry.mark).filter((mark): mark is _Mark => mark !== false))],
		wraps: [...new Set(resolved.map(entry => entry.wrap).filter((wrap): wrap is _Wrap => wrap !== false))],
		first: resolved[0],
		in: (cols: Record<string, unknown>): _LensIn => {
			const present = fields.filter(fieldName => fieldName in cols);
			const first = present[0];
			return { fields: present, cols: present.map(fieldName => _Registry[fieldName].col), first: first ? { field: first, col: _Registry[first].col } : undefined };
		},
	};
};
const _dispatch = <D extends _DispatchDim, R>(dim: D, targets: _Field | readonly _Field[], handlers: _DimHandlers<D, R>): R[] => {
	const fields = typeof targets === 'string' ? [targets] : targets;
	return fields.map(name => {
		const entry = _Registry[name], value = entry[dim];
		if (value === false) return handlers.none(entry, name);
		if (dim === 'wrap') { const wrapMeta = (value as _Wrap)[0]; return (handlers as _DimHandlers<'wrap', R>)[wrapMeta.cat](entry, wrapMeta, name); }
		const handler = (handlers as unknown as Record<string, (e: _Entry, f: _Field) => R>)[value as string];
		return handler ? handler(entry, name) : handlers.none(entry, name);
	});
};

// --- [FIELD_OBJECT] ----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Field = Object.assign(_get, _cache.query, {
	from: _from, lens: _lens, dispatch: _dispatch, entries: _cache.entries,
	byCol: _cache as { readonly [ColKey in _Col]: _Resolved<_ColToField[ColKey]> },
	keys: _cache.keys, cols: _cache.cols, marks: _cache.marks, wrapByCat: _cache.wrapByCat,
	tables: _Tables, tableNames: _cache.tableNames, tableByField: _cache.tableByField, fk: _Fk,
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
	// Function signatures
	export type Lens<L extends _Lens = _Lens> = L; export type DispatchDim<D extends _DispatchDim = _DispatchDim> = D; export type DimHandlers<D extends _DispatchDim = _DispatchDim, R = unknown> = _DimHandlers<D, R>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Field };
