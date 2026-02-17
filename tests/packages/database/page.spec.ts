/** page.ts tests: encode/decode cursor inverse, keyset/offset pagination, schema defaults, strip. */
import { it } from '@effect/vitest';
import { Page } from '@parametric-portal/database/page';
import { Effect, FastCheck as fc, Option, Schema as S } from 'effect';
import { describe, expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _uuid = fc.uuid();
const _int = fc.integer();
const _validLimit = fc.integer({ max: 1000, min: 1 });
const _row = fc.record({ id: fc.uuid(), totalCount: fc.nat({ max: 999 }), value: fc.integer() });

// --- [ALGEBRAIC] -------------------------------------------------------------

describe('Page', () => {
    it.effect.prop('P1: encode/decode inverse (id-only + compound)', { id: _uuid, v: _int }, ({ id, v }) =>
        Effect.gen(function* () {
            expect(yield* Page.decode(Page.encode(id))).toEqual(Option.some({ id }));
            expect(yield* Page.decode(Page.encode(id, v, S.Int), S.Int)).toEqual(Option.some({ id, v }));
        }),
    { fastCheck: { numRuns: 100 } });
    it.effect.prop('P2: strip removes totalCount, extracts total', {
        rows: fc.array(_row, { maxLength: 10, minLength: 1 }),
    }, ({ rows }) => Effect.sync(() => {
        const { items, total } = Page.strip(rows);
        expect(items.length).toBe(rows.length);
        expect(items.every((item) => !('totalCount' in item))).toBe(true);
        expect(items.every((item) => 'id' in item && 'value' in item)).toBe(true);
        expect(total).toBe(rows[0]?.totalCount);
    }), { fastCheck: { numRuns: 100 } });
    it.effect.prop('P3: keyset hasNext correctness', {
        extra:    fc.boolean(),
        limit:    fc.integer({ max: 10, min: 1 }),
        rowCount: fc.integer({ max: 10, min: 0 }),
    }, ({ extra, limit, rowCount }) => Effect.sync(() => {
        const actualCount = extra ? limit + 1 : Math.min(rowCount, limit);
        const rows = Array.from({ length: actualCount }, (_, index) => ({ id: `id-${String(index)}` }));
        const result = Page.keyset(rows, actualCount, limit, (row) => ({ id: row.id }));
        expect(result.hasNext).toBe(rows.length > limit);
        expect(result.items.length).toBe(Math.min(rows.length, limit));
    }), { fastCheck: { numRuns: 100 } });
    it.effect.prop('P4: offset page math', {
        itemCount: fc.integer({ max: 20, min: 0 }),
        limit:     fc.integer({ max: 10, min: 1 }),
        start:     fc.nat({     max: 50         }),
        total:     fc.nat({     max: 100        }),
    }, ({ itemCount, limit, start, total }) => Effect.sync(() => {
        const items = Array.from({ length: itemCount }, (_, index) => index);
        const result = Page.offset(items, total, start, limit);
        expect(result.page).toBe(Math.floor(start / limit) + 1);
        expect(result.pages).toBe(Math.ceil(total / limit));
        expect(result.hasPrev).toBe(start > 0);
        expect(result.hasNext).toBe(start + items.length < total);
    }), { fastCheck: { numRuns: 100 } });
    it.effect.prop('P5: Limit rejects out-of-range', { valid: _validLimit }, ({ valid }) =>
        Effect.sync(() => {
            expect(S.decodeSync(Page.Keyset)({ limit: valid }).limit).toBe(valid);
            expect(() => S.decodeSync(Page.Keyset)({ limit: 0 })).toThrow();
            expect(() => S.decodeSync(Page.Keyset)({ limit: 1001 })).toThrow();
            expect(() => S.decodeSync(Page.Keyset)({ limit: -1 })).toThrow();
            expect(() => S.decodeSync(Page.Keyset)({ limit: 1.5 })).toThrow();
        }),
    { fastCheck: { numRuns: 50 } });
    // --- [EDGE_CASES] --------------------------------------------------------
    it.effect('E1: decode graceful degradation', () =>
        Effect.gen(function* () {
            expect(yield* Page.decode(undefined)).toEqual(Option.none());
            expect(yield* Page.decode('not-base64!!!')).toEqual(Option.none());
            expect(yield* Page.decode('')).toEqual(Option.none());
            expect(yield* Page.decode('aW52YWxpZA')).toEqual(Option.none());
            expect(yield* Page.decode(Page.encode('test-id', 42, S.Int), S.String)).toEqual(Option.none());
        }));
    it.effect('E2: strip empty and schema defaults', () =>
        Effect.sync(() => {
            expect(Page.strip([])).toStrictEqual({ items: [], total: 0 });
            expect(Page.bounds).toStrictEqual({ default: 100, max: 1000, min: 1 });
            expect(S.decodeSync(Page.Keyset)({}).limit).toBe(100);
            expect(S.decodeSync(Page.KeysetInput)({})).toEqual({ asc: false, cursor: undefined, limit: 100 });
            expect(S.decodeSync(Page.Offset)({})).toEqual({ limit: 100, offset: 0 });
            expect(S.decodeSync(Page.OffsetInput)({})).toEqual({ asc: false, limit: 100, offset: 0 });
        }));
    it.effect('E3: keyset boundary conditions', () =>
        Effect.sync(() => {
            const empty = Page.keyset([], 0, 10, (row: { id: string }) => ({ id: row.id }));
            expect(empty).toStrictEqual({ cursor: null, hasNext: false, hasPrev: false, items: [], total: 0 });
            const exact = Page.keyset([{ id: 'a' }, { id: 'b' }], 2, 2, (row) => ({ id: row.id }));
            expect(exact.hasNext).toBe(false);
            expect(exact.items.length).toBe(2);
            expect(exact.cursor).toBe(Page.encode('b'));
            const rows = [{ id: 'only' }];
            expect(Page.keyset(rows, 1, 5, (row) => ({ id: row.id }), true).hasPrev).toBe(true);
            expect(Page.keyset(rows, 1, 5, (row) => ({ id: row.id }), false).hasPrev).toBe(false);
            expect(Page.keyset(rows, 1, 5, (row) => ({ id: row.id })).hasPrev).toBe(false);
        }));
    it.effect('E4: keyset cursor targets last sliced item', () =>
        Effect.gen(function* () {
            const idRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
            const idResult = Page.keyset(idRows, 10, 2, (row) => ({ id: row.id }));
            expect(idResult.items).toStrictEqual([{ id: 'a' }, { id: 'b' }]);
            expect(idResult.cursor).toBe(Page.encode('b'));
            expect(yield* Page.decode(idResult.cursor ?? '')).toEqual(Option.some({ id: 'b' }));
            const ranked = [{ id: 'x', rank: 10 }, { id: 'y', rank: 20 }, { id: 'z', rank: 30 }];
            const compResult = Page.keyset(ranked, 10, 2, (row) => ({ id: row.id, v: row.rank }), S.Int, true);
            expect(compResult.items.length).toBe(2);
            expect(compResult.cursor).toBe(Page.encode('y', 20, S.Int));
            expect(yield* Page.decode(compResult.cursor ?? '', S.Int)).toEqual(Option.some({ id: 'y', v: 20 }));
        }));
    it.effect('E5: offset edge cases', () =>
        Effect.sync(() => {
            expect(Page.offset(['a'], 1, 0, 0)).toStrictEqual({ hasNext: false, hasPrev: false, items: ['a'], page: 1, pages: 1, total: 1 });
            expect(Page.offset(['a', 'b'], 5, 2, 2)).toStrictEqual({ hasNext: true, hasPrev: true, items: ['a', 'b'], page: 2, pages: 3, total: 5 });
            expect(Page.offset(['e'], 5, 4, 2)).toStrictEqual({ hasNext: false, hasPrev: true, items: ['e'], page: 3, pages: 3, total: 5 });
        }));
});
