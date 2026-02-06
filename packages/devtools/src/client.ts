import { DevTools } from '@effect/experimental';
import { Context, Effect, Layer, List, Logger, MutableRef, PubSub, Ref, Stream } from 'effect';
import { Domain } from './domain.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const _SessionConfig =
    Context.GenericTag<Effect.Effect.Success<ReturnType<typeof Domain.normalizeSession>>>('devtools/SessionConfig');

// --- [SERVICES] --------------------------------------------------------------

class SessionService extends Effect.Service<SessionService>()('devtools/SessionService', {
    effect: Effect.gen(function* () {
        const config = yield* _SessionConfig;
        const { cleanups, entries, logs } = yield* Effect.all({
            cleanups: Ref.make<ReadonlyArray<() => void>>([]),
            entries: PubSub.unbounded<typeof Domain.Schema.LogEntry.Type>(),
            logs: Ref.make<ReadonlyArray<typeof Domain.Schema.LogEntry.Type>>([]),
        });
        const renderer = MutableRef.make<(error: Error, context?: Readonly<Record<string, unknown>>) => void>(() => {});
        const append = (logEntry: typeof Domain.Schema.LogEntry.Type) =>
            Ref.update(logs, (items) => {
                const next = [...items, logEntry];
                return next.slice(Math.max(0, next.length - config.maxLogs));
            }).pipe(Effect.andThen(PubSub.publish(entries, logEntry)), Effect.asVoid);
        const entry = (
            level: typeof Domain.Schema.LogLevel.Type,
            message: string,
            fiberId: string,
            annotations?: Readonly<Record<string, unknown>>,
            spans?: Readonly<Record<string, number>>,
        ) =>
            append({
                annotations: annotations ?? {},
                context: config.context,
                fiberId,
                level,
                message,
                spans: spans ?? {},
                timestamp: new Date(),
            });
        const feature = (condition: boolean, setup: () => () => void) =>
            condition
                ? Effect.sync(setup).pipe(Effect.tap((cleanup) => Ref.update(cleanups, (items) => [cleanup, ...items])))
                : Effect.void;
        const layer = Layer.mergeAll(
            config.experimental && _IS_BROWSER ? DevTools.layer(config.wsUrl) : Layer.empty,
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
                            Effect.runFork(
                                append({
                                    annotations: Object.fromEntries(annotations),
                                    context: config.context,
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
        yield* feature(config.console && _IS_BROWSER, () => {
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
                    Effect.runFork(
                        entry(
                            Domain.mapConsoleMethod(method),
                            args.map((arg) => Domain.stringifyMessage(arg)).join(' '),
                            'console',
                            { source: 'console' },
                        ),
                    );
                    original[method]?.(...args);
                };
            });
            return () => {
                methods.forEach((method) => {
                    const restore = original[method];
                    restore === undefined ? undefined : Object.assign(browserConsole, { [method]: restore });
                });
            };
        });
        yield* feature(_IS_BROWSER, () => {
            const onError = globalThis.onerror;
            const onUnhandled = globalThis.onunhandledrejection;
            globalThis.onerror = (message, source, lineno, colno, error): boolean => {
                const resolved = error instanceof Error ? error : Domain.toError(message);
                Effect.runFork(
                    Effect.logError('Global error', { colno, lineno, source, ...config.context }).pipe(
                        Effect.provide(layer),
                    ),
                );
                Effect.runFork(entry('Error', resolved.message, 'browser', { colno, lineno, phase: 'global', source }));
                MutableRef.get(renderer)(resolved, { colno, lineno, phase: 'global', source });
                return false;
            };
            globalThis.onunhandledrejection = (event: PromiseRejectionEvent): void => {
                const resolved = Domain.toError(event.reason);
                Effect.runFork(
                    Effect.logError('Unhandled rejection', { reason: resolved, ...config.context }).pipe(
                        Effect.provide(layer),
                    ),
                );
                Effect.runFork(entry('Error', resolved.message, 'browser', { phase: 'unhandled-rejection' }));
                MutableRef.get(renderer)(resolved, { phase: 'unhandled-rejection' });
            };
            return () => {
                globalThis.onerror = onError;
                globalThis.onunhandledrejection = onUnhandled;
            };
        });
        yield* feature(
            config.perf &&
                _IS_BROWSER &&
                typeof PerformanceObserver !== 'undefined' &&
                PerformanceObserver.supportedEntryTypes !== undefined,
            () => {
                const callback = (list: PerformanceObserverEntryList): void => {
                    list.getEntries().forEach((perfEntry) => {
                        const isLongTask = perfEntry.entryType === 'longtask';
                        const level = isLongTask ? ('Warning' as const) : ('Debug' as const);
                        const message = `[PERF] ${perfEntry.entryType}: ${Domain.formatDuration(perfEntry.duration)}${isLongTask ? ` (>${Domain._CONFIG.performance.longTaskThresholdMs}ms)` : ''}`;
                        Effect.runFork(
                            entry(
                                level,
                                message,
                                'performance',
                                { entryType: perfEntry.entryType, name: perfEntry.name },
                                { duration: perfEntry.duration },
                            ),
                        );
                        Effect.runFork(
                            Effect.logDebug(message, {
                                entryType: perfEntry.entryType,
                                name: perfEntry.name,
                                ...config.context,
                            }).pipe(Effect.provide(layer)),
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
        const emit =
            (logFn: (message: string) => Effect.Effect<void>) =>
            (message: string, context?: Readonly<Record<string, unknown>>): void => {
                Effect.runFork(
                    logFn(message).pipe(
                        Effect.annotateLogs({ ...config.context, ...(context ?? {}) }),
                        Effect.provide(layer),
                    ),
                );
            };
        return {
            app: config.app,
            context: config.context,
            debug: {
                error: emit(Effect.logError),
                info: emit(Effect.logInfo),
                log: emit(Effect.logDebug),
                warn: emit(Effect.logWarning),
            },
            dispose: (): void => {
                Effect.runFork(
                    Ref.get(cleanups).pipe(
                        Effect.flatMap((items) =>
                            Effect.forEach(items, (cleanup) => Effect.sync(cleanup), { discard: true }),
                        ),
                        Effect.andThen(Ref.set(logs, [])),
                        Effect.andThen(PubSub.shutdown(entries)),
                    ),
                );
            },
            fatal: (error: Error, context?: Readonly<Record<string, unknown>>): void => {
                emit(Effect.logFatal)(error.message, { cause: error, ...(context ?? {}) });
                MutableRef.get(renderer)(error, context);
            },
            layer,
            logs,
            setRenderer: (next: (error: Error, context?: Readonly<Record<string, unknown>>) => void): void => {
                MutableRef.set(renderer, next);
            },
            snapshotLogs: (): ReadonlyArray<typeof Domain.Schema.LogEntry.Type> => Effect.runSync(Ref.get(logs)),
            startTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
            stream: Stream.fromPubSub(entries),
        };
    }),
}) {}

// --- [EFFECT_PIPELINE] -------------------------------------------------------

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

// biome-ignore lint/correctness/noUnusedVariables: <Needed>
const Client = {
    make: _make,
    Service: SessionService,
    session: (config: unknown) => Effect.runSync(_make(config)),
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Client {
    export type Session = Effect.Effect.Success<ReturnType<typeof _make>>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Client };
