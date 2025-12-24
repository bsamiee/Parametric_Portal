/**
 * Bootstrap React application with Effect-based initialization pipeline.
 */
import { Effect, type Layer, pipe } from 'effect';
import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRootErrorOptions, type ErrorCallback } from './boundary.tsx';
import { toError } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ModuleLoader<T> = () => Promise<T>;
type BootstrapConfig<T extends { App: ComponentType }> = {
    readonly appModule: ModuleLoader<T>;
    readonly cssModule?: ModuleLoader<unknown>;
    readonly isDev: boolean;
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly onError: ErrorCallback;
    readonly rootId?: string;
    readonly verifyDelayMs?: number;
};
type MainConfig<T extends { App: ComponentType }> = BootstrapConfig<T> & {
    readonly appName: string;
    readonly appVersion?: string;
    readonly onFatal: (error: Error) => void;
    readonly startTime: number;
};
type BootstrapResult = {
    readonly bootstrap: () => Effect.Effect<void, Error>;
};
type MainResult = {
    readonly init: () => void;
    readonly main: Effect.Effect<void, never>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        rootId: 'root',
        verifyDelayMs: 16, // Single animation frame (~16ms) instead of 100ms
    },
} as const);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const loadModule = <T,>(name: string, loader: ModuleLoader<T>): Effect.Effect<T, Error> =>
    pipe(
        Effect.logDebug(`Loading module: ${name}`),
        Effect.flatMap(() =>
            Effect.tryPromise({
                catch: toError,
                try: loader,
            }),
        ),
        Effect.tap(() => Effect.logInfo(`Module loaded: ${name}`)),
        Effect.tapError((error) => Effect.logError(`Module failed: ${name}`, error)),
        Effect.withLogSpan(name),
        Effect.annotateLogs({ module: name, phase: 'load' }),
    );
const loadCss = (loader: ModuleLoader<unknown>): Effect.Effect<void, Error> =>
    pipe(
        Effect.logDebug('Importing stylesheet'),
        Effect.flatMap(() =>
            Effect.tryPromise({
                catch: toError,
                try: loader,
            }),
        ),
        Effect.tap(() => Effect.logInfo('Stylesheet loaded')),
        Effect.tapError((error) => Effect.logError('Stylesheet import failed', error)),
        Effect.withLogSpan('css'),
        Effect.annotateLogs({ phase: 'assets' }),
        Effect.asVoid,
    );
const verifyRender = (root: HTMLElement, delayMs: number): Effect.Effect<void> =>
    pipe(
        Effect.sleep(`${delayMs} millis`),
        Effect.map(() => (root.innerHTML?.length ?? 0) > 0),
        Effect.tap((hasContent) =>
            hasContent
                ? Effect.logInfo('Render verification: SUCCESS', { contentLength: root.innerHTML?.length })
                : Effect.logWarning('Render verification: EMPTY', { contentLength: 0 }),
        ),
        Effect.withLogSpan('verify-render'),
        Effect.asVoid,
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createBootstrap = <T extends { App: ComponentType }>(config: BootstrapConfig<T>): BootstrapResult => {
    const rootId = config.rootId ?? B.defaults.rootId;
    const verifyDelayMs = config.verifyDelayMs ?? B.defaults.verifyDelayMs;
    const bootstrap = (): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
            yield* Effect.logInfo('Bootstrap sequence starting');
            yield* Effect.logDebug('Environment details', { isDev: config.isDev });
            const root = yield* pipe(
                Effect.fromNullable(document.getElementById(rootId)),
                Effect.mapError(() => new Error(`Root element #${rootId} not found in DOM`)),
                Effect.tap(() => Effect.logDebug('Root element located', { id: rootId })),
            );
            config.cssModule &&
                (yield* pipe(
                    loadCss(config.cssModule),
                    Effect.catchAll((error) =>
                        Effect.logWarning('CSS load failed, continuing without styles', { error }).pipe(Effect.asVoid),
                    ),
                ));
            yield* Effect.logInfo('Loading application module');
            const { App } = yield* loadModule('app', config.appModule);
            yield* Effect.logInfo('Creating React root');
            const reactRoot = createRoot(
                root,
                createRootErrorOptions({
                    loggerLayer: config.loggerLayer,
                    onError: config.onError,
                }),
            );
            yield* Effect.logInfo('Rendering application');
            reactRoot.render(
                <StrictMode>
                    <App />
                </StrictMode>,
            );
            yield* Effect.logInfo('Application rendered successfully');
            config.isDev && (yield* verifyRender(root, verifyDelayMs));
        }).pipe(
            Effect.withLogSpan('bootstrap'),
            Effect.annotateLogs({ component: 'main' }),
            Effect.provide(config.loggerLayer),
        );
    return { bootstrap };
};
const createMain = <T extends { App: ComponentType }>(config: MainConfig<T>): MainResult => {
    const { bootstrap } = createBootstrap(config);
    const main: Effect.Effect<void, never> = pipe(
        Effect.logInfo('Application initialization starting'),
        Effect.tap(() => Effect.logDebug(`Document readyState: ${document.readyState}`)),
        Effect.flatMap(() => bootstrap()),
        Effect.tap(() => Effect.logInfo('Application ready')),
        Effect.catchAll((error) =>
            pipe(
                Effect.logFatal('Bootstrap failed catastrophically', { error }),
                Effect.tap(() => Effect.sync(() => config.onFatal(error))),
            ),
        ),
        Effect.withLogSpan('app-init'),
        Effect.annotateLogs({ app: config.appName, startTime: config.startTime, version: config.appVersion }),
        Effect.provide(config.loggerLayer),
    );
    const init = (): void => {
        Effect.runFork(main);
    };
    return { init, main };
};
const initWhenReady = (init: () => void, loggerLayer: Layer.Layer<never, never, never>): void => {
    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', () => {
              // Non-blocking: fork Effect instead of runSync to prevent main thread blocking
              Effect.runFork(Effect.logDebug('DOMContentLoaded fired').pipe(Effect.provide(loggerLayer)));
              init();
          })
        : init();
};

// --- [EXPORT] ----------------------------------------------------------------

export type { BootstrapConfig, BootstrapResult, MainConfig, MainResult, ModuleLoader };
export { B as BOOTSTRAP_TUNING, createBootstrap, createMain, initWhenReady, loadCss, loadModule, verifyRender };
