/**
 * Unified repository factory with polymorphic query/mutation API.
 * Single `resolve` config for lookups, predicate-based find/one/page/count.
 * Polymorphic single/bulk operations for drop/lift/set.
 */
import { Model, SqlClient, SqlResolver, SqlSchema, type Statement } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import type { SqlError } from '@effect/sql/SqlError';
import type { ParseError } from 'effect/ParseResult';
import { type Cause, Data, Effect, Match, Option, Schema as S, Stream } from 'effect';
import { Field } from './field.ts';
import { Page } from './page.ts';

// --- [ERRORS] ----------------------------------------------------------------

class RepoConfigError extends Data.TaggedError('RepoConfigError')<{ readonly table: string; readonly operation: string; readonly message: string }> {}
class RepoUnknownFnError extends Data.TaggedError('RepoUnknownFnError')<{ readonly table: string; readonly fn: string }> {}
class RepoOccError extends Data.TaggedError('RepoOccError')<{ readonly table: string; readonly pk: string; readonly expected: Date }> {}

// --- [TYPES] -----------------------------------------------------------------

type AggResult<T extends AggSpec> = { [K in keyof T]: T[K] extends true ? number : T[K] extends string ? number : never };
type AggSpec = { sum?: string; avg?: string; min?: string; max?: string; count?: true };
type MergeResult<T> = T & { readonly _action: 'insert' | 'update' };
type Config<M extends Model.AnyNoContext> = {
	pk?: { column: string; cast?: string };
	resolve?: Record<string, keyof M['fields'] & string | (keyof M['fields'] & string)[] | `many:${keyof M['fields'] & string}`>;
	conflict?: { keys: (keyof M['fields'] & string)[]; only?: (keyof M['fields'] & string)[] };
	purge?: string;
	fn?: Record<string, { args: (string | { field: string; cast: string })[]; params: S.Schema.AnyNoContext }>;
};
type Pred =
	| [string, unknown]
	| { field: string; value?: unknown; values?: unknown[]; op?: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'null' | 'notNull' | 'contains' | 'containedBy' | 'hasKey' | 'hasKeys' | 'tsGte' | 'tsLte'; cast?: string; wrap?: string }
	| { raw: Statement.Fragment };

// --- [CONSTANTS] -------------------------------------------------------------

const _CountSchema = S.Struct({ count: S.Int });
const _INC_SYM = Symbol.for('repo:INC');
const _JSONB_SYM = Symbol.for('repo:JSONB');
const _NOW_SYM = Symbol.for('repo:NOW');
const Update = {
	inc: (delta = 1) => ({ [_INC_SYM]: delta }),
	jsonb: {
		del: (path: string[]) => ({ [_JSONB_SYM]: 'del' as const, path }),
		set: (path: string[], value: unknown) => ({ [_JSONB_SYM]: 'set' as const, path, value }),
	},
	now: _NOW_SYM,
} as const;

// --- [HELPERS] ---------------------------------------------------------------

const _isSingle = (input: unknown): input is string | [string, unknown] =>
	typeof input === 'string' || (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string');
const _isPredArray = (pred: Pred | readonly Pred[]): pred is readonly Pred[] =>
	Array.isArray(pred) && pred.length > 0 && !('field' in pred || 'raw' in pred || typeof pred[0] === 'string');
const _buildPreds = (uuidv7Col: string | undefined) => (filter: Record<string, unknown>): Pred[] =>
	Object.entries(filter).flatMap(([key, val]): Pred[] =>
		val === undefined || (Array.isArray(val) && val.length === 0) ? []
		: key === 'after' && uuidv7Col ? [{ field: uuidv7Col, op: 'tsGte', value: val }]
		: key === 'before' && uuidv7Col ? [{ field: uuidv7Col, op: 'tsLte', value: val }]
		: Array.isArray(val) ? [{ field: key, op: 'in', values: val }]
		: [{ field: key, value: val }]
	);

// --- [FACTORY] ---------------------------------------------------------------

const repo = <M extends Model.AnyNoContext, const C extends Config<M>>(model: M, table: string, config: C = {} as C) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		const cols = model.fields as Record<string, S.Schema.AnyNoContext>;
		// Primary key config (default: 'id' with uuid cast)
		const pk = config.pk ?? { cast: 'uuid', column: 'id' };
		const pkCol = pk.column, pkCast = pk.cast ? sql`::${sql.literal(pk.cast)}` : sql``;
		// Get entries via Field.pick (cap → first entry in model cols)
		const softEntry = Field.pick('mark:soft', cols);
		const expEntry = Field.pick('mark:exp', cols);
		const autoEntry = Field.pick('autoUpdate', cols);
		// --- SQL fragments ---------------------------------------------------
		const $active = softEntry ? sql` AND ${sql(softEntry.col)} IS NULL` : sql``;
		const $fresh = expEntry ? (expEntry.null ? sql` AND (${sql(expEntry.col)} IS NULL OR ${sql(expEntry.col)} > NOW())` : sql` AND ${sql(expEntry.col)} > NOW()`) : sql``;
		const $touch = autoEntry ? sql`, ${sql(autoEntry.col)} = NOW()` : sql``;
		const $scope = (scope?: Record<string, unknown>) => scope ? sql` AND ${sql.and(Object.entries(scope).map(([col, val]) => sql`${sql(col)} = ${val}`))}` : sql``;
		const $target = (target: string | [string, unknown]) => typeof target === 'string' ? sql`${sql(pkCol)} = ${target}${pkCast}` : sql`${sql(target[0])} = ${target[1]}`;
		const $lock = (lock: false | 'update' | 'share' | 'nowait' | 'skip') => lock ? ({ nowait: sql` FOR UPDATE NOWAIT`, share: sql` FOR SHARE`, skip: sql` FOR UPDATE SKIP LOCKED`, update: sql` FOR UPDATE` })[lock] : sql``;
		const $order = (asc: boolean) => asc ? sql`ORDER BY ${sql(pkCol)} ASC` : sql`ORDER BY ${sql(pkCol)} DESC`;
		const _cmpOps = { eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` } as const;
		const _fragOps = {
			containedBy: ({ col, value }) => sql`${col} <@ ${value}::jsonb`,
			contains: ({ col, value }) => sql`${col} @> ${value}::jsonb`,
			hasKey: ({ col, value }) => sql`${col} ? ${value}`,
			hasKeys: ({ col, values }) => values.length === 0 ? sql`TRUE` : sql`${col} ?& ARRAY[${sql.csv(values.map(k => sql`${k}`))}]::text[]`,
			in: ({ col, values }) => values.length === 0 ? sql`FALSE` : sql`${col} IN ${sql.in(values)}`,
			notNull: ({ col }) => sql`${col} IS NOT NULL`,
			null: ({ col }) => sql`${col} IS NULL`,
			tsGte: ({ col, value }) => sql`uuid_extract_timestamp(${col}) >= ${value}`,
			tsLte: ({ col, value }) => sql`uuid_extract_timestamp(${col}) <= ${value}`,
		} as const satisfies Record<string, (ctx: { col: Statement.Fragment; value: unknown; values: unknown[]; $cast: string | undefined }) => Statement.Fragment>;
		const toFrag = (pred: Pred): Statement.Fragment =>
			'raw' in pred ? pred.raw
			: Array.isArray(pred) ? sql`${sql(pred[0])} = ${pred[1]}`
			: ((p: { field: string; value?: unknown; values?: unknown[]; op?: string; cast?: string; wrap?: string }) => {
				const { field, op = 'eq', value, values = [], cast, wrap } = p;
				const meta = Field.predMeta(field), $cast = cast ?? meta.cast, $wrap = wrap ?? meta.wrap;
				const col = $wrap ? sql`${sql.literal($wrap)}(${sql(field)})` : sql`${sql(field)}`;
				const handler = _fragOps[op as keyof typeof _fragOps];
				return handler ? handler({ $cast, col, value, values }) : sql`${col} ${_cmpOps[op as keyof typeof _cmpOps] ?? _cmpOps.eq} ${value}${$cast ? sql`::${sql.literal($cast)}` : sql``}`;
			})(pred as { field: string; value?: unknown; values?: unknown[]; op?: string; cast?: string; wrap?: string });
		const $where = (pred: Pred | readonly Pred[]) => {
			const list = _isPredArray(pred) ? pred : [pred];
			return list.length > 0 ? sql.and(list.map(toFrag)) : sql`TRUE`;
		};
		/** Convert single target or bulk predicate to WHERE fragment */
		const $input = (input: string | Pred | readonly Pred[]) => _isSingle(input) ? $target(input) : $where(input);
		/** Build predicates from filter object: after/before → UUIDv7 timestamp, arrays → IN, scalars → EQ */
		const preds = _buildPreds(Field.pick('gen:uuidv7', cols)?.col);
		// --- Update entries with NOW/INC/JSONB support -----------------------
		// Symbol checks first (fast path), then primitives, then special ops, then JSONB fallback
		const $entries = (updates: Record<string, unknown>) => Object.entries(updates).map(([col, val]): Statement.Fragment =>
			val === _NOW_SYM ? sql`${sql(col)} = NOW()`
			: typeof val !== 'object' || val === null ? sql`${sql(col)} = ${val}`
			: _INC_SYM in val ? sql`${sql(col)} = ${sql(col)} + ${(val as { [_INC_SYM]: number })[_INC_SYM]}`
			: _JSONB_SYM in val ? ((op: { [_JSONB_SYM]: 'set' | 'del'; path: string[]; value?: unknown }) =>
				op[_JSONB_SYM] === 'del'
					? sql`${sql(col)} = ${sql(col)} #- ${`{${op.path.join(',')}}`}::text[]`
					: sql`${sql(col)} = jsonb_set(${sql(col)}, ${`{${op.path.join(',')}}`}::text[], ${JSON.stringify(op.value)}::jsonb)`
			)(val as { [_JSONB_SYM]: 'set' | 'del'; path: string[]; value?: unknown })
			: sql`${sql(col)} = ${pg.json(val)}`,
		);
		/** Build EXCLUDED column assignments for upsert */
		const $excluded = (keys: string[], only?: string[]) => {
			const excl = new Set([pkCol, ...keys]);
			return (only ?? Object.keys(cols).filter(col => !excl.has(col))).map(col => sql`${sql(col)} = EXCLUDED.${sql(col)}`);
		};
		// --- Upsert config ---------------------------------------------------
		const upsertCfg = config.conflict && { keys: config.conflict.keys, updates: $excluded(config.conflict.keys, config.conflict.only) };
		// --- Base repository + resolvers -------------------------------------
		const base = yield* Model.makeRepository(model, { idColumn: pkCol, spanPrefix: table, tableName: table });
		const resolverEntries = Object.entries(config.resolve ?? {}).map(([name, spec]) => {
			const isMany = typeof spec === 'string' && spec.startsWith('many:');
			const fields = isMany ? [spec.slice(5)] : Array.isArray(spec) ? spec : [spec];
			const $cf = fields.map(f => { const w = Field.predMeta(f).wrap; return w ? sql`${sql.literal(w)}(${sql(f)})` : sql`${sql(f)}`; });
			const wh = (keys: unknown[]) => fields.length === 1
				? sql`${$cf[0]} IN ${sql.in(keys)}`
				: sql.or((keys as Record<string, unknown>[]).map(rec => sql`(${sql.and(fields.map((col, idx) => sql`${$cf[idx]} = ${rec[col]}`))})`));
			const ex = (keys: unknown[]) => sql`SELECT * FROM ${sql(table)} WHERE ${wh(keys)}${$active}${$fresh}`;
			const schema = Field.from(fields, cols), extract = Field.from(fields);
			const resolver = isMany
				? SqlResolver.grouped(`${table}.${name}Grp`, { execute: ex, Request: schema, RequestGroupKey: (id: unknown) => id, Result: model, ResultGroupKey: extract, withContext: false })
				: SqlResolver.findById(`${table}.${name}`, { execute: ex, Id: schema, Result: model, ResultId: extract, withContext: false });
			return [name, resolver] as const;
		});
		const resolvers = yield* Effect.all(Object.fromEntries(resolverEntries));
		// --- Query methods ---------------------------------------------------
		const by = <K extends string & keyof NonNullable<C['resolve']>>(key: K, value: unknown) =>
			(resolvers[key]?.execute(value) ?? Effect.succeed(Option.none())) as Effect.Effect<
				NonNullable<C['resolve']>[K] extends `many:${string}` ? readonly S.Schema.Type<M>[] : Option.Option<S.Schema.Type<M>>,
				SqlError | ParseError
			>;
		const find = (pred: Pred | readonly Pred[], opts: { asc?: boolean } = {}) =>
			SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh} ${$order(opts.asc ?? false)}`, Request: S.Void, Result: model })(undefined);
		const one = (pred: Pred | readonly Pred[], lock: false | 'update' | 'share' | 'nowait' | 'skip' = false) =>
			SqlSchema.findOne({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}${$lock(lock)}`, Request: S.Void, Result: model })(undefined);
		const page = (pred: Pred | readonly Pred[], opts: { limit?: number; cursor?: string; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, cursor, asc = false } = opts;
			return Page.decode(cursor).pipe(Effect.flatMap(decoded => {
				const cursorFrag = Option.match(decoded, { onNone: () => sql``, onSome: cur => sql`AND ${sql(pkCol)} ${asc ? sql`>` : sql`<`} ${cur.id}${pkCast}` });
				return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals WHERE TRUE ${cursorFrag} ${$order(asc)} LIMIT ${limit + 1}`
					.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.keyset(items as unknown as readonly S.Schema.Type<M>[], total, limit, item => ({ id: (item as Record<string, unknown>)[pkCol] as string }), Option.isSome(decoded)); }));
			}));
		};
		const count = (pred: Pred | readonly Pred[]) =>
			sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`.pipe(Effect.map(([r]) => (r as { count: number }).count));
		const exists = (pred: Pred | readonly Pred[]) =>
			sql`SELECT EXISTS(SELECT 1 FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}) AS exists`.pipe(Effect.map(([r]) => (r as { exists: boolean }).exists));
		const agg = <T extends AggSpec>(pred: Pred | readonly Pred[], spec: T): Effect.Effect<AggResult<T>, SqlError | ParseError> =>
			sql`SELECT ${sql.csv(Object.entries(spec).map(([fn, col]) => fn === 'count' ? sql`COUNT(*)::int AS count` : sql`${sql.literal(fn.toUpperCase())}(${sql(col as string)})${fn === 'sum' || fn === 'avg' ? sql`::numeric` : sql``} AS ${sql(fn)}`))} FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`.pipe(Effect.map(([row]) => row as AggResult<T>));
		const pageOffset = (pred: Pred | readonly Pred[], opts: { limit?: number; offset?: number; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, offset: start = 0, asc = false } = opts;
			return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
				SELECT base.*, totals.total_count FROM base CROSS JOIN totals ${$order(asc)} LIMIT ${limit} OFFSET ${start}`
				.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.offset(items as unknown as readonly S.Schema.Type<M>[], total, start, limit); }));
		};
		// --- Mutation methods ------------------------------------------------
		const put = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, conflict?: { keys: string[]; only?: string[]; occ?: Date }) =>
			data == null ? Effect.fail(new RepoConfigError({ message: 'data cannot be null or undefined', operation: 'put', table }))
			: ((isArr: boolean, items: readonly S.Schema.Type<typeof model.insert>[]) =>
				items.length === 0 ? Effect.succeed(isArr ? [] as S.Schema.Type<M>[] : undefined)
				: conflict ? ((updates: Statement.Fragment[], occCheck: Statement.Fragment) =>
					SqlSchema.single({ execute: (row) =>
						sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(conflict.keys)}) DO UPDATE SET ${sql.csv(updates)}${$touch}${occCheck} RETURNING *`,
						Request: model.insert, Result: model })(items[0])
						.pipe(Effect.flatMap(row => conflict.occ && !row ? Effect.fail(new RepoOccError({ expected: conflict.occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table })) : Effect.succeed(isArr ? [row] : row)))
				)($excluded(conflict.keys, conflict.only), conflict.occ ? sql` WHERE ${sql(table)}.updated_at = ${conflict.occ}` : sql``) : SqlSchema.findAll({ execute: (rows) =>
					sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
					.pipe(Effect.map(rows => isArr ? rows : rows[0]))
			)(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly S.Schema.Type<typeof model.insert>[]);
		/** Polymorphic update: single → T, bulk → count. Optional guard predicate for conditional updates. */
		const set = (input: string | [string, unknown] | Pred | readonly Pred[], updates: Record<string, unknown>, scope?: Record<string, unknown>, when?: Pred | readonly Pred[]) =>
			((entries: Statement.Fragment[], $pred: Statement.Fragment, single: boolean, $guard: Statement.Fragment, $s: Statement.Fragment) =>
				Match.value({ op: entries.length > 0, single }).pipe(
					Match.when({ op: false, single: true }, () => (when ? SqlSchema.findOne : SqlSchema.single)({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$pred}${$s}${$active}${$guard}`, Request: S.Void, Result: model })(undefined)),
					Match.when({ op: false, single: false }, () => sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$pred}${$s}${$active}${$guard}`.pipe(Effect.map(([r]) => (r as { count: number }).count))),
					Match.when({ op: true, single: true }, () => (when ? SqlSchema.findOne : SqlSchema.single)({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$s}${$active}${$guard} RETURNING *`, Request: S.Void, Result: model })(undefined)),
					Match.when({ op: true, single: false }, () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$s}${$active}${$guard} RETURNING 1`.pipe(Effect.map(rows => rows.length))),
					Match.exhaustive,
				)
			)($entries(updates), $input(input), _isSingle(input), when ? sql` AND ${$where(when)}` : sql``, $scope(scope));
		/** Conditional update: applies only when guard predicate holds. Alias for set with guard. */
		const setIf = (target: string | [string, unknown], updates: Record<string, unknown>, when: Pred | readonly Pred[], scope?: Record<string, unknown>) => set(target, updates, scope, when);
		// --- Soft delete methods (fail with tagged error if not configured) ----
		const _makeSoft = (ts: Statement.Fragment, guard: Statement.Fragment) => ((input: string | readonly string[] | Pred | readonly Pred[], scope?: Record<string, unknown>) =>
			softEntry ? ((col: string) =>
				typeof input === 'string'
					? SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${$target(input)}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
					: sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${Array.isArray(input) && input.length > 0 && typeof input[0] === 'string' ? sql`${sql(pkCol)} IN ${sql.in(input as string[])}` : $where(input as Pred | readonly Pred[])}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING 1`.pipe(Effect.map(rows => rows.length))
			)(softEntry.col) : Effect.fail(new RepoConfigError({ message: 'soft delete column not configured', operation: 'drop', table }))
		) as {
			(input: string, scope?: Record<string, unknown>): Effect.Effect<S.Schema.Type<M>, SqlError | ParseError | Cause.NoSuchElementException | RepoConfigError>;
			(input: readonly string[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError>;
			(input: Pred | readonly Pred[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError>;
		};
		const drop = _makeSoft(sql`NOW()`, sql`IS NULL`);
		const lift = _makeSoft(sql`NULL`, sql`IS NOT NULL`);
		// --- Purge method (fail with tagged error if not configured) ---------
		const purge = (days = 30) => {
			const purgeFn = config.purge;
			return purgeFn
				? SqlSchema.single({ execute: (num) => sql`SELECT ${sql.literal(purgeFn)}(${num}) AS count`, Request: S.Number, Result: _CountSchema })(days).pipe(Effect.map(row => row.count))
				: Effect.fail(new RepoConfigError({ message: 'purge function not configured', operation: 'purge', table }));
		};
		// --- Upsert method (fail with tagged error if not configured) --------
		/** Polymorphic upsert: single → T, batch → T[] (mirrors input shape). Fails with RepoOccError if OCC check fails. */
		const upsert = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, occ?: Date) =>
			upsertCfg ? data == null ? Effect.fail(new RepoConfigError({ message: 'data cannot be null or undefined', operation: 'upsert', table }))
			: ((isArr: boolean, items: readonly S.Schema.Type<typeof model.insert>[]) =>
				items.length === 0 ? Effect.succeed(isArr ? [] as S.Schema.Type<M>[] : undefined)
				: items.length === 1 ? ((occCheck: Statement.Fragment) =>
					SqlSchema.findOne({ execute: (row) =>
						sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(upsertCfg.keys)}) DO UPDATE SET ${sql.csv(upsertCfg.updates)}${$touch}${occCheck} RETURNING *`,
						Request: model.insert, Result: model })(items[0])
						.pipe(Effect.flatMap(opt => Option.match(opt, {
							onNone: () => Effect.fail((occ ? new RepoOccError({ expected: occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table }) : new RepoConfigError({ message: 'unexpected empty result', operation: 'upsert', table })) as RepoOccError | RepoConfigError),
							onSome: row => Effect.succeed((isArr ? [row] : row) as S.Schema.Type<M> | S.Schema.Type<M>[]),
						})))
				)(occ ? sql` WHERE ${sql(table)}.updated_at = ${occ}` : sql``)
				: SqlSchema.findAll({ execute: (rows) =>
					sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} ON CONFLICT (${sql.csv(upsertCfg.keys)}) DO UPDATE SET ${sql.csv(upsertCfg.updates)}${$touch} RETURNING *`,
					Request: S.Array(model.insert), Result: model })(items).pipe(Effect.map(rows => rows as S.Schema.Type<M>[]))
			)(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly S.Schema.Type<typeof model.insert>[]) : Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'upsert', table }));
		// --- Merge method (PG17+ MERGE with action tracking) -----------------
		// Cache column names for merge
		const _allColNames = Object.keys(cols);
		const _insertColNames = _allColNames.filter(c => c !== pkCol);
		/** MERGE with action tracking: returns row + _action ('insert' | 'update'). Polymorphic single/batch. */
		const merge = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined) =>
			upsertCfg ? data == null ? Effect.fail(new RepoConfigError({ message: 'data cannot be null or undefined', operation: 'merge', table }))
			: ((isArr: boolean, items: readonly Record<string, unknown>[], keys: string[], updateCols: string[]) =>
				items.length === 0 ? Effect.succeed(isArr ? [] as MergeResult<S.Schema.Type<M>>[] : undefined)
				: ((valuesList: Statement.Fragment[], sourceAlias: Statement.Fragment, matchCond: Statement.Fragment, updateSet: Statement.Fragment, insertCols: Statement.Fragment, insertVals: Statement.Fragment) =>
					sql`MERGE INTO ${sql(table)} USING (VALUES ${sql.csv(valuesList)}) AS ${sourceAlias}(${insertCols})
						ON ${matchCond}
						WHEN MATCHED THEN UPDATE SET ${updateSet}${$touch}
						WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})
						RETURNING *, (CASE WHEN xmax = 0 THEN 'insert' ELSE 'update' END) AS _action`
						.pipe(Effect.map(results => isArr ? results as MergeResult<S.Schema.Type<M>>[] : results[0] as MergeResult<S.Schema.Type<M>>))
				)(
					items.map(item => sql`(${sql.csv(_insertColNames.map(c => sql`${item[c]}`))})`),
					sql`source`,
					sql.and(keys.map(k => sql`${sql(table)}.${sql(k)} = source.${sql(k)}`)),
					sql.csv(updateCols.map(c => sql`${sql(c)} = source.${sql(c)}`)),
					sql.csv(_insertColNames.map(c => sql`${sql(c)}`)),
					sql.csv(_insertColNames.map(c => sql`source.${sql(c)}`)),
				)
			)(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly Record<string, unknown>[], upsertCfg.keys, _insertColNames.filter(c => !upsertCfg.keys.includes(c))) : Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'merge', table }));
		// --- Stream method (cursor-based iteration with schema validation) ---
		/** Stream rows via server-side cursor with schema validation. Memory-efficient for large datasets. */
		const stream = (pred: Pred | readonly Pred[], opts: { asc?: boolean } = {}): Stream.Stream<S.Schema.Type<M>, SqlError | ParseError> =>
			Stream.mapEffect(sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh} ${$order(opts.asc ?? false)}`.stream, S.decodeUnknown(model));
		// --- Custom function method (fail with tagged error if not configured)
		const fn = (name: string, params: Record<string, unknown>) =>
			config.fn ? config.fn[name] ? ((spec: NonNullable<typeof config.fn>[string]) =>
				SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${sql.csv(spec.args.map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`))}) AS count`, Request: spec.params, Result: _CountSchema })(params).pipe(Effect.map(row => row.count))
			)(config.fn[name]) : Effect.fail(new RepoUnknownFnError({ fn: name, table })) : Effect.fail(new RepoConfigError({ message: 'no functions configured', operation: 'fn', table }));
		// --- Transaction support ---------------------------------------------
		/** Run effect within a transaction. Caller controls the transaction boundary. */
		const withTransaction = sql.withTransaction;
		return {
			...base,
			agg, by, count, drop, exists, find, fn, lift, merge, one, page, pageOffset, pg,
			preds,purge, put, set, setIf, stream, upsert, withTransaction,
		};
	});

// --- [EXPORT] ----------------------------------------------------------------

export { repo, RepoConfigError, RepoOccError, RepoUnknownFnError, Update };
export type { AggSpec, Config, MergeResult, Pred };
