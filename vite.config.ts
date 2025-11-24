import typescript from '@rollup/plugin-typescript';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import browserslist from 'browserslist';
import { Effect, Array as EffectArray, Option, pipe } from 'effect';
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
import * as z from 'zod';

// --- Type Definitions --------------------------------------------------------

type ConfigSchemas = ReturnType<typeof createConfigSchemas>;
type ChunkRule = { readonly name: string; readonly pattern: string; readonly priority: number };

// --- Schema Definitions ------------------------------------------------------

const browserSchema = z
    .object({
        chrome: z.number().positive(),
        edge: z.number().positive(),
        firefox: z.number().positive(),
        safari: z.number().positive(),
    })
    .strict();
const chunkSchema = z
    .object({ name: z.string(), priority: z.number().int().nonnegative(), test: z.instanceof(RegExp) })
    .strict();
const buildSchema = z.record(z.string().startsWith('import.meta.env.'), z.string());

const createConfigSchemas = () => ({ browser: browserSchema, build: buildSchema, chunk: chunkSchema }) as const;

// --- Constants (Unified Factory → Frozen) ------------------------------------

/**
 * Binary and 3D asset file extensions for special Vite handling.
 * These files bypass normal JS/CSS processing and are copied as-is.
 */
const ASSET_EXTENSIONS = ['bin', 'exr', 'fbx', 'glb', 'gltf', 'hdr', 'mtl', 'obj', 'wasm'] as const;

/**
 * Vendor chunk splitting rules prioritized by dependency importance.
 * React (p3) → Effect (p2) → other node_modules (p1).
 */
const CHUNK_RULES = [
    { name: 'vendor-react', pattern: 'react(?:-dom)?', priority: 3 },
    { name: 'vendor-effect', pattern: '@effect', priority: 2 },
    { name: 'vendor', pattern: 'node_modules', priority: 1 },
] as const satisfies ReadonlyArray<ChunkRule>;

const {
    browsers,
    chunks,
    assets,
    port,
    pluginConfigs,
    pwaManifest,
    pwaWorkbox,
    svgrOptions,
    ssrConfig,
    compressionConfig,
    visualizerConfig,
    imageOptimizerConfig,
    cspConfig,
    webfontConfig,
} = Effect.runSync(
    Effect.all({
        assets: pipe(
            Effect.succeed(ASSET_EXTENSIONS),
            Effect.map((extensions) => Object.freeze(extensions.map((ext) => `**/*.${ext}` as const))),
        ),
        browsers: pipe(
            Effect.try({
                catch: () => ({ chrome: 107, edge: 107, firefox: 104, safari: 16 }),
                try: () => {
                    const queries = browserslist();
                    const versions = queries.reduce(
                        (acc, query) => {
                            const match = query.match(/^(chrome|edge|firefox|safari)\s+(\d+)/);
                            if (match) {
                                const [, browser, version] = match;
                                const num = Number.parseInt(version, 10);
                                if (browser && !Number.isNaN(num)) {
                                    acc[browser as keyof z.infer<ConfigSchemas['browser']>] = Math.max(
                                        acc[browser as keyof z.infer<ConfigSchemas['browser']>] || 0,
                                        num,
                                    );
                                }
                            }
                            return acc;
                        },
                        { chrome: 107, edge: 107, firefox: 104, safari: 16 } as z.infer<ConfigSchemas['browser']>,
                    );
                    return versions;
                },
            }),
            Effect.map((config) => {
                const result = createConfigSchemas().browser.safeParse(config);
                return result.success ? result.data : config;
            }),
        ),
        chunks: pipe(
            Effect.succeed(CHUNK_RULES),
            Effect.map((r) =>
                Object.freeze(
                    r.map(({ name, pattern, priority }) =>
                        Object.freeze({ name, priority, test: new RegExp(pattern) }),
                    ),
                ),
            ),
        ),
        compressionConfig: Effect.succeed({
            brotli: {
                algorithm: 'brotliCompress' as const,
                deleteOriginFile: false,
                ext: '.br',
                filter: /\.(js|mjs|json|css|html|svg)$/i,
                threshold: 10240,
                verbose: true,
            },
            gzip: {
                algorithm: 'gzip' as const,
                deleteOriginFile: false,
                ext: '.gz',
                filter: /\.(js|mjs|json|css|html|svg)$/i,
                threshold: 10240,
                verbose: true,
            },
        } as const),
        cspConfig: Effect.succeed({
            algorithm: 'sha256' as const,
            hashEnabled: {
                'script-src': true,
                'style-src': true,
            },
            policy: {
                'default-src': ["'self'"] as string[],
                'font-src': ["'self'", 'https://fonts.gstatic.com'] as string[],
                'img-src': ["'self'", 'data:', 'https:'] as string[],
                'script-src': ["'self'", "'unsafe-inline'"] as string[],
                'style-src': ["'self'", "'unsafe-inline'"] as string[],
            },
        }),
        imageOptimizerConfig: Effect.succeed(
            Object.freeze({
                avif: Object.freeze({ lossless: false, quality: 70, speed: 5 }),
                exclude: [/^virtual:/, /node_modules/] as RegExp[],
                includePublic: true,
                jpeg: Object.freeze({ progressive: true, quality: 75 }),
                logStats: true,
                png: Object.freeze({ quality: 80 }),
                test: /\.(jpe?g|png|gif|tiff|webp|svg|avif)$/i,
                webp: Object.freeze({ lossless: false, quality: 80 }),
            }),
        ),
        pluginConfigs: Effect.succeed({
            inspect: {
                build: true,
                dev: true,
                outputDir: '.vite-inspect',
            },
            react: {
                babel: {
                    plugins: [['babel-plugin-react-compiler', {}]] as Array<[string, Record<string, unknown>]>,
                },
            },
        } as const),
        port: Effect.succeed(3000 as const),
        pwaManifest: Effect.succeed(
            Object.freeze({
                backgroundColor: '#ffffff',
                description: 'Next-gen parametric design platform',
                display: 'standalone' as const,
                icons: [
                    { purpose: 'any', sizes: '192x192', src: '/icon-192.png', type: 'image/png' },
                    { purpose: 'any', sizes: '512x512', src: '/icon-512.png', type: 'image/png' },
                    { purpose: 'maskable', sizes: '512x512', src: '/icon-maskable.png', type: 'image/png' },
                ],
                name: 'Parametric Portal',
                scope: '/',
                shortName: 'Portal',
                startUrl: '/',
                themeColor: '#000000',
            }),
        ),
        pwaWorkbox: Effect.succeed({
            clientsClaim: true,
            globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,glb,gltf}'],
            runtimeCaching: [
                {
                    handler: 'CacheFirst' as const,
                    options: { cacheName: 'cdn-cache', expiration: { maxAgeSeconds: 604800, maxEntries: 50 } },
                    urlPattern: /^https:\/\/cdn\./,
                },
                {
                    handler: 'NetworkFirst' as const,
                    options: { cacheName: 'api-cache', expiration: { maxAgeSeconds: 300, maxEntries: 50 } },
                    urlPattern: /^https:\/\/api\./,
                },
            ],
            skipWaiting: true,
        }),
        ssrConfig: Effect.succeed({
            external: ['react', 'react-dom', 'react/jsx-runtime'],
            noExternal: ['@effect/platform', '@effect/platform-browser', '@effect/experimental', '@effect/schema'],
            optimizeDeps: {
                include: ['@effect/platform'],
            },
            resolve: {
                conditions: ['node', 'import', 'module', 'default'],
                externalConditions: ['node'],
            },
            target: 'node' as const,
        }),
        svgrOptions: Effect.succeed({
            exportType: 'default' as const,
            memo: true,
            ref: true,
            svgo: true,
            titleProp: true,
            typescript: true,
        }),
        visualizerConfig: Effect.succeed({
            brotliSize: true,
            emitFile: true,
            exclude: [/node_modules\/react-compiler-runtime/] as RegExp[],
            filename: '.vite/stats.html',
            gzipSize: true,
            open: false,
            projectRoot: process.cwd(),
            sourcemap: true,
            template: 'treemap' as const,
        }),
        webfontConfig: Effect.succeed([] as string[]),
    }),
);

const BROWSER_TARGETS = Object.freeze(browsers satisfies z.infer<ConfigSchemas['browser']>);
const CHUNK_PATTERNS = Object.freeze(chunks);
const ASSET_PATTERNS = Object.freeze(assets);
const PORT_DEFAULT = Object.freeze(port);
const PLUGIN_CONFIGS = Object.freeze(pluginConfigs);
const PWA_MANIFEST = Object.freeze(pwaManifest);
const PWA_WORKBOX_CONFIG = Object.freeze(pwaWorkbox);
const SVGR_OPTIONS = Object.freeze(svgrOptions);
const SSR_CONFIG = Object.freeze(ssrConfig);
const COMPRESSION_CONFIG = Object.freeze(compressionConfig);
const VISUALIZER_CONFIG = Object.freeze(visualizerConfig);
const IMAGE_OPTIMIZER_CONFIG = Object.freeze(imageOptimizerConfig);
const CSP_CONFIG = Object.freeze(cspConfig);
const WEBFONT_CONFIG = webfontConfig as string[];

// --- Pure Utility Functions --------------------------------------------------

const matchesNodeModules = (id: string): boolean => id.includes('node_modules');

const createSharedCssConfig = (browsers: z.infer<ConfigSchemas['browser']>) => ({
    lightningcss: {
        drafts: { customMedia: true },
        nonStandard: { deepSelectorCombinator: true },
        targets: { ...browsers },
    },
    transformer: 'lightningcss' as const,
});

const createSharedEsbuildConfig = (extras: { readonly format: 'esm'; readonly minifyIdentifiers: boolean }) => ({
    format: extras.format,
    keepNames: true,
    minifyIdentifiers: extras.minifyIdentifiers,
    minifySyntax: true,
    minifyWhitespace: true,
    target: 'esnext' as const,
    treeShaking: true,
});

const createSharedResolveConfig = (conditions: ReadonlyArray<string>) => ({
    alias: {
        '@': '/packages',
    },
    conditions: [...conditions],
});

// --- Effect Pipelines & Builders ---------------------------------------------

const createLibraryConfig = (options: {
    readonly entry: string | string[] | Record<string, string>;
    readonly external?: string[];
    readonly name: string;
}): Effect.Effect<UserConfig, never, never> =>
    pipe(
        Effect.succeed(
            typescript({
                declaration: true,
                declarationDir: 'dist',
            }),
        ),
        Effect.map((rollupTypescript) => ({
            build: {
                lib: {
                    entry: options.entry,
                    fileName: (format: string, entryName: string) =>
                        format === 'es' ? `${entryName}.js` : `${entryName}.${format}.js`,
                    formats: ['es', 'cjs'] as const,
                    name: options.name,
                },
                rollupOptions: {
                    external: options.external ?? [],
                    output: {
                        exports: 'named' as const,
                        preserveModules: false,
                    },
                    plugins: [rollupTypescript],
                },
                sourcemap: true,
                target: 'esnext' as const,
            },
            css: createSharedCssConfig(BROWSER_TARGETS),
            esbuild: createSharedEsbuildConfig({ format: 'esm', minifyIdentifiers: false }),
            plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] }), Inspect(PLUGIN_CONFIGS.inspect)],
            resolve: createSharedResolveConfig(['import', 'module', 'default']),
        })),
    );

const createBuildConstants = (): Effect.Effect<z.infer<ConfigSchemas['build']>, never, never> =>
    pipe(
        Effect.all({
            mode: Effect.sync(() => process.env.NODE_ENV),
            time: Effect.sync(() => new Date().toISOString()),
            version: Effect.sync(() => process.env.npm_package_version),
        }),
        Effect.map(({ mode, time, version }) => ({
            'import.meta.env.APP_VERSION': JSON.stringify(version ?? '0.0.0'),
            'import.meta.env.BUILD_MODE': JSON.stringify(mode ?? 'development'),
            'import.meta.env.BUILD_TIME': JSON.stringify(time),
        })),
        Effect.map((constants) => {
            const result = createConfigSchemas().build.safeParse(constants);
            return result.success ? result.data : constants;
        }),
    );

const getDropTargets = (): Effect.Effect<ReadonlyArray<'console' | 'debugger'>, never, never> =>
    pipe(
        Effect.sync(() => process.env.NODE_ENV),
        Effect.map((mode) => (mode === 'production' ? (['console', 'debugger'] as const) : ([] as const))),
    );

const createChunkStrategy =
    (patterns: ReadonlyArray<z.infer<ConfigSchemas['chunk']>>) =>
    (id: string): string | undefined =>
        matchesNodeModules(id)
            ? pipe(
                  [...patterns].sort((a, b) => b.priority - a.priority),
                  EffectArray.findFirst(({ test }) => test.test(id)),
                  Option.map(({ name }) => name),
                  Option.getOrUndefined,
              )
            : undefined;

const createBuildHook = (): PluginOption =>
    ({
        buildApp: async (builder: ViteBuilder) =>
            void (await Promise.all(Object.values(builder.environments).map((env) => builder.build(env)))),
        buildEnd: () => void 0,
        buildStart: () => void 0,
        enforce: 'pre' as const,
        name: 'parametric-build-hooks',
    }) as const;

const createAllPlugins = (): { readonly main: ReadonlyArray<PluginOption>; readonly worker: () => PluginOption[] } => ({
    main: [
        tsconfigPaths({ root: './' }),
        react(PLUGIN_CONFIGS.react),
        tailwindcss({ optimize: { minify: true } }),
        VitePWA({
            devOptions: { enabled: false },
            includeAssets: [...ASSET_PATTERNS],
            manifest: PWA_MANIFEST,
            registerType: 'autoUpdate' as const,
            workbox: PWA_WORKBOX_CONFIG,
        }),
        svgr({ exclude: '', include: '**/*.svg?react', svgrOptions: SVGR_OPTIONS }),
        // biome-ignore lint/suspicious/noExplicitAny: Plugin requires mutable exclude array
        ViteImageOptimizer(IMAGE_OPTIMIZER_CONFIG as any),
        webfontDownload(WEBFONT_CONFIG),
        ...pipe(
            Effect.sync(() => process.env.NODE_ENV),
            Effect.map((mode) =>
                mode === 'production'
                    ? [viteCompression(COMPRESSION_CONFIG.brotli), viteCompression(COMPRESSION_CONFIG.gzip)]
                    : [],
            ),
            Effect.runSync,
        ),
        // biome-ignore lint/suspicious/noExplicitAny: Plugin requires mutable policy arrays
        csp(CSP_CONFIG as any),
        createBuildHook(),
        Inspect(PLUGIN_CONFIGS.inspect),
    ],
    worker: () => [tsconfigPaths({ root: './' }), react(PLUGIN_CONFIGS.react)],
});

const createAppConfig = (): Effect.Effect<UserConfig, never, never> =>
    pipe(
        Effect.all({
            constants: createBuildConstants(),
            dropTargets: getDropTargets(),
        }),
        Effect.map(({ constants, dropTargets }) => {
            const plugins = createAllPlugins();
            const outputDir = 'dist';
            const baseCss = createSharedCssConfig(BROWSER_TARGETS);
            const baseEsbuild = createSharedEsbuildConfig({ format: 'esm', minifyIdentifiers: true });
            return {
                appType: 'spa' as const,
                assetsInclude: [...ASSET_PATTERNS],
                build: {
                    cssCodeSplit: true,
                    cssMinify: 'lightningcss' as const,
                    emptyOutDir: true,
                    manifest: true,
                    minify: 'esbuild' as const,
                    modulePreload: { polyfill: true },
                    outDir: outputDir,
                    reportCompressedSize: false,
                    rollupOptions: {
                        output: {
                            assetFileNames: 'assets/[name]-[hash][extname]',
                            chunkFileNames: 'chunks/[name]-[hash].js',
                            entryFileNames: 'entries/[name]-[hash].js',
                            manualChunks: createChunkStrategy(CHUNK_PATTERNS),
                        },
                        // biome-ignore lint/suspicious/noExplicitAny: Plugin requires mutable exclude Filter array
                        plugins: [visualizer(VISUALIZER_CONFIG as any)],
                        treeshake: {
                            moduleSideEffects: 'no-external' as const,
                            propertyReadSideEffects: false,
                            tryCatchDeoptimization: false,
                        },
                    },
                    sourcemap: true,
                    ssrManifest: true,
                    target: 'esnext' as const,
                },
                cacheDir: '.nx/cache/vite',
                css: { ...baseCss, devSourcemap: true },
                define: constants,
                esbuild: {
                    ...baseEsbuild,
                    drop: [...dropTargets],
                    jsx: 'automatic' as const,
                    legalComments: 'none' as const,
                    logLevel: 'error' as const,
                    pure: ['console.log', 'console.debug'] as const,
                    supported: {
                        'dynamic-import': true,
                        'import-meta': true,
                    },
                },
                json: {
                    namedExports: true,
                    stringify: 'auto' as const,
                },
                optimizeDeps: {
                    esbuildOptions: {
                        supported: {
                            'top-level-await': true,
                        },
                        target: 'esnext' as const,
                    },
                    exclude: [
                        '@effect/experimental',
                        '@effect/platform',
                        '@effect/platform-browser',
                        '@effect/schema',
                    ] as const,
                    holdUntilCrawlEnd: true,
                    include: ['react', 'react-dom', 'react/jsx-runtime'] as const,
                },
                plugins: [...plugins.main],
                resolve: {
                    ...createSharedResolveConfig(['import', 'module', 'browser', 'default']),
                    dedupe: ['react', 'react-dom'] as const,
                    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'] as const,
                },
                server: {
                    cors: true,
                    hmr: {
                        overlay: true,
                    },
                    port: PORT_DEFAULT,
                    strictPort: false,
                    warmup: {
                        clientFiles: ['./apps/*/src/main.tsx', './apps/*/src/**/*.tsx', './packages/*/src/index.ts'],
                    },
                },
                ssr: SSR_CONFIG,
                worker: {
                    format: 'es' as const,
                    plugins: plugins.worker,
                    rollupOptions: {
                        output: {
                            assetFileNames: 'workers/assets/[name]-[hash][extname]',
                            chunkFileNames: 'workers/chunks/[name]-[hash].js',
                            entryFileNames: 'workers/[name]-[hash].js',
                        },
                    },
                },
            };
        }),
    );

// --- Export ------------------------------------------------------------------

export { createAppConfig, createLibraryConfig };
export default defineConfig(Effect.runSync(createAppConfig()));
