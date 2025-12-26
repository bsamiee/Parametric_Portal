/**
 * Universal Vite environment type augmentation.
 * All apps reference via tsconfig types field — eliminates per-app vite-env.d.ts files.
 * Values injected at build time via vite.factory.ts define block.
 */

/// <reference types="vite/client" />

declare global {
    interface ImportMetaEnv {
        readonly APP_VERSION: string;
        readonly BUILD_MODE: 'development' | 'production';
        readonly BUILD_TIME: string;
        readonly VITE_API_URL: string;
    }
    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

export {};
