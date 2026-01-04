/**
 * Augment Vite environment with build-time values.
 * Centralized type definitions eliminate per-app vite-env.d.ts duplication.
 */

/// <reference types="vite/client" />

// --- [TYPES] -----------------------------------------------------------------

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

// --- [EXPORT] ----------------------------------------------------------------

export {};
