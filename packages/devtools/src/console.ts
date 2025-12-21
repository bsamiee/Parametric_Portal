/**
 * Capture console.* calls without Effect routing (prevents prettyLogger circular dep).
 */
import type { LogEntry } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';

type ConsoleInterceptConfig = {
    readonly logs: LogEntry[];
    readonly methods?: ReadonlyArray<ConsoleMethod> | undefined;
};

type ConsoleInterceptResult = {
    readonly restore: () => void;
};

type OriginalConsole = {
    [K in ConsoleMethod]: typeof console.log;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        methods: ['log', 'info', 'warn', 'error', 'debug'] as ReadonlyArray<ConsoleMethod>,
    },
    levelMap: {
        debug: 'Debug',
        error: 'Error',
        info: 'Info',
        log: 'Info',
        warn: 'Warning',
    } as const satisfies Record<ConsoleMethod, LogEntry['level']>,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const formatArgs = (args: ReadonlyArray<unknown>): string =>
    args.map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg))).join(' ');

const createLogEntry = (method: ConsoleMethod, args: ReadonlyArray<unknown>): LogEntry => ({
    annotations: { source: 'console' },
    fiberId: 'console',
    level: B.levelMap[method],
    message: formatArgs(args),
    spans: {},
    timestamp: new Date(),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const interceptConsole = (config: ConsoleInterceptConfig): ConsoleInterceptResult => {
    const methods = config.methods ?? B.defaults.methods;
    const original: Partial<OriginalConsole> = {};
    const mutableConsole = console as { -readonly [K in ConsoleMethod]: typeof console.log };

    for (const method of methods) {
        // biome-ignore lint/suspicious/noConsole: Intentional console interception
        original[method] = console[method].bind(console);

        mutableConsole[method] = (...args: unknown[]): void => {
            config.logs.push(createLogEntry(method, args));
            original[method]?.(...args);
        };
    }

    const restore = (): void => {
        for (const method of methods) {
            const orig = original[method];
            orig !== undefined && Object.assign(mutableConsole, { [method]: orig });
        }
    };

    return { restore };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ConsoleInterceptConfig, ConsoleInterceptResult, ConsoleMethod, OriginalConsole };
export { B as CONSOLE_TUNING, createLogEntry, formatArgs, interceptConsole };
