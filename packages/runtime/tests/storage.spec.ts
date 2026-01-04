/**
 * Validate storage adapters via property-based testing.
 * Covers localStorage, sessionStorage, cookies, and indexedDB backends.
 */
import { it } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { describe, expect } from 'vitest';
import { createStorage, STORAGE_TUNING, storageBackends } from '../src/store/storage';

// --- [TYPES] -----------------------------------------------------------------

type StorageType = 'cookies' | 'indexedDB' | 'localStorage' | 'sessionStorage';
type SyncStorageType = 'cookies' | 'localStorage' | 'sessionStorage';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    syncBackends: ['localStorage', 'sessionStorage', 'cookies'] as const,
    tuning: {
        cookie: { expires: 365, path: '/', sameSite: 'Lax', secure: true },
        defaults: { storage: 'localStorage' },
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const syncOps = (type: SyncStorageType) => ({
    get: (key: string) => storageBackends[type].getItem(key) as string | null,
    remove: (key: string) => storageBackends[type].removeItem(key),
    set: (key: string, value: string) => storageBackends[type].setItem(key, value),
});

// --- [DESCRIBE_STORAGE_TUNING] -----------------------------------------------

describe('STORAGE_TUNING', () => {
    it('cookie defaults match expected values', () => {
        expect(STORAGE_TUNING.cookie.expires).toBe(B.tuning.cookie.expires);
        expect(STORAGE_TUNING.cookie.path).toBe(B.tuning.cookie.path);
        expect(STORAGE_TUNING.cookie.sameSite).toBe(B.tuning.cookie.sameSite);
        expect(STORAGE_TUNING.cookie.secure).toBe(B.tuning.cookie.secure);
    });
    it('defaults to localStorage storage type', () => {
        expect(STORAGE_TUNING.defaults.storage).toBe(B.tuning.defaults.storage);
    });
});

// --- [DESCRIBE_STORAGE_BACKENDS] ---------------------------------------------

describe('storageBackends', () => {
    it('contains all 4 storage types', () => {
        const keys = Object.keys(storageBackends).sort((a, b) => a.localeCompare(b));
        expect(keys).toEqual(['cookies', 'indexedDB', 'localStorage', 'sessionStorage']);
    });
    describe.each(B.syncBackends)('%s', (type) => {
        it.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])(
            'round-trips with exact value preservation',
            (key, value) => {
                const ops = syncOps(type);
                ops.set(key, value);
                expect(ops.get(key)).toBe(value);
            },
        );
        it.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])('remove clears stored value to null', (key, value) => {
            const ops = syncOps(type);
            ops.set(key, value);
            ops.remove(key);
            expect(ops.get(key)).toBeNull();
        });
        it('returns null for nonexistent key', () => {
            expect(syncOps(type).get('nonexistent-key-12345')).toBeNull();
        });
    });
    describe('cookies', () => {
        it('encodes special characters correctly', () => {
            const ops = syncOps('cookies');
            const value = 'value with spaces & special=chars';
            ops.set('test_key', value);
            expect(ops.get('test_key')).toBe(value);
        });
    });
    describe('indexedDB', () => {
        it.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])(
            'round-trips async with value preservation',
            async (key, value) => {
                await storageBackends.indexedDB.setItem(key, value);
                expect(await storageBackends.indexedDB.getItem(key)).toBe(value);
            },
        );
        it.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])('remove clears value async', async (key, value) => {
            await storageBackends.indexedDB.setItem(key, value);
            await storageBackends.indexedDB.removeItem(key);
            expect(await storageBackends.indexedDB.getItem(key)).toBeNull();
        });
        it('returns null for nonexistent key async', async () => {
            expect(await storageBackends.indexedDB.getItem('nonexistent-async-key')).toBeNull();
        });
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
    it.each([
        'localStorage',
        'sessionStorage',
        'cookies',
        'indexedDB',
    ] as const)('creates functional adapter for %s', (type) => {
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

// --- [DESCRIBE_ADAPTER_INTERFACE] --------------------------------------------

describe('adapter interface', () => {
    it.each(Object.keys(storageBackends) as StorageType[])('%s has complete StorageAdapter interface', (type) => {
        const adapter = storageBackends[type];
        expect(typeof adapter.getItem).toBe('function');
        expect(typeof adapter.setItem).toBe('function');
        expect(typeof adapter.removeItem).toBe('function');
    });
    it.prop([FC_ARB.storageType()])('all adapters implement identical method signatures', (type) => {
        const adapter = storageBackends[type];
        expect(typeof adapter.getItem).toBe('function');
        expect(typeof adapter.setItem).toBe('function');
        expect(typeof adapter.removeItem).toBe('function');
    });
});

// --- [DESCRIBE_EDGE_CASES] ---------------------------------------------------

describe('edge cases', () => {
    it.prop([FC_ARB.storageKey()])('localStorage handles large JSON values', (key) => {
        const ops = syncOps('localStorage');
        const longValue = JSON.stringify({ data: 'x'.repeat(10000) });
        ops.set(key, longValue);
        expect(ops.get(key)).toBe(longValue);
    });
    it.prop([FC_ARB.storageKey()])('sessionStorage handles nested JSON structures', (key) => {
        const ops = syncOps('sessionStorage');
        const nested = JSON.stringify({ a: { b: { c: { d: [1, 2, 3] } } } });
        ops.set(key, nested);
        expect(ops.get(key)).toBe(nested);
    });
    it('multiple sequential operations maintain consistency', () => {
        const ops = syncOps('localStorage');
        ops.set('key1', 'value1');
        ops.set('key2', 'value2');
        expect(ops.get('key1')).toBe('value1');
        expect(ops.get('key2')).toBe('value2');
        ops.remove('key1');
        expect(ops.get('key1')).toBeNull();
        expect(ops.get('key2')).toBe('value2');
    });
});
