/**
 * Validate error boundary callbacks route to correct log levels and convert non-Error values.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, vi } from 'vitest';
import { BOUNDARY_TUNING, createRootErrorOptions } from '../src/boundary.tsx';
import { layer, mockLogger } from './utils.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    callbacks: [
        ['onCaughtError', 'Error'],
        ['onRecoverableError', 'Warning'],
        ['onUncaughtError', 'Fatal'],
    ] as const,
} as const);

type CallbackName = (typeof B.callbacks)[number][0];

// --- [TESTS] -----------------------------------------------------------------

describe('boundary', () => {
    describe('createRootErrorOptions', () => {
        it('returns all three callback functions', () => {
            const { layer: l } = layer();
            const result = createRootErrorOptions({ loggerLayer: l, onError: vi.fn() });
            expect(B.callbacks.map(([name]) => typeof result[name as CallbackName])).toEqual([
                'function',
                'function',
                'function',
            ]);
        });

        it.each(B.callbacks)('%s logs at %s level', async (callbackName, expectedLevel) => {
            const { layer: loggerLayer, logs } = mockLogger();
            createRootErrorOptions({ loggerLayer, onError: vi.fn() })[callbackName](new Error('test'), {});
            await vi.waitFor(() => expect(logs.length).toBe(1));
            expect(logs[0]?.level).toBe(expectedLevel);
        });

        it('onUncaughtError invokes onError with phase context', () => {
            const { layer: l } = layer();
            const onError = vi.fn();
            createRootErrorOptions({ loggerLayer: l, onError }).onUncaughtError(new Error('e'), {});
            expect(onError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({ phase: BOUNDARY_TUNING.phases.uncaught }),
            );
        });

        it.prop([fc.string()])('converts non-Error to Error', (reason) => {
            const { layer: loggerLayer } = mockLogger();
            const onError = vi.fn();
            createRootErrorOptions({ loggerLayer, onError }).onUncaughtError(reason, {});
            const [err] = onError.mock.calls[0] as [Error];
            expect([err instanceof Error, err.message]).toEqual([true, reason]);
        });

        it('passes Error through unchanged', () => {
            const { layer: l } = layer();
            const onError = vi.fn();
            const original = new Error('original');
            createRootErrorOptions({ loggerLayer: l, onError }).onUncaughtError(original, {});
            expect(onError.mock.calls[0]?.[0]).toBe(original);
        });

        it('passes errorInfo to onError context', () => {
            const { layer: l } = layer();
            const onError = vi.fn();
            const errorInfo = { componentStack: 'test stack' };
            createRootErrorOptions({ loggerLayer: l, onError }).onUncaughtError(new Error('e'), errorInfo);
            expect(onError.mock.calls[0]?.[1]).toMatchObject({ errorInfo });
        });
    });
});
