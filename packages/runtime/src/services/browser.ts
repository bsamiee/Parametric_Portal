/**
 * Browser download and export service with polymorphic dispatch table.
 */
import { Clipboard } from '@effect/platform-browser';
import { AppError } from '@parametric-portal/types/app-error';
import { Svg } from '@parametric-portal/types/svg';
import { Context, Effect, Layer, Option, Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ExportFormat = 'png' | 'svg' | 'zip';
type ExportInput = {
    readonly filename?: string;
    readonly format: ExportFormat;
    readonly onProgress?: (progress: number) => void;
    readonly pngSize?: number;
    readonly svg?: string;
    readonly variantCount?: number;
    readonly variantIndex?: number;
    readonly variants?: ReadonlyArray<string>;
};
type BrowserService = {
    readonly download: (data: Blob | string, filename: string, mimeType?: string) => Effect.Effect<void>;
    readonly export: (input: ExportInput) => Effect.Effect<void, AppError<'Browser'>>;
};

// --- [CLASSES] ---------------------------------------------------------------

class Browser extends Context.Tag('Browser')<Browser, BrowserService>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};
const sanitizeFilename = (text: string): string =>
    text
        .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
        .replaceAll(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
        .toLowerCase()
        .trim()
        .replaceAll(/[^a-z0-9 -]/g, '')
        .replaceAll(/[ -]+/g, '_')
        .slice(0, 64) || 'export';
const buildFilename = (base: string, ext: string, variantIndex?: number, variantCount?: number): string =>
    variantCount && variantCount > 1 && variantIndex !== undefined
        ? `${sanitizeFilename(base)}_variant_${variantIndex + 1}.${ext}`
        : `${sanitizeFilename(base)}.${ext}`;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const pngEffect = (input: ExportInput): Effect.Effect<void, AppError<'Browser'>> =>
    Effect.gen(function* () {
        const svg = yield* Option.fromNullable(input.svg).pipe(
            Option.flatMap(Svg.sanitize),
            Effect.mapError(() => AppError.from('Browser', 'NO_SVG')),
        );
        const canvas = globalThis.document.createElement('canvas');
        const size = input.pngSize ?? 512;
        canvas.width = size;
        canvas.height = size;
        const ctx = yield* Option.fromNullable(canvas.getContext('2d')).pipe(
            Effect.mapError(() => AppError.from('Browser', 'CANVAS_CONTEXT')),
        );
        yield* Effect.async<void, AppError<'Browser'>>((resume) => {
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, size, size);
                const a = globalThis.document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = buildFilename(input.filename ?? '', 'png', input.variantIndex, input.variantCount);
                a.click();
                URL.revokeObjectURL(url);
                resume(Effect.void);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resume(Effect.fail(AppError.from('Browser', 'EXPORT_FAILED')));
            };
            img.src = url;
        });
    }).pipe(Effect.withSpan('export.png', { attributes: { format: 'png', size: input.pngSize ?? 512 } }));
const svgEffect = (input: ExportInput): Effect.Effect<void, AppError<'Browser'>> =>
    Option.fromNullable(input.svg).pipe(
        Option.flatMap(Svg.sanitize),
        Effect.mapError(() => AppError.from('Browser', 'NO_SVG')),
        Effect.tap((svg) =>
            Effect.sync(() =>
                downloadBlob(
                    new Blob([svg], { type: 'image/svg+xml' }),
                    buildFilename(input.filename ?? '', 'svg', input.variantIndex, input.variantCount),
                ),
            ),
        ),
        Effect.asVoid,
        Effect.withSpan('export.svg', { attributes: { format: 'svg' } }),
    );
const zipEffect = (input: ExportInput): Effect.Effect<void, AppError<'Browser'>> =>
    Effect.gen(function* () {
        const variants = yield* Option.fromNullable(input.variants).pipe(
            Option.filter((v) => v.length > 0),
            Effect.mapError(() => AppError.from('Browser', 'NO_VARIANTS')),
        );
        const { default: JSZip } = yield* Effect.tryPromise({
            catch: () => AppError.from('Browser', 'EXPORT_FAILED'),
            try: () => import('jszip'),
        });
        const base = sanitizeFilename(input.filename ?? '');
        const zip = new JSZip();
        const total = variants.length;
        yield* Stream.fromIterable(variants).pipe(
            Stream.zipWithIndex,
            Stream.mapEffect(([svg, index]: readonly [string, number]) =>
                Effect.sync(() => {
                    const sanitized = Option.getOrNull(Svg.sanitize(svg));
                    sanitized && zip.file(`${base}_variant_${index + 1}.svg`, sanitized);
                    input.onProgress?.((index + 1) / total);
                }),
            ),
            Stream.runDrain,
        );
        const blob = yield* Effect.tryPromise({
            catch: () => AppError.from('Browser', 'EXPORT_FAILED'),
            try: () => zip.generateAsync({ type: 'blob' }),
        });
        downloadBlob(blob, `${base}.zip`);
    }).pipe(
        Effect.withSpan('export.zip', { attributes: { format: 'zip', variantCount: input.variants?.length ?? 0 } }),
    );

// --- [LAYERS] ----------------------------------------------------------------

const BrowserLive = Layer.succeed(Browser, {
    download: (data, filename, mimeType = 'application/octet-stream') =>
        Effect.sync(() => downloadBlob(data instanceof Blob ? data : new Blob([data], { type: mimeType }), filename)),
    export: (input) => ({ png: pngEffect, svg: svgEffect, zip: zipEffect })[input.format](input),
});
const BrowserServicesLive = Layer.mergeAll(Clipboard.layer, BrowserLive);

// --- [EXPORT] ----------------------------------------------------------------

export { Browser, BrowserServicesLive, sanitizeFilename };
export type { BrowserService, ExportFormat, ExportInput };
