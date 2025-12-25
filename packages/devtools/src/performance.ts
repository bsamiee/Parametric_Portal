/**
 * Capture browser performance metrics via Performance Observer API.
 * Single factory pattern returning frozen API object.
 */
import { Effect, type Layer, Option, pipe } from 'effect';
import {
    createLogEntry,
    DEVTOOLS_TUNING,
    formatDuration,
    type LogEntry,
    type LogEntrySource,
    type LogLevelKey,
    type PerformanceEntryType,
} from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type PerformanceObserverConfig = {
    readonly entryTypes?: ReadonlyArray<PerformanceEntryType> | undefined;
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly logs: LogEntry[];
    readonly resourceFilter?: ((entry: PerformanceResourceTiming) => boolean) | undefined;
};
type MetricSummary = {
    readonly cls: number;
    readonly fid: number;
    readonly lcp: number;
    readonly longTasks: number;
};
type PerformanceAPI = {
    readonly disconnect: () => void;
    readonly isSupported: boolean;
    readonly getMetrics: () => MetricSummary;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const T = DEVTOOLS_TUNING;
const isSupported = (): boolean =>
    globalThis.window !== undefined &&
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes !== undefined;
const formatEntryMessage = (entry: PerformanceEntry): string => {
    const base = `[PERF] ${entry.entryType}`;
    const handlers: Record<string, () => string> = {
        'first-input': () => `${base}: delay=${formatDuration(entry.duration)}`,
        'largest-contentful-paint': () => `${base}: ${formatDuration(entry.startTime)}`,
        'layout-shift': () =>
            `${base}: score=${(entry as PerformanceEntry & { value?: number }).value?.toFixed(4) ?? 'unknown'}`,
        longtask: () => `${base}: ${formatDuration(entry.duration)} (>${T.performance.thresholds.longTask}ms)`,
        resource: () => `${base}: ${entry.name} (${formatDuration(entry.duration)})`,
    };
    return handlers[entry.entryType]?.() ?? `${base}: ${entry.name}`;
};
const perfLogSource = (entry: PerformanceEntry): LogEntrySource => ({
    annotations: { entryType: entry.entryType, name: entry.name },
    fiberId: 'performance',
});
const getSupportedTypes = (requested: ReadonlyArray<PerformanceEntryType>): ReadonlyArray<PerformanceEntryType> =>
    requested.filter((type) => PerformanceObserver.supportedEntryTypes.includes(type));
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

// --- [ENTRY_POINT] -----------------------------------------------------------

const createPerformanceObserver = (config: PerformanceObserverConfig): PerformanceAPI => {
    const supported = isSupported();
    const entryTypes = config.entryTypes ?? T.performance.entryTypes;
    const logs = config.logs;
    const disconnect = supported
        ? pipe(
              Option.some(entryTypes),
              Option.map(getSupportedTypes),
              Option.filter((types) => types.length > 0),
              Option.map((types) => {
                  const callback = (list: PerformanceObserverEntryList): void => {
                      list.getEntries().forEach((entry) => {
                          const level: LogLevelKey = entry.entryType === 'longtask' ? 'Warning' : 'Debug';
                          const logEntry = createLogEntry(perfLogSource(entry), level, formatEntryMessage(entry), {
                              duration: entry.duration,
                          });
                          logs.push(logEntry);
                          Effect.runFork(
                              pipe(
                                  Effect.logDebug(logEntry.message, logEntry.annotations),
                                  Effect.provide(config.loggerLayer),
                              ),
                          );
                      });
                  };
                  const observers = types.map((type) => {
                      const observer = new PerformanceObserver(callback);
                      observer.observe({ buffered: true, type });
                      return observer;
                  });
                  return () => {
                      observers.forEach((obs) => {
                          obs.disconnect();
                      });
                  };
              }),
              Option.getOrElse(() => () => {}),
          )
        : () => {};
    return Object.freeze({
        disconnect,
        getMetrics: () => getMetricSummary(logs),
        isSupported: supported,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { MetricSummary, PerformanceAPI, PerformanceObserverConfig };
export { createPerformanceObserver };
