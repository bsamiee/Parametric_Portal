/**
 * Shared authentication store for cross-app auth state. Tokens stored in HttpOnly cookies; state via Zustand with devtools.
 */
import type { ApiKeyListItem, UserResponse } from '@parametric-portal/types/database';
import { createStore } from '../store/factory';

// --- [TYPES] -----------------------------------------------------------------

type AuthState = {
    readonly accessToken: string | null;
    readonly apiKeys: ReadonlyArray<ApiKeyListItem>;
    readonly expiresAt: Date | null;
    readonly isAccountOverlayOpen: boolean;
    readonly isAuthOverlayOpen: boolean;
    readonly isLoading: boolean;
    readonly user: UserResponse | null;
};

type AuthActions = {
    readonly addApiKey: (key: ApiKeyListItem) => void;
    readonly clearAuth: () => void;
    readonly closeAccountOverlay: () => void;
    readonly closeAuthOverlay: () => void;
    readonly openAccountOverlay: () => void;
    readonly openAuthOverlay: () => void;
    readonly removeApiKey: (id: string) => void;
    readonly setApiKeys: (keys: ReadonlyArray<ApiKeyListItem>) => void;
    readonly setAuth: (token: string, expiresAt: Date, user: UserResponse) => void;
    readonly setLoading: (flag: boolean) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    initial: {
        accessToken: null,
        apiKeys: [] as ReadonlyArray<ApiKeyListItem>,
        expiresAt: null,
        isAccountOverlayOpen: false,
        isAuthOverlayOpen: false,
        isLoading: false,
        user: null,
    } satisfies AuthState,
    name: 'parametric-portal:auth',
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useAuthStore = createStore<AuthState & AuthActions>(
    (set, get) => ({
        ...B.initial,
        addApiKey: (key) => set({ apiKeys: [...get().apiKeys, key] }),
        clearAuth: () => set(B.initial),
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
        name: B.name,
        persist: false,
        temporal: false,
    },
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as AUTH_STORE_TUNING, useAuthStore };
export type { AuthActions, AuthState };
