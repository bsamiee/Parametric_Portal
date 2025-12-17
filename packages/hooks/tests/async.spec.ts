/**
 * Tests for async hooks factory.
 */
import { describe, expect, it } from 'vitest';
import { ASYNC_HOOKS_TUNING, createAsyncHooks, createCacheEntry, isCacheValid } from '../src/async.ts';
import { createRuntimeHooks } from '../src/runtime.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('async', () => {
    describe('ASYNC_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(ASYNC_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof ASYNC_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = ASYNC_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });
    });

    describe('createCacheEntry', () => {
        it('should create entry with correct expiresAt', () => {
            const entry = createCacheEntry('test', 1000, 5000);
            expect(entry.expiresAt).toBe(6000);
            expect(entry.value).toBe('test');
        });

        it('should create entry with zero ttl', () => {
            const entry = createCacheEntry(42, 0, 1000);
            expect(entry.expiresAt).toBe(1000);
            expect(entry.value).toBe(42);
        });
    });

    describe('isCacheValid', () => {
        it('should return false for null entry', () => {
            expect(isCacheValid(null, 1000)).toBe(false);
        });

        it('should return true when now < expiresAt', () => {
            const entry = { expiresAt: 2000, value: 'test' };
            expect(isCacheValid(entry, 1000)).toBe(true);
        });

        it('should return false when now >= expiresAt', () => {
            const entry = { expiresAt: 1000, value: 'test' };
            expect(isCacheValid(entry, 1000)).toBe(false);
            expect(isCacheValid(entry, 2000)).toBe(false);
        });
    });

    describe('createAsyncHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useAsyncEffect property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(typeof api.useAsyncEffect).toBe('function');
        });

        it('should have useAsyncState property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(typeof api.useAsyncState).toBe('function');
        });

        it('should have useAsyncCallback property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(typeof api.useAsyncCallback).toBe('function');
        });

        it('should have useAsyncEffectCached property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(typeof api.useAsyncEffectCached).toBe('function');
        });

        it('should have useAsyncEffectWithRetry property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createAsyncHooks(runtimeApi);
            expect(typeof api.useAsyncEffectWithRetry).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createAsyncHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
