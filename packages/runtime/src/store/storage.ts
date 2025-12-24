/**
 * Storage adapters (cookies|localStorage|sessionStorage|indexedDB) for Zustand persist middleware.
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

const encodeCookie = (value: string): string => encodeURIComponent(value);
const decodeCookie = (value: string): string => decodeURIComponent(value);
const getCookie = (name: string): string | null => {
    const encoded = encodeCookie(name);
    const regex = new RegExp(`(?:^|; )${encoded}=([^;]*)`);
    const match = regex.exec(document.cookie);
    return match?.[1] ? decodeCookie(match[1]) : null;
};
const setCookie = (name: string, value: string, options: CookieOptions = {}): void => {
    const expires = new Date();
    expires.setDate(expires.getDate() + (options.expires ?? B.cookie.expires));
    const parts = [
        `${encodeCookie(name)}=${encodeCookie(value)}`,
        `expires=${expires.toUTCString()}`,
        `path=${options.path ?? B.cookie.path}`,
        `SameSite=${options.sameSite ?? B.cookie.sameSite}`,
        (options.secure ?? B.cookie.secure) ? 'Secure' : '',
    ].filter(Boolean);
    // biome-ignore lint/suspicious/noDocumentCookie: Standard DOM API required for cookie storage adapter
    document.cookie = parts.join('; ');
};
const removeCookie = (name: string): void => {
    // biome-ignore lint/suspicious/noDocumentCookie: Standard DOM API required for cookie storage adapter
    document.cookie = `${encodeCookie(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${B.cookie.path}`;
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const storageBackends: Record<StorageType, StorageAdapter> = Object.freeze({
    cookies: {
        getItem: (name) => getCookie(name),
        removeItem: (name) => removeCookie(name),
        setItem: (name, value) => setCookie(name, value),
    },
    indexedDB: {
        getItem: async (name) => (await get(name)) ?? null,
        removeItem: async (name) => del(name),
        setItem: async (name, value) => set(name, value),
    },
    localStorage: {
        getItem: (name) => localStorage.getItem(name),
        removeItem: (name) => localStorage.removeItem(name),
        setItem: (name, value) => localStorage.setItem(name, value),
    },
    sessionStorage: {
        getItem: (name) => sessionStorage.getItem(name),
        removeItem: (name) => sessionStorage.removeItem(name),
        setItem: (name, value) => sessionStorage.setItem(name, value),
    },
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStorageAdapter = (type: StorageType): ReturnType<typeof createJSONStorage> =>
    createJSONStorage(() => storageBackends[type] as StateStorage);
const createStorage = (type: StorageType = B.defaults.storage) => createStorageAdapter(type);

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORAGE_TUNING, createStorage, storageBackends };
export type { CookieOptions, StorageAdapter, StorageType };
