/**
 * Tests for API hooks factory.
 */
import { describe, expect, it } from 'vitest';
import { API_HOOKS_TUNING, createApiHooks } from '../src/api.ts';
import { createRuntimeHooks } from '../src/runtime.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('api', () => {
    describe('API_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(API_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof API_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = API_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });
    });

    describe('createApiHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createApiHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useApiQuery property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createApiHooks(runtimeApi);
            expect(typeof api.useApiQuery).toBe('function');
        });

        it('should have useApiMutation property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createApiHooks(runtimeApi);
            expect(typeof api.useApiMutation).toBe('function');
        });

        it('should accept config parameter', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createApiHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
