/**
 * Capture console.* calls without Effect routing (prevents prettyLogger circular dep).
 */
import {
    type ConsoleMethod,
    createLogEntry,
    DEVTOOLS_TUNING,
    type LogEntry,
    type LogEntrySource,
    mapConsoleMethod,
    stringifyArgs,
} from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const T = DEVTOOLS_TUNING;
const consoleLogSource: LogEntrySource = { annotations: { source: 'console' }, fiberId: 'console' };

// --- [ENTRY_POINT] -----------------------------------------------------------

const interceptConsole = (config: ConsoleInterceptConfig): ConsoleInterceptResult => {
    const methods = config.methods ?? T.console.methods;
    const original: Partial<OriginalConsole> = {};
    const mutableConsole = console as { -readonly [K in ConsoleMethod]: typeof console.log };
    methods.forEach((method) => {
        // biome-ignore lint/suspicious/noConsole: Intentional console interception
        original[method] = console[method].bind(console);
        mutableConsole[method] = (...args: unknown[]): void => {
            config.logs.push(createLogEntry(consoleLogSource, mapConsoleMethod(method), stringifyArgs(args)));
            original[method]?.(...args);
        };
    });
    const restore = (): void => {
        methods.forEach((method) => {
            const orig = original[method];
            orig !== undefined && Object.assign(mutableConsole, { [method]: orig });
        });
    };
    return Object.freeze({ restore });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ConsoleInterceptConfig, ConsoleInterceptResult, OriginalConsole };
export { interceptConsole };
