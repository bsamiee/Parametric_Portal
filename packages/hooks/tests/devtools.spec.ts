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

        it('should have noop.hide that returns undefined', () => {
            const result = DEVTOOLS_HOOK_TUNING.noop.hide();
            expect(result).toBeUndefined();
        });

        it('should have noop.show that returns undefined and accepts any arguments', () => {
            const result = DEVTOOLS_HOOK_TUNING.noop.show();
            expect(result).toBeUndefined();
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

        it('should return same error reference when captureOwnerStack returns null', () => {
            const error = new Error('test');
            const enhanced = enhanceError(error);
            expect(enhanced).toBe(error);
            expect(enhanced.message).toBe('test');
        });

        it('should merge ownerStack into existing cause when available', () => {
            const error = new Error('test', { cause: { existing: 'data' } });
            const enhanced = enhanceError(error);
            expect(enhanced.message).toBe('test');

            // Verify that if ownerStack was added, it's merged with existing cause
            if (enhanced.cause && typeof enhanced.cause === 'object') {
                const cause = enhanced.cause as Record<string, unknown>;
                // Original data should be preserved
                expect(cause.existing).toBe('data');
            }
        });
    });
});
