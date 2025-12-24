/**
 * Capture browser performance metrics via Performance Observer API.
 */
import { Effect, type Layer, Option, pipe } from 'effect';
import type { LogEntry } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type PerformanceEntryType = 'first-input' | 'largest-contentful-paint' | 'layout-shift' | 'longtask' | 'resource';
type PerformanceObserverConfig = {
    readonly entryTypes?: ReadonlyArray<PerformanceEntryType> | undefined;
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly logs: LogEntry[];
    readonly resourceFilter?: ((entry: PerformanceResourceTiming) => boolean) | undefined;
};
type PerformanceObserverResult = {
    readonly disconnect: () => void;
    readonly isSupported: boolean;
};
type MetricSummary = {
    readonly cls: number;
    readonly fid: number;
    readonly lcp: number;
    readonly longTasks: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        entryTypes: [
            'longtask',
            'layout-shift',
            'first-input',
            'largest-contentful-paint',
        ] as ReadonlyArray<PerformanceEntryType>,
    },
    format: {
        durationPrecision: 2,
    },
    thresholds: {
        longTask: 50,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isSupported = (): boolean =>
    globalThis.window !== undefined &&
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes !== undefined;
const formatDuration = (ms: number): string => `${ms.toFixed(B.format.durationPrecision)}ms`;
const formatEntryMessage = (entry: PerformanceEntry): string => {
    const base = `[PERF] ${entry.entryType}`;
    const handlers: Record<string, () => string> = {
        'first-input': () => `${base}: delay=${formatDuration(entry.duration)}`,
        'largest-contentful-paint': () => `${base}: ${formatDuration(entry.startTime)}`,
        'layout-shift': () =>
            `${base}: score=${(entry as PerformanceEntry & { value?: number }).value?.toFixed(4) ?? 'unknown'}`,
        longtask: () => `${base}: ${formatDuration(entry.duration)} (>${B.thresholds.longTask}ms)`,
        resource: () => `${base}: ${entry.name} (${formatDuration(entry.duration)})`,
    };
    return handlers[entry.entryType]?.() ?? `${base}: ${entry.name}`;
};
const createLogEntry = (entry: PerformanceEntry): LogEntry => ({
    annotations: { entryType: entry.entryType, name: entry.name },
    fiberId: 'performance',
    level: entry.entryType === 'longtask' ? 'Warning' : 'Debug',
    message: formatEntryMessage(entry),
    spans: { duration: entry.duration },
    timestamp: new Date(),
});
const getSupportedTypes = (requested: ReadonlyArray<PerformanceEntryType>): ReadonlyArray<PerformanceEntryType> =>
    requested.filter((type) => PerformanceObserver.supportedEntryTypes.includes(type));

// --- [ENTRY_POINT] -----------------------------------------------------------

const observePerformance = (config: PerformanceObserverConfig): PerformanceObserverResult => {
    const supported = isSupported();
    const disconnect = supported
        ? pipe(
              Option.some(config.entryTypes ?? B.defaults.entryTypes),
              Option.map(getSupportedTypes),
              Option.filter((types) => types.length > 0),
              Option.map((types) => {
                  const callback = (list: PerformanceObserverEntryList): void => {
                      list.getEntries().forEach((entry) => {
                          const logEntry = createLogEntry(entry);
                          config.logs.push(logEntry);
                          // Non-blocking: fork Effect instead of runSync to prevent main thread blocking
                          Effect.runFork(
                              pipe(
                                  Effect.logDebug(logEntry.message, logEntry.annotations),
                                  Effect.provide(config.loggerLayer),
                              ),
                          );
                      });
                  };
                  // Create separate observers per type to support buffered flag
                  // (entryTypes option does not support buffered, only type does)
                  const observers = types.map((type) => {
                      const observer = new PerformanceObserver(callback);
                      observer.observe({ buffered: true, type });
                      return observer;
                  });
                  return () => {
                      observers.forEach((obs) => obs.disconnect());
                  };
              }),
              Option.getOrElse(() => () => {}),
          )
        : () => {};
    return { disconnect, isSupported: supported };
};
const getMetricSummary = (logs: ReadonlyArray<LogEntry>): MetricSummary => {
    const perfLogs = logs.filter((log) => log.fiberId === 'performance');
    return {
        cls: perfLogs
            .filter((log) => log.annotations['entryType'] === 'layout-shift')
            .reduce((sum, log) => sum + (Number(log.annotations['value']) || 0), 0),
        fid: perfLogs.find((log) => log.annotations['entryType'] === 'first-input')?.spans['duration'] ?? 0,
        lcp:
            perfLogs.find((log) => log.annotations['entryType'] === 'largest-contentful-paint')?.spans['duration'] ?? 0,
        longTasks: perfLogs.filter((log) => log.annotations['entryType'] === 'longtask').length,
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { MetricSummary, PerformanceEntryType, PerformanceObserverConfig, PerformanceObserverResult };
export {
    B as PERFORMANCE_TUNING,
    createLogEntry,
    formatDuration,
    formatEntryMessage,
    getMetricSummary,
    getSupportedTypes,
    isSupported,
    observePerformance,
};
