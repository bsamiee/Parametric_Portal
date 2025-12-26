/**
 * Auth store tests: state transitions, actions, overlay management.
 */
import { it as itProp } from '@fast-check/vitest';
import { database, type ApiKeyListItem, type UserResponse } from '@parametric-portal/types/database';
import { Option, Schema as S } from 'effect';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_STORE_TUNING, type AuthState, useAuthStore } from '../src/stores/auth';

// --- [CONSTANTS] -------------------------------------------------------------

const dbApi = database();
const mkUserId = (uuid: string) => S.decodeSync(dbApi.schemas.ids.UserId)(uuid);
const mkApiKeyId = (uuid: string) => S.decodeSync(dbApi.schemas.ids.ApiKeyId)(uuid);

const B = Object.freeze({
    initial: {
        accessToken: null,
        apiKeys: [],
        expiresAt: null,
        isAccountOverlayOpen: false,
        isAuthOverlayOpen: false,
        isLoading: false,
        user: null,
    } satisfies AuthState,
    samples: {
        apiKeys: [
            {
                createdAt: new Date('2025-01-01'),
                id: mkApiKeyId('01932f5a-b7c1-7def-8a90-000000000001'),
                lastUsedAt: Option.none(),
                name: 'Production',
                provider: 'anthropic',
            },
            {
                createdAt: new Date('2025-01-02'),
                id: mkApiKeyId('01932f5a-b7c1-7def-8a90-000000000002'),
                lastUsedAt: Option.some(new Date('2025-01-10')),
                name: 'Development',
                provider: 'anthropic',
            },
            {
                createdAt: new Date('2025-01-03'),
                id: mkApiKeyId('01932f5a-b7c1-7def-8a90-000000000003'),
                lastUsedAt: Option.none(),
                name: 'Staging',
                provider: 'anthropic',
            },
        ] satisfies ReadonlyArray<ApiKeyListItem>,
        tokens: ['eyJhbGciOiJIUzI1NiJ9.test1', 'eyJhbGciOiJIUzI1NiJ9.test2'] as const,
        users: [
            { email: 'alice@example.com', id: mkUserId('01932f5a-b7c1-7def-8a90-100000000001') },
            { email: 'bob@example.com', id: mkUserId('01932f5a-b7c1-7def-8a90-100000000002') },
        ] satisfies ReadonlyArray<UserResponse>,
    },
    storeName: 'parametric-portal:auth',
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createMockApiKey = (idSuffix: string, name: string): ApiKeyListItem => ({
    createdAt: new Date(),
    id: mkApiKeyId(`01932f5a-b7c1-7def-8a90-${idSuffix.padStart(12, '0')}`),
    lastUsedAt: Option.none(),
    name,
    provider: 'anthropic',
});
const futureDate = (hours = 1) => new Date(Date.now() + hours * 60 * 60 * 1000);

// --- [SETUP] -----------------------------------------------------------------

beforeEach(() => {
    useAuthStore.getState().clearAuth();
});

// --- [DESCRIBE] AUTH_STORE_TUNING --------------------------------------------

describe('AUTH_STORE_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(AUTH_STORE_TUNING)).toBe(true);
        expect(AUTH_STORE_TUNING.name).toBe(B.storeName);
    });
    it('initial state matches expected shape', () => {
        expect(AUTH_STORE_TUNING.initial).toEqual(B.initial);
    });
    it('initial.isLoading is false', () => expect(AUTH_STORE_TUNING.initial.isLoading).toBe(false));
    it('initial.accessToken is null', () => expect(AUTH_STORE_TUNING.initial.accessToken).toBeNull());
    it('initial.apiKeys is empty array', () => expect(AUTH_STORE_TUNING.initial.apiKeys).toEqual([]));
});

// --- [DESCRIBE] initial state ------------------------------------------------

describe('initial state', () => {
    it('starts with null values and closed overlays', () => {
        const state = useAuthStore.getState();
        expect(state.accessToken).toBeNull();
        expect(state.user).toBeNull();
        expect(state.expiresAt).toBeNull();
        expect(state.apiKeys).toEqual([]);
        expect(state.isLoading).toBe(false);
        expect(state.isAuthOverlayOpen).toBe(false);
        expect(state.isAccountOverlayOpen).toBe(false);
    });
});

// --- [DESCRIBE] setAuth action -----------------------------------------------

describe('setAuth', () => {
    it('sets accessToken, expiresAt, and user', () => {
        const token = B.samples.tokens[0];
        const expires = futureDate();
        const user = B.samples.users[0];
        useAuthStore.getState().setAuth(token, expires, user);
        const state = useAuthStore.getState();
        expect(state.accessToken).toBe(token);
        expect(state.expiresAt).toBe(expires);
        expect(state.user).toEqual(user);
    });
    it('sets isLoading to false', () => {
        useAuthStore.getState().setLoading(true);
        expect(useAuthStore.getState().isLoading).toBe(true);
        useAuthStore.getState().setAuth(B.samples.tokens[0], futureDate(), B.samples.users[0]);
        expect(useAuthStore.getState().isLoading).toBe(false);
    });
    itProp.prop([fc.string({ maxLength: 100, minLength: 10 })])('accepts arbitrary token strings', (token) => {
        useAuthStore.getState().setAuth(token, futureDate(), B.samples.users[0]);
        expect(useAuthStore.getState().accessToken).toBe(token);
    });
    it('overwrites previous auth state', () => {
        useAuthStore.getState().setAuth(B.samples.tokens[0], futureDate(), B.samples.users[0]);
        useAuthStore.getState().setAuth(B.samples.tokens[1], futureDate(), B.samples.users[1]);
        expect(useAuthStore.getState().accessToken).toBe(B.samples.tokens[1]);
        expect(useAuthStore.getState().user).toEqual(B.samples.users[1]);
    });
});

// --- [DESCRIBE] clearAuth action ---------------------------------------------

describe('clearAuth', () => {
    it('resets to initial state', () => {
        useAuthStore.getState().setAuth(B.samples.tokens[0], futureDate(), B.samples.users[0]);
        useAuthStore.getState().addApiKey(B.samples.apiKeys[0]);
        useAuthStore.getState().openAuthOverlay();
        useAuthStore.getState().clearAuth();
        const state = useAuthStore.getState();
        expect(state.accessToken).toBeNull();
        expect(state.user).toBeNull();
        expect(state.expiresAt).toBeNull();
        expect(state.apiKeys).toEqual([]);
        expect(state.isAuthOverlayOpen).toBe(false);
        expect(state.isAccountOverlayOpen).toBe(false);
    });
    it('clears loading state', () => {
        useAuthStore.getState().setLoading(true);
        useAuthStore.getState().clearAuth();
        expect(useAuthStore.getState().isLoading).toBe(false);
    });
});

// --- [DESCRIBE] setLoading action --------------------------------------------

describe('setLoading', () => {
    it('sets isLoading to true', () => {
        useAuthStore.getState().setLoading(true);
        expect(useAuthStore.getState().isLoading).toBe(true);
    });
    it('sets isLoading to false', () => {
        useAuthStore.getState().setLoading(true);
        useAuthStore.getState().setLoading(false);
        expect(useAuthStore.getState().isLoading).toBe(false);
    });
    itProp.prop([fc.boolean()])('toggles isLoading correctly', (flag) => {
        useAuthStore.getState().setLoading(flag);
        expect(useAuthStore.getState().isLoading).toBe(flag);
    });
});

// --- [DESCRIBE] API key management -------------------------------------------

describe('addApiKey', () => {
    it('adds single API key', () => {
        const key = B.samples.apiKeys[0];
        useAuthStore.getState().addApiKey(key);
        expect(useAuthStore.getState().apiKeys).toHaveLength(1);
        expect(useAuthStore.getState().apiKeys[0]).toEqual(key);
    });
    it('appends to existing keys', () => {
        useAuthStore.getState().addApiKey(B.samples.apiKeys[0]);
        useAuthStore.getState().addApiKey(B.samples.apiKeys[1]);
        expect(useAuthStore.getState().apiKeys).toHaveLength(2);
    });
    it('preserves key order', () => {
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().addApiKey(key);
        });
        const ids = useAuthStore.getState().apiKeys.map((k) => k.id);
        expect(ids).toEqual(B.samples.apiKeys.map((k) => k.id));
    });
    itProp.prop([fc.integer({ max: 10, min: 1 })])('handles arbitrary number of keys', (count) => {
        useAuthStore.getState().clearAuth();
        Array.from({ length: count }, (_, i) => {
            useAuthStore.getState().addApiKey(createMockApiKey(String(i), `Key ${i}`));
        });
        expect(useAuthStore.getState().apiKeys).toHaveLength(count);
    });
});

describe('removeApiKey', () => {
    it('removes API key by id', () => {
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().addApiKey(key);
        });
        useAuthStore.getState().removeApiKey(B.samples.apiKeys[1].id);
        const ids = useAuthStore.getState().apiKeys.map((k) => k.id);
        expect(ids).toEqual([B.samples.apiKeys[0].id, B.samples.apiKeys[2].id]);
    });
    it('does nothing for non-existent id', () => {
        useAuthStore.getState().addApiKey(B.samples.apiKeys[0]);
        useAuthStore.getState().removeApiKey('non-existent');
        expect(useAuthStore.getState().apiKeys).toHaveLength(1);
    });
    it('removes all keys when called for each', () => {
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().addApiKey(key);
        });
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().removeApiKey(key.id);
        });
        expect(useAuthStore.getState().apiKeys).toEqual([]);
    });
    it('preserves other keys', () => {
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().addApiKey(key);
        });
        useAuthStore.getState().removeApiKey(B.samples.apiKeys[0].id);
        expect(useAuthStore.getState().apiKeys.map((k) => k.id)).toEqual([B.samples.apiKeys[1].id, B.samples.apiKeys[2].id]);
    });
});

describe('setApiKeys', () => {
    it('replaces all API keys', () => {
        useAuthStore.getState().addApiKey(B.samples.apiKeys[0]);
        useAuthStore.getState().setApiKeys([B.samples.apiKeys[1], B.samples.apiKeys[2]]);
        expect(useAuthStore.getState().apiKeys).toHaveLength(2);
        expect(useAuthStore.getState().apiKeys.map((k) => k.id)).toEqual([B.samples.apiKeys[1].id, B.samples.apiKeys[2].id]);
    });
    it('clears keys with empty array', () => {
        B.samples.apiKeys.forEach((key) => {
            useAuthStore.getState().addApiKey(key);
        });
        useAuthStore.getState().setApiKeys([]);
        expect(useAuthStore.getState().apiKeys).toEqual([]);
    });
    it('creates new array reference', () => {
        const keys = [B.samples.apiKeys[0]];
        useAuthStore.getState().setApiKeys(keys);
        expect(useAuthStore.getState().apiKeys).not.toBe(keys);
        expect(useAuthStore.getState().apiKeys).toEqual(keys);
    });
});

// --- [DESCRIBE] overlay management -------------------------------------------

describe('overlay management', () => {
    it('toggles auth overlay', () => {
        expect(useAuthStore.getState().isAuthOverlayOpen).toBe(false);
        useAuthStore.getState().openAuthOverlay();
        expect(useAuthStore.getState().isAuthOverlayOpen).toBe(true);
        useAuthStore.getState().closeAuthOverlay();
        expect(useAuthStore.getState().isAuthOverlayOpen).toBe(false);
    });
    it('toggles account overlay', () => {
        expect(useAuthStore.getState().isAccountOverlayOpen).toBe(false);
        useAuthStore.getState().openAccountOverlay();
        expect(useAuthStore.getState().isAccountOverlayOpen).toBe(true);
        useAuthStore.getState().closeAccountOverlay();
        expect(useAuthStore.getState().isAccountOverlayOpen).toBe(false);
    });
    it('overlays are independent', () => {
        useAuthStore.getState().openAuthOverlay();
        useAuthStore.getState().openAccountOverlay();
        expect(useAuthStore.getState().isAuthOverlayOpen).toBe(true);
        expect(useAuthStore.getState().isAccountOverlayOpen).toBe(true);
        useAuthStore.getState().closeAuthOverlay();
        expect(useAuthStore.getState().isAuthOverlayOpen).toBe(false);
        expect(useAuthStore.getState().isAccountOverlayOpen).toBe(true);
    });
});

// --- [DESCRIBE] store integration --------------------------------------------

describe('store integration', () => {
    it('exposes use selectors', () => {
        expect(typeof useAuthStore.use.accessToken).toBe('function');
        expect(typeof useAuthStore.use.user).toBe('function');
        expect(typeof useAuthStore.use.apiKeys).toBe('function');
        expect(typeof useAuthStore.use.isLoading).toBe('function');
    });
    it('getState returns current state', () => {
        const state = useAuthStore.getState();
        expect(state).toHaveProperty('accessToken');
        expect(state).toHaveProperty('user');
        expect(state).toHaveProperty('apiKeys');
        expect(state).toHaveProperty('setAuth');
        expect(state).toHaveProperty('clearAuth');
    });
});

// --- [DESCRIBE] edge cases ---------------------------------------------------

describe('edge cases', () => {
    it('handles rapid state updates', () => {
        Array.from({ length: 100 }, (_, i) => useAuthStore.getState().setLoading(i % 2 === 0));
        expect(useAuthStore.getState().isLoading).toBe(false);
    });
    it('handles auth then immediate clear', () => {
        useAuthStore.getState().setAuth(B.samples.tokens[0], futureDate(), B.samples.users[0]);
        useAuthStore.getState().clearAuth();
        expect(useAuthStore.getState().accessToken).toBeNull();
    });
    it('handles expired date', () => {
        const pastDate = new Date(Date.now() - 1000);
        useAuthStore.getState().setAuth(B.samples.tokens[0], pastDate, B.samples.users[0]);
        expect(useAuthStore.getState().expiresAt).toBe(pastDate);
    });
});
