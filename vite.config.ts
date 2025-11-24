import typescript from '@rollup/plugin-typescript';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import browserslist from 'browserslist';
import { Effect, Array as EffectArray, Option, pipe } from 'effect';
import { visualizer } from 'rollup-plugin-visualizer';
import type { PluginOption, UserConfig, ViteBuilder } from 'vite';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import Inspect from 'vite-plugin-inspect';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import * as z from 'zod';

// --- Type Definitions --------------------------------------------------------

type ChunkDecision = Option.Option<string>;

type ConfigSchemas = ReturnType<typeof createConfigSchemas>;
type BrowserTargetConfig = z.infer<ConfigSchemas['browser']>;
type ChunkPattern = z.infer<ConfigSchemas['chunk']>;
type BuildConstants = z.infer<ConfigSchemas['build']>;

// --- Schema Definitions ------------------------------------------------------

const createConfigSchemas = () =>
    ({
        browser: z
            .object({
                chrome: z.number().positive(),
                edge: z.number().positive(),
                firefox: z.number().positive(),
                safari: z.number().positive(),
            })
            .strict(),
        build: z.record(z.string().startsWith('import.meta.env.'), z.string()),
        chunk: z
            .object({ name: z.string(), priority: z.number().int().nonnegative(), test: z.instanceof(RegExp) })
            .strict(),
    }) as const;

// --- Constants (Unified Factory → Frozen) ------------------------------------

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
} = Effect.runSync(
    Effect.all({
        assets: Effect.succeed([
            '**/*.bin',
            '**/*.exr',
            '**/*.fbx',
            '**/*.glb',
            '**/*.gltf',
            '**/*.hdr',
            '**/*.mtl',
            '**/*.obj',
            '**/*.wasm',
        ] as const),
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
                                    acc[browser as keyof BrowserTargetConfig] = Math.max(
                                        acc[browser as keyof BrowserTargetConfig] || 0,
                                        num,
                                    );
                                }
                            }
                            return acc;
                        },
                        { chrome: 107, edge: 107, firefox: 104, safari: 16 } as BrowserTargetConfig,
                    );
                    return versions;
                },
            }),
            Effect.map((config) => {
                const result = createConfigSchemas().browser.safeParse(config);
                return result.success ? result.data : config;
            }),
        ),
        chunks: Effect.succeed([
            { name: 'vendor-react', priority: 3, test: /react(?:-dom)?/ },
            { name: 'vendor-effect', priority: 2, test: /@effect/ },
            { name: 'vendor', priority: 1, test: /node_modules/ },
        ] as const),
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
        imageOptimizerConfig: Effect.succeed({
            avif: {
                lossless: false,
                quality: 70,
                speed: 5,
            },
            exclude: [/^virtual:/, /node_modules/],
            includePublic: true,
            jpeg: {
                progressive: true,
                quality: 75,
            },
            logStats: true,
            png: {
                quality: 80,
            },
            test: /\.(jpe?g|png|gif|tiff|webp|svg|avif)$/i,
            webp: {
                lossless: false,
                quality: 80,
            },
        } as const),
        pluginConfigs: Effect.succeed({
            inspect: {
                build: true,
                dev: {
                    enabled: true,
                    logLevel: 'error',
                },
                outputDir: '.vite-inspect',
            },
            react: {
                babel: {
                    plugins: [['babel-plugin-react-compiler', {}]] as Array<[string, Record<string, unknown>]>,
                },
            },
        } as const),
        port: Effect.succeed(3000 as const),
        pwaManifest: Effect.succeed({
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
            exclude: [/node_modules\/react-compiler-runtime/],
            filename: '.vite/stats.html',
            gzipSize: true,
            open: false,
            projectRoot: process.cwd(),
            sourcemap: true,
            template: 'treemap' as const,
        } as const),
    }),
);

const BROWSER_TARGETS = Object.freeze(browsers satisfies BrowserTargetConfig);
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

// --- Pure Utility Functions --------------------------------------------------

const matchesNodeModules = (id: string): boolean => id.includes('node_modules');

const createCompressionPlugins = (): ReadonlyArray<PluginOption> =>
    pipe(
        isProductionMode(),
        Effect.map((isProd) =>
            isProd ? [viteCompression(COMPRESSION_CONFIG.brotli), viteCompression(COMPRESSION_CONFIG.gzip)] : [],
        ),
        Effect.runSync,
    );

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
            css: {
                lightningcss: {
                    drafts: { customMedia: true },
                    nonStandard: { deepSelectorCombinator: true },
                    targets: { ...BROWSER_TARGETS },
                },
                transformer: 'lightningcss' as const,
            },
            esbuild: {
                format: 'esm' as const,
                keepNames: true,
                minifyIdentifiers: false,
                minifySyntax: true,
                minifyWhitespace: true,
                target: 'esnext' as const,
                treeShaking: true,
            },
            plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] })],
            resolve: {
                alias: {
                    '@': '/packages',
                },
                conditions: ['import', 'module', 'default'] as const,
            },
        })),
    );

const createBuildConstants = (): Effect.Effect<BuildConstants, never, never> =>
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

const isProductionMode = (): Effect.Effect<boolean, never, never> =>
    pipe(
        Effect.sync(() => process.env.NODE_ENV),
        Effect.map((mode) => mode === 'production'),
    );

const getDropTargets = (): Effect.Effect<ReadonlyArray<'console' | 'debugger'>, never, never> =>
    pipe(
        isProductionMode(),
        Effect.map((isProd) => (isProd ? (['console', 'debugger'] as const) : ([] as const))),
    );

const findMatchingPattern =
    (patterns: ReadonlyArray<ChunkPattern>) =>
    (id: string): ChunkDecision =>
        pipe(
            [...patterns].sort((a, b) => b.priority - a.priority),
            EffectArray.findFirst(({ test }) => test.test(id)),
            Option.map(({ name }) => name),
        );

const createChunkStrategy =
    (patterns: ReadonlyArray<ChunkPattern>) =>
    (id: string): string | undefined =>
        matchesNodeModules(id) ? pipe(id, findMatchingPattern(patterns), Option.getOrUndefined) : undefined;

const createAllPlugins = (): { readonly main: ReadonlyArray<PluginOption>; readonly worker: () => PluginOption[] } => ({
    main: Object.freeze([
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
        ViteImageOptimizer(IMAGE_OPTIMIZER_CONFIG),
        ...createCompressionPlugins(),
        {
            buildApp: async (builder: ViteBuilder) => {
                await Promise.all(Object.values(builder.environments).map((env) => builder.build(env)));
            },
            buildEnd: (_error: Error | undefined) => {},
            buildStart: () => {},
            enforce: 'pre' as const,
            name: 'parametric-build-hooks',
        } as const,
        Inspect(PLUGIN_CONFIGS.inspect),
    ] as const),
    worker: () => Object.freeze([tsconfigPaths({ root: './' }), react(PLUGIN_CONFIGS.react)]),
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
                        plugins: [visualizer(VISUALIZER_CONFIG)],
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
                css: {
                    devSourcemap: true,
                    lightningcss: {
                        drafts: { customMedia: true },
                        nonStandard: { deepSelectorCombinator: true },
                        targets: { ...BROWSER_TARGETS },
                    },
                    transformer: 'lightningcss' as const,
                },
                define: constants,
                esbuild: {
                    drop: [...dropTargets],
                    format: 'esm' as const,
                    jsx: 'automatic' as const,
                    keepNames: true,
                    legalComments: 'none' as const,
                    logLevel: 'error' as const,
                    minifyIdentifiers: true,
                    minifySyntax: true,
                    minifyWhitespace: true,
                    pure: ['console.log', 'console.debug'] as const,
                    supported: {
                        'dynamic-import': true,
                        'import-meta': true,
                    },
                    target: 'esnext' as const,
                    treeShaking: true,
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
                    include: ['react', 'react-dom', 'react/jsx-runtime'] as const,
                },
                plugins: [...plugins.main],
                resolve: {
                    alias: {
                        '@': '/packages',
                    },
                    conditions: ['import', 'module', 'browser', 'default'] as const,
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
                    plugins: plugins.worker(),
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
