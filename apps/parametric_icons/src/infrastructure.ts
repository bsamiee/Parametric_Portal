/**
 * Infrastructure: Effect runtime, API client, and auth initialization.
 * Unified module combining runtime layer, API dispatch tables, and auth hooks.
 */
import type { HttpClient } from '@effect/platform/HttpClient';
import { BrowserHttpClient } from '@effect/platform-browser';
import type { GenerateRequest, GenerateResponse } from '@parametric-portal/api/contracts/icons';
import { createAppRuntime, useRuntime } from '@parametric-portal/runtime/runtime';
import { type AuthState, useAuthStore } from '@parametric-portal/runtime/stores/auth';
import { type ApiResponse, api, type HttpStatusError } from '@parametric-portal/types/api';
import { async } from '@parametric-portal/types/async';
import type {
    AiProvider,
    ApiKeyId,
    ApiKeyListItem,
    LogoutResponse,
    OAuthProvider,
    OAuthStartResponse,
    SessionResponse,
    UserResponse,
} from '@parametric-portal/types/database';
import { DateTime, Duration, Effect, Fiber, Layer, Option, pipe } from 'effect';
import { useEffect } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type AppServices = HttpClient;
type RecoveryConfig = FetchConfig & { readonly onTokenRefresh?: (token: string, expiresAt: Date) => void };
type CreateApiKeyRequest = { readonly key: string; readonly name: string; readonly provider: AiProvider };
type CreateApiKeyResponse = ApiKeyListItem;
type ListApiKeysResponse = { readonly data: ReadonlyArray<ApiKeyListItem> };
type DeleteApiKeyResponse = { readonly success: boolean };
type GenerateInput = GenerateRequest & { readonly signal?: AbortSignal };
type FetchConfig = {
    readonly body?: unknown;
    readonly credentials?: RequestCredentials;
    readonly method?: 'DELETE' | 'GET' | 'POST';
    readonly signal?: AbortSignal;
    readonly token?: string;
};
type AuthResult = {
    readonly accessToken: string;
    readonly expiresAt: Date;
    readonly user: NonNullable<AuthState['user']>;
} | null;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    auth: { refreshBuffer: 60_000 },
    baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
    endpoints: {
        apiKeys: '/auth/apikeys',
        apiKeysDelete: (id: ApiKeyId) => `/auth/apikeys/${id}`,
        icons: '/icons',
        logout: '/auth/logout',
        me: '/auth/me',
        oauth: (provider: OAuthProvider) => `/auth/oauth/${provider}`,
        refresh: '/auth/refresh',
    },
} as const);
const AppLayer = Layer.mergeAll(BrowserHttpClient.layerXMLHttpRequest);
const apiFactory = api();
const asyncApi = async();

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const buildHeaders = (token?: string): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
});
const fetchApi = <T>(endpoint: string, config: FetchConfig = {}): Effect.Effect<ApiResponse<T>, never, never> =>
    pipe(
        Effect.tryPromise({
            catch: (e) =>
                e instanceof Error && e.name === 'AbortError'
                    ? apiFactory.error(499 as HttpStatusError, 'CANCELLED', 'Request cancelled')
                    : apiFactory.error(500 as HttpStatusError, 'NETWORK', String(e)),
            try: () =>
                fetch(`${B.baseUrl}${endpoint}`, {
                    body: config.body ? JSON.stringify(config.body) : null,
                    credentials: config.credentials ?? 'include',
                    headers: buildHeaders(config.token),
                    method: config.method ?? 'GET',
                    signal: config.signal ?? null,
                }),
        }),
        Effect.flatMap((res) =>
            pipe(
                Effect.tryPromise({
                    catch: () => apiFactory.error(500 as HttpStatusError, 'PARSE', 'Invalid JSON'),
                    try: () => res.json() as Promise<unknown>,
                }),
                Effect.map((data) =>
                    res.ok
                        ? apiFactory.success(data as T)
                        : apiFactory.error(
                              res.status as HttpStatusError,
                              (data as { code?: string }).code ?? 'API_ERROR',
                              (data as { message?: string }).message ?? 'Request failed',
                          ),
                ),
            ),
        ),
        Effect.catchAll((err) => Effect.succeed(err)),
    );
const fetchApiWithRecovery = <T>(
    endpoint: string,
    config: RecoveryConfig,
): Effect.Effect<ApiResponse<T>, never, never> =>
    pipe(
        fetchApi<T>(endpoint, config),
        Effect.flatMap((result) =>
            result._tag === 'ApiError' && result.status === 401 && config.token
                ? pipe(
                      fetchApi<SessionResponse>(B.endpoints.refresh, { method: 'POST' }),
                      Effect.flatMap((refreshResult) =>
                          refreshResult._tag === 'ApiSuccess'
                              ? pipe(
                                    Effect.sync(() => {
                                        const expiresAt = new Date(String(refreshResult.data.expiresAt));
                                        config.onTokenRefresh?.(refreshResult.data.accessToken, expiresAt);
                                    }),
                                    Effect.flatMap(() =>
                                        fetchApi<T>(endpoint, { ...config, token: refreshResult.data.accessToken }),
                                    ),
                                )
                              : Effect.succeed(result),
                      ),
                  )
                : Effect.succeed(result),
        ),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const auth = {
    createApiKey: (
        token: string,
        body: CreateApiKeyRequest,
        onTokenRefresh?: (token: string, expiresAt: Date) => void,
    ) =>
        fetchApiWithRecovery<CreateApiKeyResponse>(B.endpoints.apiKeys, {
            body,
            method: 'POST',
            token,
            ...(onTokenRefresh ? { onTokenRefresh } : {}),
        }),
    deleteApiKey: (token: string, id: ApiKeyId, onTokenRefresh?: (token: string, expiresAt: Date) => void) =>
        fetchApiWithRecovery<DeleteApiKeyResponse>(B.endpoints.apiKeysDelete(id), {
            method: 'DELETE',
            token,
            ...(onTokenRefresh ? { onTokenRefresh } : {}),
        }),
    getCurrentUser: (token: string, onTokenRefresh?: (token: string, expiresAt: Date) => void) =>
        fetchApiWithRecovery<UserResponse>(B.endpoints.me, { token, ...(onTokenRefresh ? { onTokenRefresh } : {}) }),
    initiateOAuth: (provider: OAuthProvider) => fetchApi<OAuthStartResponse>(B.endpoints.oauth(provider)),
    listApiKeys: (token: string, onTokenRefresh?: (token: string, expiresAt: Date) => void) =>
        fetchApiWithRecovery<ListApiKeysResponse>(B.endpoints.apiKeys, {
            token,
            ...(onTokenRefresh ? { onTokenRefresh } : {}),
        }),
    logout: (token: string, onTokenRefresh?: (token: string, expiresAt: Date) => void) =>
        fetchApiWithRecovery<LogoutResponse>(B.endpoints.logout, {
            method: 'POST',
            token,
            ...(onTokenRefresh ? { onTokenRefresh } : {}),
        }),
    refreshSession: () => fetchApi<SessionResponse>(B.endpoints.refresh, { method: 'POST' }),
} as const;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

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
const handleAuthResult = (
    result: AuthResult,
    clearAuth: () => void,
    setAuth: (token: string, expiresAt: Date, user: NonNullable<AuthState['user']>) => void,
): void =>
    pipe(
        Option.fromNullable(result),
        Option.match({
            onNone: () => {
                console.warn('[Auth] Session refresh failed. Please sign in again.');
                clearAuth();
            },
            onSome: (r) => setAuth(r.accessToken, r.expiresAt, r.user),
        }),
    );

// --- [HOOKS] -----------------------------------------------------------------

const useAuthInit = (): void => {
    const runtime = useRuntime();
    const setLoading = useAuthStore((s) => s.setLoading);
    const clearAuth = useAuthStore((s) => s.clearAuth);
    const setAuth = useAuthStore((s) => s.setAuth);
    useEffect(() => {
        setLoading(true);
        const fiber = runtime.runFork(
            pipe(
                refreshAuthEffect,
                Effect.map((result) => handleAuthResult(result, clearAuth, setAuth)),
            ),
        );
        return () => {
            runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [runtime, setLoading, clearAuth, setAuth]);
    const accessToken = useAuthStore((s) => s.accessToken);
    const expiresAt = useAuthStore((s) => s.expiresAt);
    useEffect(() => {
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
                          Effect.map((result) => handleAuthResult(result, clearAuth, setAuth)),
                      ),
                  )
                : null;
        return () => {
            fiber !== null && runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [runtime, clearAuth, setAuth, accessToken, expiresAt]);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const appRuntime = createAppRuntime<AppServices, never>(AppLayer);
const generateIcon = (input: GenerateInput): Effect.Effect<ApiResponse<GenerateResponse>, never, never> => {
    const { signal, ...body } = input;
    return fetchApi<GenerateResponse>(B.endpoints.icons, {
        body,
        method: 'POST',
        ...(signal && { signal }),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export { apiFactory, appRuntime, asyncApi, auth, generateIcon, useAuthInit };
export type { AppServices, GenerateInput };
