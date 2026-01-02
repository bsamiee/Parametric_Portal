/**
 * Runtime tests: ManagedRuntime context, provider, hook, and factory validation.
 */
import { it } from '@fast-check/vitest';
import '@parametric-portal/test-utils/harness';
import { renderHook } from '@testing-library/react';
import { Layer, ManagedRuntime } from 'effect';
import fc from 'fast-check';
import type { ReactElement } from 'react';
import React from 'react';
import { describe, expect } from 'vitest';
import { createAppRuntime, createRuntimeHooks, RUNTIME_TUNING, RuntimeProvider, useRuntime } from '../src/runtime';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arb: { name: fc.stringMatching(/^[A-Z][a-zA-Z0-9]+$/) },
    derived: { defaultName: 'AppRuntime', errorPattern: /useRuntime must be used within a RuntimeProvider/ },
    samples: { names: ['CustomRuntime', 'TestRuntime', 'AppContext'] as const },
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

// --- [DESCRIBE] RUNTIME_TUNING -----------------------------------------------

describe('RUNTIME_TUNING', () => {
    it('is frozen with expected structure', () => {
        expect(Object.isFrozen(RUNTIME_TUNING)).toBe(true);
        expect(RUNTIME_TUNING.defaults.name).toBe(B.derived.defaultName);
        expect(typeof RUNTIME_TUNING.errors.missingRuntime).toBe('function');
    });
    it.each(B.samples.names)('missingRuntime includes name: %s', (name) => {
        const msg = RUNTIME_TUNING.errors.missingRuntime(name);
        expect(msg).toContain(name);
        expect(msg).toMatch(B.derived.errorPattern);
    });
});

// --- [DESCRIBE] RuntimeProvider ----------------------------------------------

describe('RuntimeProvider', () => {
    it('renders children in context', () => {
        const runtime = ManagedRuntime.make(Layer.empty);
        const child = React.createElement('div', null, 'Test');
        const element = RuntimeProvider({ children: child, runtime }) as ReactElement<{ children: typeof child }>;
        expect(React.isValidElement(element)).toBe(true);
        expect(element.props.children).toBe(child);
    });
});

// --- [DESCRIBE] useRuntime ---------------------------------------------------

describe('useRuntime', () => {
    it('returns runtime inside provider', () => {
        const runtime = ManagedRuntime.make(Layer.empty);
        const { result } = renderHook(() => useRuntime(), {
            wrapper: ({ children }) => RuntimeProvider({ children, runtime }),
        });
        expect(result.current).toBe(runtime);
    });
    it('throws with default name outside provider', () => {
        const { result } = renderHook(() => captureHookError(useRuntime));
        expect(result.current.error).toMatch(B.derived.errorPattern);
        expect(result.current.error).toContain(B.derived.defaultName);
    });
});

// --- [DESCRIBE] createAppRuntime ---------------------------------------------

describe('createAppRuntime', () => {
    it('creates distinct instances per call', () => {
        const r1 = createAppRuntime(Layer.empty);
        const r2 = createAppRuntime(Layer.empty);
        expect(r1).not.toBe(r2);
    });
});

// --- [DESCRIBE] createRuntimeHooks -------------------------------------------

describe('createRuntimeHooks', () => {
    it('returns frozen API with expected properties', () => {
        const api = createRuntimeHooks();
        expect(Object.isFrozen(api)).toBe(true);
        expect(api.RuntimeContext).toHaveProperty('Provider');
        expect(typeof api.RuntimeProvider).toBe('function');
        expect(typeof api.useRuntime).toBe('function');
    });
    it.each(B.samples.names)('custom name %s appears in error message', (name) => {
        const api = createRuntimeHooks({ name });
        const { result } = renderHook(() => captureHookError(api.useRuntime));
        expect(result.current.error).toContain(name);
    });
    it.prop([B.arb.name])('accepts generated names', (name) => {
        const api = createRuntimeHooks({ name });
        expect(api.RuntimeContext).toHaveProperty('Provider');
    });
    it('creates isolated contexts per call', () => {
        const api1 = createRuntimeHooks({ name: 'A' });
        const api2 = createRuntimeHooks({ name: 'B' });
        expect(api1.RuntimeContext).not.toBe(api2.RuntimeContext);
    });
    it('useRuntime works inside provider', () => {
        const api = createRuntimeHooks<never, never>({ name: 'Test' });
        const runtime = ManagedRuntime.make(Layer.empty);
        const { result } = renderHook(() => api.useRuntime(), {
            wrapper: ({ children }) => api.RuntimeProvider({ children, runtime }),
        });
        expect(result.current).toBe(runtime);
    });
});
