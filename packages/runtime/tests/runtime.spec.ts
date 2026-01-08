/**
 * Test unified Runtime object for Effect ManagedRuntime React integration.
 * Validates make, Provider, and use hook behavior.
 */
import '@parametric-portal/test-utils/harness';
import { render, renderHook } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../src/runtime';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    derived: { errorPattern: /Runtime\.use must be called within Runtime\.Provider/ },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const captureHookError = <T>(hookFn: () => T): { error: string | null; value: T | null } => {
    let error: string | null = null;
    let value: T | null = null;
    try {
        value = hookFn();
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    return { error, value };
};

// --- [DESCRIBE_RUNTIME] ------------------------------------------------------

describe('Runtime', () => {
    it('is frozen with expected structure', () => {
        expect(Object.isFrozen(Runtime)).toBe(true);
        expect(typeof Runtime.make).toBe('function');
        expect(typeof Runtime.Provider).toBe('function');
        expect(typeof Runtime.use).toBe('function');
    });
});

// --- [DESCRIBE_RUNTIME_PROVIDER] ---------------------------------------------

describe('Runtime.Provider', () => {
    it('renders children in context', () => {
        // biome-ignore lint/suspicious/noExplicitAny: test type coercion for generic runtime
        const runtime = ManagedRuntime.make(Layer.empty) as any;
        const child = React.createElement('div', { 'data-testid': 'child' }, 'Test');
        // biome-ignore lint/correctness/noChildrenProp: Runtime.Provider requires children in props
        const { container } = render(React.createElement(Runtime.Provider, { children: child, runtime }));
        expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
        expect(container.textContent).toContain('Test');
    });
});

// --- [DESCRIBE_RUNTIME_USE] --------------------------------------------------

describe('Runtime.use', () => {
    it('returns runtime inside provider', () => {
        // biome-ignore lint/suspicious/noExplicitAny: test type coercion for generic runtime
        const runtime = ManagedRuntime.make(Layer.empty) as any;
        const { result } = renderHook(() => Runtime.use(), {
            // biome-ignore lint/correctness/noChildrenProp: Runtime.Provider requires children in props
            // biome-ignore lint/suspicious/noExplicitAny: wrapper props require type coercion
            wrapper: ({ children }) => React.createElement(Runtime.Provider, { children, runtime } as any),
        });
        expect(result.current).toBe(runtime);
    });
    it('throws outside provider', () => {
        const { result } = renderHook(() => captureHookError(Runtime.use));
        expect(result.current.error).toMatch(B.derived.errorPattern);
    });
});

// --- [DESCRIBE_RUNTIME_MAKE] -------------------------------------------------

describe('Runtime.make', () => {
    it('creates distinct instances per call', () => {
        const r1 = Runtime.make(Layer.empty);
        const r2 = Runtime.make(Layer.empty);
        expect(r1).not.toBe(r2);
    });
});
