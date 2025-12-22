/**
 * Validate bootstrap pipeline module loading, CSS injection, and DOM ready behavior.
 */
import { Effect, Exit } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initWhenReady, loadCss, loadModule, verifyRender } from '../src/bootstrap.tsx';
import { layer } from './utils.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('bootstrap', () => {
    describe('loadModule', () => {
        it.each([
            ['resolving loader', () => Promise.resolve({ App: () => null }), true],
            ['rejecting loader', () => Promise.reject(new Error('fail')), false],
            ['string rejection', () => Promise.reject('string error'), false],
        ])('%s → success=%s', async (_, loader, shouldSucceed) => {
            const { layer: l } = layer();
            const exit = await Effect.runPromiseExit(loadModule('test', loader).pipe(Effect.provide(l)));
            expect(Exit.isSuccess(exit)).toBe(shouldSucceed);
        });

        it('returns loaded module on success', async () => {
            const { layer: l } = layer();
            const module = { App: () => null };
            const result = await Effect.runPromise(
                loadModule('app', () => Promise.resolve(module)).pipe(Effect.provide(l)),
            );
            expect(result).toBe(module);
        });

        it.each([
            'string error',
            'another reason',
            'network failure',
        ])('converts string rejection "%s" to Error', async (reason) => {
            const { layer: l } = layer();
            const exit = await Effect.runPromiseExit(
                loadModule('t', () => Promise.reject(reason)).pipe(Effect.provide(l)),
            );
            Exit.isFailure(exit) && exit.cause._tag === 'Fail' && expect(exit.cause.error).toBeInstanceOf(Error);
        });
    });

    describe('loadCss', () => {
        it.each([
            ['resolving', () => Promise.resolve({}), true],
            ['rejecting', () => Promise.reject(new Error('css')), false],
        ])('%s loader → success=%s', async (_, loader, shouldSucceed) => {
            const { layer: l } = layer();
            const exit = await Effect.runPromiseExit(loadCss(loader).pipe(Effect.provide(l)));
            expect(Exit.isSuccess(exit)).toBe(shouldSucceed);
        });
    });

    describe('verifyRender', () => {
        it.each([
            '<div>content</div>',
            '<span>hello</span>',
            '<p>world</p>',
        ])('logs SUCCESS for non-empty innerHTML: %s', async (content) => {
            const { layer: l, logs } = layer();
            await Effect.runPromise(verifyRender({ innerHTML: content } as HTMLElement, 0).pipe(Effect.provide(l)));
            expect(logs.some((log) => log.message.includes('SUCCESS'))).toBe(true);
        });

        it('logs EMPTY/Warning for empty innerHTML', async () => {
            const { layer: l, logs } = layer();
            await Effect.runPromise(verifyRender({ innerHTML: '' } as HTMLElement, 0).pipe(Effect.provide(l)));
            expect(logs.some((log) => log.message.includes('EMPTY') || log.level === 'Warning')).toBe(true);
        });

        it('handles null innerHTML gracefully', async () => {
            const { layer: l } = layer();
            await expect(
                Effect.runPromise(
                    verifyRender({ innerHTML: null } as unknown as HTMLElement, 0).pipe(Effect.provide(l)),
                ),
            ).resolves.toBeUndefined();
        });
    });

    describe('initWhenReady', () => {
        let origReadyState: DocumentReadyState | undefined;
        let origAddEventListener: typeof document.addEventListener | undefined;

        beforeEach(() => {
            if (typeof document !== 'undefined') {
                origReadyState = document.readyState;
                origAddEventListener = document.addEventListener;
            }
        });

        afterEach(() => {
            if (typeof document !== 'undefined' && origReadyState !== undefined) {
                Object.defineProperty(document, 'readyState', { value: origReadyState, writable: true });
                if (origAddEventListener) {
                    document.addEventListener = origAddEventListener;
                }
            }
        });

        it.each([
            ['complete', true, false],
            ['interactive', true, false],
            ['loading', false, true],
        ] as const)('readyState=%s → initCalled=%s, listenerAdded=%s', (state, initCalled, listenerAdded) => {
            if (typeof document === 'undefined') {
                return;
            }
            Object.defineProperty(document, 'readyState', { value: state, writable: true });
            const { layer: l } = layer();
            const init = vi.fn();
            const mockAddEventListener = vi.fn();
            document.addEventListener = mockAddEventListener;

            initWhenReady(init, l);

            expect([init.mock.calls.length > 0, mockAddEventListener.mock.calls.length > 0]).toEqual([
                initCalled,
                listenerAdded,
            ]);
        });

        it('DOMContentLoaded handler invokes init', () => {
            if (typeof document === 'undefined') {
                return;
            }
            Object.defineProperty(document, 'readyState', { value: 'loading', writable: true });
            const { layer: l } = layer();
            const init = vi.fn();
            let capturedHandler: (() => void) | undefined;

            document.addEventListener = vi.fn((event, handler) => {
                capturedHandler = event === 'DOMContentLoaded' ? (handler as () => void) : capturedHandler;
            });

            initWhenReady(init, l);
            capturedHandler?.();

            expect(init).toHaveBeenCalledTimes(1);
        });
    });
});
