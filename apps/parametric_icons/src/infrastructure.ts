/**
 * Infrastructure: Effect runtime, HttpApiClient, and auth initialization.
 * Uses ParametricApi contract for type-safe API calls via HttpApiClient.make.
 */
import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform';
// biome-ignore lint/style/useImportType: Clipboard namespace needed for Clipboard.Clipboard type
import { BrowserHttpClient, Clipboard } from '@effect/platform-browser';
import { Runtime } from '@parametric-portal/runtime/runtime';
import { BrowserServicesLive, type Download, type Export } from '@parametric-portal/runtime/services/browser';
import { createBrowserTelemetryLayer } from '@parametric-portal/runtime/services/telemetry';
import { type AuthState, useAuthStore } from '@parametric-portal/runtime/stores/auth';
import { ParametricApi } from '@parametric-portal/server/api';
import type { IconRequest } from '@parametric-portal/types/icons';
import type { ApiKeyId, OAuthProvider } from '@parametric-portal/types/schema';
import { DurationMs } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Fiber, Layer, Option } from 'effect';
import { useEffect } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type AppServices = Clipboard.Clipboard | Download | Export | HttpClient.HttpClient;
type GenerateInput = IconRequest & { readonly signal?: AbortSignal };
type AuthResult = {
    readonly accessToken: string;
    readonly expiresAt: Date;
    readonly user: NonNullable<AuthState['user']>;
} | null;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    auth: { refreshBuffer: DurationMs.fromMillis(60_000) },
    baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
    otel: {
        enabled: import.meta.env['VITE_OTEL_ENABLED'] === 'true',
        serviceName: 'parametric-icons',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeClient = () => HttpApiClient.make(ParametricApi, { baseUrl: B.baseUrl });
const makeAuthenticatedClient = (token: string) =>
    HttpApiClient.make(ParametricApi, {
        baseUrl: B.baseUrl,
        transformClient: (client) => client.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken(token))),
    });

// --- [LAYERS] ----------------------------------------------------------------

const TracedHttpClientLive = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return client.pipe(HttpClient.withTracerPropagation(true));
    }),
).pipe(Layer.provide(BrowserHttpClient.layerXMLHttpRequest));
const BrowserTelemetryWithClient = createBrowserTelemetryLayer({
    apiUrl: `${B.baseUrl}/api`,
    enabled: B.otel.enabled,
    serviceName: B.otel.serviceName,
}).pipe(Layer.provide(TracedHttpClientLive));
const AppLayer = Layer.mergeAll(TracedHttpClientLive, BrowserServicesLive, BrowserTelemetryWithClient);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const auth = {
    createApiKey: (token: string, body: { readonly key: string; readonly name: string; readonly provider: string }) =>
        Effect.gen(function* () {
            const client = yield* makeAuthenticatedClient(token);
            return yield* client.auth.createApiKey({
                payload: {
                    key: body.key,
                    name: body.name,
                    provider: body.provider as 'anthropic' | 'gemini' | 'openai',
                },
            });
        }).pipe(Effect.withSpan('api.apiKeys.create')),
    deleteApiKey: (token: string, id: ApiKeyId) =>
        Effect.gen(function* () {
            const client = yield* makeAuthenticatedClient(token);
            return yield* client.auth.deleteApiKey({ path: { id } });
        }).pipe(Effect.withSpan('api.apiKeys.delete', { attributes: { id } })),
    getCurrentUser: (token: string) =>
        Effect.gen(function* () {
            const client = yield* makeAuthenticatedClient(token);
            return yield* client.auth.me();
        }).pipe(Effect.withSpan('api.auth.me')),
    initiateOAuth: (provider: OAuthProvider) =>
        Effect.gen(function* () {
            const client = yield* makeClient();
            return yield* client.auth.oauthStart({ path: { provider } });
        }).pipe(Effect.withSpan('api.auth.oauth', { attributes: { provider } })),
    listApiKeys: (token: string) =>
        Effect.gen(function* () {
            const client = yield* makeAuthenticatedClient(token);
            return yield* client.auth.listApiKeys();
        }).pipe(Effect.withSpan('api.apiKeys.list')),
    logout: (token: string) =>
        Effect.gen(function* () {
            const client = yield* makeAuthenticatedClient(token);
            return yield* client.auth.logout();
        }).pipe(Effect.withSpan('api.auth.logout')),
    refreshSession: () =>
        Effect.gen(function* () {
            const client = yield* makeClient();
            return yield* client.auth.refresh();
        }).pipe(Effect.withSpan('api.auth.refresh')),
} as const;
const generateIcon = (token: string, input: GenerateInput) =>
    Effect.gen(function* () {
        const client = yield* makeAuthenticatedClient(token);
        const { signal: _signal, ...payload } = input;
        return yield* client.icons.generate({ payload });
    }).pipe(Effect.withSpan('api.icons.generate'));

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const refreshAuthEffect = Effect.gen(function* () {
    const sessionResult = yield* auth.refreshSession().pipe(Effect.option);
    return yield* Option.isSome(sessionResult)
        ? Effect.gen(function* () {
              const userResult = yield* auth.getCurrentUser(sessionResult.value.accessToken).pipe(Effect.option);
              return Option.isSome(userResult)
                  ? {
                        accessToken: sessionResult.value.accessToken,
                        expiresAt: DateTime.toDate(sessionResult.value.expiresAt),
                        user: userResult.value,
                    }
                  : null;
          })
        : Effect.succeed(null);
}).pipe(Effect.withSpan('auth.refreshFlow'));
const handleAuthResult = (
    result: AuthResult,
    clearAuth: () => void,
    setAuth: (token: string, expiresAt: Date, user: NonNullable<AuthState['user']>) => void,
): void =>
    Option.fromNullable(result).pipe(
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
    const runtime = Runtime.use();
    const setLoading = useAuthStore((s) => s.setLoading);
    const clearAuth = useAuthStore((s) => s.clearAuth);
    const setAuth = useAuthStore((s) => s.setAuth);
    useEffect(() => {
        setLoading(true);
        const fiber = runtime.runFork(
            refreshAuthEffect.pipe(
                Effect.map((result) => handleAuthResult(result, clearAuth, setAuth)),
                Effect.catchAll(() => Effect.succeed(undefined)),
                Effect.provide(AppLayer),
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
                      Effect.sleep(Duration.millis(refreshMs)).pipe(
                          Effect.flatMap(() => refreshAuthEffect),
                          Effect.map((result) => handleAuthResult(result, clearAuth, setAuth)),
                          Effect.catchAll(() => Effect.succeed(undefined)),
                          Effect.provide(AppLayer),
                      ),
                  )
                : null;
        return () => {
            fiber !== null && runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [runtime, clearAuth, setAuth, accessToken, expiresAt]);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const appRuntime = Runtime.make<AppServices, never>(AppLayer);

// --- [EXPORT] ----------------------------------------------------------------

export { AppLayer, appRuntime, auth, generateIcon, useAuthInit };
export type { AppServices, GenerateInput };
