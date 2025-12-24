/**
 * Test harness: setup/capture utilities for test isolation.
 */
import { vi } from 'vitest';
import { TEST_CONSTANTS } from './constants';

// --- [TYPES] -----------------------------------------------------------------

type ConsoleSpy = ReturnType<typeof vi.spyOn>;
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
const captureConsole = <T>(method: ConsoleMethod, fn: (spy: ConsoleSpy) => T): T =>
    withCleanup(
        () => vi.spyOn(console, method).mockImplementation(() => {}),
        (spy) => spy.mockRestore(),
        fn,
    );
const withEnv = <T>(env: string, fn: () => T): T =>
    withCleanup(
        () => {
            // biome-ignore lint/style/useNamingConvention: NODE_ENV is standard
            vi.stubGlobal('process', { env: { NODE_ENV: env } });
        },
        () => vi.unstubAllGlobals(),
        fn,
    );
const Harness = Object.freeze({
    console: Object.freeze({
        error: <T>(fn: (spy: ConsoleSpy) => T): T => captureConsole('error', fn),
        log: <T>(fn: (spy: ConsoleSpy) => T): T => captureConsole('log', fn),
        warn: <T>(fn: (spy: ConsoleSpy) => T): T => captureConsole('warn', fn),
    }),
    env: Object.freeze({
        development: <T>(fn: () => T): T => withEnv('development', fn),
        production: <T>(fn: () => T): T => withEnv('production', fn),
        test: <T>(fn: () => T): T => withEnv('test', fn),
    }),
    storage: Object.freeze({
        clear: (): void => localStorage.clear(),
        seed: (name: string, state: object): void =>
            localStorage.setItem(name, JSON.stringify({ state, version: TEST_CONSTANTS.storage.version })),
    }),
    timers: Object.freeze({
        /** Advances fake timers. Default 10ms (sufficient for microtask flush). */
        advance: async (ms = 10): Promise<void> => {
            await vi.advanceTimersByTimeAsync(ms);
        },
    }),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Harness as TEST_HARNESS };
export type { ConsoleSpy };
