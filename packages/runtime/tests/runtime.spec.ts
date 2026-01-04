/**
 * Test unified Runtime object for Effect ManagedRuntime React integration.
 * Validates make, Provider, and use hook behavior.
 */
import '@parametric-portal/test-utils/harness';
import { renderHook } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import type { ReactElement } from 'react';
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
        const runtime = ManagedRuntime.make(Layer.empty);
        const child = React.createElement('div', null, 'Test');
        const element = Runtime.Provider({ children: child, runtime }) as ReactElement<{ children: typeof child }>;
        expect(React.isValidElement(element)).toBe(true);
        expect(element.props.children).toBe(child);
    });
});

// --- [DESCRIBE_RUNTIME_USE] --------------------------------------------------

describe('Runtime.use', () => {
    it('returns runtime inside provider', () => {
        const runtime = ManagedRuntime.make(Layer.empty);
        const { result } = renderHook(() => Runtime.use(), {
            wrapper: ({ children }) => Runtime.Provider({ children, runtime }),
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
