/**
 * Provide storage adapters for Zustand persist middleware.
 * Supports cookies, localStorage, sessionStorage, and indexedDB backends.
 */

import { del, get, set } from 'idb-keyval';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

// --- [TYPES] -----------------------------------------------------------------

type StorageType = 'cookies' | 'indexedDB' | 'localStorage' | 'sessionStorage';
type StorageAdapter = {
    readonly getItem: (name: string) => Promise<string | null> | string | null;
    readonly removeItem: (name: string) => Promise<void> | void;
    readonly setItem: (name: string, value: string) => Promise<void> | void;
};
type CookieOptions = {
    readonly expires?: number;
    readonly path?: string;
    readonly sameSite?: 'Lax' | 'None' | 'Strict';
    readonly secure?: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cookie: {
        expires: 365,
        path: '/',
        sameSite: 'Lax' as const,
        secure: true,
    },
    defaults: {
        storage: 'localStorage' as StorageType,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getCookie = (name: string): string | null => {
    const match = new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`).exec(document.cookie);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
};
const setCookie = (name: string, value: string, opts: CookieOptions = {}): void => {
    const exp = new Date();
    exp.setDate(exp.getDate() + (opts.expires ?? B.cookie.expires));
    // biome-ignore lint/suspicious/noDocumentCookie: Standard DOM API required for cookie storage adapter
    document.cookie = [
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        `expires=${exp.toUTCString()}`,
        `path=${opts.path ?? B.cookie.path}`,
        `SameSite=${opts.sameSite ?? B.cookie.sameSite}`,
        (opts.secure ?? B.cookie.secure) ? 'Secure' : '',
    ]
        .filter(Boolean)
        .join('; ');
};
const removeCookie = (name: string): void => {
    // biome-ignore lint/suspicious/noDocumentCookie: Standard DOM API required for cookie storage adapter
    document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${B.cookie.path}`;
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const storageBackends: Record<StorageType, StorageAdapter> = Object.freeze({
    cookies: { getItem: getCookie, removeItem: removeCookie, setItem: setCookie },
    indexedDB: {
        getItem: async (name) => (await get(name)) ?? null,
        removeItem: del,
        setItem: set,
    },
    localStorage: {
        getItem: (n) => localStorage.getItem(n),
        removeItem: (n) => localStorage.removeItem(n),
        setItem: (n, v) => localStorage.setItem(n, v),
    },
    sessionStorage: {
        getItem: (n) => sessionStorage.getItem(n),
        removeItem: (n) => sessionStorage.removeItem(n),
        setItem: (n, v) => sessionStorage.setItem(n, v),
    },
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStorage = (type: StorageType = B.defaults.storage): ReturnType<typeof createJSONStorage> =>
    createJSONStorage(() => storageBackends[type] as StateStorage);

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORAGE_TUNING, createStorage, storageBackends };
export type { CookieOptions, StorageAdapter, StorageType };
