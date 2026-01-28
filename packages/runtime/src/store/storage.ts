/**
 * Storage adapters for Zustand persist with multi-backend support.
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

const B = {
    cookie: {
        expires: 365,
        path: '/',
        sameSite: 'Lax' as const,
        secure: true,
    },
} as const;

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

// --- [ENTRY_POINT] -----------------------------------------------------------

const createStorage = (type: StorageType = 'localStorage'): ReturnType<typeof createJSONStorage> =>
    createJSONStorage(
        () =>
            ({
                cookies: { getItem: getCookie, removeItem: removeCookie, setItem: setCookie },
                indexedDB: {
                    getItem: async (name: string) => (await get(name)) ?? null,
                    removeItem: del,
                    setItem: set,
                },
                localStorage: {
                    getItem: (n: string) => localStorage.getItem(n),
                    removeItem: (n: string) => localStorage.removeItem(n),
                    setItem: (n: string, v: string) => localStorage.setItem(n, v),
                },
                sessionStorage: {
                    getItem: (n: string) => sessionStorage.getItem(n),
                    removeItem: (n: string) => sessionStorage.removeItem(n),
                    setItem: (n: string, v: string) => sessionStorage.setItem(n, v),
                },
            })[type] as StateStorage,
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B as STORAGE_TUNING, createStorage };
export type { CookieOptions, StorageAdapter, StorageType };
