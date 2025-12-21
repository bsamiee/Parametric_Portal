/**
 * Validate suspense hooks factory behavior.
 */
import { describe, expect, it } from 'vitest';
import { createRuntimeHooks } from '../src/runtime.tsx';
import { createSuspenseHooks, SUSPENSE_HOOKS_TUNING } from '../src/suspense.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('suspense', () => {
    describe('SUSPENSE_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(SUSPENSE_HOOKS_TUNING)).toBe(true);
        });

        it('should have status.idle constant', () => {
            expect(SUSPENSE_HOOKS_TUNING.status.idle).toBe('idle');
        });

        it('should have status.pending constant', () => {
            expect(SUSPENSE_HOOKS_TUNING.status.pending).toBe('pending');
        });

        it('should have status.resolved constant', () => {
            expect(SUSPENSE_HOOKS_TUNING.status.resolved).toBe('resolved');
        });

        it('should have status.rejected constant', () => {
            expect(SUSPENSE_HOOKS_TUNING.status.rejected).toBe('rejected');
        });
    });

    describe('createSuspenseHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createSuspenseHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useEffectResource property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createSuspenseHooks(runtimeApi);
            expect(typeof api.useEffectResource).toBe('function');
        });

        it('should have useEffectSuspense property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createSuspenseHooks(runtimeApi);
            expect(typeof api.useEffectSuspense).toBe('function');
        });

        it('should accept empty config parameter', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createSuspenseHooks(runtimeApi, {});
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
