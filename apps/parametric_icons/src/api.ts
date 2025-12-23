/**
 * API client with Effect pipelines.
 * Icons + Auth endpoints using shared contracts.
 */

import {
    type GenerateRequest,
    type GenerateResponse,
    ICON_DESIGN,
    type Palette,
} from '@parametric-portal/api/contracts/icons';
import { type ApiError, type ApiResponse, api, type HttpStatusError } from '@parametric-portal/types/api';
import { type AsyncState, createAsync } from '@parametric-portal/types/async';
import type {
    AiProvider,
    ApiKeyId,
    ApiKeyListItem,
    ColorMode,
    LogoutResponse,
    OAuthProvider,
    OAuthStartResponse,
    SessionResponse,
    UserResponse,
} from '@parametric-portal/types/database';
import { Effect, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type RecoveryConfig = FetchConfig & { readonly onTokenRefresh?: (token: string, expiresAt: Date) => void };
type CreateApiKeyRequest = { readonly key: string; readonly name: string; readonly provider: AiProvider };
type CreateApiKeyResponse = ApiKeyListItem;
type ListApiKeysResponse = { readonly data: ReadonlyArray<ApiKeyListItem> };
type DeleteApiKeyResponse = { readonly success: boolean };
type GenerateInput = GenerateRequest & { readonly signal?: AbortSignal };
type IconAsyncState = AsyncState<ApiResponse<GenerateResponse>, ApiError>;
type FetchConfig = {
    readonly body?: unknown;
    readonly credentials?: RequestCredentials;
    readonly method?: 'DELETE' | 'GET' | 'POST';
    readonly signal?: AbortSignal;
    readonly token?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const apiFactory = api();
const asyncApi = createAsync();
const buildHeaders = (token?: string): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
});
const getPalette = (mode: ColorMode): Palette => ICON_DESIGN.palettes[mode];
const buildLayerManifest = (palette: Palette): string => {
    const { structural, semantic } = palette;
    const { layers } = ICON_DESIGN;
    return [
        `<g id="${layers.guide.id}" stroke="${structural.guide}" stroke-width="${layers.guide.strokeWidth}" fill="none" stroke-dasharray="${layers.guide.dasharray}"/>`,
        `<g id="${layers.context.id}" stroke="${structural.context}" stroke-width="${layers.context.strokeWidth}" fill="none"/>`,
        `<g id="${layers.detail.id}" stroke="${structural.secondary}" stroke-width="${layers.detail.strokeWidth}" fill="none"/>`,
        `<g id="${layers.primary.id}" stroke="${structural.primary}" stroke-width="${layers.primary.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<g id="${layers.grips.id}" stroke="${semantic.gripStroke}" stroke-width="${layers.grips.strokeWidth}" fill="${semantic.grip}"/>`,
    ].join('\n  ');
};
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
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateIcon = (input: GenerateInput): Effect.Effect<ApiResponse<GenerateResponse>, never, never> => {
    const { signal, ...body } = input;
    return fetchApi<GenerateResponse>(B.endpoints.icons, {
        body,
        method: 'POST',
        ...(signal && { signal }),
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    apiFactory,
    asyncApi,
    auth,
    B as API_CONFIG,
    buildLayerManifest,
    fetchApiWithRecovery,
    generateIcon,
    getPalette,
};
export type { GenerateInput, IconAsyncState };
