/// <reference types="vite/client" />

interface ImportMetaEnv {
    // biome-ignore lint/style/useNamingConvention: Vite requires SCREAMING_SNAKE_CASE for env vars
    readonly VITE_ANTHROPIC_API_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
