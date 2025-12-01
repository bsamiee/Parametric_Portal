import * as path from 'node:path';
import { Effect, pipe } from 'effect';
import sharp from 'sharp';

// --- Configuration -----------------------------------------------------------

const ICON_CONFIG = Object.freeze({
    outputDir: 'public',
    source: 'public/icon-source.svg',
    targets: [
        { maskable: false, size: 192 },
        { maskable: false, size: 512 },
        { maskable: true, size: 512 },
    ] as const,
} as const);

// --- Domain Logic ------------------------------------------------------------

const createResizeOptions = (maskable: boolean) => ({
    background: { alpha: maskable ? 0 : 0, b: maskable ? 255 : 0, g: maskable ? 255 : 0, r: maskable ? 255 : 0 },
    fit: 'contain' as const,
});

const createExtendOptions = () => ({
    background: { alpha: 1, b: 255, g: 255, r: 255 },
    bottom: 51,
    left: 51,
    right: 51,
    top: 51,
});

const getOutputPath = (size: number, maskable: boolean): string =>
    path.join(ICON_CONFIG.outputDir, `icon-${size}${maskable ? '-maskable' : ''}.png`);

// --- Effect Pipelines --------------------------------------------------------

const processIcon = ({ maskable, size }: { maskable: boolean; size: number }): Effect.Effect<void, Error> =>
    pipe(
        Effect.tryPromise({
            catch: (error) =>
                new Error(`Failed to generate icon (size: ${size}, maskable: ${maskable}): ${String(error)}`),
            try: () => {
                const resizeSize = maskable ? 410 : size;
                const pipeline = sharp(ICON_CONFIG.source).resize(
                    resizeSize,
                    resizeSize,
                    createResizeOptions(maskable),
                );

                return (maskable ? pipeline.extend(createExtendOptions()) : pipeline)
                    .png()
                    .toFile(getOutputPath(size, maskable));
            },
        }),
        Effect.tap(() =>
            Effect.sync(() => {
                // biome-ignore lint/suspicious/noConsole: script output
                console.log(`[OK] Generated: ${getOutputPath(size, maskable)}`);
            }),
        ),
    );

const main = pipe(
    Effect.all(
        ICON_CONFIG.targets.map((target) => processIcon(target)),
        { concurrency: 'unbounded' },
    ),
    Effect.tap(() =>
        Effect.sync(() => {
            // biome-ignore lint/suspicious/noConsole: script output
            console.log('\n[OK] PWA Icons Generation Complete');
        }),
    ),
    Effect.catchAll((error) =>
        Effect.sync(() => {
            // biome-ignore lint/suspicious/noConsole: script output
            console.error(`\n[ERROR] ${error.message}`);
            process.exit(1);
        }),
    ),
);

// --- Execution ---------------------------------------------------------------

void Effect.runPromise(main);
