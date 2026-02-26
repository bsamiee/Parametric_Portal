/**
 * Implement keyset and offset pagination for PostgreSQL 18.2 + @effect/sql.
 * Polymorphic cursor encoding; fetch LIMIT+1 for accurate hasNext detection.
 */
import { Effect, Option, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const bounds = { default: 100, max: 1000, min: 1 } as const;
const _Limit = S.optionalWith(S.Int.pipe(S.between(bounds.min, bounds.max)), { default: () => bounds.default });
const _Asc =   S.optionalWith(S.Boolean, { default: () => false });
// Base schemas (response/runtime shape)
const Keyset = S.Struct({ cursor: S.optional(S.String), limit: _Limit });
const Offset = S.Struct({ limit: _Limit, offset: S.optionalWith(S.NonNegativeInt, { default: () => 0 }) });
// Input schemas extend base with sort direction
const KeysetInput = S.extend(Keyset, S.Struct({ asc: _Asc }));
const OffsetInput = S.extend(Offset, S.Struct({ asc: _Asc }));
const _idCursor =   S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.String })));
const _compoundCursor = <V, I>(vSchema: S.Schema<V, I, never>) => S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.String, v: vSchema })));

// --- [FUNCTIONS] -------------------------------------------------------------

const strip = <T extends { totalCount: number }>(rows: readonly T[]): { items: Omit<T, 'totalCount'>[]; total: number } => ({ items: rows.map(({ totalCount: _, ...rest }) => rest), total: rows[0]?.totalCount ?? 0 });
function decode(raw: string | undefined): Effect.Effect<Option.Option<{ id: string }>>;
function decode<V, I>(raw: string | undefined, vSchema: S.Schema<V, I, never>): Effect.Effect<Option.Option<{ id: string; v: V }>>;
function decode<V, I>(raw: string | undefined, vSchema?: S.Schema<V, I, never>) {
    return Option.fromNullable(raw).pipe(Option.match({
        onNone: () => Effect.succeed(Option.none()),
        onSome: (encoded) => (vSchema ? S.decode(_compoundCursor(vSchema))(encoded) : S.decode(_idCursor)(encoded)).pipe(Effect.map(Option.some), Effect.catchAll(() => Effect.succeed(Option.none()))),
    }));
}
function encode(id: string): string;
function encode<V, I>(id: string, v: V, vSchema: S.Schema<V, I, never>): string;
function encode<V, I>(id: string, v?: V, vSchema?: S.Schema<V, I, never>): string {
    return vSchema !== undefined && v !== undefined ? S.encodeSync(_compoundCursor(vSchema))({ id, v }) : S.encodeSync(_idCursor)({ id });
}
function keyset<T>(rows: readonly T[], total: number, limit: number, key: (t: T) => { id: string }, hasPrev?: boolean): { cursor: string | null; hasNext: boolean; hasPrev: boolean; items: readonly T[]; total: number };
function keyset<T, V, I>(rows: readonly T[], total: number, limit: number, key: (t: T) => { id: string; v: V }, vSchema: S.Schema<V, I, never>, hasPrev?: boolean): { cursor: string | null; hasNext: boolean; hasPrev: boolean; items: readonly T[]; total: number };
function keyset<T, V, I>(rows: readonly T[], total: number, limit: number, key: (t: T) => { id: string; v?: V }, vSchemaOrHasPrev?: S.Schema<V, I, never> | boolean, hasPrev = false) {
    const vSchema = typeof vSchemaOrHasPrev === 'boolean' ? undefined : vSchemaOrHasPrev;
    const prev = typeof vSchemaOrHasPrev === 'boolean' ? vSchemaOrHasPrev : hasPrev;
    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    const cursor = Option.fromNullable(items.at(-1)).pipe(
        Option.map((last) => { const cursorKey = key(last); return vSchema && cursorKey.v !== undefined ? encode(cursorKey.id, cursorKey.v, vSchema) : encode(cursorKey.id); }),
        Option.getOrNull,
    );
    return { cursor, hasNext, hasPrev: prev, items, total };
}
const offset = <T>(items: readonly T[], total: number, start: number, limit: number) => ({
    hasNext: start + items.length < total, hasPrev: start > 0, items,
    page: limit > 0 ? Math.floor(start / limit) + 1 : 1,
    pages: limit > 0 ? Math.ceil(total / limit) : Math.min(total, 1),
    total,
});

// --- [OBJECT] ----------------------------------------------------------------

const Page = {
    bounds, decode, encode, Keyset, KeysetInput, keyset, Offset, OffsetInput, offset, strip,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Page };
