import { Effect, Fiber, Option, pipe, Stream } from 'effect';
import {
    type ComponentType,
    createContext,
    createElement,
    type ReactNode,
    StrictMode,
    useContext,
    useEffect,
    useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import type { Client } from './client.ts';
import { Domain } from './domain.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _SessionContext = createContext<Client.Session | null>(null);
const _CONFIG = {
    style: {
        app: {
            background: 'var(--pp-devtools-app-bg)',
            color: 'var(--pp-devtools-app-fg)',
            fontFamily: 'var(--pp-devtools-font-family)',
            minHeight: '100vh',
            padding: 'var(--pp-devtools-space-6)',
        },
        button: {
            background: 'var(--pp-devtools-accent)',
            border: 'none',
            borderRadius: 'var(--pp-devtools-radius-sm)',
            color: 'var(--pp-devtools-accent-fg)',
            cursor: 'pointer',
            fontWeight: '700',
            padding: 'var(--pp-devtools-space-2) var(--pp-devtools-space-3)',
        },
        logs: {
            background: 'var(--pp-devtools-panel-muted-bg)',
            borderRadius: 'var(--pp-devtools-radius-sm)',
            marginTop: 'var(--pp-devtools-space-4)',
            maxHeight: 'var(--pp-devtools-logs-max-height)',
            overflowY: 'auto',
            padding: 'var(--pp-devtools-space-3)',
        },
        panel: {
            background: 'var(--pp-devtools-panel-bg)',
            borderRadius: 'var(--pp-devtools-radius-md)',
            margin: '0 auto',
            maxWidth: 'var(--pp-devtools-panel-max-width)',
            padding: 'var(--pp-devtools-space-4)',
        },
    },
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const _OverlayView = (props: {
    readonly error: Error;
    readonly onDismiss?: () => void;
    readonly session: Client.Session;
}): ReactNode => {
    const logs = props.session.snapshotLogs();
    const elapsed = Domain.formatDuration(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - props.session.startTime,
    );
    const summary = `Elapsed: ${elapsed} | Logs: ${logs.length}`;
    const dismiss =
        typeof props.onDismiss === 'function'
            ? createElement(
                  'button',
                  { onClick: props.onDismiss, style: _CONFIG.style.button, type: 'button' },
                  'Dismiss',
              )
            : null;
    const logPanel =
        logs.length === 0
            ? [
                  createElement(
                      'div',
                      { key: 'empty', style: { color: 'var(--pp-devtools-muted-fg)' } },
                      'No logs captured',
                  ),
              ]
            : logs.map((entry) =>
                  createElement(
                      'div',
                      {
                          key: `${entry.timestamp.getTime()}-${entry.fiberId}-${entry.message}`,
                          style: {
                              borderBottom: '1px solid var(--pp-devtools-divider)',
                              color: Domain.toLevelColor(entry.level),
                              fontSize: 'var(--pp-devtools-font-size-sm)',
                              padding: 'var(--pp-devtools-space-1) 0',
                          },
                      },
                      Domain.formatLogEntry(entry),
                  ),
              );
    return createElement(
        'div',
        { style: _CONFIG.style.app },
        createElement(
            'section',
            { style: _CONFIG.style.panel },
            createElement('h1', { style: { color: 'var(--pp-devtools-danger)', margin: 0 } }, 'Application Failed'),
            createElement(
                'div',
                { style: { marginTop: 'var(--pp-devtools-space-3)' } },
                createElement('strong', null, props.error.name),
                createElement('div', { style: { marginTop: 'var(--pp-devtools-space-1)' } }, props.error.message),
                createElement(
                    'pre',
                    {
                        style: {
                            marginTop: 'var(--pp-devtools-space-3)',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                        },
                    },
                    props.error.stack ?? 'No stack trace available',
                ),
            ),
            createElement(
                'div',
                {
                    style: {
                        alignItems: 'center',
                        display: 'flex',
                        gap: 'var(--pp-devtools-space-3)',
                        marginTop: 'var(--pp-devtools-space-3)',
                    },
                },
                createElement('span', { style: { color: 'var(--pp-devtools-muted-fg)' } }, summary),
                dismiss,
            ),
            createElement('div', { style: _CONFIG.style.logs }, ...logPanel),
        ),
    );
};
const Provider = (props: { readonly children?: ReactNode; readonly session: Client.Session }): ReactNode => {
    const [overlay, setOverlay] = useState<Option.Option<{ readonly error: Error }>>(Option.none());
    const [, tick] = useState(0);
    useEffect(() => {
        const fiber = Effect.runFork(
            Stream.runForEach(props.session.stream, () =>
                Effect.sync(() => {
                    tick((value) => value + 1);
                }),
            ),
        );
        props.session.setRenderer((error) => {
            setOverlay(Option.some({ error }));
        });
        return () => {
            Effect.runFork(Fiber.interrupt(fiber));
            props.session.setRenderer(() => {});
        };
    }, [props.session]);
    return createElement(
        _SessionContext.Provider,
        { value: props.session },
        Option.match(overlay, {
            onNone: () => props.children,
            onSome: (state) =>
                createElement(_OverlayView, {
                    error: state.error,
                    onDismiss: () => setOverlay(Option.none()),
                    session: props.session,
                }),
        }),
    );
};
const use = (): Client.Session =>
    pipe(
        Option.fromNullable(useContext(_SessionContext)),
        Option.getOrThrowWith(() => new Error('Devtools.react.use must be called inside Devtools.react.Provider')),
    );
const Boundary = (props: { readonly children?: ReactNode }): ReactNode => {
    const session = use();
    return createElement(
        ErrorBoundary,
        {
            fallbackRender: ({ error }) => createElement(_OverlayView, { error: Domain.toError(error), session }),
            onError: (error, info) => {
                session.fatal(Domain.toError(error), { info, phase: 'react-boundary', ...session.context });
            },
        },
        props.children,
    );
};
const _renderFatal = (session: Client.Session, error: Error, rootId: string = 'root'): void => {
    pipe(
        document.getElementById(rootId),
        Option.fromNullable,
        Option.match({
            onNone: () => undefined,
            onSome: (root) => createRoot(root).render(createElement(_OverlayView, { error, session })),
        }),
    );
};
const _createBootstrap = (config: {
    readonly appModule: () => Promise<{ readonly App: ComponentType }>;
    readonly appName: string;
    readonly appVersion?: string;
    readonly cssModule?: () => Promise<unknown>;
    readonly isDev: boolean;
    readonly rootId?: string;
    readonly session: Client.Session;
    readonly verifyDelayMs?: number;
}) => {
    const normalized = Domain.normalizeBootstrap(config);
    const main = Effect.gen(function* () {
        const root = yield* pipe(
            Effect.fromNullable(document.getElementById(normalized.rootId)),
            Effect.mapError(() => Domain.Error.from('bootstrap', `Root #${normalized.rootId} not found`)),
        );
        yield* config.cssModule !== undefined
            ? Effect.tryPromise({
                  catch: (error) => Domain.Error.from('bootstrap', error),
                  try: config.cssModule,
              }).pipe(
                  Effect.asVoid,
                  Effect.catchAll((error) =>
                      Effect.sync(() =>
                          config.session.debug.warn('Stylesheet load failed', {
                              error,
                              ...config.session.context,
                          }),
                      ),
                  ),
              )
            : Effect.void;
        const appModule = yield* Effect.tryPromise({
            catch: (error) => Domain.Error.from('bootstrap', error),
            try: config.appModule,
        });
        createRoot(root, {
            onUncaughtError: (error, errorInfo): void => {
                const resolved = Domain.toError(error);
                config.session.fatal(resolved, { errorInfo, phase: 'react-uncaught', ...config.session.context });
                _renderFatal(config.session, resolved, normalized.rootId);
            },
        }).render(
            createElement(
                StrictMode,
                null,
                createElement(
                    Provider,
                    { session: config.session },
                    createElement(Boundary, null, createElement(appModule.App)),
                ),
            ),
        );
        yield* normalized.isDev
            ? Effect.sleep(`${normalized.verifyDelayMs} millis`).pipe(
                  Effect.andThen(
                      root.innerHTML.length > 0
                          ? Effect.sync(() =>
                                config.session.debug.info('Render verification succeeded', {
                                    app: normalized.appName,
                                    version: normalized.appVersion,
                                    ...config.session.context,
                                }),
                            )
                          : Effect.sync(() =>
                                config.session.debug.warn('Render verification returned empty DOM', {
                                    app: normalized.appName,
                                    version: normalized.appVersion,
                                    ...config.session.context,
                                }),
                            ),
                  ),
              )
            : Effect.void;
    }).pipe(
        Effect.catchAll((error) => {
            const resolved = Domain.toError(error);
            config.session.fatal(resolved, { app: normalized.appName, phase: 'bootstrap', ...config.session.context });
            return Effect.sync(() => _renderFatal(config.session, resolved, normalized.rootId));
        }),
    );
    return {
        init: (): void => {
            Effect.runFork(main);
        },
        main,
    } as const;
};
const _whenReady = (init: () => void): void => {
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const ReactTools = {
    Boundary,
    createBootstrap: _createBootstrap,
    Provider,
    renderFatal: _renderFatal,
    use,
    whenReady: _whenReady,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { ReactTools };
