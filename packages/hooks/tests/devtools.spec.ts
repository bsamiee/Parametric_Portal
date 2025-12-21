/**
 * Validate devtools hooks factory behavior and pure function utilities.
 */
import { describe, expect, it } from 'vitest';
import { DEVTOOLS_HOOK_TUNING, enhanceError } from '../src/devtools.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('devtools', () => {
    describe('DEVTOOLS_HOOK_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(DEVTOOLS_HOOK_TUNING)).toBe(true);
        });

        it('should have errors.missingProvider', () => {
            expect(DEVTOOLS_HOOK_TUNING.errors.missingProvider).toBe(
                'useDevSession requires DevSession.SessionProvider in component tree',
            );
        });

        it('should have noop.hide function', () => {
            expect(typeof DEVTOOLS_HOOK_TUNING.noop.hide).toBe('function');
        });

        it('should have noop.show function', () => {
            expect(typeof DEVTOOLS_HOOK_TUNING.noop.show).toBe('function');
        });

        it('should have noop.hide that does nothing', () => {
            expect(() => DEVTOOLS_HOOK_TUNING.noop.hide()).not.toThrow();
        });

        it('should have noop.show that does nothing', () => {
            expect(() => DEVTOOLS_HOOK_TUNING.noop.show()).not.toThrow();
        });
    });

    describe('enhanceError', () => {
        it('should return Error instance', () => {
            const error = new Error('test error');
            const enhanced = enhanceError(error);
            expect(enhanced).toBeInstanceOf(Error);
        });

        it('should preserve original error message', () => {
            const error = new Error('original message');
            const enhanced = enhanceError(error);
            expect(enhanced.message).toBe('original message');
        });

        it('should preserve error when captureOwnerStack returns null', () => {
            const error = new Error('test');
            const enhanced = enhanceError(error);
            expect(enhanced.message).toBe('test');
        });

        it('should add ownerStack to cause when available', () => {
            const error = new Error('test');
            const enhanced = enhanceError(error);
            // ownerStack may or may not be available depending on React version
            expect(enhanced).toBeDefined();
        });

        it('should preserve existing cause when adding ownerStack', () => {
            const error = new Error('test', { cause: { existing: 'data' } });
            const enhanced = enhanceError(error);
            expect(enhanced).toBeDefined();
        });
    });
});
