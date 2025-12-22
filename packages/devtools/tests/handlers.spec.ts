/**
 * Validate global error handler installation and error callback invocation.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { HANDLERS_TUNING, installGlobalHandlers } from '../src/handlers.ts';
import { captureGlobals, type GlobalEnv, layer, restoreGlobals } from './utils.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('handlers', () => {
    let orig: GlobalEnv;

    beforeEach(() => {
        orig = captureGlobals();
    });

    afterEach(() => {
        restoreGlobals(orig);
    });

    describe('installGlobalHandlers', () => {
        it('installs handlers on globalThis', () => {
            const { layer: l } = layer();
            const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError: vi.fn() });

            expect([globalThis.onerror !== orig.onerror, globalThis.onunhandledrejection !== orig.onrejection]).toEqual(
                [true, true],
            );
            uninstall();
        });

        it('uninstall restores original handlers', () => {
            const { layer: l } = layer();
            const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError: vi.fn() });

            uninstall();

            expect([globalThis.onerror, globalThis.onunhandledrejection]).toEqual([orig.onerror, orig.onrejection]);
        });

        it.prop([fc.string(), fc.string(), fc.integer(), fc.integer()])(
            'onerror calls onError with context',
            (msg, source, lineno, colno) => {
                const { layer: l } = layer();
                const onError = vi.fn();
                const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError });

                const error = new Error('test');
                globalThis.onerror?.(msg, source, lineno, colno, error);

                expect(onError).toHaveBeenCalledWith(error, {
                    colno,
                    lineno,
                    phase: HANDLERS_TUNING.phases.global,
                    source,
                });
                uninstall();
            },
        );

        it('onerror returns false for default handling', () => {
            const { layer: l } = layer();
            const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError: vi.fn() });

            expect(globalThis.onerror?.('msg', 'src', 1, 1, new Error('t'))).toBe(false);
            uninstall();
        });

        it.prop([fc.string()])('onunhandledrejection converts reason to Error', (reason) => {
            const { layer: l } = layer();
            const onError = vi.fn();
            const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError });

            const event = {
                promise: Promise.reject(reason).catch(() => {}),
                reason,
            } as PromiseRejectionEvent;
            (globalThis.onunhandledrejection as ((e: PromiseRejectionEvent) => void) | null)?.(event);

            const [err, ctx] = onError.mock.calls[0] as [Error, { phase: string }];
            expect([err instanceof Error, err.message, ctx.phase]).toEqual([
                true,
                reason,
                HANDLERS_TUNING.phases.rejection,
            ]);
            uninstall();
        });

        it('onunhandledrejection passes Error reason directly', () => {
            const { layer: l } = layer();
            const onError = vi.fn();
            const { uninstall } = installGlobalHandlers({ loggerLayer: l, onError });

            const error = new Error('original error');
            const event = {
                promise: Promise.reject(error).catch(() => {}),
                reason: error,
            } as PromiseRejectionEvent;
            (globalThis.onunhandledrejection as ((e: PromiseRejectionEvent) => void) | null)?.(event);

            expect(onError.mock.calls[0]?.[0]).toBe(error);
            uninstall();
        });
    });
});
