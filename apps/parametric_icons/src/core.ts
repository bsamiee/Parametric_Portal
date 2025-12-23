/**
 * Core infrastructure: Effect runtime, hooks, and API factories.
 * Consolidates runtime composition, store hooks, boundary hooks, transition hooks, and async hooks.
 */
import type { HttpClient } from '@effect/platform/HttpClient';
import { BrowserHttpClient } from '@effect/platform-browser';
import { createAsyncHooks } from '@parametric-portal/hooks/async';
import { createBoundaryHooks } from '@parametric-portal/hooks/boundary';
import { createBrowserHooks } from '@parametric-portal/hooks/browser';
import { createFileHooks } from '@parametric-portal/hooks/file';
import { createAppRuntime, createRuntimeHooks } from '@parametric-portal/hooks/runtime';
import { createStoreHooks } from '@parametric-portal/hooks/store';
import { createTransitionHooks } from '@parametric-portal/hooks/transition';
import { DateTime, Duration, Effect, Layer, Option, pipe } from 'effect';
import { useEffect } from 'react';
import { auth } from './api.ts';
import { type AuthState, authSlice } from './stores.ts';

// --- [TYPES] -----------------------------------------------------------------

type AppServices = HttpClient;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    auth: { refreshBuffer: 60_000 },
    enableDevtools: true,
    name: 'ParametricIcons',
} as const);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const AppLayer = Layer.mergeAll(BrowserHttpClient.layerXMLHttpRequest);

// --- [ENTRY_POINT] -----------------------------------------------------------

const appRuntime = createAppRuntime<AppServices, never>(AppLayer);
const runtimeApi = createRuntimeHooks<AppServices>({ name: B.name });
const { RuntimeProvider, useRuntime } = runtimeApi;
const { useEffectBoundary } = createBoundaryHooks(runtimeApi);
const { usePersist, useStoreSlice, useStoreSelector, useStoreActions } = createStoreHooks<AppServices>({
    enableDevtools: B.enableDevtools,
    name: B.name,
});
const { useEffectTransition, useOptimisticEffect } = createTransitionHooks(runtimeApi);
const { useMutation, useQuery, useQueryCached, useQueryRetry } = createAsyncHooks(runtimeApi);
const { useClipboard, useDownload, useExport } = createBrowserHooks(runtimeApi);
const { useFileDrop, useFileInput } = createFileHooks(runtimeApi);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

type AuthResult = {
    readonly accessToken: string;
    readonly expiresAt: Date;
    readonly user: NonNullable<AuthState['user']>;
} | null;

const refreshAuthEffect: Effect.Effect<AuthResult, never, never> = pipe(
    auth.refreshSession(),
    Effect.flatMap((sessionResult) =>
        sessionResult._tag === 'ApiSuccess'
            ? pipe(
                  auth.getCurrentUser(sessionResult.data.accessToken),
                  Effect.map((userResult) =>
                      userResult._tag === 'ApiSuccess'
                          ? {
                                accessToken: sessionResult.data.accessToken,
                                expiresAt: DateTime.toDate(sessionResult.data.expiresAt),
                                user: userResult.data,
                            }
                          : null,
                  ),
              )
            : Effect.succeed(null),
    ),
);

const useAuthInit = (): void => {
    const runtime = useRuntime();
    const authActions = useStoreActions(authSlice);

    // Silent refresh on mount - attempt to restore session from HttpOnly cookie
    useEffect(() => {
        authActions.setLoading(true);
        const fiber = runtime.runFork(
            pipe(
                refreshAuthEffect,
                Effect.map((result) =>
                    Option.match(Option.fromNullable(result), {
                        onNone: () => authActions.clearAuth(),
                        onSome: (r) => authActions.setAuth(r.accessToken, r.expiresAt, r.user),
                    }),
                ),
            ),
        );
        return () => {
            runtime.runFork(Effect.sync(() => fiber.unsafeInterruptAsFork(fiber.id())));
        };
    }, [runtime, authActions]);

    // Auto-refresh before token expiration
    useEffect(() => {
        const { accessToken, expiresAt } = authSlice.getState();
        const refreshMs =
            accessToken !== null && expiresAt !== null
                ? Math.max(0, expiresAt.getTime() - Date.now() - B.auth.refreshBuffer)
                : 0;
        const fiber =
            refreshMs > 0
                ? runtime.runFork(
                      pipe(
                          Effect.sleep(Duration.millis(refreshMs)),
                          Effect.flatMap(() => refreshAuthEffect),
                          Effect.map((result) =>
                              Option.match(Option.fromNullable(result), {
                                  onNone: () => authActions.clearAuth(),
                                  onSome: (r) => authActions.setAuth(r.accessToken, r.expiresAt, r.user),
                              }),
                          ),
                      ),
                  )
                : null;
        return () => {
            fiber !== null && runtime.runFork(Effect.sync(() => fiber.unsafeInterruptAsFork(fiber.id())));
        };
    }, [runtime, authActions]);
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    appRuntime,
    runtimeApi,
    RuntimeProvider,
    useAuthInit,
    useClipboard,
    useDownload,
    useEffectBoundary,
    useEffectTransition,
    useExport,
    useFileDrop,
    useFileInput,
    useMutation,
    useOptimisticEffect,
    usePersist,
    useQuery,
    useQueryCached,
    useQueryRetry,
    useRuntime,
    useStoreActions,
    useStoreSelector,
    useStoreSlice,
};
export type { AppServices };
