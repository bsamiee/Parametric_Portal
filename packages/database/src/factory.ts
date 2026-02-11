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
import { Client } from './client.ts';
import { Field } from './field.ts';
import { Page } from './page.ts';

// --- [ERRORS] ----------------------------------------------------------------

class RepoConfigError extends Data.TaggedError('RepoConfigError')<{ table: string; operation: string; message: string }> {}
class RepoUnknownFnError extends Data.TaggedError('RepoUnknownFnError')<{ table: string; fn: string }> {}
class RepoOccError extends Data.TaggedError('RepoOccError')<{ table: string; pk: string; expected: Date }> {}
class RepoScopeError extends Data.TaggedError('RepoScopeError')<{ table: string; operation: string; reason: 'tenant_missing'; scopedField: string; tenantId: string }> {}

// --- [TYPES] -----------------------------------------------------------------

type AggResult<T extends AggSpec> = { [K in keyof T]: T[K] extends true ? number : T[K] extends string ? number : never };
type AggSpec = { sum?: string; avg?: string; min?: string; max?: string; count?: true };
type MergeResult<T> = T & { readonly _action: 'insert' | 'update' };
type SqlCast = typeof Field.sqlCast[keyof typeof Field.sqlCast];
type FnConfig = { args?: readonly (string | { field: string; cast: SqlCast })[]; params?: S.Schema.AnyNoContext };
type Config<M extends Model.AnyNoContext> = {
	pk?: { column: string; cast?: SqlCast };
	scoped?: keyof M['fields'] & string;
	resolve?: Record<string, keyof M['fields'] & string | (keyof M['fields'] & string)[] | `many:${keyof M['fields'] & string}`>;
	conflict?: { keys: (keyof M['fields'] & string)[]; only?: (keyof M['fields'] & string)[] };
	purge?: string;
	fn?: Record<string, FnConfig>;
	fnSet?: Record<string, FnConfig>;
	fnTyped?: Record<string, FnConfig & { schema: S.Schema.AnyNoContext }>;
};
type RoutineConfig = {
	fn?: Record<string, FnConfig>;
	fnSet?: Record<string, FnConfig & { schema: S.Schema.AnyNoContext }>;
	fnTyped?: Record<string, FnConfig & { schema: S.Schema.AnyNoContext }>;
};
type Pred =
	| [string, unknown]
	| { field: string; value?: unknown; values?: unknown[]; op?: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'null' | 'notNull' | 'contains' | 'containedBy' | 'hasKey' | 'hasKeys' | 'tsGte' | 'tsLte' | 'like'; cast?: SqlCast; wrap?: 'casefold' }
	| { raw: Statement.Fragment };

// --- [CONSTANTS] -------------------------------------------------------------

class IncOp extends Data.TaggedClass('IncOp')<{ readonly delta: number }> {}
class JsonbSetOp extends Data.TaggedClass('JsonbSetOp')<{ readonly path: readonly string[]; readonly value: unknown }> {}
class JsonbDelOp extends Data.TaggedClass('JsonbDelOp')<{ readonly path: readonly string[] }> {}
const NowOp = Symbol('NowOp');
const Update = {
	inc: (delta = 1) => new IncOp({ delta }),
	jsonb: { del: (path: readonly string[]) => new JsonbDelOp({ path }), set: (path: readonly string[], value: unknown) => new JsonbSetOp({ path, value }) },
	now: NowOp,
};
const _EMPTY_FN_PARAMS = S.Struct({});
const _fnArgs = (sql: SqlClient.SqlClient, spec: { args?: FnConfig['args'] }, params: Record<string, unknown>) =>
	sql.csv((spec.args ?? []).map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`));

// --- [FACTORY] ---------------------------------------------------------------

const repo = <M extends Model.AnyNoContext, const C extends Config<M>>(model: M, table: string, config: C = {} as C) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const pg = yield* PgClient.PgClient;
		const cols = model.fields as Record<string, S.Schema.AnyNoContext>;
		const { column: pkCol, cast: _pkCast } = config.pk ?? { cast: 'uuid', column: 'id' };
		const pkCast = _pkCast ? sql`::${sql.literal(_pkCast)}` : sql``;
		const softEntry = Field.pick('mark:soft', cols);
		const expEntry = Field.pick('mark:exp', cols);
		const _insertCols = Object.keys(cols).filter(column => column !== pkCol && !(['uuidv7', 'stored'] as const).some(gen => Field.isGen(column, gen)));
		// --- SQL fragments ---------------------------------------------------
		const $active = softEntry ? sql` AND ${sql(softEntry.col)} IS NULL` : sql``;
		const $fresh = Option.fromNullable(expEntry).pipe(Option.match({ onNone: () => sql``, onSome: (e) => e.null ? sql` AND (${sql(e.col)} IS NULL OR ${sql(e.col)} > NOW())` : sql` AND ${sql(e.col)} > NOW()` }));
		const $touch = ((e) => e ? sql`, ${sql(e.col)} = NOW()` : sql``)(Field.pick('autoUpdate', cols));
		const $scope = (scope?: Record<string, unknown>) => scope && !R.isEmptyRecord(scope) ? sql` AND ${sql.and(R.collect(scope, (column, value) => sql`${sql(column)} = ${value}`))}` : sql``; // NOSONAR S3358
		const $target = (target: string | [string, unknown]) => typeof target === 'string' ? sql`${sql(pkCol)} = ${target}${pkCast}` : sql`${sql(target[0])} = ${target[1]}`;
		const $lock = (lock: false | 'update' | 'share' | 'nowait' | 'skip') => ({ false: sql``, nowait: sql` FOR UPDATE NOWAIT`, share: sql` FOR SHARE`, skip: sql` FOR UPDATE SKIP LOCKED`, update: sql` FOR UPDATE` })[`${lock}`];
			const $order = (asc: boolean) => asc ? sql`ORDER BY ${sql(pkCol)} ASC` : sql`ORDER BY ${sql(pkCol)} DESC`;
			const _scopeOpt = Option.fromNullable(config.scoped).pipe(Option.flatMap((field) => Option.fromNullable(Field.resolve(field))), Option.map((entry) => entry.col));
			const _tenantScope = (operation: string, scopeCol: string) => (tenantId: string) => ({ [Client.tenant.Id.system]: Effect.succeed(sql``), [Client.tenant.Id.unspecified]: Effect.fail(new RepoScopeError({ operation, reason: 'tenant_missing', scopedField: scopeCol, table, tenantId })) } as Record<string, Effect.Effect<Statement.Fragment, RepoScopeError>>)[tenantId] ?? Effect.succeed(sql` AND ${sql(scopeCol)} = ${tenantId}`); // NOSONAR S3358
			const _withTenantContext = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | RepoScopeError | SqlError, R> =>
				Option.match(_scopeOpt, {
					onNone: () => effect,
					onSome: (scopeCol) => Effect.all([Client.tenant.current, Client.tenant.inSqlContext]).pipe(
						Effect.flatMap(([tenantId, inSqlContext]) =>
							_tenantScope(operation, scopeCol)(tenantId).pipe(
								Effect.andThen(
									tenantId === Client.tenant.Id.system || inSqlContext
										? effect
										: sql.withTransaction(
											sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.pipe(
												Effect.andThen(effect),
												Effect.provideService(SqlClient.SqlClient, sql),
											),
										),
								),
							),
						),
					),
				});
			const _autoScope = (operation: string): Effect.Effect<Statement.Fragment, RepoScopeError> => Option.match(_scopeOpt, { onNone: () => Effect.succeed(sql``), onSome: (scopeCol) => Effect.andThen(Client.tenant.current, _tenantScope(operation, scopeCol)) });
		type OpCtx = { col: Statement.Fragment; value: unknown; values: unknown[]; $cast: SqlCast | undefined };
		const _cmp = (op: string) => ({ col, value, $cast }: OpCtx) => {
			const castFrag = ($cast && sql`::${sql.literal($cast)}`) || sql``;
			return sql`${col} ${sql.literal(op)} ${value}${castFrag}`;
		};
		const _ops = {
			containedBy: ({ col, value }: OpCtx) => sql`${col} <@ ${value}::jsonb`,
			contains: ({ col, value }: OpCtx) => sql`${col} @> ${value}::jsonb`,
			eq: _cmp('='), gt: _cmp('>'), gte: _cmp('>='),
			hasKey: ({ col, value }: OpCtx) => sql`${col} ? ${value}`,
			hasKeys: ({ col, values }: OpCtx) => {
				const csvFrag = sql.csv(values.map((key) => sql`${key}`));
				return Option.match(A.head(values), {
					onNone: () => sql`TRUE`,
					onSome: () => sql`${col} ?& ARRAY[${csvFrag}]::text[]`,
				});
			},
			in: ({ col, values }: OpCtx) => A.isNonEmptyArray(values) ? sql`${col} IN ${sql.in(values)}` : sql`FALSE`,
			like: _cmp('LIKE'),
			lt: _cmp('<'),
			lte: _cmp('<='),
			notNull: ({ col }: OpCtx) => sql`${col} IS NOT NULL`, null: ({ col }: OpCtx) => sql`${col} IS NULL`,
			tsGte: ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) >= ${value}`,
			tsLte: ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) <= ${value}`,
		} as const satisfies Record<string, (ctx: OpCtx) => Statement.Fragment>;
			const $pred = (p: Pred): Statement.Fragment => {
				const _handleObj = (pred: { field: string; value?: unknown; values?: unknown[]; op?: keyof typeof _ops; cast?: SqlCast; wrap?: string }) => {
					const { field, op = 'eq', value, values = [], cast, wrap } = pred;
					const { cast: metaCast, wrap: metaWrap } = Field.predMeta(field);
					const $cast = cast ?? metaCast;
					const $wrap = wrap ?? metaWrap;
					const col = $wrap ? sql`${sql.literal($wrap)}(${sql(field)})` : sql`${sql(field)}`;
					return (_ops[op] ?? _ops.eq)({ $cast, col, value, values });
				};
				const kind: 'obj' | 'raw' | 'tuple' = ('raw' in p && 'raw') || (Array.isArray(p) && 'tuple') || 'obj';
				const dispatch = {
					obj: () => _handleObj(p as Parameters<typeof _handleObj>[0]),
					raw: () => (p as { raw: Statement.Fragment }).raw,
					tuple: () => sql`${sql((p as [string, unknown])[0])} = ${(p as [string, unknown])[1]}`,
				} satisfies Record<typeof kind, () => Statement.Fragment>;
				return dispatch[kind]();
			};
			const _asPredArray = (pred: Pred | readonly Pred[]): readonly Pred[] => Array.isArray(pred) && !(pred.length === 2 && typeof pred[0] === 'string')
				? pred as readonly Pred[]
				: [pred as Pred];
			const $where = (pred: Pred | readonly Pred[]): Statement.Fragment => {
				const predicates = _asPredArray(pred);
				return Option.match(A.head(predicates), {
					onNone: () => sql`TRUE`,
					onSome: () => sql.and(predicates.map($pred)),
				});
			};
		const _isSingle = (input: string | Pred | readonly Pred[]): input is string | [string, unknown] => typeof input === 'string' || (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string');
		const _uuidv7Col = Field.pick('gen:uuidv7', cols)?.col;
			const _tsOps: Record<'after' | 'before', 'tsGte' | 'tsLte'> = { after: 'tsGte', before: 'tsLte' };
			const preds = (filter: Record<string, unknown>): Pred[] =>
				R.reduce(filter, [] as Pred[], (acc, value, key) => {
					const empty = value === undefined || (Array.isArray(value) && !(value as unknown[]).length);
					const isTemporal = key === 'after' || key === 'before';
					const tsOp = _uuidv7Col && isTemporal ? _tsOps[key] : undefined;
					const pred = (tsOp && { field: _uuidv7Col, op: tsOp, value })
						|| (Array.isArray(value) && { field: key, op: 'in' as const, values: value as unknown[] })
						|| { field: key, value };
					return ({
						false: !isTemporal || tsOp ? [...acc, pred as Pred] : acc,
						true: acc,
				})[`${empty}`];
				});
			const $entry = (column: string, value: unknown): Statement.Fragment => {
				const col = sql(column);
				const kind: 'del' | 'inc' | 'json' | 'now' | 'scalar' | 'set' = (value === NowOp && 'now')
					|| (value instanceof IncOp && 'inc')
					|| (value instanceof JsonbDelOp && 'del')
					|| (value instanceof JsonbSetOp && 'set')
					|| (typeof value === 'object' && value !== null && 'json')
					|| 'scalar';
			const dispatch = {
				del: () => { const pathStr = `{${(value as JsonbDelOp).path.join(',')}}`; return sql`${col} = ${col} #- ${pathStr}::text[]`; },
				inc: () => sql`${col} = ${col} + ${(value as IncOp).delta}`,
				json: () => sql`${col} = ${pg.json(value)}`,
				now: () => sql`${col} = NOW()`,
				scalar: () => sql`${col} = ${value}`,
				set: () => { const pathStr = `{${(value as JsonbSetOp).path.join(',')}}`; return sql`${col} = jsonb_set(${col}, ${pathStr}::text[], ${pg.json((value as JsonbSetOp).value)}::jsonb)`; },
				} satisfies Record<typeof kind, () => Statement.Fragment>;
				return dispatch[kind]();
			};
		const $entries = (updates: Record<string, unknown>): Statement.Fragment[] => R.collect(updates, (column, value) => $entry(column, value));
		const $excluded = (keys: string[], only?: string[]) => (only ?? Object.keys(cols).filter(column => column !== pkCol && !keys.includes(column))).map(column => sql`${sql(column)} = EXCLUDED.${sql(column)}`);
		const upsertConfiguration = config.conflict && { keys: config.conflict.keys, updates: $excluded(config.conflict.keys, config.conflict.only) };
		// --- Base repository + resolvers -------------------------------------
		const base = yield* Model.makeRepository(model, { idColumn: pkCol, spanPrefix: table, tableName: table });
		const resolvers = yield* Effect.all(R.map(config.resolve ?? {}, (spec, name) => {
			const isMany = typeof spec === 'string' && spec.startsWith('many:');
			const fields = (isMany && [(spec).slice(5)])
				|| (Array.isArray(spec) && (spec as string[]))
				|| [spec as string];
			const $cf = fields.map(field => { const wrap = Field.predMeta(field).wrap; return wrap ? sql`${sql.literal(wrap)}(${sql(field)})` : sql`${sql(field)}`; });
			const $compoundClause = (rec: Record<string, unknown>) => sql`(${sql.and(fields.map((column, index) => sql`${$cf[index]} = ${rec[column]}`))})`;  // NOSONAR S2004
			const $wh = (keys: unknown[]) => ({ false: sql.or((keys as Record<string, unknown>[]).map($compoundClause)), true: sql`${$cf[0]} IN ${sql.in(keys)}` })[`${fields.length === 1}`];
			const $select = (wh: Statement.Fragment, $autoScope: Statement.Fragment) => sql`SELECT * FROM ${sql(table)} WHERE ${wh}${$active}${$fresh}${$autoScope}`;
			const ex = (keys: unknown[]) => Effect.andThen(_autoScope('by'), ($autoScope) => $select($wh(keys), $autoScope)); // NOSONAR S2004
			const schema = Field.from(fields, cols), extract = Field.from(fields);
			return isMany
				? SqlResolver.grouped(`${table}.${name}Grp`, { execute: ex, Request: schema, RequestGroupKey: (id: unknown) => id, Result: model, ResultGroupKey: extract, withContext: false })
				: SqlResolver.findById(`${table}.${name}`, { execute: ex, Id: schema, Result: model, ResultId: extract, withContext: false });
		}));
		// --- Query methods ---------------------------------------------------
			const by = <K extends string & keyof NonNullable<C['resolve']>>(key: K, value: unknown): (
				NonNullable<C['resolve']>[K] extends `many:${string}`
					? Effect.Effect<readonly S.Schema.Type<M>[], SqlError | ParseError | RepoScopeError | RepoConfigError> // NOSONAR S3358
					: Effect.Effect<Option.Option<S.Schema.Type<M>>, SqlError | ParseError | RepoScopeError | RepoConfigError>
			) => (resolvers[key]
				? _withTenantContext('by', resolvers[key].execute(value) as Effect.Effect<unknown, SqlError | ParseError | RepoScopeError, never>)
				: Effect.fail(new RepoConfigError({ message: `resolver '${String(key)}' not configured`, operation: 'by', table }))) as (
				NonNullable<C['resolve']>[K] extends `many:${string}`
					? Effect.Effect<readonly S.Schema.Type<M>[], SqlError | ParseError | RepoScopeError | RepoConfigError>
					: Effect.Effect<Option.Option<S.Schema.Type<M>>, SqlError | ParseError | RepoScopeError | RepoConfigError>
			);
			const _findExec = (predicate: Pred | readonly Pred[], $autoScope: Statement.Fragment, asc: boolean) => () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope} ${$order(asc)}`;
			const find = (predicate: Pred | readonly Pred[], options: { asc?: boolean } = {}) => _withTenantContext('find', Effect.andThen(_autoScope('find'), ($autoScope) => SqlSchema.findAll({ execute: _findExec(predicate, $autoScope, options.asc ?? false), Request: S.Void, Result: model })(undefined)));
			const one = (predicate: Pred | readonly Pred[], lock: false | 'update' | 'share' | 'nowait' | 'skip' = false) => _withTenantContext('one', _autoScope('one').pipe(Effect.flatMap(($autoScope) => SqlSchema.findOne({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}${$lock(lock)}`, Request: S.Void, Result: model })(undefined))));
			const page = (predicate: Pred | readonly Pred[], options: { limit?: number; cursor?: string; asc?: boolean } = {}) => {
				const { limit = Page.bounds.default, cursor, asc = false } = options;
				return _withTenantContext('page', _autoScope('page').pipe(Effect.flatMap(($autoScope) => Page.decode(cursor).pipe(Effect.flatMap(decoded => {
					const cursorFrag = decoded._tag === 'None' ? sql`` : sql`AND ${sql(pkCol)} ${asc ? sql`>` : sql`<`} ${decoded.value.id}${pkCast}`;
					return sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
						SELECT base.*, totals.total_count FROM base CROSS JOIN totals WHERE TRUE ${cursorFrag} ${$order(asc)} LIMIT ${limit + 1}`
						.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.keyset(items as unknown as readonly S.Schema.Type<M>[], total, limit, item => ({ id: (item as Record<string, unknown>)[pkCol] as string }), Option.isSome(decoded)); }));
				})))));
			};
			const count = (predicate: Pred | readonly Pred[]) =>
				_withTenantContext(
					'count',
					_autoScope('count').pipe(
						Effect.flatMap(($autoScope) =>
							sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}`
								.pipe(Effect.map((rows): number => (rows[0] as { count: number }).count)),
						),
					),
				);
			const exists = (predicate: Pred | readonly Pred[]) =>
				_withTenantContext(
					'exists',
					_autoScope('exists').pipe(
						Effect.flatMap(($autoScope) =>
							sql`SELECT EXISTS(SELECT 1 FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}) AS exists`
								.pipe(Effect.map((rows): boolean => (rows[0] as { exists: boolean }).exists)),
						),
					),
				);
			const agg = <T extends AggSpec>(predicate: Pred | readonly Pred[], spec: T): Effect.Effect<AggResult<T>, RepoScopeError | SqlError | ParseError> =>
				_withTenantContext(
					'agg',
					_autoScope('agg').pipe(
						Effect.flatMap(($autoScope) =>
							sql`SELECT ${sql.csv(Object.entries(spec).map(([fn, col]) => fn === 'count' ? sql`COUNT(*)::int AS count` : sql`${sql.literal(fn.toUpperCase())}(${sql(col as string)})${(fn === 'avg' || fn === 'sum') ? sql`::numeric` : sql``} AS ${sql.literal(fn)}`))} FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}`
								.pipe(Effect.map(([row]) => row as AggResult<T>)),
						),
					),
				);
			const pageOffset = (predicate: Pred | readonly Pred[], options: { limit?: number; offset?: number; asc?: boolean } = {}) => {
				const { limit = Page.bounds.default, offset: start = 0, asc = false } = options;
				return _withTenantContext(
					'pageOffset',
					_autoScope('pageOffset').pipe(
						Effect.flatMap(($autoScope) =>
							sql`WITH base AS (SELECT * FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope}), totals AS (SELECT COUNT(*)::int AS total_count FROM base)
								SELECT base.*, totals.total_count FROM base CROSS JOIN totals ${$order(asc)} LIMIT ${limit} OFFSET ${start}`
								.pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.offset(items as unknown as readonly S.Schema.Type<M>[], total, start, limit); })),
						),
					),
				);
			};
		// --- Mutation helpers ------------------------------------------------
		const _withData = <T, E, R>(operation: string, data: T | readonly T[] | null | undefined, onEmpty: (isArr: boolean) => R, onData: (items: readonly T[], isArr: boolean) => Effect.Effect<R, E>): Effect.Effect<R, RepoConfigError | E> =>
			data == null ? Effect.fail(new RepoConfigError({ message: 'data cannot be null or undefined', operation, table }))
			: ((isArr, items) => items.length === 0 ? Effect.succeed(onEmpty(isArr)) : onData(items, isArr))(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly T[]);
		// --- Mutation methods ------------------------------------------------
			function put<T extends S.Schema.Type<typeof model.insert>>(data: readonly T[], conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException>;
			function put<T extends S.Schema.Type<typeof model.insert>>(data: T, conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<S.Schema.Type<M>, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException>;
			function put<T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[] | undefined, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException> {
				return _withTenantContext('put', _withData('put', data, (isArr) => isArr ? [] as S.Schema.Type<M>[] : undefined,
					(items, isArr) => conflict
						? SqlSchema.single({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(conflict.keys)}) DO UPDATE SET ${sql.csv($excluded(conflict.keys, conflict.only))}${$touch}${conflict.occ ? sql` WHERE ${sql(table)}.updated_at = ${conflict.occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(items[0])
							.pipe(Effect.flatMap(row => conflict.occ && !row ? Effect.fail(new RepoOccError({ expected: conflict.occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table })) : Effect.succeed(isArr ? [row] : row)))
						: SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
							.pipe(Effect.map(rows => isArr ? rows : rows[0]))));
			}
			const set = (input: string | [string, unknown] | Pred | readonly Pred[], updates: Record<string, unknown>, scope?: Record<string, unknown>, when?: Pred | readonly Pred[]) => {
				const single = _isSingle(input);
				const entries = $entries(updates), $p = single ? $target(input) : $where(input as Pred | readonly Pred[]), $s = $scope(scope);
				const $guard = when ? sql` AND ${$where(when)}` : sql``;
				const schema = when === undefined ? SqlSchema.single : SqlSchema.findOne;
				return _withTenantContext('set', A.isNonEmptyArray(entries)
					? single
						? schema({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$p}${$s}${$active}${$guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
						: sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$p}${$s}${$active}${$guard} RETURNING 1`.pipe(Effect.map(rows => rows.length))
					: single
						? schema({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$p}${$s}${$active}${$guard}`, Request: S.Void, Result: model })(undefined)
						: sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$p}${$s}${$active}${$guard}`.pipe(Effect.map((rows): number => (rows[0] as { count: number }).count)));
			};
			type SoftDeleteResult = {
				(input: string, scope?: Record<string, unknown>): Effect.Effect<S.Schema.Type<M>, SqlError | ParseError | Cause.NoSuchElementException | RepoConfigError | RepoScopeError>;
				(input: readonly string[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError | RepoScopeError>;
				(input: Pred | readonly Pred[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError | RepoScopeError>;
			};
			type SoftOp = 'drop' | 'lift';
			const _softOps = { drop: { guard: sql`IS NULL`, ts: sql`NOW()` }, lift: { guard: sql`IS NOT NULL`, ts: sql`NULL` } } as const satisfies Record<SoftOp, { guard: Statement.Fragment; ts: Statement.Fragment }>;
			const _soft = (op: SoftOp) => (input: string | readonly string[] | Pred | readonly Pred[], scope?: Record<string, unknown>) => {
				const effect: Effect.Effect<S.Schema.Type<M> | number, RepoConfigError | SqlError | ParseError | Cause.NoSuchElementException> = Array.isArray(input) && (input as readonly unknown[]).length === 0
					? Effect.succeed(0)
					: softEntry
					? ((entry) => {
						const { ts, guard } = _softOps[op];
						const col = entry.col;
						return typeof input === 'string'
							? SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${$target(input)}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING *`, Request: S.Void, Result: model })(undefined)
							: sql`UPDATE ${sql(table)} SET ${sql(col)} = ${ts}${$touch} WHERE ${Array.isArray(input) && typeof input[0] === 'string' ? sql`${sql(pkCol)} IN ${sql.in(input as string[])}` : $where(input as Pred | readonly Pred[])}${$scope(scope)} AND ${sql(col)} ${guard} RETURNING 1`.pipe(Effect.map(rows => rows.length));
					})(softEntry)
					: Effect.fail(new RepoConfigError({ message: 'soft delete column not configured', operation: op, table }));
				return _withTenantContext(op, effect);
			};
			const drop = _soft('drop') as SoftDeleteResult;
			const lift = _soft('lift') as SoftDeleteResult;
			const purge = (days = 30): Effect.Effect<number, RepoConfigError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException> => {
				const effect: Effect.Effect<number, RepoConfigError | SqlError | ParseError | Cause.NoSuchElementException> = config.purge
					? ((functionName) => SqlSchema.single({ execute: (num) => sql`SELECT ${sql.literal(functionName)}(${num}) AS count`, Request: S.Number, Result: S.Struct({ count: S.Int }) })(days).pipe(Effect.map(row => row.count)))(config.purge)
					: Effect.fail(new RepoConfigError({ message: 'purge function not configured', operation: 'purge', table }));
				return _withTenantContext('purge', effect);
			};
			function upsert<T extends S.Schema.Type<typeof model.insert>>(data: readonly T[], occ?: Date): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError>;
			function upsert<T extends S.Schema.Type<typeof model.insert>>(data: T, occ?: Date): Effect.Effect<S.Schema.Type<M>, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError>;
			function upsert<T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined, occ?: Date): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[] | undefined, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError> {
				return _withTenantContext('upsert', upsertConfiguration
					? _withData('upsert', data, (isArr) => isArr ? [] as S.Schema.Type<M>[] : undefined,
						(items, isArr) => items.length === 1
							? SqlSchema.findOne({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(upsertConfiguration.keys)}) DO UPDATE SET ${sql.csv(upsertConfiguration.updates)}${$touch}${occ ? sql` WHERE ${sql(table)}.updated_at = ${occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(items[0])
								.pipe(Effect.flatMap(opt => Option.match(opt, {
									onNone: () => Effect.fail(occ ? new RepoOccError({ expected: occ, pk: String((items[0] as Record<string, unknown>)[pkCol]), table }) : new RepoConfigError({ message: 'unexpected empty result', operation: 'upsert', table })),
									onSome: row => Effect.succeed((isArr ? [row] : row) as S.Schema.Type<M> | readonly S.Schema.Type<M>[]),
								})))
							: SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} ON CONFLICT (${sql.csv(upsertConfiguration.keys)}) DO UPDATE SET ${sql.csv(upsertConfiguration.updates)}${$touch} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
								.pipe(Effect.map(rows => rows as readonly S.Schema.Type<M>[]))
					)
					: Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'upsert', table })));
			}
			const merge = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[] | null | undefined): Effect.Effect<MergeResult<S.Schema.Type<M>> | readonly MergeResult<S.Schema.Type<M>>[] | undefined, RepoConfigError | RepoScopeError | SqlError | ParseError> =>
				_withTenantContext('merge', upsertConfiguration
					? _withData<Record<string, unknown>, SqlError | ParseError, MergeResult<S.Schema.Type<M>> | readonly MergeResult<S.Schema.Type<M>>[] | undefined>(
						'merge', data as Record<string, unknown> | readonly Record<string, unknown>[] | null | undefined,
						(isArr) => isArr ? [] as MergeResult<S.Schema.Type<M>>[] : undefined,
					(items, isArr) => sql`MERGE INTO ${sql(table)} USING (VALUES ${sql.csv(items.map(item => sql`(${sql.csv(_insertCols.map(column => sql`${item[column]}`))})`))} ) AS source(${sql.csv(_insertCols.map(column => sql`${sql(column)}`))})
						ON ${sql.and(upsertConfiguration.keys.map(key => sql`${sql(table)}.${sql(key)} = source.${sql(key)}`))}
						WHEN MATCHED THEN UPDATE SET ${sql.csv(_insertCols.filter(column => !upsertConfiguration.keys.includes(column)).map(column => sql`${sql(column)} = source.${sql(column)}`))}${$touch}
						WHEN NOT MATCHED THEN INSERT (${sql.csv(_insertCols.map(column => sql`${sql(column)}`))}) VALUES (${sql.csv(_insertCols.map(column => sql`source.${sql(column)}`))})
							RETURNING *, (CASE WHEN xmax = 0 THEN 'insert' ELSE 'update' END) AS _action`
							.pipe(Effect.map(results => isArr ? results as MergeResult<S.Schema.Type<M>>[] : results[0] as MergeResult<S.Schema.Type<M>>))
					)
					: Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'merge', table })));
			const stream = (predicate: Pred | readonly Pred[], options: { asc?: boolean } = {}): Stream.Stream<S.Schema.Type<M>, RepoScopeError | SqlError | ParseError> =>
				Stream.unwrap(
					_autoScope('stream').pipe(
						Effect.map(($autoScope) => Stream.mapEffect(sql`SELECT * FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$autoScope} ${$order(options.asc ?? false)}`.stream, S.decodeUnknown(model))),
					),
				);
			const fn = (name: string, params: Record<string, unknown>): Effect.Effect<number, RepoConfigError | RepoScopeError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> => { // NOSONAR S3358
				const effect: Effect.Effect<number, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> = ((spec) => spec
					? SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${_fnArgs(sql, spec, params)}) AS count`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: S.Struct({ count: S.Int }) })(params).pipe(Effect.map(row => row.count))
					: Effect.fail(config.fn ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no scalar functions configured', operation: 'fn', table }))
				)(config.fn?.[name]);
				return _withTenantContext('fn', effect);
			};
			const fnSet = (name: string, params: Record<string, unknown>): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoScopeError | RepoUnknownFnError | SqlError | ParseError> => {
				const effect: Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoUnknownFnError | SqlError | ParseError> = ((spec) => spec
					? SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql.literal(name)}(${_fnArgs(sql, spec, params)})`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: model })(params)
					: Effect.fail(config.fnSet ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no set functions configured', operation: 'fnSet', table }))
				)(config.fnSet?.[name]);
				return _withTenantContext('fnSet', effect);
			};
			const fnTyped = (name: string, params: Record<string, unknown>): Effect.Effect<unknown, RepoConfigError | RepoScopeError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> => {
				const effect: Effect.Effect<unknown, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> = ((spec) => spec
					? SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${_fnArgs(sql, spec, params)}) AS result`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: S.Struct({ result: spec.schema }) })(params).pipe(Effect.map(row => row.result))
					: Effect.fail(config.fnTyped ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no typed functions configured', operation: 'fnTyped', table }))
				)(config.fnTyped?.[name]);
				return _withTenantContext('fnTyped', effect);
			};
			const withTransaction = sql.withTransaction;
			const json = {
				decode: <A, I, R>(field: string, schema: S.Schema<A, I, R>) =>
					(opt: Option.Option<S.Schema.Type<M>>): Effect.Effect<Option.Option<A>, never, R> =>
						opt._tag === 'None' ? Effect.succeed(Option.none<A>()) : S.decodeUnknown(S.parseJson(schema))((opt.value as Record<string, unknown>)[field]).pipe(Effect.option),
				encode: <A, I, R>(schema: S.Schema<A, I, R>) => (value: A): Effect.Effect<string, ParseError, R> => S.encode(S.parseJson(schema))(value),
			};
			return { ...base, agg, by, count, drop, exists, find, fn, fnSet, fnTyped, json, lift, merge, one, page, pageOffset, pg, preds, purge, put, set, stream, upsert, withTransaction };
		});
const routine = <const C extends RoutineConfig>(table: string, config: C) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const fn = (name: string, params: Record<string, unknown>): Effect.Effect<number, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> =>
			((spec) => spec
				? SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${_fnArgs(sql, spec, params)}) AS count`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: S.Struct({ count: S.Int }) })(params).pipe(Effect.map(row => row.count))
				: Effect.fail(config.fn ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no scalar functions configured', operation: 'fn', table }))
			)(config.fn?.[name]);
		const fnSet = <K extends string & keyof NonNullable<C['fnSet']>>(name: K, params: Record<string, unknown>) =>
			((spec) => spec
				? SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql.literal(name)}(${_fnArgs(sql, spec, params)})`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: spec.schema })(params)
				: Effect.fail(config.fnSet ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no set functions configured', operation: 'fnSet', table }))
			)(config.fnSet?.[name]) as Effect.Effect<readonly S.Schema.Type<NonNullable<C['fnSet']>[K]['schema']>[], RepoConfigError | RepoUnknownFnError | SqlError | ParseError>;
		const fnTyped = <K extends string & keyof NonNullable<C['fnTyped']>>(name: K, params: Record<string, unknown>) =>
			((spec) => spec
				? SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${_fnArgs(sql, spec, params)}) AS result`, Request: spec.params ?? _EMPTY_FN_PARAMS, Result: S.Struct({ result: spec.schema }) })(params).pipe(Effect.map(row => row.result))
				: Effect.fail(config.fnTyped ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no typed functions configured', operation: 'fnTyped', table }))
			)(config.fnTyped?.[name]) as Effect.Effect<S.Schema.Type<NonNullable<C['fnTyped']>[K]['schema']>, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException>;
		return { fn, fnSet, fnTyped };
	});

// --- [EXPORT] ----------------------------------------------------------------

export { repo, routine, RepoConfigError, RepoOccError, RepoScopeError, RepoUnknownFnError, Update };
export type { AggSpec, Config, MergeResult, Pred, RoutineConfig };
