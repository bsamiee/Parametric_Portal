/**
 * Tests for transition hooks factory.
 */
import { describe, expect, it } from 'vitest';
import { createRuntimeHooks } from '../src/runtime.ts';
import { createTransitionHooks, TRANSITION_HOOKS_TUNING } from '../src/transition.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('transition', () => {
    describe('TRANSITION_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(TRANSITION_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof TRANSITION_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = TRANSITION_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });
    });

    describe('createTransitionHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createTransitionHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useEffectTransition property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createTransitionHooks(runtimeApi);
            expect(typeof api.useEffectTransition).toBe('function');
        });

        it('should have useOptimisticEffect property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createTransitionHooks(runtimeApi);
            expect(typeof api.useOptimisticEffect).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createTransitionHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
