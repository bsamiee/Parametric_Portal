/**
 * Browser download and export service with polymorphic dispatch table.
 */
import { Clipboard } from '@effect/platform-browser';
import { AppError } from '@parametric-portal/types/app-error';
import { Svg } from '@parametric-portal/types/svg';
import { Context, Effect, Layer, Option, pipe, Stream } from 'effect';

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
    readonly export: (input: ExportInput) => Effect.Effect<void, AppError.Browser>;
};

// --- [CLASSES] ---------------------------------------------------------------

class Browser extends Context.Tag('Browser')<Browser, BrowserService>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const sanitizeFilename = (text: string): string =>
    text
        .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
        .replaceAll(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
        .toLowerCase()
        .trim()
        .replaceAll(/[^a-z0-9 -]/g, '')
        .replaceAll(/[ -]+/g, '_')
        .slice(0, 64) || 'export';
const triggerDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(globalThis.document.createElement('a'), { download: filename, href: url });
    a.click();
    URL.revokeObjectURL(url);
};
const requireSvg = (svg: string | undefined): Effect.Effect<string, AppError.Browser> =>
    pipe(
        Option.fromNullable(svg),
        Option.flatMap(Svg.sanitize),
        Effect.mapError(() => AppError.browser('NO_SVG')),
    );
const variantFilename = (base: string, ext: string, index: number | undefined, count: number | undefined): string =>
    count && count > 1 && index !== undefined ? `${base}_variant_${index + 1}.${ext}` : `${base}.${ext}`;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const pngEffect = (input: ExportInput): Effect.Effect<void, AppError.Browser> => {
    const size = input.pngSize ?? 512;
    const base = sanitizeFilename(input.filename ?? '');
    return Effect.gen(function* () {
        const svg = yield* requireSvg(input.svg);
        const canvas = Object.assign(globalThis.document.createElement('canvas'), { height: size, width: size });
        const ctx = yield* Option.fromNullable(canvas.getContext('2d')).pipe(
            Effect.mapError(() => AppError.browser('CANVAS_CONTEXT')),
        );
        yield* Effect.async<void, AppError.Browser>((resume) => {
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, size, size);
                const a = Object.assign(globalThis.document.createElement('a'), {
                    download: variantFilename(base, 'png', input.variantIndex, input.variantCount),
                    href: canvas.toDataURL('image/png'),
                });
                a.click();
                URL.revokeObjectURL(url);
                resume(Effect.void);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resume(Effect.fail(AppError.browser('EXPORT_FAILED')));
            };
            img.src = url;
        });
    }).pipe(Effect.withSpan('export.png', { attributes: { format: 'png', size } }));
};
const svgEffect = (input: ExportInput): Effect.Effect<void, AppError.Browser> => {
    const base = sanitizeFilename(input.filename ?? '');
    return requireSvg(input.svg).pipe(
        Effect.tap((svg) =>
            Effect.sync(() =>
                triggerDownload(
                    new Blob([svg], { type: 'image/svg+xml' }),
                    variantFilename(base, 'svg', input.variantIndex, input.variantCount),
                ),
            ),
        ),
        Effect.asVoid,
        Effect.withSpan('export.svg', { attributes: { format: 'svg' } }),
    );
};
const zipEffect = (input: ExportInput): Effect.Effect<void, AppError.Browser> => {
    const base = sanitizeFilename(input.filename ?? '');
    const exportError = (e: unknown) => AppError.browser('EXPORT_FAILED', undefined, e);
    return Effect.gen(function* () {
        const variants = yield* Option.fromNullable(input.variants).pipe(
            Option.filter((v) => v.length > 0),
            Effect.mapError(() => AppError.browser('NO_VARIANTS')),
        );
        const { default: JSZip } = yield* Effect.tryPromise({ catch: exportError, try: () => import('jszip') });
        const zip = new JSZip();
        const total = variants.length;
        yield* Stream.fromIterable(variants).pipe(
            Stream.zipWithIndex,
            Stream.tap(([content, index]) =>
                Effect.sync(() => {
                    Option.map(Svg.sanitize(content), (sanitized) =>
                        zip.file(`${base}_variant_${index + 1}.svg`, sanitized),
                    );
                    input.onProgress?.((index + 1) / total);
                }),
            ),
            Stream.runDrain,
        );
        triggerDownload(
            yield* Effect.tryPromise({ catch: exportError, try: () => zip.generateAsync({ type: 'blob' }) }),
            `${base}.zip`,
        );
    }).pipe(
        Effect.withSpan('export.zip', { attributes: { format: 'zip', variantCount: input.variants?.length ?? 0 } }),
    );
};

// --- [LAYERS] ----------------------------------------------------------------

const BrowserLive = Layer.succeed(Browser, {
    download: (data, filename, mimeType = 'application/octet-stream') =>
        Effect.sync(() =>
            triggerDownload(data instanceof Blob ? data : new Blob([data], { type: mimeType }), filename),
        ),
    export: (input) => ({ png: pngEffect, svg: svgEffect, zip: zipEffect })[input.format](input),
});
const BrowserServicesLive = Layer.mergeAll(Clipboard.layer, BrowserLive);

// --- [EXPORT] ----------------------------------------------------------------

export { Browser, BrowserServicesLive, sanitizeFilename };
export type { BrowserService, ExportFormat, ExportInput };
