/**
 * Browser services for download and export operations.
 * Uses @effect/platform-browser for Clipboard/KeyValueStore.
 * Custom Context.Tag services for operations not in platform.
 */
import { Clipboard } from '@effect/platform-browser';
import {
    BROWSER_TUNING as B,
    BrowserError,
    type ExportInput as ExportInputBase,
    type ExportVariant,
} from '@parametric-portal/types/browser';
import { Context, Effect, Layer, Option, Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ExportInput = ExportInputBase & { readonly onProgress?: (progress: number) => void };
type DownloadService = {
    readonly download: (data: Blob | string, filename: string, mimeType?: string) => Effect.Effect<void>;
};
type ExportService = {
    readonly png: (input: ExportInput) => Effect.Effect<void, BrowserError>;
    readonly svg: (input: ExportInput) => Effect.Effect<void, BrowserError>;
    readonly zip: (input: ExportInput) => Effect.Effect<void, BrowserError>;
};

// --- [CONTEXT_TAGS] ----------------------------------------------------------

class Download extends Context.Tag('Download')<Download, DownloadService>() {}
class Export extends Context.Tag('Export')<Export, ExportService>() {}

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
        .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .trim()
        .replaceAll(/[^a-z0-9 -]/g, '')
        .replaceAll(/ +/g, '_')
        .replaceAll(/-+/g, '_')
        .replaceAll(/_+/g, '_')
        .slice(0, 64) || 'export';
const buildFilename = (base: string, ext: string, variantIndex?: number, variantCount?: number): string =>
    variantCount && variantCount > 1 && variantIndex !== undefined
        ? `${sanitizeFilename(base)}_variant_${variantIndex + 1}.${ext}`
        : `${sanitizeFilename(base)}.${ext}`;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const pngEffect = (input: ExportInput): Effect.Effect<void, BrowserError> =>
    Effect.gen(function* () {
        const svg = yield* Option.fromNullable(input.svg).pipe(
            Effect.mapError(() => BrowserError.Export(B.errors.noSvg)),
        );
        const canvas = globalThis.document.createElement('canvas');
        const size = input.pngSize ?? B.defaults.pngSize;
        canvas.width = size;
        canvas.height = size;
        const ctx = yield* Option.fromNullable(canvas.getContext('2d')).pipe(
            Effect.mapError(() => BrowserError.Export(B.errors.canvasContext)),
        );
        yield* Effect.async<void, BrowserError>((resume) => {
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
                resume(Effect.fail(BrowserError.Export(B.errors.exportFailed)));
            };
            img.src = url;
        });
    }).pipe(
        Effect.withSpan('export.png', { attributes: { format: 'png', size: input.pngSize ?? B.defaults.pngSize } }),
    );
const svgEffect = (input: ExportInput): Effect.Effect<void, BrowserError> =>
    Option.fromNullable(input.svg).pipe(
        Effect.mapError(() => BrowserError.Export(B.errors.noSvg)),
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
const zipEffect = (input: ExportInput): Effect.Effect<void, BrowserError> =>
    Effect.gen(function* () {
        const variants = yield* Option.fromNullable(input.variants).pipe(
            Option.filter((v) => v.length > 0),
            Effect.mapError(() => BrowserError.Export(B.errors.noVariants)),
        );
        const { default: JSZip } = yield* Effect.tryPromise({
            catch: () => BrowserError.Export(B.errors.exportFailed),
            try: () => import('jszip'),
        });
        const base = sanitizeFilename(input.filename ?? '');
        const zip = new JSZip();
        const total = variants.length;
        yield* Stream.fromIterable(variants).pipe(
            Stream.zipWithIndex,
            Stream.mapEffect(([variant, index]: readonly [ExportVariant, number]) =>
                Effect.sync(() => {
                    zip.file(`${base}_variant_${index + 1}.svg`, variant.svg);
                    input.onProgress?.((index + 1) / total);
                }),
            ),
            Stream.runDrain,
        );
        const blob = yield* Effect.tryPromise({
            catch: () => BrowserError.Export(B.errors.exportFailed),
            try: () => zip.generateAsync({ type: 'blob' }),
        });
        downloadBlob(blob, `${base}.zip`);
    }).pipe(
        Effect.withSpan('export.zip', { attributes: { format: 'zip', variantCount: input.variants?.length ?? 0 } }),
    );

// --- [LAYERS] ----------------------------------------------------------------

const DownloadLive = Layer.succeed(Download, {
    download: (data, filename, mimeType = B.defaults.mimeType) =>
        Effect.sync(() => downloadBlob(data instanceof Blob ? data : new Blob([data], { type: mimeType }), filename)),
});
const ExportLive = Layer.succeed(Export, {
    png: pngEffect,
    svg: svgEffect,
    zip: zipEffect,
});
const BrowserServicesLive = Layer.mergeAll(Clipboard.layer, DownloadLive, ExportLive);

// --- [EXPORT] ----------------------------------------------------------------

export { BrowserServicesLive, buildFilename, Download, DownloadLive, Export, ExportLive, sanitizeFilename };
export type { DownloadService, ExportInput, ExportService };
