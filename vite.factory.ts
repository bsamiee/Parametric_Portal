/// <reference types="vite/client" />
/**
 * Vite configuration factory: pure createConfig function without side effects.
 * Import this in app/package configs. Root vite.config.ts imports and executes.
 */

// --- [IMPORTS: node] ---------------------------------------------------------
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- [IMPORTS: vite-ecosystem] -----------------------------------------------
import typescript from '@rollup/plugin-typescript';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// --- [IMPORTS: external] -----------------------------------------------------
import { Effect, Option, pipe, Schema as S } from 'effect';
import { visualizer } from 'rollup-plugin-visualizer';
import type { Plugin, UserConfig, ViteBuilder } from 'vite';
import viteCompression from 'vite-plugin-compression';
import csp from 'vite-plugin-csp';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import Inspect from 'vite-plugin-inspect';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';
import webfontDownload from 'vite-plugin-webfont-dl';
import tsconfigPaths from 'vite-tsconfig-paths';

// --- [TYPES] -----------------------------------------------------------------

type EnvironmentConsumer = { readonly config: { readonly consumer: 'client' | 'server' } };
type Cfg = S.Schema.Type<typeof CfgSchema>;
type Mode = Cfg['mode'];

// --- [SCHEMA] ----------------------------------------------------------------

const CfgSchema = S.Union(
    S.Struct({
        assetExts: S.optional(S.Array(S.String)),
        builder: S.optional(
            S.Struct({
                sharedConfigBuild: S.optional(S.Boolean),
                sharedPlugins: S.optional(S.Boolean),
            }),
        ),
        compressionThreshold: S.optional(pipe(S.Number, S.int(), S.positive())),
        cspPolicy: S.optional(S.Record({ key: S.String, value: S.Array(S.String) })),
        entry: S.optional(S.String),
        imageQuality: S.optional(S.Struct({ avif: S.Number, jpeg: S.Number, png: S.Number, webp: S.Number })),
        mode: S.Literal('app'),
        name: S.String,
        port: S.optional(pipe(S.Number, S.int(), S.between(1024, 65535))),
        pwa: S.optional(S.Struct({ description: S.String, name: S.String, shortName: S.String, themeColor: S.String })),
        root: S.optional(S.String),
        webfonts: S.optional(S.Array(S.String)),
    }),
    S.Struct({
        css: S.optional(S.String),
        declaration: S.optional(S.Boolean),
        entry: S.Union(S.String, S.Record({ key: S.String, value: S.String })),
        external: S.optional(S.Array(S.String)),
        mode: S.Literal('library'),
        name: S.String,
        react: S.optional(S.Boolean),
    }),
    S.Struct({
        entry: S.String,
        external: S.optional(S.Array(S.String)),
        mode: S.Literal('server'),
        name: S.String,
        port: S.optional(pipe(S.Number, S.int(), S.between(1024, 65535))),
    }),
);

// --- [CONSTANTS] -------------------------------------------------------------

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const B = Object.freeze({
    artifacts: { compression: { dir: 'entries', exts: ['.br', '.gz'] } },
    assets: ['bin', 'exr', 'fbx', 'glb', 'gltf', 'hdr', 'mtl', 'obj', 'wasm'],
    builder: { sharedConfigBuild: true, sharedPlugins: true },
    cache: { api: 300, cdn: 604800, max: 50 },
    chunks: [
        { n: 'vendor-react', p: 'react(?:-dom)?', w: 3 },
        { n: 'vendor-effect', p: '@effect', w: 2 },
        { n: 'vendor', p: 'node_modules', w: 1 },
    ],
    comp: { f: /\.(js|mjs|json|css|html|svg)$/i, t: 10240 },
    csp: {
        'connect-src': ["'self'", 'https:', 'wss:', 'ws:'],
        'default-src': ["'self'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'worker-src': ["'self'", 'blob:'],
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
        ext: ['react', 'react-dom', 'react/jsx-runtime', 'react/compiler-runtime'],
        noExt: ['@effect/platform', '@effect/platform-browser', '@effect/experimental'],
    },
    svgr: { exportType: 'default', memo: true, ref: true, svgo: true, titleProp: true, typescript: true },
    treeshake: {
        moduleSideEffects: 'no-external' as const,
        preset: 'smallest' as const,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
        unknownGlobalSideEffects: false,
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

const chunk = (id: string) =>
    id.includes('node_modules')
        ? pipe(
              [...B.chunks].sort((a, b) => b.w - a.w).find(({ p }) => new RegExp(p).test(id)),
              Option.fromNullable,
              Option.map(({ n }) => n),
              Option.getOrUndefined,
          )
        : undefined;
const css = (dev = false) => ({
    devSourcemap: dev,
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
    exclude: /^(?:virtual:|node_modules)/,
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
const clientOnly = (plugin: Plugin): Plugin => ({
    ...plugin,
    applyToEnvironment: (environment: EnvironmentConsumer) => environment.config.consumer === 'client',
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const buildApp = (builder: ViteBuilder): Promise<void> =>
    pipe(
        Option.fromNullable(builder.environments['client']),
        Option.match({
            onNone: () => Promise.resolve(),
            onSome: (env) => builder.build(env).then(() => undefined),
        }),
    );
const plugins = {
    app: (c: Extract<Cfg, { mode: 'app' }>, prod: boolean) => [
        tsconfigPaths({ root: c.root ?? ROOT_DIR }),
        react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
        tailwindcss({ optimize: { minify: true } }),
        ...(c.pwa
            ? VitePWA({
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
              }).map((p) => clientOnly(p))
            : []),
        svgr({ exclude: '', include: '**/*.svg?react', svgrOptions: B.svgr }),
        clientOnly(ViteImageOptimizer(imgOpt(c.imageQuality ?? B.img))),
        clientOnly(webfontDownload([...(c.webfonts ?? [])])),
        clientOnly({
            ...visualizer({ ...B.viz, exclude: [...B.viz.exclude], projectRoot: process.cwd() }),
            apply: 'build',
        } as Plugin),
        ...(prod
            ? [
                  clientOnly(compress('brotliCompress', '.br', c.compressionThreshold ?? B.comp.t)),
                  clientOnly(compress('gzip', '.gz', c.compressionThreshold ?? B.comp.t)),
              ]
            : []),
        clientOnly(
            csp({
                hashEnabled: {
                    'script-src': false,
                    'script-src-attr': false,
                    'style-src': true,
                    'style-src-attr': false,
                },
                hashingMethod: 'sha256',
                policy: toPolicy(c.cspPolicy),
            }) as Plugin,
        ),
        // Inspect disabled in dev due to EEXIST race condition on HMR restart
        ...(prod ? [Inspect({ build: true, dev: false, outputDir: '.vite-inspect' })] : []),
    ],
    library: (c: Extract<Cfg, { mode: 'library' }>) => [
        tsconfigPaths({ projects: ['./tsconfig.json'] }),
        ...(c.react === true ? [react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })] : []),
        ...(c.css === undefined ? [] : [tailwindcss({ optimize: { minify: true } })]),
        Inspect({ build: true, dev: false, outputDir: '.vite-inspect' }),
    ],
    server: () => [tsconfigPaths({ projects: ['./tsconfig.json'] })],
} as const;
const config: {
    readonly [M in Mode]: (
        c: Extract<Cfg, { mode: M }>,
        env: { prod: boolean; time: string; ver: string },
    ) => UserConfig;
} = {
    app: (c, { prod, time, ver }) => ({
        appType: 'spa',
        assetsInclude: (c.assetExts ?? B.assets).map((x) => `**/*.${x}`),
        ...(c.root ? { root: c.root } : {}),
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
                treeshake: B.treeshake,
            },
            sourcemap: true,
            ssrManifest: false,
            target: 'baseline-widely-available',
        },
        builder: pipe(
            Option.fromNullable(c.builder),
            Option.map((builder) => ({ ...B.builder, ...builder })),
            Option.getOrElse(() => B.builder),
            (builder) => ({
                buildApp,
                sharedConfigBuild: builder.sharedConfigBuild ?? B.builder.sharedConfigBuild,
                sharedPlugins: builder.sharedPlugins ?? B.builder.sharedPlugins,
            }),
        ),
        cacheDir: c.root ? pathResolve(c.root, 'node_modules/.vite') : pathResolve(ROOT_DIR, '.nx/cache/vite'),
        css: css(true),
        define: {
            'import.meta.env.APP_VERSION': JSON.stringify(ver),
            'import.meta.env.BUILD_MODE': JSON.stringify(prod ? 'production' : 'development'),
            'import.meta.env.BUILD_TIME': JSON.stringify(time),
            'import.meta.env.VITE_API_URL': JSON.stringify(process.env['VITE_API_URL'] ?? 'http://localhost:4000/api'),
        },
        esbuild: esbuild(true, prod),
        json: { namedExports: true, stringify: 'auto' },
        optimizeDeps: {
            esbuildOptions: { supported: { 'top-level-await': true }, target: 'esnext' },
            exclude: [...B.ssr.noExt],
            force: false,
            holdUntilCrawlEnd: true,
            include: [...B.ssr.ext, 'react-aria-components', '@floating-ui/react', 'effect'],
        },
        plugins: plugins.app(c, prod),
        resolve: resolve(true),
        server: {
            cors: true,
            hmr: { overlay: true },
            port: c.port ?? B.port,
            strictPort: false,
            warmup: { clientFiles: ['./apps/*/src/main.tsx'] },
            watch: {
                ignored: [
                    // Dependencies and version control
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/.pnpm-store/**',
                    // Build outputs
                    '**/dist/**',
                    '**/build/**',
                    '**/out/**',
                    // Caches
                    '**/.nx/**',
                    '**/.vite/**',
                    '**/.vite-inspect/**',
                    '**/.cache/**',
                    '**/.turbo/**',
                    '**/coverage/**',
                    // Test artifacts
                    '**/test-results/**',
                    '**/playwright-report/**',
                    '**/playwright/.cache/**',
                    '**/reports/**',
                    // Python artifacts
                    '**/__pycache__/**',
                    '**/.venv/**',
                    '**/venv/**',
                    '**/*.pyc',
                    // Logs and misc
                    '**/*.log',
                    '**/.DS_Store',
                ],
                ignoreInitial: true,
            },
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
                tsconfigPaths({ root: c.root ?? ROOT_DIR }),
                react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } }),
            ],
            rollupOptions: { output: output('workers/') },
        },
    }),
    library: (c) => ({
        build: {
            cssCodeSplit: false,
            lib: {
                entry: c.entry,
                fileName: (f: string, n: string) => (f === 'es' ? `${n}.js` : `${n}.${f}.js`),
                formats: ['es', 'cjs'],
                name: c.name,
            },
            rollupOptions: {
                external: [/^node:/, ...(c.external ?? [])],
                output: {
                    exports: 'named',
                    generatedCode: {
                        arrowFunctions: true,
                        constBindings: true,
                        objectShorthand: true,
                        preset: 'es2015',
                    },
                    preserveModules: false,
                },
                plugins:
                    c.declaration === false
                        ? []
                        : [
                              typescript({
                                  compilerOptions: { rewriteRelativeImportExtensions: true },
                                  declaration: true,
                                  declarationDir: 'dist',
                                  outputToFilesystem: true,
                              }),
                          ],
            },
            sourcemap: true,
            target: 'esnext',
        },
        css: css(c.css !== undefined),
        esbuild: esbuild(c.react === true),
        plugins: plugins.library(c),
        resolve: resolve(c.react === true),
        ssr: { target: 'node' as const },
    }),
    server: (c) => ({
        build: {
            lib: { entry: c.entry, fileName: 'main', formats: ['es'] as const, name: c.name },
            rollupOptions: {
                external: [
                    /^node:/,
                    /^@effect/,
                    /^effect/,
                    /^arctic/,
                    /^@anthropic-ai/,
                    /^@opentelemetry/,
                    /^@grpc/,
                    /^prom-client/,
                    ...(c.external ?? []),
                ],
                output: { exports: 'named' as const },
            },
            sourcemap: true,
            target: 'node22',
        },
        plugins: plugins.server(),
        resolve: resolve(),
        ssr: { target: 'node' as const },
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
                    p: Effect.sync(() => process.env['NODE_ENV'] === 'production'),
                    t: Effect.sync(() => new Date().toISOString()),
                    v: Effect.sync(() => process.env['npm_package_version'] ?? '0.0.0'),
                }),
                Effect.map(({ p, t, v }) => config[c.mode](c as never, { prod: p, time: t, ver: v })),
            ),
        ),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B, createConfig };
