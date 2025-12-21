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
import { Layer } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AppServices = HttpClient;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
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

// --- [EXPORT] ----------------------------------------------------------------

export {
    appRuntime,
    runtimeApi,
    RuntimeProvider,
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
