import { Schema as S } from '@effect/schema';
import typescript from '@rollup/plugin-typescript';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import browserslist from 'browserslist';
import { Effect, Option, pipe } from 'effect';
import { visualizer } from 'rollup-plugin-visualizer';
import type { PluginOption, UserConfig, ViteBuilder } from 'vite';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';
import csp from 'vite-plugin-csp';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import Inspect from 'vite-plugin-inspect';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';
import webfontDownload from 'vite-plugin-webfont-dl';
import tsconfigPaths from 'vite-tsconfig-paths';

// --- Type Definitions --------------------------------------------------------

type ConfigInput = S.Schema.Type<typeof ConfigInputSchema>;
type Browsers = { readonly [K in 'chrome' | 'edge' | 'firefox' | 'safari']: number };

// --- Schema Definitions ------------------------------------------------------

const BaseSchema = S.Struct({
    assetExts: S.optional(S.Array(S.String)),
    compressionThreshold: S.optional(pipe(S.Number, S.int(), S.positive())),
    cspPolicy: S.optional(S.Record({ key: S.String, value: S.Array(S.String) })),
    external: S.optional(S.Array(S.String)),
    imageQuality: S.optional(S.Struct({ avif: S.Number, jpeg: S.Number, png: S.Number, webp: S.Number })),
    name: S.String,
    port: S.optional(pipe(S.Number, S.int(), S.between(1024, 65535))),
    pwa: S.optional(S.Struct({ description: S.String, name: S.String, shortName: S.String, themeColor: S.String })),
    webfonts: S.optional(S.Array(S.String)),
});
const ConfigInputSchema = S.Union(
    pipe(BaseSchema, S.extend(S.Struct({ entry: S.optional(S.String), mode: S.Literal('app') }))),
    pipe(
        BaseSchema,
        S.extend(
            S.Struct({
                entry: S.Union(S.String, S.Record({ key: S.String, value: S.String })),
                mode: S.Literal('library'),
            }),
        ),
    ),
);

// --- Constants (Algorithmic Base) --------------------------------------------

const B = Object.freeze({
    assets: ['bin', 'exr', 'fbx', 'glb', 'gltf', 'hdr', 'mtl', 'obj', 'wasm'],
    browsers: { chrome: 107, edge: 107, firefox: 104, safari: 16 },
    cache: { api: 300, cdn: 604800, max: 50 },
    chunks: [
        { n: 'vendor-react', p: 'react(?:-dom)?', w: 3 },
        { n: 'vendor-effect', p: '@effect', w: 2 },
        { n: 'vendor', p: 'node_modules', w: 1 },
    ],
    comp: { f: /\.(js|mjs|json|css|html|svg)$/i, t: 10240 },
    csp: {
        'default-src': ["'self'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'https:'],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
    },
    img: { avif: 70, jpeg: 75, png: 80, webp: 80 },
    port: 3000,
    pwa: {
        bg: '#ffffff',
        desc: 'Next-gen parametric design platform',
        name: 'Parametric Portal',
        short: 'Portal',
        theme: '#000000',
    },
    ssr: {
        ext: ['react', 'react-dom', 'react/jsx-runtime'],
        noExt: ['@effect/platform', '@effect/platform-browser', '@effect/experimental', '@effect/schema'],
    },
} as const);

// --- Pure Utility Functions --------------------------------------------------

const parseBrowsers = (queries: ReadonlyArray<string>): Browsers => {
    const result = { ...B.browsers } as Record<keyof Browsers, number>;
    for (const q of queries) {
        const m = q.match(/^(chrome|edge|firefox|safari)\s+(\d+)/);
        if (m) {
            result[m[1] as keyof Browsers] = Math.max(result[m[1] as keyof Browsers], Number(m[2]));
        }
    }
    return result as Browsers;
};
const getBrowsers = (): Browsers =>
    pipe(
        Option.fromNullable(browserslist.loadConfig({ path: '.' })),
        Option.map((c) => parseBrowsers(browserslist(c))),
        Option.getOrElse(() => B.browsers),
    );

const toGlob = (e: ReadonlyArray<string>) => e.map((x) => `**/*.${x}`);
const chunk = (id: string) =>
    id.includes('node_modules')
        ? pipe(
              [...B.chunks].sort((a, b) => b.w - a.w).find(({ p }) => new RegExp(p).test(id)),
              Option.fromNullable,
              Option.map(({ n }) => n),
              Option.getOrUndefined,
          )
        : undefined;
const css = (b: Browsers) => ({
    lightningcss: { drafts: { customMedia: true }, nonStandard: { deepSelectorCombinator: true }, targets: b },
    transformer: 'lightningcss' as const,
});
const esbuild = (app: boolean) => ({
    format: 'esm' as const,
    keepNames: true,
    minifyIdentifiers: app,
    minifySyntax: true,
    minifyWhitespace: true,
    target: 'esnext' as const,
    treeShaking: true,
});
const comp = (t: number, a: 'brotliCompress' | 'gzip', e: string) => ({
    algorithm: a,
    deleteOriginFile: false,
    ext: e,
    filter: B.comp.f,
    threshold: t,
    verbose: true,
});
const img = (q: typeof B.img) => ({
    avif: { lossless: false, quality: q.avif, speed: 5 },
    exclude: [/^virtual:/, /node_modules/],
    includePublic: true,
    jpeg: { progressive: true, quality: q.jpeg },
    logStats: true,
    png: { quality: q.png },
    test: /\.(jpe?g|png|gif|tiff|webp|svg|avif)$/i,
    webp: { lossless: false, quality: q.webp },
});

const pwa = (c: NonNullable<ConfigInput['pwa']>) => ({
    backgroundColor: B.pwa.bg,
    description: c.description,
    display: 'standalone' as const,
    icons: [192, 512]
        .map((s) => ({ purpose: 'any' as const, sizes: `${s}x${s}`, src: `/icon-${s}.png`, type: 'image/png' }))
        .concat([{ purpose: 'maskable' as const, sizes: '512x512', src: '/icon-maskable.png', type: 'image/png' }]),
    name: c.name,
    scope: '/',
    shortName: c.shortName,
    startUrl: '/',
    themeColor: c.themeColor,
});
const workbox = () => ({
    clientsClaim: true,
    globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,glb,gltf}'],
    runtimeCaching: [
        {
            handler: 'CacheFirst' as const,
            options: { cacheName: 'cdn-cache', expiration: { maxAgeSeconds: B.cache.cdn, maxEntries: B.cache.max } },
            urlPattern: /^https:\/\/cdn\./,
        },
        {
            handler: 'NetworkFirst' as const,
            options: { cacheName: 'api-cache', expiration: { maxAgeSeconds: B.cache.api, maxEntries: B.cache.max } },
            urlPattern: /^https:\/\/api\./,
        },
    ],
    skipWaiting: true,
});

// --- Effect Pipelines & Builders ---------------------------------------------

const libPlugins = () => [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    Inspect({ build: true, dev: true, outputDir: '.vite-inspect' }),
];
const appPlugins = (i: ConfigInput & { mode: 'app' }, prod: boolean) => [
    tsconfigPaths({ root: './' }),
    react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
    tailwindcss({ optimize: { minify: true } }),
    ...(i.pwa
        ? [
              VitePWA({
                  devOptions: { enabled: false },
                  includeAssets: toGlob(i.assetExts ?? B.assets),
                  manifest: pwa(i.pwa),
                  registerType: 'autoUpdate',
                  workbox: workbox(),
              }),
          ]
        : []),
    svgr({
        exclude: '',
        include: '**/*.svg?react',
        svgrOptions: { exportType: 'default', memo: true, ref: true, svgo: true, titleProp: true, typescript: true },
    }),
    ViteImageOptimizer(img(i.imageQuality ?? B.img) as Parameters<typeof ViteImageOptimizer>[0]),
    webfontDownload(i.webfonts ?? []),
    ...(prod
        ? [
              viteCompression(comp(i.compressionThreshold ?? B.comp.t, 'brotliCompress', '.br')),
              viteCompression(comp(i.compressionThreshold ?? B.comp.t, 'gzip', '.gz')),
          ]
        : []),
    csp({
        algorithm: 'sha256',
        hashEnabled: { 'script-src': true, 'style-src': true },
        policy: i.cspPolicy ?? B.csp,
    } as Parameters<typeof csp>[0]),
    {
        buildApp: async (b: ViteBuilder) =>
            void (await Promise.all(Object.values(b.environments).map((e) => b.build(e)))),
        buildEnd: () => void 0,
        buildStart: () => void 0,
        enforce: 'pre' as const,
        name: 'parametric-build-hooks',
    },
    Inspect({ build: true, dev: true, outputDir: '.vite-inspect' }),
];

const libCfg = (i: ConfigInput & { mode: 'library' }, b: Browsers): UserConfig => ({
    build: {
        lib: {
            entry: i.entry,
            fileName: (f: string, n: string) => (f === 'es' ? `${n}.js` : `${n}.${f}.js`),
            formats: ['es', 'cjs'],
            name: i.name,
        },
        rollupOptions: {
            external: i.external ?? [],
            output: { exports: 'named', preserveModules: false },
            plugins: [typescript({ declaration: true, declarationDir: 'dist' })],
        },
        sourcemap: true,
        target: 'esnext',
    },
    css: css(b),
    esbuild: esbuild(false),
    plugins: libPlugins(),
    resolve: { alias: { '@': '/packages' }, conditions: ['import', 'module', 'default'] },
});

const appCfg = (
    i: ConfigInput & { mode: 'app' },
    b: Browsers,
    prod: boolean,
    ver: string,
    time: string,
): UserConfig => ({
    appType: 'spa',
    assetsInclude: toGlob(i.assetExts ?? B.assets),
    build: {
        cssCodeSplit: true,
        cssMinify: 'lightningcss',
        emptyOutDir: true,
        manifest: true,
        minify: 'esbuild',
        modulePreload: { polyfill: true },
        outDir: 'dist',
        reportCompressedSize: false,
        rollupOptions: {
            output: {
                assetFileNames: 'assets/[name]-[hash][extname]',
                chunkFileNames: 'chunks/[name]-[hash].js',
                entryFileNames: 'entries/[name]-[hash].js',
                manualChunks: chunk,
            },
            plugins: [
                visualizer({
                    brotliSize: true,
                    emitFile: true,
                    exclude: [/node_modules\/react-compiler-runtime/],
                    filename: '.vite/stats.html',
                    gzipSize: true,
                    open: false,
                    projectRoot: process.cwd(),
                    sourcemap: true,
                    template: 'treemap',
                }) as PluginOption,
            ],
            treeshake: {
                moduleSideEffects: 'no-external',
                propertyReadSideEffects: false,
                tryCatchDeoptimization: false,
            },
        },
        sourcemap: true,
        ssrManifest: true,
        target: 'esnext',
    },
    cacheDir: '.nx/cache/vite',
    css: { ...css(b), devSourcemap: true },
    define: {
        'import.meta.env.APP_VERSION': JSON.stringify(ver),
        'import.meta.env.BUILD_MODE': JSON.stringify(prod ? 'production' : 'development'),
        'import.meta.env.BUILD_TIME': JSON.stringify(time),
    },
    esbuild: {
        ...esbuild(true),
        drop: prod ? ['console', 'debugger'] : [],
        jsx: 'automatic',
        legalComments: 'none',
        logLevel: 'error',
        pure: ['console.log', 'console.debug'],
        supported: { 'dynamic-import': true, 'import-meta': true },
    },
    json: { namedExports: true, stringify: 'auto' },
    optimizeDeps: {
        esbuildOptions: { supported: { 'top-level-await': true }, target: 'esnext' },
        exclude: B.ssr.noExt,
        holdUntilCrawlEnd: true,
        include: B.ssr.ext,
    },
    plugins: appPlugins(i, prod),
    resolve: {
        alias: { '@': '/packages' },
        conditions: ['import', 'module', 'browser', 'default'],
        dedupe: ['react', 'react-dom'],
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    },
    server: {
        cors: true,
        hmr: { overlay: true },
        port: i.port ?? B.port,
        strictPort: false,
        warmup: { clientFiles: ['./apps/*/src/main.tsx', './apps/*/src/**/*.tsx', './packages/*/src/index.ts'] },
    },
    ssr: {
        external: B.ssr.ext,
        noExternal: B.ssr.noExt,
        optimizeDeps: { include: ['@effect/platform'] },
        resolve: { conditions: ['node', 'import', 'module', 'default'], externalConditions: ['node'] },
        target: 'node',
    },
    worker: {
        format: 'es',
        plugins: () => [
            tsconfigPaths({ root: './' }),
            react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
        ],
        rollupOptions: {
            output: {
                assetFileNames: 'workers/assets/[name]-[hash][extname]',
                chunkFileNames: 'workers/chunks/[name]-[hash].js',
                entryFileNames: 'workers/[name]-[hash].js',
            },
        },
    },
});

const createConfig = (input: ConfigInput): Effect.Effect<UserConfig, never, never> =>
    pipe(
        Effect.all({
            b: Effect.sync(getBrowsers),
            p: Effect.sync(() => process.env.NODE_ENV === 'production'),
            t: Effect.sync(() => new Date().toISOString()),
            v: Effect.sync(() => process.env.npm_package_version ?? '0.0.0'),
        }),
        Effect.map(({ b, p, t, v }) => (input.mode === 'library' ? libCfg(input, b) : appCfg(input, b, p, v, t))),
    );

// --- Export ------------------------------------------------------------------

export { createConfig };
export default defineConfig(
    Effect.runSync(
        createConfig({
            mode: 'app',
            name: 'ParametricPortal',
            pwa: { description: B.pwa.desc, name: B.pwa.name, shortName: B.pwa.short, themeColor: B.pwa.theme },
        }),
    ),
);
