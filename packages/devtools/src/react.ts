import { Effect, Match, Option, pipe } from 'effect';
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
import type { ClientSession } from './client.ts';
import { Domain } from './domain.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _SessionContext = createContext<ClientSession | null>(null);
const _CONFIG = {
    style: {
        app: {
            background: 'oklch(0.12 0.02 260)',
            color: '#fff',
            fontFamily: 'ui-monospace, Menlo, monospace',
            minHeight: '100vh',
            padding: '1.5rem',
        },
        button: {
            background: 'oklch(0.50 0.20 260)',
            border: 0,
            borderRadius: '8px',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 700,
            padding: '0.5rem 0.75rem',
        },
        logs: {
            background: 'oklch(0.10 0.02 260)',
            borderRadius: '8px',
            marginTop: '1rem',
            maxHeight: '340px',
            overflowY: 'auto',
            padding: '0.75rem',
        },
        panel: {
            background: 'oklch(0.15 0.02 260)',
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '960px',
            padding: '1rem',
        },
    },
} as const;

// --- [COMPONENTS] ------------------------------------------------------------

const _OverlayView = (props: {
    readonly error: Error;
    readonly onDismiss?: () => void;
    readonly session: ClientSession;
}): ReactNode => {
    const elapsed = Domain.formatDuration(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - props.session.startTime,
    );
    const summary = `Elapsed: ${elapsed} | Logs: ${props.session.logs.length}`;
    const dismiss = Match.value(props.onDismiss).pipe(
        Match.when(
            (next): next is () => void => typeof next === 'function',
            (next) =>
                createElement('button', { onClick: next, style: _CONFIG.style.button, type: 'button' }, 'Dismiss'),
        ),
        Match.orElse(() => null),
    );
    const logPanel = Match.value(props.session.logs.length).pipe(
        Match.when(0, () => [
            createElement('div', { key: 'empty', style: { color: 'oklch(0.75 0.02 260)' } }, 'No logs captured'),
        ]),
        Match.orElse(() =>
            props.session.logs.map((entry) =>
                createElement(
                    'div',
                    {
                        key: `${entry.timestamp.getTime()}-${entry.fiberId}`,
                        style: {
                            borderBottom: '1px solid oklch(0.20 0.02 260)',
                            color: Domain.toLevelColor(entry.level),
                            fontSize: '0.8rem',
                            padding: '0.2rem 0',
                        },
                    },
                    Domain.formatLogEntry(entry),
                ),
            ),
        ),
    );
    return createElement(
        'div',
        { style: _CONFIG.style.app },
        createElement(
            'section',
            { style: _CONFIG.style.panel },
            createElement('h1', { style: { color: 'oklch(0.70 0.20 25)', margin: 0 } }, 'Application Failed'),
            createElement(
                'div',
                { style: { marginTop: '0.75rem' } },
                createElement('strong', null, props.error.name),
                createElement('div', { style: { marginTop: '0.25rem' } }, props.error.message),
                createElement(
                    'pre',
                    { style: { marginTop: '0.75rem', overflowX: 'auto', whiteSpace: 'pre-wrap' } },
                    props.error.stack ?? 'No stack trace available',
                ),
            ),
            createElement(
                'div',
                { style: { alignItems: 'center', display: 'flex', gap: '0.75rem', marginTop: '0.75rem' } },
                createElement('span', { style: { color: 'oklch(0.75 0.15 260)' } }, summary),
                dismiss,
            ),
            createElement('div', { style: _CONFIG.style.logs }, ...logPanel),
        ),
    );
};
const Provider = (props: { readonly children?: ReactNode; readonly session: ClientSession }): ReactNode => {
    const [overlay, setOverlay] = useState<Option.Option<{ readonly error: Error }>>(Option.none());
    useEffect(() => {
        props.session.setRenderer((error) => {
            setOverlay(Option.some({ error }));
        });
        return () => {
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
const use = (): ClientSession =>
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
                session.fatal(Domain.toError(error), { info, phase: 'react-boundary' });
            },
        },
        props.children,
    );
};

// --- [FUNCTIONS] -------------------------------------------------------------

const _renderFatal = (session: ClientSession, error: Error, rootId: string = Domain._CONFIG.defaults.rootId): void => {
    pipe(
        Option.fromNullable(document.getElementById(rootId)),
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
    readonly session: ClientSession;
    readonly verifyDelayMs?: number;
}) => {
    const normalized = Domain.normalizeBootstrap(config);
    const main = Effect.gen(function* () {
        const root = yield* pipe(
            Effect.fromNullable(document.getElementById(normalized.rootId)),
            Effect.mapError(() => Domain.Error.from('bootstrap', `Root #${normalized.rootId} not found`)),
        );
        yield* Option.fromNullable(config.cssModule).pipe(
            Option.match({
                onNone: () => Effect.void,
                onSome: (loadCss) =>
                    Effect.tryPromise({ catch: (error) => Domain.Error.from('bootstrap', error), try: loadCss }).pipe(
                        Effect.asVoid,
                        Effect.catchAll((error) =>
                            Effect.sync(() => config.session.debug.warn('Stylesheet load failed', { error })),
                        ),
                    ),
            }),
        );
        const appModule = yield* Effect.tryPromise({
            catch: (error) => Domain.Error.from('bootstrap', error),
            try: config.appModule,
        });
        createRoot(root, {
            onUncaughtError: (error, errorInfo): void => {
                const resolved = Domain.toError(error);
                config.session.fatal(resolved, { errorInfo, phase: 'react-uncaught' });
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
        yield* Match.value(normalized.isDev).pipe(
            Match.when(true, () =>
                Effect.sleep(`${normalized.verifyDelayMs} millis`).pipe(
                    Effect.andThen(
                        Match.value(root.innerHTML.length > 0).pipe(
                            Match.when(true, () =>
                                Effect.sync(() =>
                                    config.session.debug.info('Render verification succeeded', {
                                        app: normalized.appName,
                                        version: normalized.appVersion,
                                    }),
                                ),
                            ),
                            Match.orElse(() =>
                                Effect.sync(() =>
                                    config.session.debug.warn('Render verification returned empty DOM', {
                                        app: normalized.appName,
                                        version: normalized.appVersion,
                                    }),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
            Match.orElse(() => Effect.void),
        );
    }).pipe(
        Effect.catchAll((error) => {
            const resolved = Domain.toError(error);
            config.session.fatal(resolved, { app: normalized.appName, phase: 'bootstrap' });
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
    Match.value(document.readyState).pipe(
        Match.when('loading', () => document.addEventListener('DOMContentLoaded', init)),
        Match.orElse(() => init()),
    );
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
