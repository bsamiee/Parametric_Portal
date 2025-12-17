/**
 * Tests for boundary hooks factory.
 */
import { describe, expect, it } from 'vitest';
import { BOUNDARY_HOOKS_TUNING, createBoundaryHooks } from '../src/boundary.ts';
import { createRuntimeHooks } from '../src/runtime.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('boundary', () => {
    describe('BOUNDARY_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(BOUNDARY_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof BOUNDARY_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = BOUNDARY_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });
    });

    describe('createBoundaryHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBoundaryHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useEffectBoundary property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBoundaryHooks(runtimeApi);
            expect(typeof api.useEffectBoundary).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createBoundaryHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
