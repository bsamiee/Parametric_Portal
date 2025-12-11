/// <reference types="vite/client" />
/**
 * Root Vite configuration: orchestrate plugins, compression, PWA, CSP via Effect pipeline.
 * Uses B constant, CfgSchema, createConfig factory for app/library mode dispatch.
 */
import { Schema as S } from '@effect/schema';
import typescript from '@rollup/plugin-typescript';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import browserslist from 'browserslist';
import { Effect, Option, pipe } from 'effect';
import { visualizer } from 'rollup-plugin-visualizer';
import type { UserConfig, ViteBuilder } from 'vite';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';
import csp from 'vite-plugin-csp';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import Inspect from 'vite-plugin-inspect';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';
import webfontDownload from 'vite-plugin-webfont-dl';
import tsconfigPaths from 'vite-tsconfig-paths';

// --- [TYPES] -----------------------------------------------------------------

type Cfg = S.Schema.Type<typeof CfgSchema>;
type Mode = Cfg['mode'];
type Browsers = { readonly [K in 'chrome' | 'edge' | 'firefox' | 'safari']: number };

// --- [SCHEMA] ----------------------------------------------------------------

const CfgSchema = S.Union(
    S.Struct({
        assetExts: S.optional(S.Array(S.String)),
        compressionThreshold: S.optional(pipe(S.Number, S.int(), S.positive())),
        cspPolicy: S.optional(S.Record({ key: S.String, value: S.Array(S.String) })),
        entry: S.optional(S.String),
        imageQuality: S.optional(S.Struct({ avif: S.Number, jpeg: S.Number, png: S.Number, webp: S.Number })),
        mode: S.Literal('app'),
        name: S.String,
        port: S.optional(pipe(S.Number, S.int(), S.between(1024, 65535))),
        pwa: S.optional(S.Struct({ description: S.String, name: S.String, shortName: S.String, themeColor: S.String })),
        webfonts: S.optional(S.Array(S.String)),
    }),
    S.Struct({
        entry: S.Union(S.String, S.Record({ key: S.String, value: S.String })),
        external: S.optional(S.Array(S.String)),
        mode: S.Literal('library'),
        name: S.String,
    }),
);

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    assets: ['bin', 'exr', 'fbx', 'glb', 'gltf', 'hdr', 'mtl', 'obj', 'wasm'],
    browsers: { chrome: 107, edge: 107, firefox: 104, safari: 16 } as Browsers,
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
    exts: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    glob: '**/*.{js,css,html,ico,png,svg,wasm,glb,gltf}',
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
    svgr: { exportType: 'default', memo: true, ref: true, svgo: true, titleProp: true, typescript: true },
    treeshake: {
        moduleSideEffects: 'no-external' as const,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
    },
    viz: {
        brotliSize: true,
        emitFile: true,
        exclude: [{ file: '**/node_modules/react-compiler-runtime/**' }],
        filename: '.vite/stats.html',
        gzipSize: true,
        open: false,
        sourcemap: true,
        template: 'treemap' as const,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const browsers = (): Browsers =>
    pipe(
        Option.fromNullable(browserslist.loadConfig({ path: '.' })),
        Option.map(
            (c) =>
                Object.fromEntries(
                    (Object.keys(B.browsers) as ReadonlyArray<keyof Browsers>).map((k) => [
                        k,
                        Math.max(
                            B.browsers[k],
                            ...browserslist(c)
                                .map((q) => q.match(new RegExp(`^${k}\\s+(\\d+)`))?.[1])
                                .filter((v): v is string => v !== undefined)
                                .map(Number),
                        ),
                    ]),
                ) as Browsers,
        ),
        Option.getOrElse(() => B.browsers),
    );

const chunk = (id: string) =>
    id.includes('node_modules')
        ? pipe(
              [...B.chunks].sort((a, b) => b.w - a.w).find(({ p }) => new RegExp(p).test(id)),
              Option.fromNullable,
              Option.map(({ n }) => n),
              Option.getOrUndefined,
          )
        : undefined;

const css = (b: Browsers, dev = false) => ({
    devSourcemap: dev,
    lightningcss: { drafts: { customMedia: true }, nonStandard: { deepSelectorCombinator: true }, targets: b },
    transformer: 'lightningcss' as const,
});

const esbuild = (app: boolean, prod = false) => ({
    ...(app
        ? {
              drop: (prod ? ['console', 'debugger'] : []) as ('console' | 'debugger')[],
              jsx: 'automatic' as const,
              legalComments: 'none' as const,
              logLevel: 'error' as const,
              pure: ['console.log', 'console.debug'],
              supported: { 'dynamic-import': true, 'import-meta': true },
          }
        : {}),
    format: 'esm' as const,
    keepNames: true,
    minifyIdentifiers: app,
    minifySyntax: true,
    minifyWhitespace: true,
    target: 'esnext' as const,
    treeShaking: true,
});

const toPolicy = (p: Record<string, ReadonlyArray<string>> | undefined) =>
    Object.fromEntries(Object.entries(p ?? B.csp).map(([k, v]) => [k, [...v]]));

const compress = (alg: 'brotliCompress' | 'gzip', ext: string, t: number) =>
    viteCompression({ algorithm: alg, deleteOriginFile: false, ext, filter: B.comp.f, threshold: t, verbose: true });

const cache = <H extends 'CacheFirst' | 'NetworkFirst'>(h: H, n: string, s: number, u: RegExp) => ({
    handler: h,
    options: { cacheName: n, expiration: { maxAgeSeconds: s, maxEntries: B.cache.max } },
    urlPattern: u,
});

const output = (p = '') => ({
    assetFileNames: `${p}assets/[name]-[hash][extname]`,
    chunkFileNames: `${p}chunks/[name]-[hash].js`,
    entryFileNames: `${p}${p ? '' : 'entries/'}[name]-[hash].js`,
});
const icons = () => [
    ...[192, 512].map((s) => ({
        purpose: 'any' as const,
        sizes: `${s}x${s}`,
        src: `/icon-${s}.png`,
        type: 'image/png',
    })),
    { purpose: 'maskable' as const, sizes: '512x512', src: '/icon-maskable.png', type: 'image/png' },
];
const imgOpt = (q: { readonly avif: number; readonly jpeg: number; readonly png: number; readonly webp: number }) => ({
    avif: { lossless: false, quality: q.avif },
    exclude: /^(?:virtual:)|node_modules/,
    includePublic: true,
    jpeg: { progressive: true, quality: q.jpeg },
    logStats: true,
    png: { quality: q.png },
    test: /\.(jpe?g|png|gif|tiff|webp|svg|avif)$/i,
    webp: { lossless: false, quality: q.webp },
});
const resolve = (browser = false) => ({
    alias: { '@': '/packages' },
    conditions: browser ? ['import', 'module', 'browser', 'default'] : ['import', 'module', 'default'],
    ...(browser ? { dedupe: ['react', 'react-dom'], extensions: [...B.exts] } : {}),
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const plugins = {
    app: (c: Extract<Cfg, { mode: 'app' }>, prod: boolean) => [
        tsconfigPaths({ root: './' }),
        react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
        tailwindcss({ optimize: { minify: true } }),
        ...(c.pwa
            ? [
                  VitePWA({
                      devOptions: { enabled: false },
                      includeAssets: (c.assetExts ?? B.assets).map((x) => `**/*.${x}`),
                      manifest: {
                          background_color: B.pwa.bg,
                          description: c.pwa.description,
                          display: 'standalone' as const,
                          icons: icons(),
                          name: c.pwa.name,
                          scope: '/',
                          short_name: c.pwa.shortName,
                          start_url: '/',
                          theme_color: c.pwa.themeColor,
                      },
                      registerType: 'autoUpdate',
                      workbox: {
                          clientsClaim: true,
                          globPatterns: [B.glob],
                          runtimeCaching: [
                              cache('CacheFirst', 'cdn-cache', B.cache.cdn, /^https:\/\/cdn\./),
                              cache('NetworkFirst', 'api-cache', B.cache.api, /^https:\/\/api\./),
                          ],
                          skipWaiting: true,
                      },
                  }),
              ]
            : []),
        svgr({ exclude: '', include: '**/*.svg?react', svgrOptions: B.svgr }),
        ViteImageOptimizer(imgOpt(c.imageQuality ?? B.img)),
        webfontDownload([...(c.webfonts ?? [])]),
        ...(prod
            ? [
                  compress('brotliCompress', '.br', c.compressionThreshold ?? B.comp.t),
                  compress('gzip', '.gz', c.compressionThreshold ?? B.comp.t),
              ]
            : []),
        csp({
            hashEnabled: { 'script-src': true, 'script-src-attr': false, 'style-src': true, 'style-src-attr': false },
            hashingMethod: 'sha256',
            policy: toPolicy(c.cspPolicy),
        }),
        {
            buildApp: async (b: ViteBuilder) => {
                await Promise.all(Object.values(b.environments).map((e) => b.build(e)));
            },
            buildEnd: () => undefined,
            buildStart: () => undefined,
            enforce: 'pre' as const,
            name: 'parametric-build-hooks',
        },
        Inspect({ build: true, dev: true, outputDir: '.vite-inspect' }),
    ],
    library: () => [
        tsconfigPaths({ projects: ['./tsconfig.json'] }),
        Inspect({ build: true, dev: true, outputDir: '.vite-inspect' }),
    ],
} as const;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const config: {
    readonly [M in Mode]: (
        c: Extract<Cfg, { mode: M }>,
        b: Browsers,
        env: { prod: boolean; time: string; ver: string },
    ) => UserConfig;
} = {
    app: (c, b, { prod, time, ver }) => ({
        appType: 'spa',
        assetsInclude: (c.assetExts ?? B.assets).map((x) => `**/*.${x}`),
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
                output: { ...output(), manualChunks: chunk },
                plugins: [visualizer({ ...B.viz, exclude: [...B.viz.exclude], projectRoot: process.cwd() })],
                treeshake: B.treeshake,
            },
            sourcemap: true,
            ssrManifest: true,
            target: 'esnext',
        },
        cacheDir: '.nx/cache/vite',
        css: css(b, true),
        define: {
            'import.meta.env.APP_VERSION': JSON.stringify(ver),
            'import.meta.env.BUILD_MODE': JSON.stringify(prod ? 'production' : 'development'),
            'import.meta.env.BUILD_TIME': JSON.stringify(time),
        },
        esbuild: esbuild(true, prod),
        json: { namedExports: true, stringify: 'auto' },
        optimizeDeps: {
            esbuildOptions: { supported: { 'top-level-await': true }, target: 'esnext' },
            exclude: [...B.ssr.noExt],
            holdUntilCrawlEnd: true,
            include: [...B.ssr.ext],
        },
        plugins: plugins.app(c, prod),
        resolve: resolve(true),
        server: {
            cors: true,
            hmr: { overlay: true },
            port: c.port ?? B.port,
            strictPort: false,
            warmup: { clientFiles: ['./apps/*/src/main.tsx', './apps/*/src/**/*.tsx', './packages/*/src/index.ts'] },
        },
        ssr: {
            external: [...B.ssr.ext],
            noExternal: [...B.ssr.noExt],
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
            rollupOptions: { output: output('workers/') },
        },
    }),
    library: (c, b) => ({
        build: {
            lib: {
                entry: c.entry,
                fileName: (f: string, n: string) => (f === 'es' ? `${n}.js` : `${n}.${f}.js`),
                formats: ['es', 'cjs'],
                name: c.name,
            },
            rollupOptions: {
                external: [...(c.external ?? [])],
                output: { exports: 'named', preserveModules: false },
                plugins: [typescript({ declaration: true, declarationDir: 'dist' })],
            },
            sourcemap: true,
            target: 'esnext',
        },
        css: css(b),
        esbuild: esbuild(false),
        plugins: plugins.library(),
        resolve: resolve(),
    }),
};

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const createConfig = (input: unknown): Effect.Effect<UserConfig, never, never> =>
    pipe(
        Effect.try(() => S.decodeUnknownSync(CfgSchema)(input)),
        Effect.orDie,
        Effect.flatMap((c) =>
            pipe(
                Effect.all({
                    b: Effect.sync(browsers),
                    p: Effect.sync(() => process.env.NODE_ENV === 'production'),
                    t: Effect.sync(() => new Date().toISOString()),
                    v: Effect.sync(() => process.env.npm_package_version ?? '0.0.0'),
                }),
                Effect.map(({ b, p, t, v }) => config[c.mode](c as never, b, { prod: p, time: t, ver: v })),
            ),
        ),
    );

// --- [EXPORT] ----------------------------------------------------------------

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
