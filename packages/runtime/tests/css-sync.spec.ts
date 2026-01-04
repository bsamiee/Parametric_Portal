/**
 * Test CSS sync hook integration with prefix validation.
 * Validates store-to-DOM variable synchronization via console capture.
 */
import { it } from '@fast-check/vitest';
import { TEST_HARNESS } from '@parametric-portal/test-utils/harness';
import { renderHook } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, vi } from 'vitest';
import { CSS_SYNC_TUNING, useCssSync } from '../src/css-sync';

// --- [TYPES] -----------------------------------------------------------------

type MockStore<T> = {
    getState: () => T;
    setState: (s: T) => void;
    subscribe: (fn: (state: T, prevState: T) => void) => () => void;
};
type TestState = { active: boolean; color: string; size: string };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arb: { cssKey: fc.stringMatching(/^[a-z][a-z0-9-]*$/), cssValue: fc.string({ maxLength: 20, minLength: 1 }) },
    samples: {
        invalidPrefixes: ['', '123start', 'has space', '@special', '-dash'] as const,
        validPrefixes: ['app', 'theme', 'my-prefix', 'theme1'] as const,
    },
    selectors: { color: (s: TestState) => ({ color: s.color }) },
    state: { active: true, color: 'red', size: '16px' } as TestState,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mockStore = <T extends object>(init: T): MockStore<T> => {
    let state = init;
    const listeners = new Set<(state: T, prevState: T) => void>();
    return {
        getState: () => state,
        setState: (s: T) => {
            const prev = state;
            state = s;
            for (const fn of listeners) fn(state, prev);
        },
        subscribe: (fn) => {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },
    };
};
const mockElement = () =>
    ({
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { setProperty: vi.fn() },
    }) as unknown as HTMLElement;

// --- [DESCRIBE_CSS_SYNC_TUNING] ----------------------------------------------

describe('CSS_SYNC_TUNING', () => {
    it('is frozen with expected defaults', () => {
        expect(Object.isFrozen(CSS_SYNC_TUNING)).toBe(true);
        expect(CSS_SYNC_TUNING.defaults.prefix).toBe('app');
        expect(typeof CSS_SYNC_TUNING.defaults.root).toBe('function');
    });
});

// --- [DESCRIBE_USE_CSS_SYNC] -------------------------------------------------

describe('useCssSync', () => {
    it('syncs CSS variables on mount', () => {
        const root = mockElement();
        renderHook(() =>
            useCssSync(mockStore(B.state), { prefix: 'test', root: () => root, selector: B.selectors.color }),
        );
        expect(root.style.setProperty).toHaveBeenCalledWith('--test-color', 'red');
    });
    it('syncs class names (add/remove)', () => {
        const root = mockElement();
        renderHook(() =>
            useCssSync(mockStore(B.state), {
                classNames: () => ({ add: ['active'], remove: ['hidden'] }),
                root: () => root,
            }),
        );
        expect(root.classList.add).toHaveBeenCalledWith('active');
        expect(root.classList.remove).toHaveBeenCalledWith('hidden');
    });
    it('uses default prefix when not provided', () => {
        const root = mockElement();
        renderHook(() => useCssSync(mockStore(B.state), { root: () => root, selector: B.selectors.color }));
        expect(root.style.setProperty).toHaveBeenCalledWith('--app-color', 'red');
    });
    it('subscribes to store updates', () => {
        const root = mockElement();
        const store = mockStore(B.state);
        renderHook(() => useCssSync(store, { root: () => root, selector: B.selectors.color }));
        store.setState({ ...B.state, color: 'blue' });
        expect(root.style.setProperty).toHaveBeenCalledWith('--app-color', 'blue');
    });
    it('cleans up on unmount', () => {
        const root = mockElement();
        const store = mockStore(B.state);
        const { unmount } = renderHook(() => useCssSync(store, { root: () => root, selector: B.selectors.color }));
        const spy = root.style.setProperty as ReturnType<typeof vi.fn>;
        const callsBefore = spy.mock.calls.length;
        unmount();
        store.setState({ ...B.state, color: 'green' });
        expect(spy).toHaveBeenCalledTimes(callsBefore);
    });
    it.each(B.samples.validPrefixes)('accepts valid prefix: %s', (prefix) => {
        const root = mockElement();
        renderHook(() => useCssSync(mockStore(B.state), { prefix, root: () => root, selector: B.selectors.color }));
        expect(root.style.setProperty).toHaveBeenCalledWith(`--${prefix}-color`, 'red');
    });
    it.each(B.samples.invalidPrefixes)('warns on invalid prefix: "%s"', (prefix) => {
        const root = mockElement();
        const rootFn = () => root;
        TEST_HARNESS.console.warn((spy) => {
            renderHook(() => useCssSync(mockStore(B.state), { prefix, root: rootFn, selector: B.selectors.color }));
            expect(spy).toHaveBeenCalled();
            expect(root.style.setProperty).toHaveBeenCalledWith('--app-color', 'red');
        });
    });
    it('handles empty selector', () => {
        const root = mockElement();
        renderHook(() => useCssSync(mockStore(B.state), { root: () => root, selector: () => ({}) }));
        expect(root.style.setProperty).not.toHaveBeenCalled();
    });
    it('handles combined selector and classNames', () => {
        const root = mockElement();
        renderHook(() =>
            useCssSync(mockStore(B.state), {
                classNames: () => ({ add: ['theme'] }),
                root: () => root,
                selector: B.selectors.color,
            }),
        );
        expect(root.style.setProperty).toHaveBeenCalledWith('--app-color', 'red');
        expect(root.classList.add).toHaveBeenCalledWith('theme');
    });
    it.prop([B.arb.cssKey, B.arb.cssValue])('syncs generated key-value pairs', (key, value) => {
        const root = mockElement();
        renderHook(() =>
            useCssSync(mockStore({ value }), {
                prefix: 'gen',
                root: () => root,
                selector: (s) => ({ [key]: s.value }),
            }),
        );
        expect(root.style.setProperty).toHaveBeenCalledWith(`--gen-${key}`, value);
    });
});
