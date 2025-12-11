/**
 * Generate PWA icons by resizing SVG source to multiple PNG sizes with maskable variants.
 */
import * as path from 'node:path';
import { Effect, pipe } from 'effect';
import sharp from 'sharp';

// --- [TYPES] -----------------------------------------------------------------

type IconMode = 'maskable' | 'standard';

class IconGenerationError {
    readonly _tag = 'IconGenerationError';
    constructor(
        readonly size: number,
        readonly mode: IconMode,
        readonly reason: string,
    ) {}
}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    baseSize: 512,
    output: 'public',
    rgbWhite: 255,
    safeZonePadding: 51,
    smallRatio: 192 / 512,
    source: 'public/icon-source.svg',
    targets: [
        { mode: 'standard' as const, size: 192 },
        { mode: 'standard' as const, size: 512 },
        { mode: 'maskable' as const, size: 512 },
    ],
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const deriveOutputPath = (size: number, mode: IconMode): string =>
    path.join(B.output, `icon-${size}${mode === 'maskable' ? '-maskable' : ''}.png`);

// --- [DISPATCH_TABLES] -------------------------------------------------------

// Route pipeline behavior by icon mode
const pipelineHandlers = {
    maskable: (p: sharp.Sharp) =>
        p.extend({
            background: { alpha: 1, b: B.rgbWhite, g: B.rgbWhite, r: B.rgbWhite },
            bottom: B.safeZonePadding,
            left: B.safeZonePadding,
            right: B.safeZonePadding,
            top: B.safeZonePadding,
        }),
    standard: (p: sharp.Sharp) => p,
} as const satisfies Record<IconMode, (p: sharp.Sharp) => sharp.Sharp>;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const processIcon = ({ mode, size }: { mode: IconMode; size: number }): Effect.Effect<void, IconGenerationError> =>
    pipe(
        Effect.tryPromise({
            catch: (error) => new IconGenerationError(size, mode, String(error)),
            // Maskable icons: resize to (baseSize - 2*padding) then extend back to baseSize
            try: () =>
                pipelineHandlers[mode](
                    sharp(B.source).resize(
                        mode === 'maskable' ? B.baseSize - B.safeZonePadding * 2 : size,
                        mode === 'maskable' ? B.baseSize - B.safeZonePadding * 2 : size,
                        { background: { alpha: 0, b: 0, g: 0, r: 0 }, fit: 'contain' as const },
                    ),
                )
                    .png()
                    .toFile(deriveOutputPath(size, mode)),
        }),
        Effect.tap(() =>
            Effect.sync(() => {
                // biome-ignore lint/suspicious/noConsole: script output
                console.log(`[OK] Generated: ${deriveOutputPath(size, mode)}`);
            }),
        ),
    );

const generationPipeline = pipe(
    Effect.all(
        B.targets.map((target) => processIcon(target)),
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
            console.error(`\n[ERROR] ${error.reason}`);
            process.exit(1);
        }),
    ),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

Effect.runPromise(generationPipeline).catch(() => process.exit(1));
