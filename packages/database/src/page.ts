/**
 * Implement keyset and offset pagination for PostgreSQL 18.1 + @effect/sql.
 * Polymorphic cursor encoding; fetch LIMIT+1 for accurate hasNext detection.
 */
import { Effect, Option, Schema as S } from 'effect';
import type { Simplify } from 'type-fest';

// --- [SCHEMA] ----------------------------------------------------------------

const _PAGE_BOUNDS = { default: 100, max: 1000, min: 1 } as const;
const Limit = S.optionalWith(S.Int.pipe(S.between(_PAGE_BOUNDS.min, _PAGE_BOUNDS.max)), { default: () => _PAGE_BOUNDS.default });
const Asc = S.optionalWith(S.Boolean, { default: () => false });
const Keyset = S.Struct({ cursor: S.optional(S.String), limit: Limit });
const Offset = S.Struct({ limit: Limit, offset: S.optionalWith(S.NonNegativeInt, { default: () => 0 }) });
const KeysetInput = S.Struct({ asc: Asc, cursor: S.optional(S.String), limit: Limit });
const OffsetInput = S.Struct({ asc: Asc, limit: Limit, offset: S.optionalWith(S.NonNegativeInt, { default: () => 0 }) });
const IdCursor = S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.String })));
const compoundCursor = <V, I>(vSchema: S.Schema<V, I, never>) => S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.String, v: vSchema })));

// --- [FUNCTIONS] -------------------------------------------------------------

const withCount = <T extends S.Struct.Fields>(fields: T) => S.Struct({ ...fields, totalCount: S.NumberFromString });
const strip = <T extends { totalCount: number }>(rows: readonly T[]): { items: Omit<T, 'totalCount'>[]; total: number } => ({ items: rows.map(({ totalCount: _, ...rest }) => rest), total: rows[0]?.totalCount ?? 0 });
const tryDecode = <A>(schema: S.Schema<A, string, never>) => (raw: string) => S.decode(schema)(raw).pipe(Effect.map(Option.some<A>), Effect.catchAll(() => Effect.succeed(Option.none())));
function decode(raw: string | undefined): Effect.Effect<Option.Option<{ id: string }>>;
function decode<V, I>(raw: string | undefined, vSchema: S.Schema<V, I, never>): Effect.Effect<Option.Option<{ id: string; v: V }>>;
function decode<V, I>(raw: string | undefined, vSchema?: S.Schema<V, I, never>) {
	return Option.fromNullable(raw).pipe(
		Option.match({
			onNone: () => Effect.succeed(Option.none()),
			onSome: (encoded) => vSchema ? tryDecode(compoundCursor(vSchema))(encoded) : tryDecode(IdCursor)(encoded),
		}),
	);
}
function encode(id: string): string;
function encode<V, I>(id: string, v: V, vSchema: S.Schema<V, I, never>): string;
function encode<V, I>(id: string, v?: V, vSchema?: S.Schema<V, I, never>): string {
	return vSchema !== undefined && v !== undefined
		? S.encodeSync(compoundCursor(vSchema))({ id, v })
		: S.encodeSync(IdCursor)({ id });
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

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Page = {
	Asc,
	bounds: _PAGE_BOUNDS,
	decode,
	encode,
	Keyset,
	KeysetInput,
	keyset,
	Limit,
	Offset,
	OffsetInput,
	offset,
	strip,
	withCount,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Page {
	export type Asc = S.Schema.Type<typeof Asc>;
	export type Bounds = typeof _PAGE_BOUNDS;
	export type Cursor = Simplify<{ readonly id: string }>;
	export type CursorCompound<V> = Simplify<{ readonly id: string; readonly v: V }>;
	export type Keyset = S.Schema.Type<typeof Keyset>;
	export type KeysetEncoded = S.Schema.Encoded<typeof Keyset>;
	export type KeysetInput = S.Schema.Type<typeof KeysetInput>;
	export type KeysetInputEncoded = S.Schema.Encoded<typeof KeysetInput>;
	export type KeysetOut<T> = Simplify<{ readonly cursor: string | null; readonly hasNext: boolean; readonly hasPrev: boolean; readonly items: readonly T[]; readonly total: number }>;
	export type Limit = Keyset['limit'];
	export type Offset = S.Schema.Type<typeof Offset>;
	export type OffsetEncoded = S.Schema.Encoded<typeof Offset>;
	export type OffsetInput = S.Schema.Type<typeof OffsetInput>;
	export type OffsetInputEncoded = S.Schema.Encoded<typeof OffsetInput>;
	export type OffsetOut<T> = Simplify<{ readonly hasNext: boolean; readonly hasPrev: boolean; readonly items: readonly T[]; readonly page: number; readonly pages: number; readonly total: number }>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Page };
