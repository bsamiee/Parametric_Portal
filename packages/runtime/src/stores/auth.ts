/**
 * Cross-app authentication state with HttpOnly cookie token persistence.
 */
import type { AiProvider, ApiKeyId, Role, UserId } from '@parametric-portal/types/schema';
import { createStore } from '../store/factory';

// --- [TYPES] -----------------------------------------------------------------

type ApiKeyResponseType = {
    readonly createdAt: Date;
    readonly id: ApiKeyId;
    readonly name: string;
    readonly provider: AiProvider;
};
type UserResponseType = {
    readonly createdAt: Date;
    readonly email: string;
    readonly id: UserId;
    readonly role: Role;
};
type AuthState = {
    readonly accessToken: string | null;
    readonly apiKeys: ReadonlyArray<ApiKeyResponseType>;
    readonly expiresAt: Date | null;
    readonly isAccountOverlayOpen: boolean;
    readonly isAuthOverlayOpen: boolean;
    readonly isLoading: boolean;
    readonly user: UserResponseType | null;
};
type AuthActions = {
    readonly addApiKey: (key: ApiKeyResponseType) => void;
    readonly clearAuth: () => void;
    readonly closeAccountOverlay: () => void;
    readonly closeAuthOverlay: () => void;
    readonly openAccountOverlay: () => void;
    readonly openAuthOverlay: () => void;
    readonly removeApiKey: (id: string) => void;
    readonly setApiKeys: (keys: ReadonlyArray<ApiKeyResponseType>) => void;
    readonly setAuth: (token: string, expiresAt: Date, user: UserResponseType) => void;
    readonly setLoading: (flag: boolean) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    initial: {
        accessToken: null,
        apiKeys: [] as ReadonlyArray<ApiKeyResponseType>,
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
