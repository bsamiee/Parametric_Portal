/**
 * Unified repository factory with polymorphic query/mutation API.
 * Single `resolve` config for lookups, predicate-based find/one/page/count.
 * Polymorphic single/bulk operations for drop/lift/set.
 */
import { Model, SqlClient, SqlResolver, SqlSchema, type Statement } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import type { SqlError } from '@effect/sql/SqlError';
import type { ParseError } from 'effect/ParseResult';
import { Array as A, type Cause, Data, Effect, Option, Record as R, Schema as S, Stream } from 'effect';
import { Field } from './field.ts';
import { Page } from './page.ts';

// --- [ERRORS] ----------------------------------------------------------------

class RepoConfigError extends Data.TaggedError('RepoConfigError')<{ table: string; operation: string; message: string }> {}
class RepoUnknownFnError extends Data.TaggedError('RepoUnknownFnError')<{ table: string; fn: string }> {}
class RepoOccError extends Data.TaggedError('RepoOccError')<{ table: string; pk: string; expected: Date }> {}

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
	fnSet?: Record<string, { args: (string | { field: string; cast: string })[]; params: S.Schema.AnyNoContext }>;
};
type Pred =
	| [string, unknown]
	| { field: string; value?: unknown; values?: unknown[]; op?: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'null' | 'notNull' | 'contains' | 'containedBy' | 'hasKey' | 'hasKeys' | 'tsGte' | 'tsLte'; cast?: string; wrap?: string }
	| { raw: Statement.Fragment };

// --- [CONSTANTS] -------------------------------------------------------------

class IncOp extends Data.TaggedClass('IncOp')<{ readonly delta: number }> {}
class JsonbSetOp extends Data.TaggedClass('JsonbSetOp')<{ readonly path: readonly string[]; readonly value: unknown }> {}
class JsonbDelOp extends Data.TaggedClass('JsonbDelOp')<{ readonly path: readonly string[] }> {}
const NowOp = Symbol('NowOp');
const Update = {
	inc: (delta = 1) => new IncOp({ delta }),
	jsonb: {
		del: (path: readonly string[]) => new JsonbDelOp({ path }),
		set: (path: readonly string[], value: unknown) => new JsonbSetOp({ path, value }),
	},
	now: NowOp,
};

// --- [FACTORY] ---------------------------------------------------------------

const repo = <M extends Model.AnyNoContext, const C extends Config<M>>(model: M, table: string, config: C = {} as C) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		const cols = model.fields as Record<string, S.Schema.AnyNoContext>;
		// Primary key config (default: 'id' with uuid cast)
		const { column: pkCol, cast: _pkCast } = config.pk ?? { cast: 'uuid', column: 'id' };
		const pkCast = _pkCast ? sql`::${sql.literal(_pkCast)}` : sql``;
		// Get entries via Field.pick (cap → first entry in model cols)
		const softEntry = Field.pick('mark:soft', cols);
		const expEntry = Field.pick('mark:exp', cols);
		const _insertCols = Object.keys(cols).filter(c => c !== pkCol && !(['uuidv7', 'virtual', 'stored'] as const).some(gen => Field.isGen(c, gen)));
		// --- SQL fragments ---------------------------------------------------
		const $active = softEntry ? sql` AND ${sql(softEntry.col)} IS NULL` : sql``;
		const $fresh = Option.fromNullable(expEntry).pipe(
			Option.match({
				onNone: () => sql``,
				onSome: (e) => e.null
					? sql` AND (${sql(e.col)} IS NULL OR ${sql(e.col)} > NOW())`
					: sql` AND ${sql(e.col)} > NOW()`
			})
		);
		const $touch = ((e) => e ? sql`, ${sql(e.col)} = NOW()` : sql``)(Field.pick('autoUpdate', cols));
		const $scope = (scope?: Record<string, unknown>) =>
			scope && !R.isEmptyRecord(scope) ? sql` AND ${sql.and(R.collect(scope, (c, v) => sql`${sql(c)} = ${v}`))}` : sql``;

		const $target = (target: string | [string, unknown]) => typeof target === 'string' ? sql`${sql(pkCol)} = ${target}${pkCast}` : sql`${sql(target[0])} = ${target[1]}`;
		const $lock = (lock: false | 'update' | 'share' | 'nowait' | 'skip') => ({ false: sql``, nowait: sql` FOR UPDATE NOWAIT`, share: sql` FOR SHARE`, skip: sql` FOR UPDATE SKIP LOCKED`, update: sql` FOR UPDATE` })[`${lock}`];
		const $order = (asc: boolean) => asc ? sql`ORDER BY ${sql(pkCol)} ASC` : sql`ORDER BY ${sql(pkCol)} DESC`;
		type OpCtx = { col: Statement.Fragment; value: unknown; values: unknown[]; $cast: string | undefined };
		const _cmp = (op: string) => ({ col, value, $cast }: OpCtx) => sql`${col} ${sql.literal(op)} ${value}${$cast ? sql`::${sql.literal($cast)}` : sql``}`;
		const _ops = {
			containedBy: ({ col, value }: OpCtx) => sql`${col} <@ ${value}::jsonb`,
			contains: ({ col, value }: OpCtx) => sql`${col} @> ${value}::jsonb`,
			eq: _cmp('='),
			gt: _cmp('>'),
			gte: _cmp('>='),
			hasKey: ({ col, value }: OpCtx) => sql`${col} ? ${value}`,
			hasKeys: ({ col, values }: OpCtx) => A.isNonEmptyArray(values) ? sql`${col} ?& ARRAY[${sql.csv(values.map(k => sql`${k}`))}]::text[]` : sql`TRUE`,
			in: ({ col, values }: OpCtx) => A.isNonEmptyArray(values) ? sql`${col} IN ${sql.in(values)}` : sql`FALSE`,
			lt: _cmp('<'),
			lte: _cmp('<='),
			notNull: ({ col }: OpCtx) => sql`${col} IS NOT NULL`,
			null: ({ col }: OpCtx) => sql`${col} IS NULL`,
			tsGte: ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) >= ${value}`,
			tsLte: ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) <= ${value}`,
		} as const satisfies Record<string, (ctx: OpCtx) => Statement.Fragment>;
		const _predToFragment = (p: Pred): Statement.Fragment =>
			'raw' in p ? p.raw
			: Array.isArray(p) ? sql`${sql(p[0])} = ${p[1]}`
			: ((({ field, op = 'eq', value, values = [], cast, wrap }) => {
				const { cast: metaCast, wrap: metaWrap } = Field.predMeta(field);
				const $cast = cast ?? metaCast, $wrap = wrap ?? metaWrap;
				const col = $wrap ? sql`${sql.literal($wrap)}(${sql(field)})` : sql`${sql(field)}`;
				return (_ops[op] ?? _ops.eq)({ $cast, col, value, values });
			})(p));
		const $where = (pred: Pred | readonly Pred[]): Statement.Fragment => {
			const isArr = Array.isArray(pred) && pred.length > 0 && !('field' in pred || 'raw' in pred || typeof pred[0] === 'string');
			return sql.and((isArr ? pred as readonly Pred[] : [pred] as readonly Pred[]).map(_predToFragment));
		};
		/** Type guard for single target (pk string or [col, val] tuple) vs bulk predicate */
		const _isSingleTarget = (i: string | Pred | readonly Pred[]): i is string | [string, unknown] => typeof i === 'string' || (Array.isArray(i) && i.length === 2 && typeof i[0] === 'string');
		/** Build predicates from filter object: after/before → UUIDv7 timestamp, arrays → IN, scalars → EQ */
		const _uuidv7Col = Field.pick('gen:uuidv7', cols)?.col;
		const preds = (filter: Record<string, unknown>): Pred[] =>
			R.reduce(filter, [] as Pred[], (acc, val, key) =>
				val === undefined || (Array.isArray(val) && !val.length) ? acc
				: _uuidv7Col && (key === 'after' || key === 'before') ? [...acc, { field: _uuidv7Col, op: key === 'after' ? 'tsGte' : 'tsLte', value: val }]
				: Array.isArray(val) ? [...acc, { field: key, op: 'in', values: val }]
				: [...acc, { field: key, value: val }]
			);
		// --- Update entries with NOW/INC/JSONB support -----------------------
		const _entryToFragment = (col: string, val: unknown): Statement.Fragment =>
			val === NowOp ? sql`${sql(col)} = NOW()`
			: val instanceof IncOp ? sql`${sql(col)} = ${sql(col)} + ${val.delta}`
			: val instanceof JsonbDelOp ? sql`${sql(col)} = ${sql(col)} #- ${`{${val.path.join(',')}}`}::text[]`
			: val instanceof JsonbSetOp ? sql`${sql(col)} = jsonb_set(${sql(col)}, ${`{${val.path.join(',')}}`}::text[], ${JSON.stringify(val.value)}::jsonb)`
			: typeof val !== 'object' || val === null ? sql`${sql(col)} = ${val}`
			: sql`${sql(col)} = ${pg.json(val)}`;
		const $entries = (updates: Record<string, unknown>): Statement.Fragment[] => R.collect(updates, (col, val) => _entryToFragment(col, val));
		/** Build EXCLUDED column assignments for upsert */
		const $excluded = (keys: string[], only?: string[]) => (only ?? Object.keys(cols).filter(col => col !== pkCol && !keys.includes(col))).map(col => sql`${sql(col)} = EXCLUDED.${sql(col)}`);
		// --- Upsert config ---------------------------------------------------
		const upsertCfg = config.conflict && { keys: config.conflict.keys, updates: $excluded(config.conflict.keys, config.conflict.only) };
		// --- Base repository + resolvers -------------------------------------
		const base = yield* Model.makeRepository(model, { idColumn: pkCol, spanPrefix: table, tableName: table });
		const resolvers = yield* Effect.all(R.map(config.resolve ?? {}, (spec, name) => {
			const isMany = typeof spec === 'string' && spec.startsWith('many:');
			const fields = isMany ? [(spec as string).slice(5)] : Array.isArray(spec) ? spec : [spec as string];
			const $cf = fields.map(f => {
				const wrap = Field.predMeta(f).wrap;
				return wrap ? sql`${sql.literal(wrap)}(${sql(f)})` : sql`${sql(f)}`;
			});
			const ex = (keys: unknown[]) => {
				const wh = fields.length === 1
					? sql`${$cf[0]} IN ${sql.in(keys)}`
					: sql.or((keys as Record<string, unknown>[]).map(rec => sql`(${sql.and(fields.map((col, idx) => sql`${$cf[idx]} = ${rec[col]}`))})`));
				return sql`SELECT * FROM ${sql(table)} WHERE ${wh}${$active}${$fresh}`;
			};
			const schema = Field.from(fields, cols), extract = Field.from(fields);
			return isMany
				? SqlResolver.grouped(`${table}.${name}Grp`, { execute: ex, Request: schema, RequestGroupKey: (id: unknown) => id, Result: model, ResultGroupKey: extract, withContext: false })
				: SqlResolver.findById(`${table}.${name}`, { execute: ex, Id: schema, Result: model, ResultId: extract, withContext: false });
		}));
		// --- Query methods ---------------------------------------------------
		const by = <K extends string & keyof NonNullable<C['resolve']>>(key: K, value: unknown) =>
			(resolvers[key]?.execute(value) ?? Effect.succeed(Option.none())) as Effect.Effect<
				NonNullable<C['resolve']>[K] extends `many:${string}` ? readonly S.Schema.Type<M>[] : Option.Option<S.Schema.Type<M>>,
				SqlError | ParseError
			>;
		const find = (pred: Pred | readonly Pred[], opts: { asc?: boolean } = {}) => SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh} ${$order(opts.asc ?? false)}`, Request: S.Void, Result: model })(undefined);
		const one = (pred: Pred | readonly Pred[], lock: false | 'update' | 'share' | 'nowait' | 'skip' = false) => SqlSchema.findOne({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}${$lock(lock)}`, Request: S.Void, Result: model })(undefined);
		const page = (pred: Pred | readonly Pred[], opts: { limit?: number; cursor?: string; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, cursor, asc = false } = opts;
			return Page.decode(cursor).pipe(Effect.flatMap(decoded => {
				const cursorFrag = decoded._tag === 'None' ? sql`` : sql`AND ${sql(pkCol)} ${asc ? sql`>` : sql`<`} ${decoded.value.id}${pkCast}`;
				return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals WHERE TRUE ${cursorFrag} ${$order(asc)} LIMIT ${limit + 1}`
					.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.keyset(items as unknown as readonly S.Schema.Type<M>[], total, limit, item => ({ id: (item as Record<string, unknown>)[pkCol] as string }), Option.isSome(decoded)); }));
			}));
		};
		const count = (pred: Pred | readonly Pred[]) => sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`.pipe(Effect.map((rows): number => (rows[0] as { count: number }).count));
		const exists = (pred: Pred | readonly Pred[]) => sql`SELECT EXISTS(SELECT 1 FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}) AS exists`.pipe(Effect.map((rows): boolean => (rows[0] as { exists: boolean }).exists));
		const _aggToFragment = ([fn, col]: [string, unknown]) =>
			fn === 'count' ? sql`COUNT(*)::int AS count`
			: sql`${sql.literal(fn.toUpperCase())}(${sql(col as string)})${(fn === 'avg' || fn === 'sum') ? sql`::numeric` : sql``} AS ${sql.literal(fn)}`;
		const agg = <T extends AggSpec>(pred: Pred | readonly Pred[], spec: T): Effect.Effect<AggResult<T>, SqlError | ParseError> => sql`SELECT ${sql.csv(Object.entries(spec).map(_aggToFragment))} FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`.pipe(Effect.map(([row]) => row as AggResult<T>));
		const pageOffset = (pred: Pred | readonly Pred[], opts: { limit?: number; offset?: number; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, offset: start = 0, asc = false } = opts;
			return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
				SELECT base.*, totals.total_count FROM base CROSS JOIN totals ${$order(asc)} LIMIT ${limit} OFFSET ${start}`
				.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.offset(items as unknown as readonly S.Schema.Type<M>[], total, start, limit); }));
		};
		// --- Mutation helpers ------------------------------------------------
		const _withData = <T, E, R>(
			operation: string,
			data: T | readonly T[] | null | undefined,
			onEmpty: (isArr: boolean) => R,
			onData: (items: readonly T[], isArr: boolean) => Effect.Effect<R, E>
		): Effect.Effect<R, RepoConfigError | E> =>
			data == null ? Effect.fail(new RepoConfigError({ message: 'data cannot be null or undefined', operation, table }))
			: ((isArr, items) => items.length === 0 ? Effect.succeed(onEmpty(isArr)) : onData(items, isArr))(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly T[]);
		// --- Mutation methods ------------------------------------------------
		const put = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[] | undefined, RepoConfigError | RepoOccError | SqlError | ParseError | Cause.NoSuchElementException> =>
			_withData(
				'put', data,
				(isArr) => isArr ? [] as S.Schema.Type<M>[] : undefined,
				(items, isArr) => conflict
					? SqlSchema.single({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(conflict.keys)}) DO UPDATE SET ${sql.csv($excluded(conflict.keys, conflict.only))}${$touch}${conflict.occ ? sql` WHERE ${sql(table)}.updated_at = ${conflict.occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(items[0])
						.pipe(Effect.flatMap(row => conflict.occ && !row ? Effect.fail(new RepoOccError({ expected: conflict.occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table })) : Effect.succeed(isArr ? [row] : row)))
					: SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
						.pipe(Effect.map(rows => isArr ? rows : rows[0]))
			);
		/** Polymorphic update: single → T, bulk → count. Optional guard predicate for conditional updates. */
		const set = (input: string | [string, unknown] | Pred | readonly Pred[], updates: Record<string, unknown>, scope?: Record<string, unknown>, when?: Pred | readonly Pred[]) => {
			const single = _isSingleTarget(input);
			const entries = $entries(updates), $pred = single ? $target(input) : $where(input as Pred | readonly Pred[]), $s = $scope(scope);
			const $guard = when ? sql` AND ${$where(when)}` : sql``;
			const schema = when === undefined ? SqlSchema.single : SqlSchema.findOne;
			return A.isNonEmptyArray(entries)
				? single
					? schema({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$s}${$active}${$guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
					: sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$s}${$active}${$guard} RETURNING 1`.pipe(Effect.map(rows => rows.length))
				: single
					? schema({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$pred}${$s}${$active}${$guard}`, Request: S.Void, Result: model })(undefined)
					: sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$pred}${$s}${$active}${$guard}`.pipe(Effect.map((rows): number => (rows[0] as { count: number }).count));
		};
		// --- Soft delete methods (fail with tagged error if not configured) ----
		type SoftDeleteResult = {
			(input: string, scope?: Record<string, unknown>): Effect.Effect<S.Schema.Type<M>, SqlError | ParseError | Cause.NoSuchElementException | RepoConfigError>;
			(input: readonly string[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError>;
			(input: Pred | readonly Pred[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError>;
		};
		type SoftOp = 'drop' | 'lift';
		const _softOps = { drop: { guard: sql`IS NULL`, ts: sql`NOW()` }, lift: { guard: sql`IS NOT NULL`, ts: sql`NULL` } } as const satisfies Record<SoftOp, { guard: Statement.Fragment; ts: Statement.Fragment }>;
		const _soft = (op: SoftOp) => (input: string | readonly string[] | Pred | readonly Pred[], scope?: Record<string, unknown>) =>
			softEntry
				? ((entry) => {
					const { ts, guard } = _softOps[op], col = entry.col;
					return typeof input === 'string'
						? SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${$target(input)}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
						: sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${Array.isArray(input) && input.length > 0 && typeof input[0] === 'string' ? sql`${sql(pkCol)} IN ${sql.in(input as string[])}` : $where(input as Pred | readonly Pred[])}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING 1`.pipe(Effect.map(rows => rows.length));
				})(softEntry)
				: Effect.fail(new RepoConfigError({ message: 'soft delete column not configured', operation: op, table }));
		const drop = _soft('drop') as SoftDeleteResult;
		const lift = _soft('lift') as SoftDeleteResult;
		// --- Purge method (fail with tagged error if not configured) ---------
		const purge = (days = 30): Effect.Effect<number, RepoConfigError | SqlError | ParseError | Cause.NoSuchElementException> =>
			config.purge
				? ((fn) => SqlSchema.single({ execute: (num) => sql`SELECT ${sql.literal(fn)}(${num}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(days).pipe(Effect.map(row => row.count)))(config.purge)
				: Effect.fail(new RepoConfigError({ message: 'purge function not configured', operation: 'purge', table }));
		// --- Upsert method (fail with tagged error if not configured) --------
		/** Polymorphic upsert: single → T, batch → T[] (mirrors input shape). Fails with RepoOccError if OCC check fails. */
		const upsert = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, occ?: Date): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[] | undefined, RepoConfigError | RepoOccError | SqlError | ParseError> =>
			upsertCfg
				? _withData(
					'upsert', data,
					(isArr) => isArr ? [] as S.Schema.Type<M>[] : undefined,
					(items, isArr) => items.length === 1
						? SqlSchema.findOne({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(upsertCfg.keys)}) DO UPDATE SET ${sql.csv(upsertCfg.updates)}${$touch}${occ ? sql` WHERE ${sql(table)}.updated_at = ${occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(items[0])
							.pipe(Effect.flatMap(opt => Option.match(opt, {
								onNone: () => Effect.fail(occ ? new RepoOccError({ expected: occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table }) : new RepoConfigError({ message: 'unexpected empty result', operation: 'upsert', table })),
								onSome: row => Effect.succeed((isArr ? [row] : row) as S.Schema.Type<M> | S.Schema.Type<M>[]),
							})))
						: SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} ON CONFLICT (${sql.csv(upsertCfg.keys)}) DO UPDATE SET ${sql.csv(upsertCfg.updates)}${$touch} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
							.pipe(Effect.map(rows => rows as S.Schema.Type<M>[]))
				)
				: Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'upsert', table }));
		// --- Merge method (PG17+ MERGE with action tracking) -----------------
		/** MERGE with action tracking: returns row + _action ('insert' | 'update'). Polymorphic single/batch. */
		const merge = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined): Effect.Effect<MergeResult<S.Schema.Type<M>> | readonly MergeResult<S.Schema.Type<M>>[] | undefined, RepoConfigError | SqlError | ParseError> =>
			upsertCfg
				? _withData<Record<string, unknown>, SqlError | ParseError, MergeResult<S.Schema.Type<M>> | readonly MergeResult<S.Schema.Type<M>>[] | undefined>(
					'merge', data as Record<string, unknown> | readonly Record<string, unknown>[] | null | undefined,
					(isArr) => isArr ? [] as MergeResult<S.Schema.Type<M>>[] : undefined,
					(items, isArr) => sql`MERGE INTO ${sql(table)} USING (VALUES ${sql.csv(items.map(item => sql`(${sql.csv(_insertCols.map(c => sql`${item[c]}`))})`))} ) AS source(${sql.csv(_insertCols.map(c => sql`${sql(c)}`))})
						ON ${sql.and(upsertCfg.keys.map(k => sql`${sql(table)}.${sql(k)} = source.${sql(k)}`))}
						WHEN MATCHED THEN UPDATE SET ${sql.csv(_insertCols.filter(c => !upsertCfg.keys.includes(c)).map(c => sql`${sql(c)} = source.${sql(c)}`))}${$touch}
						WHEN NOT MATCHED THEN INSERT (${sql.csv(_insertCols.map(c => sql`${sql(c)}`))}) VALUES (${sql.csv(_insertCols.map(c => sql`source.${sql(c)}`))})
						RETURNING *, (CASE WHEN xmax = 0 THEN 'insert' ELSE 'update' END) AS _action`
						.pipe(Effect.map(results => isArr ? results as MergeResult<S.Schema.Type<M>>[] : results[0] as MergeResult<S.Schema.Type<M>>))
				)
				: Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'merge', table }));
		// --- Stream method (cursor-based iteration with schema validation) ---
		/** Stream rows via server-side cursor with schema validation. Memory-efficient for large datasets. */
		const stream = (pred: Pred | readonly Pred[], opts: { asc?: boolean } = {}): Stream.Stream<S.Schema.Type<M>, SqlError | ParseError> => Stream.mapEffect(sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh} ${$order(opts.asc ?? false)}`.stream, S.decodeUnknown(model));
		// --- Custom function methods (fail with tagged error if not configured)
		const fn = (name: string, params: Record<string, unknown>): Effect.Effect<number, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> =>
			config.fn?.[name]
				? ((spec) => {
					const args = sql.csv(spec.args.map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`));
					return SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${args}) AS count`, Request: spec.params, Result: S.Struct({ count: S.Int }) })(params).pipe(Effect.map(row => row.count));
				})(config.fn[name])
				: Effect.fail(config.fn ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no scalar functions configured', operation: 'fn', table }));
		const fnSet = (name: string, params: Record<string, unknown>): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoUnknownFnError | SqlError | ParseError> =>
			config.fnSet?.[name]
				? ((spec) => {
					const args = sql.csv(spec.args.map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`));
					return SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql.literal(name)}(${args})`, Request: spec.params, Result: model })(params);
				})(config.fnSet[name])
				: Effect.fail(config.fnSet ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no set functions configured', operation: 'fnSet', table }));
		// --- Transaction support ---------------------------------------------
		/** Run effect within a transaction. Caller controls the transaction boundary. */
		const withTransaction = sql.withTransaction;
		// --- JSON field helpers (for string columns storing typed JSON) -------
		const json = {
			/** Decode JSON string field from Option<Row> to Option<A>. Compose with `by`: by(...).pipe(Effect.flatMap(json.decode(...))) */
			decode: <A, I>(field: string, schema: S.Schema<A, I, never>) =>
				(opt: Option.Option<S.Schema.Type<M>>): Effect.Effect<Option.Option<A>, never, never> =>
					opt._tag === 'None' ? Effect.succeed(Option.none<A>()) : S.decodeUnknown(S.parseJson(schema))((opt.value as Record<string, unknown>)[field]).pipe(Effect.option),
			/** Encode typed value to JSON string. Compose with `upsert`: json.encode(...)(value).pipe(Effect.flatMap(v => upsert({...}))) */
			encode: <A, I>(schema: S.Schema<A, I, never>) =>
				(value: A): Effect.Effect<string, ParseError> => S.encode(S.parseJson(schema))(value),
		};
		return {
			...base,
			agg, by, count, drop, exists, find, fn, fnSet, json, lift, merge, one, page, pageOffset, pg,
			preds, purge, put, set, stream, upsert, withTransaction,
		};
	});

// --- [EXPORT] ----------------------------------------------------------------

export { repo, RepoConfigError, RepoOccError, RepoUnknownFnError, Update };
export type { AggSpec, Config, MergeResult, Pred };
