/**
 * Tests for runtime hooks factory.
 */
import { Context, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { createAppRuntime, createRuntimeHooks, RUNTIME_TUNING } from '../src/runtime.ts';

// --- [TYPES] -----------------------------------------------------------------

type TestService = { readonly value: number };

// --- [CONSTANTS] -------------------------------------------------------------

const TestService = Context.GenericTag<TestService>('TestService');
const TestLayer = Layer.succeed(TestService, { value: 42 });

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('runtime', () => {
    describe('RUNTIME_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(RUNTIME_TUNING)).toBe(true);
        });

        it('should have defaults.name', () => {
            expect(RUNTIME_TUNING.defaults.name).toBe('AppRuntime');
        });

        it('should have errors.missingRuntime as function', () => {
            expect(typeof RUNTIME_TUNING.errors.missingRuntime).toBe('function');
            expect(RUNTIME_TUNING.errors.missingRuntime('TestRuntime')).toBe(
                'useRuntime must be used within a RuntimeProvider (TestRuntime)',
            );
        });
    });

    describe('createAppRuntime', () => {
        it('should create a ManagedRuntime from a Layer', () => {
            const runtime = createAppRuntime(TestLayer);
            expect(runtime).toBeDefined();
            expect(typeof runtime.runSync).toBe('function');
            expect(typeof runtime.runPromise).toBe('function');
            expect(typeof runtime.runFork).toBe('function');
        });

        it('should execute effects with provided services', async () => {
            const runtime = createAppRuntime(TestLayer);
            const result = await runtime.runPromise(Effect.succeed(123));
            expect(result).toBe(123);
        });
    });

    describe('createRuntimeHooks', () => {
        it('should return frozen API object', () => {
            const api = createRuntimeHooks();
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have RuntimeContext property', () => {
            const api = createRuntimeHooks();
            expect(api.RuntimeContext).toBeDefined();
        });

        it('should have RuntimeProvider property', () => {
            const api = createRuntimeHooks();
            expect(typeof api.RuntimeProvider).toBe('function');
        });

        it('should have useRuntime property', () => {
            const api = createRuntimeHooks();
            expect(typeof api.useRuntime).toBe('function');
        });

        it('should accept name config for debug messages', () => {
            const api = createRuntimeHooks({ name: 'CustomRuntime' });
            expect(Object.isFrozen(api)).toBe(true);
            expect(typeof api.useRuntime).toBe('function');
        });
    });
});
