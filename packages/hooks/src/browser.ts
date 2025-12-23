/**
 * Bridge browser APIs with React state via Effect-wrapped operations.
 * Provides useClipboard (copy/paste), useDownload (file download), and useExport (SVG/PNG/ZIP) hooks.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

// biome-ignore lint/style/useNamingConvention: _tag is standard Effect discriminated union convention
type BrowserError<Tag extends string> = { readonly _tag: Tag; readonly code: string; readonly message: string };
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
    readonly variantIndex?: number;
    readonly variantCount?: number;
    readonly variants?: ReadonlyArray<ExportVariant>;
};
type ClipboardState<V> = {
    readonly copy: (value: V) => void;
    readonly paste: () => void;
    readonly reset: () => void;
    readonly state: AsyncState<V, ClipboardError>;
};
type DownloadState = {
    readonly download: (data: string | Blob, filename: string, mimeType?: string) => void;
    readonly reset: () => void;
    readonly state: AsyncState<void, DownloadError>;
};
type ExportState = {
    readonly exportAs: (input: ExportInput) => void;
    readonly reset: () => void;
    readonly state: AsyncState<void, ExportError>;
};
type BrowserHooksApi<_R> = {
    readonly useClipboard: <V>(
        serializer?: (value: V) => string,
        deserializer?: (text: string) => V,
    ) => ClipboardState<V>;
    readonly useDownload: () => DownloadState;
    readonly useExport: () => ExportState;
};
type BrowserHooksConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        mimeType: 'text/plain',
        pngSize: 512,
        timestamp: ASYNC_TUNING.timestamp,
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

type ErrorDef = { readonly code: string; readonly message: string };
const isClipboardAvailable = (): boolean => globalThis.navigator?.clipboard !== undefined;
const mkBrowserError =
    <Tag extends string>(tag: Tag) =>
    (err: ErrorDef): BrowserError<Tag> => ({ _tag: tag, code: err.code, message: err.message });
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

const clipboardWrite = (text: string): Effect.Effect<void, ClipboardError, never> =>
    Effect.tryPromise({
        catch: () => mkClipboardError(B.errors.clipboardWrite),
        try: () => globalThis.navigator.clipboard.writeText(text),
    });

const clipboardRead = (): Effect.Effect<string, ClipboardError, never> =>
    Effect.tryPromise({
        catch: () => mkClipboardError(B.errors.clipboardRead),
        try: () => globalThis.navigator.clipboard.readText(),
    });

const downloadEffect = (blob: Blob, filename: string): Effect.Effect<void, DownloadError, never> =>
    Effect.try({ catch: () => mkDownloadError(B.errors.downloadFailed), try: () => downloadBlob(blob, filename) });

// --- [DISPATCH_TABLES] -------------------------------------------------------

type ExportHandler = (input: ExportInput) => Effect.Effect<void, ExportError, never>;

const exportHandlers: Readonly<Record<ExportFormat, ExportHandler>> = {
    png: (input) =>
        input.svg
            ? Effect.async<void, ExportError>((resume) => {
                  const size = input.pngSize ?? B.defaults.pngSize;
                  const canvas = globalThis.document.createElement('canvas');
                  canvas.width = size;
                  canvas.height = size;
                  const ctx = canvas.getContext('2d');
                  ctx === null
                      ? resume(Effect.fail(mkExportError(B.errors.canvasContext)))
                      : ((img: HTMLImageElement, url: string) => {
                            img.onload = () => {
                                ctx.drawImage(img, 0, 0, size, size);
                                const pngUrl = canvas.toDataURL('image/png');
                                const a = globalThis.document.createElement('a');
                                a.href = pngUrl;
                                a.download = buildFilename(
                                    input.filename ?? '',
                                    'png',
                                    input.variantIndex,
                                    input.variantCount,
                                );
                                a.click();
                                URL.revokeObjectURL(url);
                                resume(Effect.succeed(undefined));
                            };
                            img.onerror = () => {
                                URL.revokeObjectURL(url);
                                resume(Effect.fail(mkExportError(B.errors.exportFailed)));
                            };
                            img.src = url;
                        })(
                            new Image(),
                            URL.createObjectURL(new Blob([input.svg as string], { type: 'image/svg+xml' })),
                        );
              })
            : Effect.fail(mkExportError(B.errors.noSvg)),
    svg: (input) =>
        input.svg
            ? Effect.try({
                  catch: () => mkExportError(B.errors.exportFailed),
                  try: () => {
                      const blob = new Blob([input.svg as string], { type: 'image/svg+xml' });
                      downloadBlob(
                          blob,
                          buildFilename(input.filename ?? '', 'svg', input.variantIndex, input.variantCount),
                      );
                  },
              })
            : Effect.fail(mkExportError(B.errors.noSvg)),
    zip: (input) =>
        input.variants && input.variants.length > 0
            ? Effect.tryPromise({
                  catch: () => mkExportError(B.errors.exportFailed),
                  try: async () => {
                      const { default: JSZip } = await import('jszip');
                      const zip = new JSZip();
                      const base = sanitizeFilename(input.filename ?? '');
                      (input.variants as ReadonlyArray<ExportVariant>).map((v, i) =>
                          zip.file(`${base}_variant_${i + 1}.svg`, v.svg),
                      );
                      const blob = await zip.generateAsync({ type: 'blob' });
                      downloadBlob(blob, `${base}.zip`);
                  },
              })
            : Effect.fail(mkExportError(B.errors.noVariants)),
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createBrowserHooks = <R, E>(
    runtimeApi: RuntimeApi<R, E>,
    config: BrowserHooksConfig = {},
): BrowserHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useClipboard = <V>(
        serializer: (value: V) => string = String,
        deserializer: (text: string) => V = (text) => text as V,
    ): ClipboardState<V> => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<V, ClipboardError>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const copy = useCallback(
            (value: V) => {
                if (!isClipboardAvailable()) {
                    setState(mkFailure(mkClipboardError(B.errors.clipboardUnavailable), ts));
                    return;
                }
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(
                    Effect.gen(function* () {
                        yield* clipboardWrite(serializer(value));
                        setState(mkSuccess(value, ts));
                        return value;
                    }).pipe(
                        Effect.catchAll((error: ClipboardError) => {
                            setState(mkFailure(error, ts));
                            return Effect.void;
                        }),
                    ),
                );
            },
            [runtime, serializer],
        );

        const paste = useCallback(() => {
            if (!isClipboardAvailable()) {
                setState(mkFailure(mkClipboardError(B.errors.clipboardUnavailable), ts));
                return;
            }
            setState(mkLoading(ts));
            fiberRef.current = runtime.runFork(
                Effect.gen(function* () {
                    const text = yield* clipboardRead();
                    const data = deserializer(text);
                    setState(mkSuccess(data, ts));
                    return data;
                }).pipe(
                    Effect.catchAll((error: ClipboardError) => {
                        setState(mkFailure(error, ts));
                        return Effect.void;
                    }),
                ),
            );
        }, [runtime, deserializer]);

        const reset = useCallback(() => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(
            () =>
                fiberRef.current === null
                    ? undefined
                    : () => {
                          runtime.runFork(Fiber.interrupt(fiberRef.current as Fiber.RuntimeFiber<unknown, unknown>));
                      },
            [runtime],
        );

        return { copy, paste, reset, state };
    };

    const useDownload = (): DownloadState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<void, DownloadError>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const download = useCallback(
            (data: string | Blob, filename: string, mimeType: string = B.defaults.mimeType) => {
                if (globalThis.document === undefined) {
                    setState(mkFailure(mkDownloadError(B.errors.downloadFailed), ts));
                    return;
                }
                setState(mkLoading(ts));
                const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
                fiberRef.current = runtime.runFork(
                    Effect.gen(function* () {
                        yield* downloadEffect(blob, filename);
                        setState(mkSuccess(undefined, ts));
                    }).pipe(
                        Effect.catchAll((error: DownloadError) => {
                            setState(mkFailure(error, ts));
                            return Effect.void;
                        }),
                    ),
                );
            },
            [runtime],
        );

        const reset = useCallback(() => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(
            () =>
                fiberRef.current === null
                    ? undefined
                    : () => {
                          runtime.runFork(Fiber.interrupt(fiberRef.current as Fiber.RuntimeFiber<unknown, unknown>));
                      },
            [runtime],
        );

        return { download, reset, state };
    };

    const useExport = (): ExportState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<void, ExportError>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const exportAs = useCallback(
            (input: ExportInput) => {
                if (globalThis.document === undefined) {
                    setState(mkFailure(mkExportError(B.errors.exportFailed), ts));
                    return;
                }
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(
                    Effect.gen(function* () {
                        yield* exportHandlers[input.format](input);
                        setState(mkSuccess(undefined, ts));
                    }).pipe(
                        Effect.catchAll((error: ExportError) => {
                            setState(mkFailure(error, ts));
                            return Effect.void;
                        }),
                    ),
                );
            },
            [runtime],
        );

        const reset = useCallback(() => {
            fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(
            () =>
                fiberRef.current === null
                    ? undefined
                    : () => {
                          runtime.runFork(Fiber.interrupt(fiberRef.current as Fiber.RuntimeFiber<unknown, unknown>));
                      },
            [runtime],
        );

        return { exportAs, reset, state };
    };

    return Object.freeze({
        useClipboard,
        useDownload,
        useExport,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type {
    BrowserError,
    BrowserHooksApi,
    BrowserHooksConfig,
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
    B as BROWSER_HOOKS_TUNING,
    buildFilename,
    createBrowserHooks,
    exportHandlers,
    isClipboardAvailable,
    mkClipboardError,
    mkDownloadError,
    mkExportError,
    sanitizeFilename,
};
