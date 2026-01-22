/**
 * Unified repository factory with polymorphic query/mutation API.
 * Single `resolve` config for lookups, predicate-based find/one/page/count.
 * Polymorphic single/bulk operations for drop/lift/set.
 */
import { Model, SqlClient, SqlResolver, SqlSchema, type Statement } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import type { SqlError } from '@effect/sql/SqlError';
import type { ParseError } from 'effect/ParseResult';
import { Effect, Option, Schema as S } from 'effect';
import { Field } from './field.ts';
import { Page } from './page.ts';

// --- [TYPES] -----------------------------------------------------------------

type Op = 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'null' | 'notNull' | 'contains' | 'containedBy' | 'hasKey' | 'hasKeys';
type AggResult<T extends AggSpec> = { [K in keyof T]: T[K] extends true ? number : T[K] extends string ? number : never };
type AggSpec = { sum?: string; avg?: string; min?: string; max?: string; count?: true };
type Lock = false | 'update' | 'share' | 'nowait' | 'skip';
type Target = string | [string, unknown];
type Scope = Record<string, unknown>;
type Config<M extends Model.AnyNoContext> = {
	resolve?: Record<string, Resolve<M>>;
	conflict?: { keys: (keyof M['fields'] & string)[]; only?: (keyof M['fields'] & string)[] };
	purge?: string;
	fn?: Record<string, { args: (string | { field: string; cast: string })[]; params: S.Schema.AnyNoContext }>;
};
type Resolve<M extends Model.AnyNoContext> =
	| (keyof M['fields'] & string)
	| (keyof M['fields'] & string)[]
	| `many:${keyof M['fields'] & string}`;
type Pred =
	| [string, unknown]
	| { field: string; value?: unknown; values?: unknown[]; op?: Op; cast?: string; wrap?: string }
	| { raw: Statement.Fragment };

// --- [CONSTANTS] -------------------------------------------------------------

const _CountSchema = S.Struct({ count: S.Int });
const _ExistsSchema = S.Struct({ exists: S.Boolean });
const _casefold = new Set<string>(Field['mark:casefold']);
const _INC_SYM = Symbol.for('repo:INC');
const _JSONB_SYM = Symbol.for('repo:JSONB');
const Update = {
	inc: (delta = 1) => ({ [_INC_SYM]: delta }),
	jsonb: {
		del: (path: string[]) => ({ [_JSONB_SYM]: 'del' as const, path }),
		set: (path: string[], value: unknown) => ({ [_JSONB_SYM]: 'set' as const, path, value }),
	},
	now: Symbol.for('repo:NOW'),
} as const;

// --- [HELPERS] ---------------------------------------------------------------

const _isSingle = (input: unknown): input is string | [string, unknown] => typeof input === 'string' || (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string');
const _isPredArray = (pred: Pred | readonly Pred[]): pred is readonly Pred[] => Array.isArray(pred) && !('field' in pred || 'raw' in pred || typeof pred[0] === 'string');
const _$count = Effect.map((rows: readonly unknown[]) => rows.length);

// --- [FACTORY] ---------------------------------------------------------------

const repo = <M extends Model.AnyNoContext>(model: M, table: string, config: Config<M> = {}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		const cols = model.fields as Record<string, S.Schema.AnyNoContext>;
		const { soft, time, exp } = Field.from(['soft', 'time', 'exp'] as const, cols);
		// --- SQL fragments ---------------------------------------------------
		const $active = soft ? sql` AND ${sql(soft)} IS NULL` : sql``;
		const $fresh = exp ? sql` AND ${sql(exp)} > NOW()` : sql``;
		const $touch = time ? sql`, ${sql(time)} = NOW()` : sql``;
		const $scope = (scope?: Scope) => scope ? sql` AND ${sql.and(Object.entries(scope).map(([col, val]) => sql`${sql(col)} = ${val}`))}` : sql``;
		const $target = (target: Target) => typeof target === 'string' ? sql`id = ${target}` : sql`${sql(target[0])} = ${target[1]}`;
		const $lock = (lock: Lock) => lock ? ({ nowait: sql` FOR UPDATE NOWAIT`, share: sql` FOR SHARE`, skip: sql` FOR UPDATE SKIP LOCKED`, update: sql` FOR UPDATE` })[lock] : sql``;
		// --- Predicate → Fragment --------------------------------------------
		const cmp = { containedBy: sql`<@`, contains: sql`@>`, eq: sql`=`, gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` } as const;
		const toFrag = (pred: Pred): Statement.Fragment =>
			'raw' in pred ? pred.raw
			: Array.isArray(pred) ? sql`${sql(pred[0])} = ${pred[1]}`
			: (({ field, op = 'eq', value, values = [], cast, wrap }) => {
				const col = wrap ? sql`${sql.literal(wrap)}(${sql(field)})` : sql`${sql(field)}`;
				const ops: Record<string, () => Statement.Fragment> = {
					containedBy: () => sql`${col} ${cmp.containedBy} ${value}::jsonb`,
					contains: () => sql`${col} ${cmp.contains} ${value}::jsonb`,
					hasKey: () => sql`${col} ? ${value}`,
					hasKeys: () => values.length === 0 ? sql`TRUE` : sql`${col} ?& ARRAY[${sql.csv(values.map(key => sql`${key}`))}]::text[]`,
					in: () => values.length === 0 ? sql`FALSE` : sql`${col} IN ${sql.in(values)}`,
					notNull: () => sql`${col} IS NOT NULL`,
					null: () => sql`${col} IS NULL`,
				};
				return ops[op]?.() ?? sql`${col} ${cmp[op as keyof typeof cmp]} ${value}${cast ? sql`::${sql.literal(cast)}` : sql``}`;
			})(pred);
		const $where = (pred: Pred | readonly Pred[]) => {
			const preds = _isPredArray(pred) ? pred : [pred];
			return preds.length > 0 ? sql.and(preds.map(toFrag)) : sql`TRUE`;
		};
		/** Convert single target or bulk predicate to WHERE fragment */
		const $input = (input: string | Pred | readonly Pred[]) => _isSingle(input) ? $target(input) : $where(input);
		// --- Update entries with NOW/INC/JSONB support -----------------------
		const $entries = (updates: Record<string, unknown>) => Object.entries(updates).map(([col, val]) =>
			val === Update.now ? sql`${sql(col)} = NOW()`
			: typeof val !== 'object' || val === null ? sql`${sql(col)} = ${val}`
			: _INC_SYM in val ? sql`${sql(col)} = ${sql(col)} + ${(val as { [_INC_SYM]: number })[_INC_SYM]}`
			: _JSONB_SYM in val ? ((op: { [_JSONB_SYM]: 'set' | 'del'; path: string[]; value?: unknown }) =>
				op[_JSONB_SYM] === 'del'
					? sql`${sql(col)} = ${sql(col)} #- ${`{${op.path.join(',')}}`}::text[]`
					: sql`${sql(col)} = jsonb_set(${sql(col)}, ${`{${op.path.join(',')}}`}::text[], ${JSON.stringify(op.value)}::jsonb)`
			)(val as { [_JSONB_SYM]: 'set' | 'del'; path: string[]; value?: unknown })
			: sql`${sql(col)} = ${pg.json(val)}` // Plain objects → pg.json() for JSONB
		);
		/** Build EXCLUDED column assignments for upsert */
		const $excluded = (keys: string[], only?: string[]) => {
			const excl = new Set(['id', ...keys]);
			return (only ?? Object.keys(cols).filter(col => !excl.has(col))).map(col => sql`${sql(col)} = EXCLUDED.${sql(col)}`);
		};
		// --- Upsert config ---------------------------------------------------
		const upsertCfg = config.conflict && { keys: config.conflict.keys, updates: $excluded(config.conflict.keys, config.conflict.only) };
		// --- Base repository + resolvers -------------------------------------
		const base = yield* Model.makeRepository(model, { idColumn: 'id', spanPrefix: table, tableName: table });
		const resolverEntries = Object.entries(config.resolve ?? {}).map(([name, spec]) => {
			const isMany = typeof spec === 'string' && spec.startsWith('many:');
			const fields = isMany ? [spec.slice(5)] : Array.isArray(spec) ? spec : [spec];
			// Auto-detect casefold transform from Field registry - $cf returns column fragment with optional casefold wrap
			const $cf = fields.map(field => _casefold.has(field) ? sql`casefold(${sql(field)})` : sql`${sql(field)}`);
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
		// biome-ignore lint/suspicious/noExplicitAny: resolver signatures vary
		const by = (key: string, value: unknown): Effect.Effect<any, SqlError | ParseError> =>
			resolvers[key]?.execute(value) ?? Effect.succeed(Option.none());
		const find = (pred: Pred | readonly Pred[], opts: { asc?: boolean } = {}) => {
			const { asc = false } = opts;
			const $order = asc ? sql`ORDER BY id ASC` : sql`ORDER BY id DESC`;
			return SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh} ${$order}`, Request: S.Void, Result: model })(undefined);
		};
		const one = (pred: Pred | readonly Pred[], lock: Lock = false) =>
			SqlSchema.findOne({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}${$lock(lock)}`, Request: S.Void, Result: model })(undefined);
		const page = (pred: Pred | readonly Pred[], opts: { limit?: number; cursor?: string; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, cursor, asc = false } = opts;
			return Page.decode(cursor).pipe(Effect.flatMap(decoded => {
				const $cmp = asc ? sql`>` : sql`<`;
				const $order = asc ? sql`ORDER BY id ASC` : sql`ORDER BY id DESC`;
				const cursorFrag = Option.match(decoded, { onNone: () => sql``, onSome: cur => sql`AND id ${$cmp} ${cur.id}::uuid` });
				return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
					SELECT base.*, totals.total_count FROM base CROSS JOIN totals WHERE TRUE ${cursorFrag} ${$order} LIMIT ${limit + 1}`
					.pipe(Effect.map(rows => {
						const { items, total } = Page.strip(rows as readonly { totalCount: number }[]);
						return Page.keyset(items as unknown as readonly S.Schema.Type<M>[], total, limit, (item) => ({ id: (item as { id: string }).id }), Option.isSome(decoded));
					}));
			}));
		};
		const count = (pred: Pred | readonly Pred[]) =>
			SqlSchema.single({ execute: () => sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`, Request: S.Void, Result: _CountSchema })(undefined)
				.pipe(Effect.map(row => row.count));
		const exists = (pred: Pred | readonly Pred[]) =>
			SqlSchema.single({ execute: () => sql`SELECT EXISTS(SELECT 1 FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}) AS exists`, Request: S.Void, Result: _ExistsSchema })(undefined)
				.pipe(Effect.map(row => row.exists));
		const agg = <T extends AggSpec>(pred: Pred | readonly Pred[], spec: T): Effect.Effect<AggResult<T>, SqlError | ParseError> => {
			const selects = Object.entries(spec).map(([aggName, colName]) =>
				aggName === 'count' ? sql`COUNT(*)::int AS count`
				: ((fnSql, col, alias) => aggName === 'sum' || aggName === 'avg' ? sql`${fnSql}(${col})::numeric AS ${alias}` : sql`${fnSql}(${col}) AS ${alias}`)(sql.literal(aggName.toUpperCase()), sql(colName as string), sql(aggName))
			);
			return sql`SELECT ${sql.csv(selects)} FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}`.pipe(Effect.map(([row]) => row as AggResult<T>));
		};
		const pageOffset = (pred: Pred | readonly Pred[], opts: { limit?: number; offset?: number; asc?: boolean } = {}) => {
			const { limit = Page.bounds.default, offset: start = 0, asc = false } = opts;
			const $order = asc ? sql`ORDER BY id ASC` : sql`ORDER BY id DESC`;
			return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(pred)}${$active}${$fresh}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
				SELECT base.*, totals.total_count FROM base CROSS JOIN totals ${$order} LIMIT ${limit} OFFSET ${start}`
				.pipe(Effect.map(rows => {
					const { items, total } = Page.strip(rows as readonly { totalCount: number }[]);
					return Page.offset(items as unknown as readonly S.Schema.Type<M>[], total, start, limit);
				}));
		};
		// --- Mutation methods ------------------------------------------------
		const put = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[], conflict?: { keys: string[]; only?: string[]; occ?: Date }) =>
			((isArray, items) =>
				items.length === 0 ? Effect.succeed(isArray ? [] : undefined)
				: conflict ? ((updates, occCheck) => SqlSchema.single({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(conflict.keys)}) DO UPDATE SET ${sql.csv(updates)}${$touch}${occCheck} RETURNING *`, Request: model.insert, Result: model })(items[0]).pipe(Effect.map(row => isArray ? [row] : row)))($excluded(conflict.keys, conflict.only), conflict.occ ? sql` WHERE ${sql(table)}.updated_at = ${conflict.occ}` : sql``) : SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} RETURNING *`, Request: S.Array(model.insert), Result: model })(items as S.Schema.Type<typeof model.insert>[]).pipe(Effect.map(rows => isArray ? rows : rows[0]))
			)(Array.isArray(data), Array.isArray(data) ? data : [data]);
		/** Polymorphic update: single → T, bulk → count */
		const set = (input: string | Target | Pred | readonly Pred[], updates: Record<string, unknown>, scope?: Scope) =>
			((entries, $pred, single) =>
				entries.length === 0
					? single
						? SqlSchema.single({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$pred}${$scope(scope)}${$active}`, Request: S.Void, Result: model })(undefined)
						: SqlSchema.single({ execute: () => sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$pred}${$scope(scope)}${$active}`, Request: S.Void, Result: _CountSchema })(undefined).pipe(Effect.map(row => row.count))
					: single
						? SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$scope(scope)}${$active} RETURNING *`, Request: S.Void, Result: model })(undefined)
						: sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$scope(scope)}${$active} RETURNING 1`.pipe(_$count)
			)($entries(updates), $input(input), _isSingle(input));
		/** Conditional update: applies only when guard predicate holds (e.g., idempotent verify). Single-target only, returns T. */
		const setIf = (target: Target, updates: Record<string, unknown>, when: Pred | readonly Pred[], scope?: Scope) => {
			const entries = $entries(updates), $pred = $target(target), $guard = sql` AND ${$where(when)}`;
			return entries.length === 0
				? SqlSchema.findOne({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$pred}${$scope(scope)}${$active}${$guard}`, Request: S.Void, Result: model })(undefined)
				: SqlSchema.findOne({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$pred}${$scope(scope)}${$active}${$guard} RETURNING *`, Request: S.Void, Result: model })(undefined);
		};
		// --- Build return object ---------------------------------------------
		return {
			...base, agg, by, count, exists, find, one, page, pageOffset, pg, put, set, setIf,
			...(soft && ((softCol => {
				const $soft = (input: string | Pred | readonly Pred[], scope: Scope | undefined, timestamp: Statement.Fragment, guard: Statement.Fragment) => {
					const $pred = $input(input);
					return _isSingle(input)
						? SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql(softCol)} = ${timestamp}${$touch} WHERE ${$pred}${$scope(scope)} AND ${sql(softCol)} ${guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
						: sql`UPDATE ${sql(table)} SET ${sql(softCol)} = ${timestamp}${$touch} WHERE ${$pred}${$scope(scope)} AND ${sql(softCol)} ${guard} RETURNING 1`.pipe(_$count);
				};
				return {
					drop: (input: string | Pred | readonly Pred[], scope?: Scope) => $soft(input, scope, sql`NOW()`, sql`IS NULL`),
					lift: (input: string | Pred | readonly Pred[], scope?: Scope) => $soft(input, scope, sql`NULL`, sql`IS NOT NULL`),
				};
			})(soft))),
			...(config.purge && ((purgeFn) => ({
				purge: (days = 30) => SqlSchema.single({ execute: (num) => sql`SELECT ${sql.literal(purgeFn)}(${num}) AS count`, Request: S.Number, Result: _CountSchema })(days).pipe(Effect.map(row => row.count)),
			}))(config.purge)),
			...(upsertCfg && {
				upsert: (data: S.Schema.Type<typeof model.insert>, occ?: Date) =>
					SqlSchema.single({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(upsertCfg.keys)}) DO UPDATE SET ${sql.csv(upsertCfg.updates)}${$touch}${occ ? sql` WHERE ${sql(table)}.updated_at = ${occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(data),
			}),
			...(config.fn && ((fns => ({
				fn: (name: string, params: Record<string, unknown>) =>
					((spec) => spec
						? ((args) => SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${sql.csv(args)}) AS count`, Request: spec.params, Result: _CountSchema })(params).pipe(Effect.map(row => row.count)))(spec.args.map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`)) : Effect.fail(new Error(`Unknown fn: ${name}`))
					)(fns[name]),
			}))(config.fn))),
		};
	});

// --- [EXPORT] ----------------------------------------------------------------

export { repo, Update };
export type { AggSpec, Config, Lock, Op, Pred, Resolve, Scope, Target };
