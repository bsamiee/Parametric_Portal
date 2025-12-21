/**
 * Validate temporal operations via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { createTemporal, TEMPORAL_TUNING } from '../src/temporal.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => createTemporal();

const arbitraryIsoDate = fc
    .date({ max: new Date('2099-12-31'), min: new Date('2000-01-01') })
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.toISOString());
const arbitraryDays = fc.integer({ max: 365, min: 1 });

// --- [TESTS] -----------------------------------------------------------------

describe('temporal package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.parse).toBeDefined();
            expect(api.formatDate).toBeDefined();
            expect(api.addDays).toBeDefined();
            expect(api.daysBetween).toBeDefined();
            expect(api.createRegistry).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(TEMPORAL_TUNING)).toBe(true);
            expect(TEMPORAL_TUNING.defaultFormat).toBe('yyyy-MM-dd');
        });
    });

    describe('date parsing', () => {
        it.prop([arbitraryIsoDate])('parses valid iso date', (isoDate) => {
            const api = loadApi();
            const result = Effect.runSync(api.parse(isoDate));
            expect(result).toBeInstanceOf(Date);
            expect(result.toISOString()).toBe(isoDate);
        });

        it('rejects invalid date string', () => {
            const api = loadApi();
            const result = Effect.runSyncExit(api.parse('not-a-date'));
            expect(result._tag).toBe('Failure');
        });

        it('rejects malformed iso date', () => {
            const api = loadApi();
            const result = Effect.runSyncExit(api.parse('2024-13-45'));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('date formatting', () => {
        it.prop([arbitraryIsoDate])('formats date with default format', (isoDate) => {
            const api = loadApi();
            const date = new Date(isoDate);
            const result = Effect.runSync(api.formatDate()(date));
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it.prop([arbitraryIsoDate])('formats date with custom format', (isoDate) => {
            const api = loadApi();
            const date = new Date(isoDate);
            const result = Effect.runSync(api.formatDate('yyyy/MM/dd')(date));
            expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
        });

        it('uses config default format', () => {
            const api = createTemporal({ defaultDateFormat: 'MM-dd-yyyy' });
            const date = new Date('2024-01-15');
            const result = Effect.runSync(api.formatDate()(date));
            expect(result).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        });
    });

    describe('date arithmetic', () => {
        it.prop([arbitraryIsoDate, arbitraryDays])('adds days to date', (isoDate, days) => {
            const api = loadApi();
            const date = new Date(isoDate);
            const result = Effect.runSync(api.addDays(days)(date));
            expect(result.getTime()).toBeGreaterThan(date.getTime());
        });

        it.prop([arbitraryIsoDate, arbitraryDays])('calculates days between dates', (isoDate, days) => {
            const api = loadApi();
            const start = new Date(isoDate);
            const end = Effect.runSync(api.addDays(days)(start));
            const diff = Effect.runSync(api.daysBetween(start, end));
            expect(diff).toBe(days);
        });

        it('handles negative day differences', () => {
            const api = loadApi();
            const start = new Date('2024-01-15');
            const end = new Date('2024-01-10');
            const diff = Effect.runSync(api.daysBetween(start, end));
            expect(diff).toBeLessThan(0);
        });
    });

    describe('brand registry', () => {
        it('creates empty registry', () => {
            const api = loadApi();
            const registry = api.createRegistry();
            expect(registry.getBrandNames()).toEqual([]);
            expect(registry.hasBrand('test')).toBe(false);
        });

        it.prop([fc.string({ maxLength: 20, minLength: 1 })])('registers brand', (brandName) => {
            const api = loadApi();
            const registry = api.createRegistry();
            registry.register(brandName);
            expect(registry.hasBrand(brandName)).toBe(true);
            expect(registry.getBrandNames()).toContain(brandName);
        });

        it.prop([fc.string({ maxLength: 20, minLength: 1 })])('unregisters brand', (brandName) => {
            const api = loadApi();
            const registry = api.createRegistry();
            registry.register(brandName);
            expect(registry.hasBrand(brandName)).toBe(true);
            registry.unregister(brandName);
            expect(registry.hasBrand(brandName)).toBe(false);
        });

        it('clears all brands', () => {
            const api = loadApi();
            const registry = api.createRegistry();
            registry.register('brand1');
            registry.register('brand2');
            expect(registry.getBrandNames()).toHaveLength(2);
            registry.clear();
            expect(registry.getBrandNames()).toEqual([]);
        });

        it.prop([fc.array(fc.string({ maxLength: 20, minLength: 1 }), { maxLength: 10 })])(
            'manages multiple brands',
            (brandNames) => {
                const api = loadApi();
                const registry = api.createRegistry();
                for (const name of brandNames) {
                    registry.register(name);
                }
                const registered = registry.getBrandNames();
                for (const name of brandNames) {
                    expect(registered).toContain(name);
                }
            },
        );
    });

    describe('immer integration', () => {
        it('exposes produce function', () => {
            const api = loadApi();
            expect(api.produce).toBeDefined();
            expect(typeof api.produce).toBe('function');
        });

        it('uses produce for immutable updates', () => {
            const api = loadApi();
            const state = { count: 0, name: 'test' };
            const updated = api.produce(state, (draft) => {
                draft.count = 42;
            });
            expect(state.count).toBe(0);
            expect(updated.count).toBe(42);
            expect(updated.name).toBe('test');
        });
    });
});
