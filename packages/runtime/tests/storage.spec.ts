/**
 * Validate storage factory via property-based testing.
 * Tests createStorage factory and STORAGE_TUNING constants.
 */
import { it } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { describe, expect } from 'vitest';
import { createStorage, STORAGE_TUNING } from '../src/store/storage';

// --- [TYPES] -----------------------------------------------------------------

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    storageTypes: ['localStorage', 'sessionStorage', 'cookies', 'indexedDB'] as const,
    tuning: {
        cookie: { expires: 365, path: '/', sameSite: 'Lax', secure: true },
    },
} as const);

// --- [DESCRIBE_STORAGE_TUNING] -----------------------------------------------

describe('STORAGE_TUNING', () => {
    it('cookie defaults match expected values', () => {
        expect(STORAGE_TUNING.cookie.expires).toBe(B.tuning.cookie.expires);
        expect(STORAGE_TUNING.cookie.path).toBe(B.tuning.cookie.path);
        expect(STORAGE_TUNING.cookie.sameSite).toBe(B.tuning.cookie.sameSite);
        expect(STORAGE_TUNING.cookie.secure).toBe(B.tuning.cookie.secure);
    });
});

// --- [DESCRIBE_CREATE_STORAGE] -----------------------------------------------

describe('createStorage', () => {
    it('defaults to localStorage when no type specified', () => {
        const storage = createStorage();
        expect(storage).toBeDefined();
        expect(typeof storage?.getItem).toBe('function');
        expect(typeof storage?.setItem).toBe('function');
        expect(typeof storage?.removeItem).toBe('function');
    });
    it.each(B.storageTypes)('creates functional adapter for %s', (type) => {
        const storage = createStorage(type);
        expect(storage).toBeDefined();
        expect(typeof storage?.getItem).toBe('function');
        expect(typeof storage?.setItem).toBe('function');
        expect(typeof storage?.removeItem).toBe('function');
    });
    it('localStorage adapter preserves JSON structure', async () => {
        const storage = createStorage('localStorage');
        expect(storage).toBeDefined();
        const value = { state: { nested: { a: 1 }, test: 'value' }, version: 0 };
        await storage?.setItem('test-key', value);
        expect(await storage?.getItem('test-key')).toEqual(value);
    });
    it('sessionStorage adapter preserves JSON structure', async () => {
        const storage = createStorage('sessionStorage');
        expect(storage).toBeDefined();
        const value = { state: { session: 'data' } };
        await storage?.setItem('session-key', value);
        expect(await storage?.getItem('session-key')).toEqual(value);
    });
    it('returns null for missing key', async () => {
        const storage = createStorage('localStorage');
        expect(storage).toBeDefined();
        expect(await storage?.getItem('missing-key-xyz')).toBeNull();
    });
});

// --- [DESCRIBE_ROUND_TRIP] ---------------------------------------------------

describe('round-trip via createStorage', () => {
    it.prop([FC_ARB.storageKey()])('localStorage handles large JSON values', async (key) => {
        const storage = createStorage('localStorage');
        const value = { state: { data: 'x'.repeat(1000) }, version: 0 };
        await storage?.setItem(key, value);
        expect(await storage?.getItem(key)).toEqual(value);
    });
    it.prop([FC_ARB.storageKey()])('sessionStorage handles nested JSON structures', async (key) => {
        const storage = createStorage('sessionStorage');
        const value = { state: { a: { b: { c: { d: [1, 2, 3] } } } }, version: 0 };
        await storage?.setItem(key, value);
        expect(await storage?.getItem(key)).toEqual(value);
    });
    it('multiple sequential operations maintain consistency', async () => {
        const storage = createStorage('localStorage');
        await storage?.setItem('key1', { state: { v: 'value1' }, version: 0 });
        await storage?.setItem('key2', { state: { v: 'value2' }, version: 0 });
        expect(await storage?.getItem('key1')).toEqual({ state: { v: 'value1' }, version: 0 });
        expect(await storage?.getItem('key2')).toEqual({ state: { v: 'value2' }, version: 0 });
        await storage?.removeItem('key1');
        expect(await storage?.getItem('key1')).toBeNull();
        expect(await storage?.getItem('key2')).toEqual({ state: { v: 'value2' }, version: 0 });
    });
});
