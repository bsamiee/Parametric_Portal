/**
 * Validate store hooks factory behavior and configuration immutability.
 */
import { describe, expect, it } from 'vitest';
import { createStoreHooks, STORE_HOOKS_TUNING } from '../src/store.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('store', () => {
    describe('STORE_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(STORE_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.enableDevtools', () => {
            expect(STORE_HOOKS_TUNING.defaults.enableDevtools).toBe(false);
        });

        it('should have defaults.name', () => {
            expect(STORE_HOOKS_TUNING.defaults.name).toBe('StoreHooks');
        });

        it('should have defaults.persistDebounceMs', () => {
            expect(STORE_HOOKS_TUNING.defaults.persistDebounceMs).toBe(300);
        });

        it('should have devtools.actionTypes', () => {
            expect(STORE_HOOKS_TUNING.devtools.actionTypes.init).toBe('@@INIT');
            expect(STORE_HOOKS_TUNING.devtools.actionTypes.update).toBe('UPDATE');
        });
    });

    describe('createStoreHooks', () => {
        it('should return frozen API object', () => {
            const api = createStoreHooks();
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useStoreSlice property', () => {
            const api = createStoreHooks();
            expect(typeof api.useStoreSlice).toBe('function');
        });

        it('should have useStoreActions property', () => {
            const api = createStoreHooks();
            expect(typeof api.useStoreActions).toBe('function');
        });

        it('should have useStoreSelector property', () => {
            const api = createStoreHooks();
            expect(typeof api.useStoreSelector).toBe('function');
        });

        it('should have usePersist property', () => {
            const api = createStoreHooks();
            expect(typeof api.usePersist).toBe('function');
        });

        it('should have useSubscriptionRef property', () => {
            const api = createStoreHooks();
            expect(typeof api.useSubscriptionRef).toBe('function');
        });

        it('should accept enableDevtools config', () => {
            const api = createStoreHooks({ enableDevtools: true });
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should accept name config for devtools', () => {
            const api = createStoreHooks({ enableDevtools: true, name: 'CustomStore' });
            expect(Object.isFrozen(api)).toBe(true);
            expect(typeof api.useStoreSlice).toBe('function');
        });
    });
});
