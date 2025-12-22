/**
 * Provide test utilities for devtools package testing.
 */
import { Effect, Exit, type Layer, Logger } from 'effect';
import { expect, vi } from 'vitest';
import { createLoggerLayer } from '../src/logger.ts';
import type { LogEntry, LogLevelKey } from '../src/types.ts';

// --- [TYPES] -----------------------------------------------------------------

type GlobalEnv = {
    readonly win: typeof globalThis.window;
    readonly ws: typeof globalThis.WebSocket;
    readonly po: typeof globalThis.PerformanceObserver;
    readonly onerror: OnErrorEventHandler;
    readonly onrejection: ((e: PromiseRejectionEvent) => void) | null;
};

type EffectTestCase<A, E> = {
    readonly name: string;
    readonly effect: Effect.Effect<A, E>;
    readonly success: boolean;
    readonly check?: (a: A) => boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaultLogLevel: 'Debug' as const,
    defaultMaxLogs: 100,
} as const);

// --- [FIXTURES] --------------------------------------------------------------

const captureGlobals = (): GlobalEnv => ({
    onerror: globalThis.onerror,
    onrejection: globalThis.onunhandledrejection,
    po: globalThis.PerformanceObserver,
    win: globalThis.window,
    ws: globalThis.WebSocket,
});

const restoreGlobals = (env: GlobalEnv): void => {
    globalThis.window = env.win;
    globalThis.WebSocket = env.ws;
    (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver = env.po;
    globalThis.onerror = env.onerror;
    globalThis.onunhandledrejection = env.onrejection;
};

const withGlobals = <T>(setup: () => void, fn: () => T): T => {
    const env = captureGlobals();
    using _ = { [Symbol.dispose]: () => restoreGlobals(env) };
    setup();
    return fn();
};

// --- [FACTORIES] -------------------------------------------------------------

const entry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
    annotations: {},
    fiberId: 'test',
    level: 'Info',
    message: 'test message',
    spans: {},
    timestamp: new Date('2025-01-15T10:30:45.123Z'),
    ...overrides,
});

const perfEntry = (entryType: string, overrides: Partial<PerformanceEntry> = {}): PerformanceEntry =>
    ({
        duration: 100,
        entryType,
        name: 'test',
        startTime: 1000,
        toJSON: () => ({}),
        ...overrides,
    }) as PerformanceEntry;

const layer = (opts: { logLevel?: LogLevelKey; maxLogs?: number; silent?: boolean } = {}) =>
    createLoggerLayer({
        logLevel: opts.logLevel ?? B.defaultLogLevel,
        maxLogs: opts.maxLogs ?? B.defaultMaxLogs,
        silent: opts.silent ?? true,
    });

/**
 * Dispatch table for test logger: lowercase keys for case-insensitive lookup.
 * Must match production logger.ts mapEffectLevel behavior.
 */
const testLevelMap: Record<string, LogLevelKey> = {
    debug: 'Debug',
    error: 'Error',
    fatal: 'Fatal',
    info: 'Info',
    none: 'Debug',
    trace: 'Debug',
    warn: 'Warning',
    warning: 'Warning',
};

const mockLogger = () => {
    const logs: { level: string; message: string }[] = [];
    const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
        const level = testLevelMap[logLevel.label.toLowerCase()] ?? 'Info';
        logs.push({ level, message: typeof message === 'string' ? message : JSON.stringify(message) });
    });
    return { layer: Logger.replace(Logger.defaultLogger, logger), logs };
};

/**
 * Create mock PerformanceObserver for testing.
 * Uses function syntax (not arrow) to support `new` constructor invocation.
 */
type MockPerformanceObserverResult = {
    disconnect: ReturnType<typeof vi.fn>;
    Mock: typeof PerformanceObserver;
    observe: ReturnType<typeof vi.fn>;
};

const mockPerformanceObserver = (
    supportedTypes: ReadonlyArray<string> = ['longtask'],
): MockPerformanceObserverResult => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    const Mock = vi.fn(function (this: { disconnect: typeof disconnect; observe: typeof observe }) {
        this.disconnect = disconnect;
        this.observe = observe;
    }) as unknown as typeof PerformanceObserver;
    (Mock as { supportedEntryTypes: ReadonlyArray<string> }).supportedEntryTypes = supportedTypes;
    return { disconnect, Mock, observe };
};

// --- [EFFECT_TESTING] --------------------------------------------------------

const runEffect = async <A, E>(
    effect: Effect.Effect<A, E>,
    provider: Layer.Layer<never, never, never>,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(effect.pipe(Effect.provide(provider)));

const expectSuccess = async <A, E>(
    effect: Effect.Effect<A, E>,
    provider: Layer.Layer<never, never, never>,
    check?: (a: A) => boolean,
): Promise<void> => {
    const exit = await runEffect(effect, provider);
    if (!Exit.isSuccess(exit)) {
        throw new Error(`Expected success, got failure`);
    }
    check && expect(check(exit.value)).toBe(true);
};

const expectFailure = async <A, E>(
    effect: Effect.Effect<A, E>,
    provider: Layer.Layer<never, never, never>,
): Promise<void> => {
    const exit = await runEffect(effect, provider);
    expect(Exit.isFailure(exit)).toBe(true);
};

// --- [BROWSER_MOCKS] ---------------------------------------------------------

const setupBrowser = (opts: { window?: boolean; ws?: boolean; po?: ReadonlyArray<string> } = {}): void => {
    (globalThis as { window?: unknown }).window = opts.window === false ? undefined : {};
    (globalThis as { WebSocket?: unknown }).WebSocket = opts.ws ? vi.fn() : undefined;
    (
        globalThis as { PerformanceObserver?: { supportedEntryTypes: ReadonlyArray<string> } | undefined }
    ).PerformanceObserver = opts.po ? { supportedEntryTypes: opts.po } : undefined;
};

const setupNoBrowser = () => {
    (globalThis as { window?: unknown }).window = undefined;
};

// --- [EXPORT] ----------------------------------------------------------------

export type { EffectTestCase, GlobalEnv };
export {
    B as TEST_TUNING,
    captureGlobals,
    entry,
    expectFailure,
    expectSuccess,
    layer,
    mockLogger,
    mockPerformanceObserver,
    perfEntry,
    restoreGlobals,
    runEffect,
    setupBrowser,
    setupNoBrowser,
    withGlobals,
};
