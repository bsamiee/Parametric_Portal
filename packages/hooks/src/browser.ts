/**
 * Bridge browser APIs with React state via Effect-wrapped operations.
 * Provides useClipboard (copy/paste), useDownload (file download), and useExport (SVG/PNG/ZIP) hooks.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime.tsx';

// --- [TYPES] -----------------------------------------------------------------

// biome-ignore lint/style/useNamingConvention: _tag is standard Effect discriminated union convention
type ClipboardError = { readonly _tag: 'ClipboardError'; readonly message: string };
// biome-ignore lint/style/useNamingConvention: _tag is standard Effect discriminated union convention
type DownloadError = { readonly _tag: 'DownloadError'; readonly message: string };
// biome-ignore lint/style/useNamingConvention: _tag is standard Effect discriminated union convention
type ExportError = { readonly _tag: 'ExportError'; readonly message: string };
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
type StateSetter<A, E> = React.Dispatch<React.SetStateAction<AsyncState<A, E>>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        mimeType: 'text/plain',
        pngSize: 512,
        timestamp: ASYNC_TUNING.timestamp,
    },
    errors: {
        canvasContext: 'Failed to get canvas 2D context',
        clipboardRead: 'Failed to read from clipboard',
        clipboardUnavailable: 'Clipboard API not available',
        clipboardWrite: 'Failed to write to clipboard',
        downloadFailed: 'Download failed',
        exportFailed: 'Export failed',
        noSvg: 'No SVG content to export',
        noVariants: 'No variants to export',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isClipboardAvailable = (): boolean => globalThis.navigator?.clipboard !== undefined;
const mkClipboardError = (message: string): ClipboardError => ({ _tag: 'ClipboardError', message });
const mkDownloadError = (message: string): DownloadError => ({ _tag: 'DownloadError', message });
const mkExportError = (message: string): ExportError => ({ _tag: 'ExportError', message });

const interruptFiber =
    <A, E, R>(
        runtime: { runPromise: (effect: Effect.Effect<unknown, unknown, R>) => Promise<unknown> },
        fiber: Fiber.RuntimeFiber<A, E>,
    ) =>
    () =>
        void runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});

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

const onSuccess =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (data: A) =>
        Effect.sync(() => setState(mkSuccess(data, ts)));

const onFailure =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (error: E) =>
        Effect.sync(() => setState(mkFailure(error, ts)));

const createCopyEffect = <V>(
    value: V,
    serializer: (v: V) => string,
    setState: StateSetter<V, ClipboardError>,
    ts: () => number,
) =>
    Effect.tryPromise({
        catch: () => mkClipboardError(B.errors.clipboardWrite),
        try: () => globalThis.navigator.clipboard.writeText(serializer(value)),
    }).pipe(
        Effect.flatMap(() => onSuccess<V, ClipboardError>(setState, ts)(value)),
        Effect.catchAll(onFailure<V, ClipboardError>(setState, ts)),
    );

const createPasteEffect = <V>(
    deserializer: (text: string) => V,
    setState: StateSetter<V, ClipboardError>,
    ts: () => number,
) =>
    Effect.tryPromise({
        catch: () => mkClipboardError(B.errors.clipboardRead),
        try: () => globalThis.navigator.clipboard.readText(),
    }).pipe(
        Effect.flatMap((text) => {
            const value = deserializer(text);
            return onSuccess<V, ClipboardError>(setState, ts)(value);
        }),
        Effect.catchAll(onFailure<V, ClipboardError>(setState, ts)),
    );

const createDownloadEffect = (
    data: string | Blob,
    filename: string,
    mimeType: string,
    setState: StateSetter<void, DownloadError>,
    ts: () => number,
) =>
    Effect.try({
        catch: () => mkDownloadError(B.errors.downloadFailed),
        try: () => {
            const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;
            const url = URL.createObjectURL(blob);
            const link = globalThis.document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
        },
    }).pipe(Effect.flatMap(() => onSuccess<void, DownloadError>(setState, ts)(undefined)));

// --- [DISPATCH_TABLES] -------------------------------------------------------

const exportSvg = (svg: string, filename: string): Effect.Effect<void, ExportError, never> =>
    Effect.try({
        catch: () => mkExportError(B.errors.exportFailed),
        try: () => {
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            downloadBlob(blob, filename);
        },
    });

const exportPng = (svg: string, size: number, filename: string): Effect.Effect<void, ExportError, never> =>
    Effect.async<void, ExportError>((resume) => {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            resume(Effect.fail(mkExportError(B.errors.canvasContext)));
            return;
        }
        const img = new Image();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            ctx.drawImage(img, 0, 0, size, size);
            const pngUrl = canvas.toDataURL('image/png');
            const a = globalThis.document.createElement('a');
            a.href = pngUrl;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            resume(Effect.succeed(undefined));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resume(Effect.fail(mkExportError(B.errors.exportFailed)));
        };
        img.src = url;
    });

const exportZip = (
    variants: ReadonlyArray<ExportVariant>,
    baseFilename: string,
): Effect.Effect<void, ExportError, never> =>
    Effect.tryPromise({
        catch: () => mkExportError(B.errors.exportFailed),
        try: async () => {
            const { default: JSZip } = await import('jszip');
            const zip = new JSZip();
            const base = sanitizeFilename(baseFilename);
            variants.forEach((v, i) => {
                zip.file(`${base}_variant_${i + 1}.svg`, v.svg);
            });
            const blob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(blob, `${base}.zip`);
        },
    });

type ExportHandler = (input: ExportInput) => Effect.Effect<void, ExportError, never>;

const exportHandlers: Readonly<Record<ExportFormat, ExportHandler>> = {
    png: (input) =>
        input.svg
            ? exportPng(
                  input.svg,
                  input.pngSize ?? B.defaults.pngSize,
                  buildFilename(input.filename ?? '', 'png', input.variantIndex, input.variantCount),
              )
            : Effect.fail(mkExportError(B.errors.noSvg)),
    svg: (input) =>
        input.svg
            ? exportSvg(input.svg, buildFilename(input.filename ?? '', 'svg', input.variantIndex, input.variantCount))
            : Effect.fail(mkExportError(B.errors.noSvg)),
    zip: (input) =>
        input.variants && input.variants.length > 0
            ? exportZip(input.variants, input.filename ?? '')
            : Effect.fail(mkExportError(B.errors.noVariants)),
};

const createExportEffect = (input: ExportInput, setState: StateSetter<void, ExportError>, ts: () => number) =>
    exportHandlers[input.format](input).pipe(
        Effect.flatMap(() => onSuccess<void, ExportError>(setState, ts)(undefined)),
        Effect.catchAll(onFailure<void, ExportError>(setState, ts)),
    );

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
                fiberRef.current = runtime.runFork(createCopyEffect(value, serializer, setState, ts));
            },
            [runtime, serializer],
        );

        const paste = useCallback(() => {
            if (!isClipboardAvailable()) {
                setState(mkFailure(mkClipboardError(B.errors.clipboardUnavailable), ts));
                return;
            }
            setState(mkLoading(ts));
            fiberRef.current = runtime.runFork(createPasteEffect(deserializer, setState, ts));
        }, [runtime, deserializer]);

        const reset = useCallback(() => {
            fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(() => {
            const fiber = fiberRef.current;
            const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
            return cleanup;
        }, [runtime]);

        return { copy, paste, reset, state };
    };

    const useDownload = (): DownloadState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<void, DownloadError>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const download = useCallback(
            (data: string | Blob, filename: string, mimeType: string = B.defaults.mimeType) => {
                // SSR guard
                if (globalThis.document === undefined) {
                    setState(mkFailure(mkDownloadError(B.errors.downloadFailed), ts));
                    return;
                }
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(createDownloadEffect(data, filename, mimeType, setState, ts));
            },
            [runtime],
        );

        const reset = useCallback(() => {
            fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(() => {
            const fiber = fiberRef.current;
            const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
            return cleanup;
        }, [runtime]);

        return { download, reset, state };
    };

    const useExport = (): ExportState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<void, ExportError>>(mkIdle);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const exportAs = useCallback(
            (input: ExportInput) => {
                // SSR guard
                if (globalThis.document === undefined) {
                    setState(mkFailure(mkExportError(B.errors.exportFailed), ts));
                    return;
                }
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(createExportEffect(input, setState, ts));
            },
            [runtime],
        );

        const reset = useCallback(() => {
            fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            fiberRef.current = null;
            setState(mkIdle());
        }, [runtime]);

        useEffect(() => {
            const fiber = fiberRef.current;
            const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
            return cleanup;
        }, [runtime]);

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
