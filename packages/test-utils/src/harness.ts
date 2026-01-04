/**
 * Test harness: setup/capture utilities for test isolation.
 */
import './matchers/effect';
import { Effect, Exit } from 'effect';
import { vi } from 'vitest';
import { TEST_CONSTANTS } from './constants';

// --- [TYPES] -----------------------------------------------------------------

type SpyInstance = ReturnType<typeof vi.spyOn>;
type ConsoleMethod = 'error' | 'log' | 'warn';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Wraps fn with setup/cleanup, handling sync and async automatically. */
const withCleanup = <T, C>(setup: () => C, cleanup: (ctx: C) => void, fn: (ctx: C) => T): T => {
    const ctx = setup();
    const result = fn(ctx);
    return (
        result instanceof Promise
            ? result.finally(() => cleanup(ctx))
            : (() => {
                  cleanup(ctx);
                  return result;
              })()
    ) as T;
};
const captureConsole = <T>(method: ConsoleMethod, fn: (spy: SpyInstance) => T): T =>
    withCleanup(
        () => vi.spyOn(console, method).mockImplementation(() => {}),
        (spy) => spy.mockRestore(),
        fn,
    );
const withEnv = <T>(env: string, fn: () => T): T =>
    withCleanup(
        () => {
            vi.stubGlobal('process', { env: { NODE_ENV: env } });
        },
        () => vi.unstubAllGlobals(),
        fn,
    );
const idState = { count: 0 };
const createUniqueId = (prefix = 'test'): string => {
    idState.count += 1;
    return `${prefix}-${idState.count}`;
};
const Harness = Object.freeze({
    console: Object.freeze({
        error: <T>(fn: (spy: SpyInstance) => T): T => captureConsole('error', fn),
        log: <T>(fn: (spy: SpyInstance) => T): T => captureConsole('log', fn),
        warn: <T>(fn: (spy: SpyInstance) => T): T => captureConsole('warn', fn),
    }),
    effect: Object.freeze({
        /** Extracts value from Exit, optionally transforming with fn. Returns undefined on failure. */
        extract: <A>(exit: Exit.Exit<A, unknown>, fn?: (v: A) => unknown): unknown =>
            Exit.isSuccess(exit) ? (fn ? fn(exit.value) : exit.value) : undefined,
        /** Pattern-matches Exit to success/failure branches. */
        match: <A, E, R>(exit: Exit.Exit<A, E>, cases: { failure: (e: E) => R; success: (a: A) => R }): R =>
            Exit.isSuccess(exit)
                ? cases.success(exit.value)
                : Exit.isFailure(exit) && exit.cause._tag === 'Fail'
                  ? cases.failure(exit.cause.error)
                  : cases.failure(undefined as E),
        /** Runs Effect synchronously, returning Exit for matcher assertions. */
        runSync: <A, E>(eff: Effect.Effect<A, E, never>): Exit.Exit<A, E> => Effect.runSyncExit(eff),
    }),
    env: Object.freeze({
        development: <T>(fn: () => T): T => withEnv('development', fn),
        production: <T>(fn: () => T): T => withEnv('production', fn),
        test: <T>(fn: () => T): T => withEnv('test', fn),
    }),
    /** Auto-cleanup spy: setup before fn, restore after (handles sync/async). */
    // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn requires loose typing for generic targets
    spy: <T>(target: any, method: string, fn: (spy: SpyInstance) => T, impl?: () => void): T =>
        withCleanup(
            () => vi.spyOn(target, method).mockImplementation(impl ?? (() => {})),
            (s) => s.mockRestore(),
            fn,
        ),
    storage: Object.freeze({
        clear: (): void => {
            localStorage.clear();
            sessionStorage.clear();
        },
        seed: (name: string, state: object): void =>
            localStorage.setItem(name, JSON.stringify({ state, version: TEST_CONSTANTS.storage.version })),
    }),
    timers: Object.freeze({
        /** Advances fake timers. Default from TEST_CONSTANTS (sufficient for microtask flush). */
        advance: async (ms = TEST_CONSTANTS.defaults.timerAdvanceMs): Promise<void> => {
            await vi.advanceTimersByTimeAsync(ms);
        },
    }),
    /** Generates unique test IDs for isolation (e.g., store names in browser mode). */
    uniqueId: createUniqueId,
});

// --- [EXPORT] ----------------------------------------------------------------

export { Harness as TEST_HARNESS };
export type { SpyInstance };
