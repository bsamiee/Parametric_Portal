/**
 * Browser API hooks for clipboard, download, export operations via Effect pipelines.
 */
import { Effect, Option, pipe } from 'effect';
import { useCallback, useState } from 'react';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

class BrowserError<Tag extends string> extends Error {
    readonly _tag: Tag;
    readonly code: string;
    constructor(tag: Tag, def: { readonly code: string; readonly message: string }) {
        super(def.message);
        this._tag = tag;
        this.code = def.code;
        this.name = tag;
    }
}
type ClipboardError = BrowserError<'ClipboardError'>;
type DownloadError = BrowserError<'DownloadError'>;
type ExportError = BrowserError<'ExportError'>;
type ExportFormat = 'png' | 'svg' | 'zip';
type ExportVariant = { readonly id: string; readonly svg: string };
type ExportInput = {
    readonly filename?: string;
    readonly format: ExportFormat;
    readonly pngSize?: number;
    readonly svg?: string;
    readonly variantCount?: number;
    readonly variantIndex?: number;
    readonly variants?: ReadonlyArray<ExportVariant>;
};
type ClipboardState<V> = {
    readonly copy: (value: V) => void;
    readonly error: ClipboardError | null;
    readonly isPending: boolean;
    readonly paste: () => void;
    readonly reset: () => void;
    readonly value: V | null;
};
type DownloadState = {
    readonly download: (data: string | Blob, filename: string, mimeType?: string) => void;
    readonly error: DownloadError | null;
    readonly isPending: boolean;
    readonly reset: () => void;
};
type ExportState = {
    readonly error: ExportError | null;
    readonly exportAs: (input: ExportInput) => void;
    readonly isPending: boolean;
    readonly reset: () => void;
};
type ErrorDef = { readonly code: string; readonly message: string };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        mimeType: 'text/plain',
        pngSize: 512,
    },
    errors: {
        canvasContext: { code: 'CANVAS_CONTEXT', message: 'Failed to get canvas 2D context' },
        clipboardRead: { code: 'CLIPBOARD_READ', message: 'Failed to read from clipboard' },
        clipboardUnavailable: { code: 'CLIPBOARD_UNAVAILABLE', message: 'Clipboard API not available' },
        clipboardWrite: { code: 'CLIPBOARD_WRITE', message: 'Failed to write to clipboard' },
        downloadFailed: { code: 'DOWNLOAD_FAILED', message: 'Download failed' },
        exportFailed: { code: 'EXPORT_FAILED', message: 'Export failed' },
        noSvg: { code: 'NO_SVG', message: 'No SVG content to export' },
        noVariants: { code: 'NO_VARIANTS', message: 'No variants to export' },
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isClipboardAvailable = (): boolean => globalThis.navigator?.clipboard !== undefined;
const mkBrowserError =
    <Tag extends string>(tag: Tag) =>
    (err: ErrorDef): BrowserError<Tag> =>
        new BrowserError(tag, err);
const mkClipboardError = mkBrowserError('ClipboardError');
const mkDownloadError = mkBrowserError('DownloadError');
const mkExportError = mkBrowserError('ExportError');
const sanitizeFilename = (text: string): string =>
    text
        .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
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
const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    globalThis.document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};
const executeDownload = (
    data: string | Blob,
    filename: string,
    mimeType: string,
    setIsPending: (v: boolean) => void,
    setError: (v: DownloadError | null) => void,
): void => {
    setIsPending(true);
    setError(null);
    downloadBlob(data instanceof Blob ? data : new Blob([data], { type: mimeType }), filename);
    setIsPending(false);
};

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const loadImageToCanvas = (svg: string, size: number, filename: string): Effect.Effect<void, ExportError, never> =>
    Effect.async((resume) => {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        pipe(
            Option.fromNullable(canvas.getContext('2d')),
            Option.match({
                onNone: () => resume(Effect.fail(mkExportError(B.errors.canvasContext))),
                onSome: (ctx) => {
                    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0, size, size);
                        const a = globalThis.document.createElement('a');
                        a.href = canvas.toDataURL('image/png');
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(url);
                        resume(Effect.void);
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resume(Effect.fail(mkExportError(B.errors.exportFailed)));
                    };
                    img.src = url;
                },
            }),
        );
    });
const exportPng = (input: ExportInput): Effect.Effect<void, ExportError, never> =>
    pipe(
        Option.fromNullable(input.svg),
        Option.match({
            onNone: () => Effect.fail(mkExportError(B.errors.noSvg)),
            onSome: (svg) =>
                loadImageToCanvas(
                    svg,
                    input.pngSize ?? B.defaults.pngSize,
                    buildFilename(input.filename ?? '', 'png', input.variantIndex, input.variantCount),
                ),
        }),
    );
const exportSvg = (input: ExportInput): Effect.Effect<void, ExportError, never> =>
    pipe(
        Option.fromNullable(input.svg),
        Option.match({
            onNone: () => Effect.fail(mkExportError(B.errors.noSvg)),
            onSome: (svg) =>
                Effect.sync(() =>
                    downloadBlob(
                        new Blob([svg], { type: 'image/svg+xml' }),
                        buildFilename(input.filename ?? '', 'svg', input.variantIndex, input.variantCount),
                    ),
                ),
        }),
    );
const exportZip = (input: ExportInput): Effect.Effect<void, ExportError, never> =>
    pipe(
        Option.fromNullable(input.variants),
        Option.filter((v) => v.length > 0),
        Option.match({
            onNone: () => Effect.fail(mkExportError(B.errors.noVariants)),
            onSome: (variants) =>
                Effect.gen(function* () {
                    const { default: JSZip } = yield* Effect.tryPromise({
                        catch: () => mkExportError(B.errors.exportFailed),
                        try: () => import('jszip'),
                    });
                    const base = sanitizeFilename(input.filename ?? '');
                    const zip = variants.reduce(
                        (z, v, i) => z.file(`${base}_variant_${i + 1}.svg`, v.svg),
                        new JSZip(),
                    );
                    const blob = yield* Effect.tryPromise({
                        catch: () => mkExportError(B.errors.exportFailed),
                        try: () => zip.generateAsync({ type: 'blob' }),
                    });
                    downloadBlob(blob, `${base}.zip`);
                }),
        }),
    );
const writeClipboard = (text: string): Effect.Effect<void, ClipboardError, never> =>
    isClipboardAvailable()
        ? Effect.tryPromise({
              catch: () => mkClipboardError(B.errors.clipboardWrite),
              try: () => globalThis.navigator.clipboard.writeText(text),
          })
        : Effect.fail(mkClipboardError(B.errors.clipboardUnavailable));
const readClipboard = (): Effect.Effect<string, ClipboardError, never> =>
    isClipboardAvailable()
        ? Effect.tryPromise({
              catch: () => mkClipboardError(B.errors.clipboardRead),
              try: () => globalThis.navigator.clipboard.readText(),
          })
        : Effect.fail(mkClipboardError(B.errors.clipboardUnavailable));

// --- [DISPATCH_TABLES] -------------------------------------------------------

type ExportHandler = (input: ExportInput) => Effect.Effect<void, ExportError, never>;
const exportHandlers: Readonly<Record<ExportFormat, ExportHandler>> = {
    png: exportPng,
    svg: exportSvg,
    zip: exportZip,
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useClipboard = <V, R>(
    serializer: (value: V) => string = String,
    deserializer: (text: string) => V = (text) => text as V,
): ClipboardState<V> => {
    const runtime = useRuntime<R, never>();
    const [value, setValue] = useState<V | null>(null);
    const [error, setError] = useState<ClipboardError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const copy = useCallback(
        (v: V) => {
            setIsPending(true);
            setError(null);
            runtime.runFork(
                pipe(
                    writeClipboard(serializer(v)),
                    Effect.tap(() => Effect.sync(() => setValue(v))),
                    Effect.tapBoth({
                        onFailure: (e) => Effect.sync(() => setError(e)),
                        onSuccess: () => Effect.void,
                    }),
                    Effect.ensuring(Effect.sync(() => setIsPending(false))),
                ),
            );
        },
        [runtime, serializer],
    );
    const paste = useCallback(() => {
        setIsPending(true);
        setError(null);
        runtime.runFork(
            pipe(
                readClipboard(),
                Effect.tap((text) => Effect.sync(() => setValue(deserializer(text)))),
                Effect.tapBoth({
                    onFailure: (e) => Effect.sync(() => setError(e)),
                    onSuccess: () => Effect.void,
                }),
                Effect.ensuring(Effect.sync(() => setIsPending(false))),
            ),
        );
    }, [runtime, deserializer]);
    const reset = useCallback(() => {
        setValue(null);
        setError(null);
        setIsPending(false);
    }, []);
    return { copy, error, isPending, paste, reset, value };
};
const useDownload = (): DownloadState => {
    const [error, setError] = useState<DownloadError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const download = useCallback(
        (data: string | Blob, filename: string, mimeType: string = B.defaults.mimeType) =>
            globalThis.document === undefined
                ? setError(mkDownloadError(B.errors.downloadFailed))
                : executeDownload(data, filename, mimeType, setIsPending, setError),
        [],
    );
    const reset = useCallback(() => {
        setError(null);
        setIsPending(false);
    }, []);
    return { download, error, isPending, reset };
};
const useExport = <R>(): ExportState => {
    const runtime = useRuntime<R, never>();
    const [error, setError] = useState<ExportError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const exportAs = useCallback(
        (input: ExportInput) =>
            globalThis.document === undefined
                ? setError(mkExportError(B.errors.exportFailed))
                : (() => {
                      setIsPending(true);
                      setError(null);
                      runtime.runFork(
                          pipe(
                              exportHandlers[input.format](input),
                              Effect.tapBoth({
                                  onFailure: (e) => Effect.sync(() => setError(e)),
                                  onSuccess: () => Effect.void,
                              }),
                              Effect.ensuring(Effect.sync(() => setIsPending(false))),
                          ),
                      );
                  })(),
        [runtime],
    );
    const reset = useCallback(() => {
        setError(null);
        setIsPending(false);
    }, []);
    return { error, exportAs, isPending, reset };
};

// --- [EXPORT] ----------------------------------------------------------------

export type {
    BrowserError,
    ClipboardError,
    ClipboardState,
    DownloadError,
    DownloadState,
    ExportError,
    ExportFormat,
    ExportInput,
    ExportState,
    ExportVariant,
};
export {
    B as BROWSER_TUNING,
    buildFilename,
    exportHandlers,
    isClipboardAvailable,
    mkClipboardError,
    mkDownloadError,
    mkExportError,
    sanitizeFilename,
    useClipboard,
    useDownload,
    useExport,
};
