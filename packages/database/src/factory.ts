/**
 * Unified repository factory with polymorphic query/mutation API.
 * Single `resolve` config for lookups, predicate-based find/one/page/count.
 * Polymorphic single/bulk operations for drop/lift/set.
 */
import { Model, SqlClient, SqlSchema, type Statement } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import type { SqlError } from '@effect/sql/SqlError';
import type { ParseError } from 'effect/ParseResult';
import { Array as A, type Cause, Data, Effect, Match, Option, Record as R, Schema as S, Stream } from 'effect';
import { Client } from './client.ts';
import { Field } from './field.ts';
import { Page } from './page.ts';

// --- [ERRORS] ----------------------------------------------------------------

class RepoConfigError extends    Data.TaggedError('RepoConfigError')<{    table: string; operation: string; message: string }> {}
class RepoUnknownFnError extends Data.TaggedError('RepoUnknownFnError')<{ table: string; fn: string }> {}
class RepoOccError extends       Data.TaggedError('RepoOccError')<{       table: string; pk: string;        expected: Date }> {}
class RepoScopeError extends     Data.TaggedError('RepoScopeError')<{     table: string; operation: string; reason: 'tenant_missing'; scopedField: string; tenantId: string }> {}

// --- [TYPES] -----------------------------------------------------------------

type SqlCast = typeof Field.sqlCast[keyof typeof Field.sqlCast];
type FnCallSpec = { args?: readonly (string | { field: string; cast: SqlCast })[]; params?: S.Schema.AnyNoContext; mode?: 'scalar' | 'set' | 'typed'; schema?: S.Schema.AnyNoContext };
type _Render = (col: Statement.Identifier, sql: SqlClient.SqlClient, pg: PgClient.PgClient) => Statement.Fragment;
type ResolveSpec<M extends Model.AnyNoContext> =
    | keyof M['fields'] & string
    | readonly (keyof M['fields'] & string)[]
    | { field: keyof M['fields'] & string | readonly (keyof M['fields'] & string)[]; many?: true }
    | { field: string | readonly string[]; many?: true; through: { base?: string; table: string; target: string } };
type Config<M extends Model.AnyNoContext> = {
    pk?: { column: string; cast?: SqlCast };
    scoped?: keyof M['fields'] & string;
    resolve?: Record<string, ResolveSpec<M>>;
    conflict?: { keys: (keyof M['fields'] & string)[]; only?: (keyof M['fields'] & string)[] };
    purge?: string | { readonly table: string; readonly column: string; readonly defaultDays?: number };
    functions?: Record<string, FnCallSpec>;
};
type _ResolverSurface<M extends Model.AnyNoContext, C extends Config<M>> = {
    [K in string & keyof NonNullable<C['resolve']> as NonNullable<C['resolve']>[K] extends readonly string[] ? never : K]: (value: unknown) => (
        NonNullable<C['resolve']>[K] extends { many: true }
            ? Effect.Effect<readonly S.Schema.Type<M>[], SqlError | ParseError | RepoScopeError | RepoConfigError>
            : Effect.Effect<Option.Option<S.Schema.Type<M>>, SqlError | ParseError | RepoScopeError | RepoConfigError>
    );
};
type Pred =
    | [string, unknown]
    | { field: string; value?: unknown; values?: unknown[]; op?: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'null' | 'notNull' | 'contains' | 'containedBy' | 'hasKey' | 'hasKeys' | 'tsGte' | 'tsLte' | 'like'; cast?: SqlCast; wrap?: 'casefold' }
    | { raw: Statement.Fragment };

// --- [CONSTANTS] -------------------------------------------------------------

const Update = {
    inc: (delta = 1): _Render => (col, sql) => sql`${col} = ${col} + ${delta}`,
    jsonb: {
        del: (path: readonly string[]): _Render => (col, sql) => { const pathStr = `{${path.join(',')}}`; return sql`${col} = ${col} #- ${pathStr}::text[]`; },
        set: (path: readonly string[], value: unknown): _Render => (col, sql, pg) => { const pathStr = `{${path.join(',')}}`; return sql`${col} = jsonb_set(${col}, ${pathStr}::text[], ${pg.json(value)}::jsonb)`; },
    },
    now: ((col, sql) => sql`${col} = NOW()`) as _Render,
};
const _callFn = (sql: SqlClient.SqlClient, specs: Record<string, FnCallSpec> | undefined, modelSchema: S.Schema.AnyNoContext | undefined, table: string) =>
    (name: string, params: Record<string, unknown>): Effect.Effect<unknown, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException> =>
        Option.fromNullable(specs?.[name]).pipe(
            Option.match({
                onNone: () => Effect.fail(specs ? new RepoUnknownFnError({ fn: name, table }) : new RepoConfigError({ message: 'no functions configured', operation: 'fn', table })),
                onSome: (spec) => {
                    const args = sql.csv((spec.args ?? []).map(arg => typeof arg === 'string' ? sql`${params[arg]}` : sql`${params[arg.field]}::${sql.literal(arg.cast)}`));
                    const request = spec.params ?? S.Struct({});
                    return spec.mode === 'set'
                        ? SqlSchema.findAll({ execute: () => sql`SELECT * FROM ${sql.literal(name)}(${args})`, Request: request, Result: modelSchema ?? spec.schema ?? S.Unknown })(params)
                        : SqlSchema.single({ execute: () => sql`SELECT ${sql.literal(name)}(${args}) AS value`, Request: request, Result: S.Struct({ value: spec.schema ?? (spec.mode === 'typed' ? S.Unknown : S.Int) }) })(params).pipe(Effect.map(row => row.value));
                },
            }),
        );

// --- [FACTORY] ---------------------------------------------------------------

const repo = <M extends Model.AnyNoContext, const C extends Config<M>>(model: M, table: string, config: C = {} as C) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const pg = yield* PgClient.PgClient;
        const cols = model.fields as Record<string, S.Schema.AnyNoContext>;
        const { column: pkCol, cast: _pkCast } = config.pk ?? { cast: 'uuid', column: 'id' };
        const _resolveField = (name: string, operation = 'field.resolve'): { col: string; field: string } =>
            Option.fromNullable(Field.resolve(name)).pipe(
                Option.getOrThrowWith(() => new RepoConfigError({ message: `unknown field/column '${name}'`, operation, table })),
            );
        const _toCol = (name: string): string => _resolveField(name, 'field.toCol').col;
        const _toField = (name: string): string => _resolveField(name, 'field.toField').field;
        const _pkColumn = _toCol(pkCol);
        const _pkField = _toField(pkCol);
        const pkCast = _pkCast ? sql`::${sql.literal(_pkCast)}` : sql``;
        const softEntry = Object.keys(cols).map(Field.resolve).find((e) => e?.mark === 'soft');
        const expEntry = Object.keys(cols).map(Field.resolve).find((e) => e?.mark === 'exp');
        const _insertFields = Object.keys(cols).filter((field) => field !== _pkField && !(Field.resolve(field)?.gen));
        const _insertCols = _insertFields.map(_toCol);
        // --- SQL fragments ---------------------------------------------------
        const $active = softEntry ? sql` AND ${sql(softEntry.col)} IS NULL` : sql``;
        const $fresh = expEntry ? sql` AND (${sql(expEntry.col)} IS NULL OR ${sql(expEntry.col)} > NOW())` : sql``;
        const $touch = Option.fromNullable(Field.resolve('updatedAt')).pipe(Option.match({ onNone: () => sql``, onSome: (e) => sql`, ${sql(e.col)} = NOW()` }));
        const $scope = (scope?: Record<string, unknown>) => scope && !R.isEmptyRecord(scope) ? sql` AND ${sql.and(R.collect(scope, (column, value) => sql`${sql(_toCol(column))} = ${value}`))}` : sql``; // NOSONAR S3358
        const $target = (target: string | [string, unknown]) => typeof target === 'string' ? sql`${sql(_pkColumn)} = ${target}${pkCast}` : sql`${sql(_toCol(target[0]))} = ${target[1]}`;
        const $lock = (lock: false | 'update' | 'share' | 'nowait' | 'skip') => ({ false: sql``, nowait: sql` FOR UPDATE NOWAIT`, share: sql` FOR SHARE`, skip: sql` FOR UPDATE SKIP LOCKED`, update: sql` FOR UPDATE` })[`${lock}`]; // NOSONAR S3358
        const $order = (asc: boolean) => asc ? sql`ORDER BY ${sql(_pkColumn)} ASC` : sql`ORDER BY ${sql(_pkColumn)} DESC`;
        const _scopeOpt = Option.fromNullable(config.scoped).pipe(Option.map((field) => _toCol(field)));
        const _tenantScope = (operation: string, scopeCol: string) => (tenantId: string) => ({ [Client.tenant.Id.system]: Effect.succeed(sql``), [Client.tenant.Id.unspecified]: Effect.fail(new RepoScopeError({ operation, reason: 'tenant_missing', scopedField: scopeCol, table, tenantId })) } as Record<string, Effect.Effect<Statement.Fragment, RepoScopeError>>)[tenantId] ?? Effect.succeed(sql` AND ${sql(scopeCol)} = ${tenantId}`); // NOSONAR S3358
        const _withTenantContext = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | RepoScopeError | SqlError, R> =>
            Option.match(_scopeOpt, {
                onNone: () => effect,
                onSome: (scopeCol) => Effect.gen(function* () {
                    const [tenantId, inSqlContext] = yield* Effect.all([Client.tenant.current, Client.tenant.inSqlContext]);
                    yield* _tenantScope(operation, scopeCol)(tenantId);
                    return yield* (tenantId === Client.tenant.Id.system || inSqlContext)
                        ? effect
                        : sql.withTransaction(
                            sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.pipe(
                                Effect.andThen(effect),
                                Effect.provideService(SqlClient.SqlClient, sql),
                            ),
                        );
                }),
            });
        const _autoScope = (operation: string): Effect.Effect<Statement.Fragment, RepoScopeError> => Option.match(_scopeOpt, { onNone: () => Effect.succeed(sql``), onSome: (scopeCol) => Effect.andThen(Client.tenant.current, _tenantScope(operation, scopeCol)) });
        const _scoped = <A, E>(op: string, fn: ($autoScope: Statement.Fragment) => Effect.Effect<A, E>): Effect.Effect<A, E | RepoScopeError | SqlError> => _withTenantContext(op, _autoScope(op).pipe(Effect.flatMap(fn)));
        const _scalar = <T>(op: string, query: ($s: Statement.Fragment) => Effect.Effect<readonly Record<string, unknown>[], SqlError>, extract: (row: Record<string, unknown>) => T): Effect.Effect<T, RepoScopeError | SqlError> => _scoped(op, ($s) => query($s).pipe(Effect.map((rows) => extract(A.unsafeGet(rows, 0)))));
        type OpCtx = { col: Statement.Fragment; value: unknown; values: unknown[]; $cast: SqlCast | undefined };
        const _cmp = (op: string) => ({ col, value, $cast }: OpCtx) => sql`${col} ${sql.literal(op)} ${value}${$cast ? sql`::${sql.literal($cast)}` : sql``}`;
        const _ops = {
            containedBy: ({ col, value }: OpCtx) => sql`${col} <@ ${value}::jsonb`,
            contains:    ({ col, value }: OpCtx) => sql`${col} @> ${value}::jsonb`,
            eq:          _cmp('='), gt: _cmp('>'), gte: _cmp('>='),
            hasKey:      ({ col, value }: OpCtx) => sql`${col} ? ${value}`,
            hasKeys:     ({ col, values }: OpCtx) => values.length ? sql`${col} ?& ARRAY[${sql.csv(values.map((key) => sql`${key}`))}]::text[]` : sql`TRUE`,
            in:          ({ col, values }: OpCtx) => A.isNonEmptyArray(values) ? sql`${col} IN ${sql.in(values)}` : sql`FALSE`,
            like:        _cmp('LIKE'),
            lt:          _cmp('<'),
            lte:         _cmp('<='),
            notNull:     ({ col }: OpCtx) => sql`${col} IS NOT NULL`, null: ({ col }: OpCtx) => sql`${col} IS NULL`,
            tsGte:       ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) >= ${value}`,
            tsLte:       ({ col, value }: OpCtx) => sql`uuid_extract_timestamp(${col}) <= ${value}`,
        } as const satisfies Record<string, (ctx: OpCtx) => Statement.Fragment>;
        const _handleObj = (pred: { field: string; value?: unknown; values?: unknown[]; op?: keyof typeof _ops; cast?: SqlCast; wrap?: string }) => {
            const { field, op = 'eq', value, values = [], cast, wrap } = pred;
            const meta = Field.resolve(field);
            const $cast = cast ?? (meta ? Field.sqlCast[meta.sql as keyof typeof Field.sqlCast] : undefined);
            const $wrap = wrap ?? meta?.wrap;
            const resolvedCol = _toCol(field);
            const col = $wrap ? sql`${sql.literal($wrap)}(${sql(resolvedCol)})` : sql`${sql(resolvedCol)}`;
            return (_ops[op] ?? _ops.eq)({ $cast, col, value, values });
        };
        const _isRawPred = (pred: Pred): pred is { raw: Statement.Fragment } => typeof pred === 'object' && !Array.isArray(pred) && pred !== null && 'raw' in pred;
        const _isTuplePred = (pred: Pred): pred is [string, unknown] => Array.isArray(pred);
        const $pred = (predicate: Pred): Statement.Fragment =>
            Match.value(predicate).pipe(
                Match.when(_isRawPred, (pred) => pred.raw),
                Match.when(_isTuplePred, (pred) => sql`${sql(_toCol(pred[0]))} = ${pred[1]}`),
                Match.orElse((p) => _handleObj(p as Parameters<typeof _handleObj>[0])),
            ) as Statement.Fragment;
        const $where = (pred: Pred | readonly Pred[]): Statement.Fragment => {
            const predicates = Array.isArray(pred) && !(pred.length === 2 && typeof pred[0] === 'string') ? pred as readonly Pred[] : [pred as Pred];
            return predicates.length ? sql.and(predicates.map($pred)) : sql`TRUE`;
        };
        const _isSingle = (input: string | Pred | readonly Pred[]): input is string | [string, unknown] => typeof input === 'string' || (Array.isArray(input) && input.length === 2 && typeof input[0] === 'string');
        const _uuidv7Col = Object.keys(cols).map(Field.resolve).find((e) => e?.gen === 'uuidv7')?.col;
        const _tsOps: Record<'after' | 'before', 'tsGte' | 'tsLte'> = { after: 'tsGte', before: 'tsLte' };
        const preds = (filter: Record<string, unknown>): Pred[] =>
            R.reduce(filter, [] as Pred[], (acc, value, key) => {
                const empty = value === undefined || (Array.isArray(value) && !(value as unknown[]).length);
                const isTemporal = key === 'after' || key === 'before';
                const tsOp = _uuidv7Col && isTemporal ? _tsOps[key] : undefined;
                const predicate = (tsOp && { field: _uuidv7Col, op: tsOp, value })
                    || (Array.isArray(value) && { field: key, op: 'in' as const, values: value as unknown[] })
                    || { field: key, value };
                const include = !empty && (!isTemporal || !!tsOp);
                return include ? [...acc, predicate as Pred] : acc;
            });
        const $entry = (column: string, value: unknown): Statement.Fragment => {
            const col = sql(_toCol(column));
            return typeof value === 'function' ? (value as _Render)(col, sql, pg)
                : (value !== null && typeof value === 'object') ? sql`${col} = ${pg.json(value)}`
                : sql`${col} = ${value}`;
        };
        const $entries = (updates: Record<string, unknown>): Statement.Fragment[] => R.collect(updates, (column, value) => $entry(column, value));
        const $excluded = (keys: string[], only?: string[]) => (only ?? _insertCols.filter((column) => !keys.includes(column))).map((column) => sql`${sql(column)} = EXCLUDED.${sql(column)}`);
        const _conflictKeys = config.conflict?.keys.map(_toCol);
        const _conflictOnly = config.conflict?.only?.map(_toCol);
        const upsertConfiguration = _conflictKeys && { keys: _conflictKeys, updates: $excluded(_conflictKeys, _conflictOnly) };
        const $fromWhere = (predicate: Pred | readonly Pred[], $s: Statement.Fragment) => sql`FROM ${sql(table)} WHERE ${$where(predicate)}${$active}${$fresh}${$s}`;
        const $pagedCte = (predicate: Pred | readonly Pred[], $s: Statement.Fragment, tail: Statement.Fragment) => sql`WITH base AS (SELECT * ${$fromWhere(predicate, $s)}), totals AS (SELECT COUNT(*)::int AS total_count FROM base) SELECT base.*, totals.total_count FROM base CROSS JOIN totals ${tail}`;
        // --- Base repository + resolvers -------------------------------------
        const base = yield* Model.makeRepository(model, { idColumn: pkCol, spanPrefix: table, tableName: table });
        // Why: Normalizes join vs direct specs into { $from, $select, refs, $match } — one polymorphic builder replaces _isJoinResolve + _extractResolveFields + _resolveSchema + _resolveWhere + 2 near-identical branches
        const _buildResolver = (spec: ResolveSpec<Model.AnyNoContext>) => {
            const obj = typeof spec === 'object' && 'field' in (spec as object) ? spec as { field: string | readonly string[]; many?: true; through?: { base?: string; table: string; target: string } } : undefined;
            const join = obj?.through;
            const raw = obj?.field ?? spec as string | readonly string[];
            const isMany = obj?.many === true;
            const fields = (Array.isArray(raw) ? [...raw] : [raw as string]).map((name) => _resolveField(name, 'resolver.field'));
            const request = fields.length === 1 ? S.Unknown : S.Struct(Object.fromEntries(fields.map((entry) => [entry.field, S.Unknown]))) as unknown as S.Schema.AnyNoContext;
            const refs = join
                ? fields.map((entry) => sql`${sql(join.table)}.${sql(entry.col)}`)
                : fields.map((entry) => { const wrap = Field.resolve(entry.field)?.wrap; return wrap ? sql`${sql.literal(wrap)}(${sql(entry.col)})` : sql`${sql(entry.col)}`; });
            const [$from, $select] = join ? [sql`${sql(table)} JOIN ${sql(join.table)} ON ${sql(table)}.${sql(_toCol(join.base ?? pkCol))} = ${sql(join.table)}.${sql(_toCol(join.target))}`, sql`${sql(table)}.*`] : [sql`${sql(table)}`, sql`*`];
            const $match = (value: unknown) => ((values: unknown[]) => fields.length === 1 ? sql`${refs[0]} IN ${sql.in(values)}` : sql.or((values as Record<string, unknown>[]).map((record) => sql`(${sql.and(fields.map((entry, index) => sql`${refs[index]} = ${record[entry.field]}`))})`)))(Array.isArray(value) ? value : [value]);
            const execute = (value: unknown, lock: false | 'update' | 'share' | 'nowait' | 'skip' = false) => _autoScope('by').pipe(Effect.flatMap(($autoScope) => (isMany
                ? SqlSchema.findAll({ execute: () => sql`SELECT ${$select} FROM ${$from} WHERE ${$match(value)}${$active}${$fresh}${$autoScope}`, Request: request, Result: model })(value)
                : SqlSchema.findOne({ execute: () => sql`SELECT ${$select} FROM ${$from} WHERE ${$match(value)}${$active}${$fresh}${$autoScope}${$lock(lock)}`, Request: request, Result: model })(value)) as Effect.Effect<unknown, SqlError | ParseError, never>));
            return { execute, isMany } as const;
        };
        const resolvers = R.map(config.resolve ?? {}, _buildResolver);
        // --- Query methods ---------------------------------------------------
        const by = <K extends string & keyof NonNullable<C['resolve']>>(key: K, value: unknown, lock: false | 'update' | 'share' | 'nowait' | 'skip' = false): (
            NonNullable<C['resolve']>[K] extends { many: true }
                ? Effect.Effect<readonly S.Schema.Type<M>[], SqlError | ParseError | RepoScopeError | RepoConfigError> // NOSONAR S3358
                : Effect.Effect<Option.Option<S.Schema.Type<M>>, SqlError | ParseError | RepoScopeError | RepoConfigError>
        ) => (resolvers[key]
            ? _withTenantContext('by', resolvers[key].execute(value, lock) as Effect.Effect<unknown, SqlError | ParseError | RepoScopeError, never>) // NOSONAR S3358
            : Effect.fail(new RepoConfigError({ message: `resolver '${String(key)}' not configured`, operation: 'by', table }))) as (
            NonNullable<C['resolve']>[K] extends { many: true }
                ? Effect.Effect<readonly S.Schema.Type<M>[], SqlError | ParseError | RepoScopeError | RepoConfigError>
                : Effect.Effect<Option.Option<S.Schema.Type<M>>, SqlError | ParseError | RepoScopeError | RepoConfigError>
        );
        const find = (predicate: Pred | readonly Pred[], options: { asc?: boolean | undefined } = {}) => _scoped('find', ($s) => SqlSchema.findAll({ execute: () => sql`SELECT * ${$fromWhere(predicate, $s)} ${$order(options.asc ?? false)}`, Request: S.Void, Result: model })(undefined));
        const one = (predicate: Pred | readonly Pred[], lock: false | 'update' | 'share' | 'nowait' | 'skip' = false) => _scoped('one', ($s) => SqlSchema.findOne({ execute: () => sql`SELECT * ${$fromWhere(predicate, $s)}${$lock(lock)}`, Request: S.Void, Result: model })(undefined));
        const page = (predicate: Pred | readonly Pred[], options: { limit?: number | undefined; cursor?: string | undefined; asc?: boolean | undefined } = {}) => {
            const { limit = Page.bounds.default, cursor, asc = false } = options;
            return _scoped('page', ($s) => Page.decode(cursor).pipe(Effect.flatMap(decoded => {
                const cursorFrag = decoded._tag === 'None' ? sql`` : sql`AND ${sql(_pkColumn)} ${asc ? sql`>` : sql`<`} ${decoded.value.id}${pkCast}`;
                return $pagedCte(predicate, $s, sql`WHERE TRUE ${cursorFrag} ${$order(asc)} LIMIT ${limit + 1}`)
                    .pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.keyset(items as unknown as readonly S.Schema.Type<M>[], total, limit, item => ({ id: (item as Record<string, unknown>)[_pkColumn] as string }), Option.isSome(decoded)); }));
            })));
        };
        const count = (predicate: Pred | readonly Pred[]) => _scalar('count', ($s) => sql`SELECT COUNT(*)::int AS count ${$fromWhere(predicate, $s)}`, (row) => (row as { count: number }).count);
        const exists = (predicate: Pred | readonly Pred[]) => _scalar('exists', ($s) => sql`SELECT EXISTS(SELECT 1 ${$fromWhere(predicate, $s)}) AS exists`, (row) => (row as { exists: boolean }).exists);
        const agg = <T extends { sum?: string; avg?: string; min?: string; max?: string; count?: true }>(predicate: Pred | readonly Pred[], spec: T): Effect.Effect<Record<keyof T & string, number>, RepoScopeError | SqlError | ParseError> =>
            _scalar('agg', ($s) => sql`SELECT ${sql.csv(Object.entries(spec).map(([fn, col]) => fn === 'count' ? sql`COUNT(*)::int AS count` : sql`${sql.literal(fn.toUpperCase())}(${sql(col as string)})${(fn === 'avg' || fn === 'sum') ? sql`::numeric` : sql``} AS ${sql.literal(fn)}`))} ${$fromWhere(predicate, $s)}`, (row) => row as Record<keyof T & string, number>);
        const pageOffset = (predicate: Pred | readonly Pred[], options: { limit?: number | undefined; offset?: number | undefined; asc?: boolean | undefined } = {}) => {
            const { limit = Page.bounds.default, offset: start = 0, asc = false } = options;
            return _scoped('pageOffset', ($s) =>
                $pagedCte(predicate, $s, sql`${$order(asc)} LIMIT ${limit} OFFSET ${start}`)
                    .pipe(Effect.map(rows => { const { items, total } = Page.strip(rows as readonly { totalCount: number }[]); return Page.offset(items as unknown as readonly S.Schema.Type<M>[], total, start, limit); })),
            );
        };
        // --- Mutation helpers ------------------------------------------------
        const _withData = <T, E, R>(data: T | readonly T[], onEmpty: (isMany: boolean) => R, onData: (items: readonly T[], isMany: boolean) => Effect.Effect<R, E>): Effect.Effect<R, E> =>
            ((isMany, items) => items.length === 0 ? Effect.succeed(onEmpty(isMany)) : onData(items, isMany))(Array.isArray(data), (Array.isArray(data) ? data : [data]) as readonly T[]);
        // --- Mutation methods ------------------------------------------------
        const _conflictInsert = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[], keys: readonly string[], updates: readonly Statement.Fragment[], occ?: Date) =>
            _withData(data, () => [] as readonly S.Schema.Type<M>[],
                (items, isMany) => isMany && occ
                    ? Effect.fail(new RepoConfigError({ message: 'OCC not supported for bulk operations', operation: 'insert', table }))
                    : items.length === 1
                        ? SqlSchema.findOne({ execute: (row) => sql`INSERT INTO ${sql(table)} ${sql.insert(row)} ON CONFLICT (${sql.csv(keys)}) DO UPDATE SET ${sql.csv(updates)}${$touch}${occ ? sql` WHERE ${sql(table)}.updated_at = ${occ}` : sql``} RETURNING *`, Request: model.insert, Result: model })(items[0])
                            .pipe(Effect.flatMap(opt => Option.match(opt, {
                                onNone: () => Effect.fail(occ ? new RepoOccError({ expected: occ, pk: String((items[0] as Record<string, unknown>)[_pkField]), table }) : new RepoConfigError({ message: 'unexpected empty result', operation: 'insert', table })),
                                onSome: row => Effect.succeed((isMany ? [row] : row) as S.Schema.Type<M> | readonly S.Schema.Type<M>[]),
                            })))
                        : SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} ON CONFLICT (${sql.csv(keys)}) DO UPDATE SET ${sql.csv(updates)}${$touch} RETURNING *`, Request: S.Array(model.insert), Result: model })(items));
        function put<T extends S.Schema.Type<typeof model.insert>>(data: readonly T[], conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException>;
        function put<T extends S.Schema.Type<typeof model.insert>>(data: T, conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<S.Schema.Type<M>, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException>;
        function put<T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[], conflict?: { keys: string[]; only?: string[]; occ?: Date }): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException> {
            return _withTenantContext('put', conflict
                ? _conflictInsert(data, conflict.keys.map(_toCol), $excluded(conflict.keys.map(_toCol), conflict.only?.map(_toCol)), conflict.occ)
                : _withData(data, () => [] as readonly S.Schema.Type<M>[],
                    (items, isMany) => SqlSchema.findAll({ execute: (rows) => sql`INSERT INTO ${sql(table)} ${sql.insert(rows)} RETURNING *`, Request: S.Array(model.insert), Result: model })(items)
                        .pipe(Effect.map(rows => isMany ? rows : rows[0]))));
        }
        const set = (input: string | [string, unknown] | Pred | readonly Pred[], updates: Record<string, unknown>, scope?: Record<string, unknown>, when?: Pred | readonly Pred[]) => {
            const single = _isSingle(input);
            const entries = $entries(updates), $p = single ? $target(input) : $where(input as Pred | readonly Pred[]), $s = $scope(scope);
            const $guard = when ? sql` AND ${$where(when)}` : sql``;
            const schema = when === undefined ? SqlSchema.single : SqlSchema.findOne;
            const entriesNonEmpty = A.isNonEmptyArray(entries);
            const effect = Match.value({ entriesNonEmpty, single }).pipe(
                Match.when({ entriesNonEmpty: true,  single: true }, () => schema({ execute: () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$p}${$s}${$active}${$guard} RETURNING *`, Request: S.Void, Result: model })(undefined)),
                Match.when({ entriesNonEmpty: true,  single: false }, () => sql`UPDATE ${sql(table)} SET ${sql.csv(entries)}${$touch} WHERE ${$p}${$s}${$active}${$guard} RETURNING 1`.pipe(Effect.map(rows => rows.length))),
                Match.when({ entriesNonEmpty: false, single: true }, () => schema({ execute: () => sql`SELECT * FROM ${sql(table)} WHERE ${$p}${$s}${$active}${$guard}`, Request: S.Void, Result: model })(undefined)),
                Match.when({ entriesNonEmpty: false, single: false }, () => sql`SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE ${$p}${$s}${$active}${$guard}`.pipe(Effect.map((rows): number => (rows[0] as { count: number }).count))),
                Match.exhaustive,
            );
            return _withTenantContext('set', effect);
        };
        const _softOps = { drop: { guard: sql`IS NULL`, ts: sql`NOW()` }, lift: { guard: sql`IS NOT NULL`, ts: sql`NULL` } } as const satisfies Record<'drop' | 'lift', { guard: Statement.Fragment; ts: Statement.Fragment }>;
        const _soft = (op: 'drop' | 'lift') => ((input: string | readonly string[] | Pred | readonly Pred[], scope?: Record<string, unknown>) => {
            const { ts, guard } = _softOps[op];
            const _bulkWhere = (bulk: readonly string[] | Pred | readonly Pred[]) => Array.isArray(bulk) && typeof bulk[0] === 'string'
                ? sql`${sql(_pkColumn)} IN ${sql.in(bulk as string[])}`
                : $where(bulk as Pred | readonly Pred[]);
            const _singleUpdate = (entry: typeof softEntry & object) =>
                SqlSchema.single({ execute: () => sql`UPDATE ${sql(table)} SET ${sql(entry.col)} = ${ts}${$touch} WHERE ${$target(input as string)}${$scope(scope)} AND ${sql(entry.col)} ${guard} RETURNING *`, Request: S.Void, Result: model })(undefined);
            const _bulkUpdate = (entry: typeof softEntry & object) =>
                sql`UPDATE ${sql(table)} SET ${sql(entry.col)} = ${ts}${$touch} WHERE ${_bulkWhere(input as readonly string[] | Pred | readonly Pred[])}${$scope(scope)} AND ${sql(entry.col)} ${guard} RETURNING 1`.pipe(Effect.map(rows => rows.length));
            const effect: Effect.Effect<number | S.Schema.Type<M>, RepoConfigError | SqlError | ParseError | Cause.NoSuchElementException> =
                Array.isArray(input) && !(input as readonly unknown[]).length ? Effect.succeed(0)
                : softEntry && typeof input === 'string' ? _singleUpdate(softEntry)
                : softEntry ? _bulkUpdate(softEntry)
                : Effect.fail(new RepoConfigError({ message: 'soft delete column not configured', operation: op, table }));
            return _withTenantContext(op, effect);
        }) as {
            (input: string, scope?: Record<string, unknown>): Effect.Effect<S.Schema.Type<M>, SqlError | ParseError | Cause.NoSuchElementException | RepoConfigError | RepoScopeError>;
            (input: readonly string[] | Pred | readonly Pred[], scope?: Record<string, unknown>): Effect.Effect<number, SqlError | RepoConfigError | RepoScopeError>;
        };
        const drop = _soft('drop');
        const lift = _soft('lift');
        const purge = (days?: number): Effect.Effect<number, RepoConfigError | RepoScopeError | SqlError | ParseError | Cause.NoSuchElementException> => {
            const _purgeEffect = (cfg: NonNullable<typeof config.purge>) =>
                typeof cfg === 'string'
                    ? SqlSchema.single({
                        execute: (num) => sql`SELECT ${sql.literal(cfg)}(${num}) AS count`,
                        Request: S.Number,
                        Result: S.Struct({ count: S.Int }),
                    })(days ?? 30).pipe(Effect.map((row) => row.count))
                    : SqlSchema.single({
                        execute: (params) => sql`SELECT purge_table(${params.table}, ${params.column}, ${params.days}) AS count`,
                        Request: S.Struct({ column: S.String, days: S.Int, table: S.String }),
                        Result: S.Struct({ count: S.Int }),
                    })({ column: _toCol(cfg.column), days: days ?? cfg.defaultDays ?? 30, table: cfg.table }).pipe(Effect.map((row) => row.count));
            const effect: Effect.Effect<number, RepoConfigError | SqlError | ParseError | Cause.NoSuchElementException> = config.purge
                ? _purgeEffect(config.purge)
                : Effect.fail(new RepoConfigError({ message: 'purge function not configured', operation: 'purge', table }));
            return _withTenantContext('purge', effect);
        };
        function upsert<T extends S.Schema.Type<typeof model.insert>>(data: readonly T[], occ?: Date): Effect.Effect<readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError>;
        function upsert<T extends S.Schema.Type<typeof model.insert>>(data: T, occ?: Date): Effect.Effect<S.Schema.Type<M>, RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError>;
        function upsert<T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[], occ?: Date): Effect.Effect<S.Schema.Type<M> | readonly S.Schema.Type<M>[], RepoConfigError | RepoOccError | RepoScopeError | SqlError | ParseError> {
            return _withTenantContext('upsert', upsertConfiguration
                ? _conflictInsert(data, upsertConfiguration.keys, upsertConfiguration.updates, occ)
                : Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'upsert', table })));
        }
        type _Merged = S.Schema.Type<M> & { readonly _action: 'insert' | 'update' };
        const merge = <T extends S.Schema.Type<typeof model.insert>>(data: T | readonly T[]): Effect.Effect<_Merged | readonly _Merged[], RepoConfigError | RepoScopeError | SqlError | ParseError> =>
            _withTenantContext('merge', (upsertConfiguration
                ? _withData<Record<string, unknown>, SqlError | ParseError, _Merged | readonly _Merged[]>(
                    data as Record<string, unknown> | readonly Record<string, unknown>[],
                    () => [] as readonly _Merged[],
                    (items, isMany) => sql`MERGE INTO ${sql(table)} USING (VALUES ${sql.csv(items.map(item => sql`(${sql.csv(_insertFields.map(field => sql`${item[field]}`))})`))} ) AS source(${sql.csv(_insertCols.map(column => sql`${sql(column)}`))})
                    ON ${sql.and(upsertConfiguration.keys.map((key) => sql`${sql(table)}.${sql(key)} = source.${sql(key)}`))}
                    WHEN MATCHED THEN UPDATE SET ${sql.csv(_insertCols.filter(column => !upsertConfiguration.keys.includes(column)).map(column => sql`${sql(column)} = source.${sql(column)}`))}${$touch}
                    WHEN NOT MATCHED THEN INSERT (${sql.csv(_insertCols.map(column => sql`${sql(column)}`))}) VALUES (${sql.csv(_insertCols.map(column => sql`source.${sql(column)}`))})
                        RETURNING *, (CASE WHEN xmax = 0 THEN 'insert' ELSE 'update' END) AS _action`
                        .pipe(Effect.map(results => isMany ? results as _Merged[] : results[0] as _Merged))
                )
                : Effect.fail(new RepoConfigError({ message: 'conflict keys not configured', operation: 'merge', table }))) as Effect.Effect<_Merged | readonly _Merged[], RepoConfigError | SqlError | ParseError>);
        const stream = (predicate: Pred | readonly Pred[], options: { asc?: boolean } = {}): Stream.Stream<S.Schema.Type<M>, RepoScopeError | SqlError | ParseError> =>
            Stream.unwrap(
                _autoScope('stream').pipe(
                    Effect.map(($s) => Stream.mapEffect(sql`SELECT * ${$fromWhere(predicate, $s)} ${$order(options.asc ?? false)}`.stream, S.decodeUnknown(model))),
                ),
            );
        // Why: _callFn returns Effect<unknown> — generic <T> lets callers narrow the return type per function name
        const fn = <T = unknown>(name: string, params: Record<string, unknown>) => _withTenantContext('fn', _callFn(sql, config.functions, model, table)(name, params) as Effect.Effect<T, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException>);
        const withTransaction = sql.withTransaction;
        const json = {
            decode: <A, I, R>(field: string, schema: S.Schema<A, I, R>) => (opt: Option.Option<S.Schema.Type<M>>): Effect.Effect<Option.Option<A>, never, R> => Option.isNone(opt) ? Effect.succeed(Option.none<A>()) : S.decodeUnknown(S.parseJson(schema))((opt.value as Record<string, unknown>)[field]).pipe(Effect.option),
            encode: <A, I, R>(schema: S.Schema<A, I, R>) => (value: A): Effect.Effect<string, ParseError, R> => S.encode(S.parseJson(schema))(value),
        };
        const touch = (field: string) => (id: string) => set(id, { [field]: Update.now });
        const wildcard = (field: string, value: string | undefined): readonly Pred[] =>
            value === undefined
                ? []
                : [{ field, op: (value.includes('*') ? 'like' : 'eq'), value: value.replaceAll('*', '%') }];
        // Why: compound (array) resolve specs need named-param delegates — kept manual in repos.ts
        const _resolverDelegates = Object.fromEntries(
            Object.entries(config.resolve ?? {}).filter(([, spec]) => !Array.isArray(spec)).map(([name]) => [
                name, (value: unknown) => by(name as string & keyof NonNullable<C['resolve']>, value),
            ]),
        ) as _ResolverSurface<M, C>;
        // Why: repos without softEntry get phantom signatures absent at runtime — type-level compromise for the spread
        const _scopeArg = (scopeVal?: string): Record<string, unknown> | undefined => Option.flatMap(_scopeOpt, (col) => Option.fromNullable(scopeVal).pipe(Option.map((v) => ({ [col]: v })))).pipe(Option.getOrUndefined);
        const _softDelegates = (softEntry
            ? { restore: (id: string, scopeVal?: string) => lift(id, _scopeArg(scopeVal)), softDelete: (id: string, scopeVal?: string) => drop(id, _scopeArg(scopeVal)) }
            : {}) as { restore: (id: string, scopeVal?: string) => ReturnType<typeof lift>; softDelete: (id: string, scopeVal?: string) => ReturnType<typeof drop> };
        return { ...base, ..._resolverDelegates, ..._softDelegates, agg, by, count, drop, exists, find, fn, json, lift, merge, one, page, pageOffset, pg, preds, purge, put, set, stream, touch, upsert, wildcard, withTransaction };
        });
const routine = <const C extends { functions?: Record<string, FnCallSpec> }>(table: string, config: C) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Why: _callFn returns Effect<unknown> — generic <T> lets callers narrow the return type per function name
        const fn = <T = unknown>(name: string, params: Record<string, unknown>) => _callFn(sql, config.functions, undefined, table)(name, params) as Effect.Effect<T, RepoConfigError | RepoUnknownFnError | SqlError | ParseError | Cause.NoSuchElementException>;
        const delegate = <T = unknown>(name: string) => (params: Record<string, unknown> = {}) => fn<T>(name, params);
        return { delegate, fn };
    });

// --- [EXPORT] ----------------------------------------------------------------

export { repo, routine, Update };
