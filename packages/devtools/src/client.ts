import { DevTools } from '@effect/experimental';
import { Context, Effect, Layer, List, Logger, Match, MutableRef } from 'effect';
import { Domain } from './domain.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const _SessionConfig =
    Context.GenericTag<Effect.Effect.Success<ReturnType<typeof Domain.normalizeSession>>>('devtools/SessionConfig');

// --- [SERVICES] --------------------------------------------------------------

class SessionService extends Effect.Service<SessionService>()('devtools/SessionService', {
    effect: Effect.gen(function* () {
        const config = yield* _SessionConfig;
        const logs: Array<ReturnType<typeof Domain.makeLogEntry>> = [];
        const renderer = MutableRef.make<(error: Error, context?: Readonly<Record<string, unknown>>) => void>(() => {});
        const append = (entry: ReturnType<typeof Domain.makeLogEntry>) => {
            logs.push(entry);
            const overflow = logs.length - config.maxLogs;
            overflow > 0 ? logs.splice(0, overflow) : undefined;
        };
        const layer = Layer.mergeAll(
            Match.value(config.experimental && _IS_BROWSER).pipe(
                Match.when(true, () => DevTools.layer(config.wsUrl)),
                Match.orElse(() => Layer.empty),
            ),
            Logger.replace(
                Logger.defaultLogger,
                Logger.map(
                    Logger.zip(
                        Logger.prettyLogger(),
                        Logger.make<unknown, void>(({ annotations, date, fiberId, logLevel, message, spans }) => {
                            const spanEntries = List.toArray(
                                List.map(spans, (span): readonly [string, number] => [
                                    span.label,
                                    Date.now() - span.startTime,
                                ]),
                            );
                            append(
                                Domain.makeLogEntry({
                                    annotations: Object.fromEntries(annotations),
                                    fiberId: String(fiberId),
                                    level: Domain.mapEffectLevel(logLevel.label),
                                    message: Domain.stringifyMessage(message),
                                    spans: Object.fromEntries(spanEntries),
                                    timestamp: date,
                                }),
                            );
                        }),
                    ),
                    () => {},
                ),
            ),
            Logger.minimumLogLevel(Domain.parseLogLevel(config.logLevel)),
        );
        const cleanups: Array<() => void> = [];
        const install = (enabled: boolean, register: () => () => void) =>
            Match.value(enabled).pipe(
                Match.when(true, () => {
                    cleanups.push(register());
                    return undefined;
                }),
                Match.orElse(() => undefined),
            );
        install(config.console && _IS_BROWSER, () => {
            const methods = Object.keys(Domain._CONFIG.levels.fromConsole) as ReadonlyArray<
                keyof typeof Domain._CONFIG.levels.fromConsole
            >;
            const original = {} as Partial<
                Record<keyof typeof Domain._CONFIG.levels.fromConsole, (...args: ReadonlyArray<unknown>) => void>
            >;
            const browserConsole = globalThis.console as {
                -readonly [K in keyof typeof Domain._CONFIG.levels.fromConsole]: (
                    ...args: ReadonlyArray<unknown>
                ) => void;
            };
            methods.forEach((method) => {
                original[method] = browserConsole[method].bind(browserConsole);
                browserConsole[method] = (...args: ReadonlyArray<unknown>): void => {
                    append(
                        Domain.makeLogEntry({
                            annotations: { source: 'console' },
                            fiberId: 'console',
                            level: Domain.mapConsoleMethod(method),
                            message: args.map((arg) => Domain.stringifyMessage(arg)).join(' '),
                            spans: {},
                            timestamp: new Date(),
                        }),
                    );
                    original[method]?.(...args);
                };
            });
            return () => {
                methods.forEach((method) => {
                    const restore = original[method];
                    restore !== undefined ? Object.assign(browserConsole, { [method]: restore }) : undefined;
                });
            };
        });
        install(_IS_BROWSER, () => {
            const onError = globalThis.onerror;
            const onUnhandled = globalThis.onunhandledrejection;
            globalThis.onerror = (message, source, lineno, colno, error): boolean => {
                const resolved = Match.value(error).pipe(
                    Match.when(
                        (failure): failure is Error => failure instanceof Error,
                        (failure) => failure,
                    ),
                    Match.orElse(() => Domain.toError(message)),
                );
                Effect.runFork(Effect.logError('Global error', { colno, lineno, source }).pipe(Effect.provide(layer)));
                MutableRef.get(renderer)(resolved, { colno, lineno, phase: 'global', source });
                return false;
            };
            globalThis.onunhandledrejection = (event: PromiseRejectionEvent): void => {
                const resolved = Domain.toError(event.reason);
                Effect.runFork(
                    Effect.logError('Unhandled rejection', { reason: resolved }).pipe(Effect.provide(layer)),
                );
                MutableRef.get(renderer)(resolved, { phase: 'unhandled-rejection' });
            };
            return () => {
                globalThis.onerror = onError;
                globalThis.onunhandledrejection = onUnhandled;
            };
        });
        install(
            config.perf &&
                _IS_BROWSER &&
                typeof PerformanceObserver !== 'undefined' &&
                PerformanceObserver.supportedEntryTypes !== undefined,
            () => {
                const callback = (list: PerformanceObserverEntryList): void => {
                    list.getEntries().forEach((entry) => {
                        const level = Match.value(entry.entryType).pipe(
                            Match.when('longtask', () => 'Warning' as const),
                            Match.orElse(() => 'Debug' as const),
                        );
                        const message = Match.value(entry.entryType).pipe(
                            Match.when(
                                'longtask',
                                () =>
                                    `[PERF] ${entry.entryType}: ${Domain.formatDuration(entry.duration)} (>${Domain._CONFIG.performance.longTaskThresholdMs}ms)`,
                            ),
                            Match.orElse(() => `[PERF] ${entry.entryType}: ${Domain.formatDuration(entry.duration)}`),
                        );
                        append(
                            Domain.makeLogEntry({
                                annotations: { entryType: entry.entryType, name: entry.name },
                                fiberId: 'performance',
                                level,
                                message,
                                spans: { duration: entry.duration },
                                timestamp: new Date(),
                            }),
                        );
                        Effect.runFork(
                            Effect.logDebug(message, { entryType: entry.entryType, name: entry.name }).pipe(
                                Effect.provide(layer),
                            ),
                        );
                    });
                };
                const observers = Domain._CONFIG.performance.entryTypes
                    .filter((type) => PerformanceObserver.supportedEntryTypes.includes(type))
                    .map((type) => {
                        const observer = new PerformanceObserver(callback);
                        observer.observe({ buffered: true, type });
                        return observer;
                    });
                return () => {
                    observers.forEach((observer) => {
                        observer.disconnect();
                    });
                };
            },
        );
        const log = {
            logDebug: (message: string) => Effect.logDebug(message),
            logError: (message: string) => Effect.logError(message),
            logFatal: (message: string) => Effect.logFatal(message),
            logInfo: (message: string) => Effect.logInfo(message),
            logWarning: (message: string) => Effect.logWarning(message),
        } as const;
        const emit =
            (method: keyof typeof log) =>
            (message: string, context?: Readonly<Record<string, unknown>>): void => {
                Effect.runFork(log[method](message).pipe(Effect.annotateLogs(context ?? {}), Effect.provide(layer)));
            };
        return {
            app: config.app,
            debug: {
                error: emit('logError'),
                info: emit('logInfo'),
                log: emit('logDebug'),
                warn: emit('logWarning'),
            },
            dispose: (): void => {
                cleanups.forEach((cleanup) => {
                    cleanup();
                });
                logs.splice(0, logs.length);
            },
            fatal: (error: Error, context?: Readonly<Record<string, unknown>>): void => {
                emit('logFatal')(error.message, { cause: error, ...(context ?? {}) });
                MutableRef.get(renderer)(error, context);
            },
            layer,
            logs,
            setRenderer: (next: (error: Error, context?: Readonly<Record<string, unknown>>) => void) => {
                MutableRef.set(renderer, next);
            },
            startTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        };
    }),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _make = (config: unknown) =>
    Domain.normalizeSession(config).pipe(
        Effect.mapError((error) => Domain.Error.from('config', error)),
        Effect.flatMap((normalized) =>
            SessionService.pipe(
                Effect.provide(SessionService.Default),
                Effect.provideService(_SessionConfig, normalized),
            ),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const Client = {
    make: _make,
    Service: SessionService,
    session: (config: unknown) => Effect.runSync(_make(config)),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Client };
export type ClientSession = Effect.Effect.Success<ReturnType<typeof _make>>;
