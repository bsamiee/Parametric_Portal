/**
 * Cross-app authentication state with HttpOnly cookie token persistence.
 * Uses DateTime.Utc consistently for all temporal values.
 */
import type { DateTime } from 'effect';
import { createStore } from './factory';

// --- [TYPES] -----------------------------------------------------------------

type AuthUser = {
    readonly id: string;
    readonly appId: string;
    readonly email: string;
    readonly role: string;
    readonly state: string;
};
type AuthApiKey = {
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
    readonly expiresAt: Date | null;
    readonly lastUsedAt: Date | null;
};
type AuthState = {
    readonly accessToken: string | null;
    readonly apiKeys: ReadonlyArray<AuthApiKey>;
    readonly expiresAt: DateTime.Utc | null;
    readonly isAccountOverlayOpen: boolean;
    readonly isAuthOverlayOpen: boolean;
    readonly isLoading: boolean;
    readonly user: AuthUser | null;
};
type AuthActions = {
    readonly addApiKey: (key: AuthApiKey) => void;
    readonly clearAuth: () => void;
    readonly closeAccountOverlay: () => void;
    readonly closeAuthOverlay: () => void;
    readonly openAccountOverlay: () => void;
    readonly openAuthOverlay: () => void;
    readonly removeApiKey: (id: string) => void;
    readonly setApiKeys: (keys: ReadonlyArray<AuthApiKey>) => void;
    readonly setAuth: (token: string, expiresAt: DateTime.Utc, user: AuthUser) => void;
    readonly setLoading: (flag: boolean) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const AuthStoreTuning = {
    initial: {
        accessToken: null,
        apiKeys: [] as ReadonlyArray<AuthApiKey>,
        expiresAt: null,
        isAccountOverlayOpen: false,
        isAuthOverlayOpen: false,
        isLoading: false,
        user: null,
    } satisfies AuthState,
    name: 'parametric-portal:auth',
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const useAuthStore = createStore<AuthState & AuthActions>(
    (set, get) => ({
        ...AuthStoreTuning.initial,
        addApiKey: (key) => set({ apiKeys: [...get().apiKeys, key] }),
        clearAuth: () => set(AuthStoreTuning.initial),
        closeAccountOverlay: () => set({ isAccountOverlayOpen: false }),
        closeAuthOverlay: () => set({ isAuthOverlayOpen: false }),
        openAccountOverlay: () => set({ isAccountOverlayOpen: true }),
        openAuthOverlay: () => set({ isAuthOverlayOpen: true }),
        removeApiKey: (id) => set({ apiKeys: get().apiKeys.filter((k) => k.id !== id) }),
        setApiKeys: (keys) => set({ apiKeys: [...keys] }),
        setAuth: (token, expiresAt, user) => set({ accessToken: token, expiresAt, isLoading: false, user }),
        setLoading: (flag) => set({ isLoading: flag }),
    }),
    {
        immer: false,
        name: AuthStoreTuning.name,
        persist: false,
        temporal: false,
    },
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthStoreTuning as AUTH_STORE_TUNING, useAuthStore };
export type { AuthActions, AuthApiKey, AuthState, AuthUser };
