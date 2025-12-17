/**
 * Tests for form hooks factory.
 */
import { describe, expect, it } from 'vitest';
import { createFormHooks, FORM_HOOKS_TUNING } from '../src/form.ts';
import { createRuntimeHooks } from '../src/runtime.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('form', () => {
    describe('FORM_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(FORM_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof FORM_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = FORM_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });

        it('should have states with pristine, touched, dirty', () => {
            expect(FORM_HOOKS_TUNING.states.pristine).toBe('pristine');
            expect(FORM_HOOKS_TUNING.states.touched).toBe('touched');
            expect(FORM_HOOKS_TUNING.states.dirty).toBe('dirty');
        });

        it('should have tags with error and success', () => {
            expect(FORM_HOOKS_TUNING.tags.error).toBe('ValidationError');
            expect(FORM_HOOKS_TUNING.tags.success).toBe('ValidationSuccess');
        });
    });

    describe('createFormHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFormHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useFormField property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFormHooks(runtimeApi);
            expect(typeof api.useFormField).toBe('function');
        });

        it('should have useActionStateEffect property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFormHooks(runtimeApi);
            expect(typeof api.useActionStateEffect).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createFormHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
