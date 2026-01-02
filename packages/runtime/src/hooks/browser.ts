/**
 * Browser API hooks consuming Effect services.
 * Thin wrappers over @effect/platform-browser Clipboard + custom services.
 */
import { Clipboard } from '@effect/platform-browser';
import { BROWSER_TUNING as B, BrowserError } from '@parametric-portal/types/browser';
import { Effect } from 'effect';
import { useCallback, useState } from 'react';
import { useRuntime } from '../runtime';
import { Download, Export, type ExportInput } from '../services/browser';

// --- [TYPES] -----------------------------------------------------------------

type ClipboardState<V> = {
    readonly copy: (value: V) => void;
    readonly error: BrowserError | null;
    readonly isPending: boolean;
    readonly paste: () => void;
    readonly reset: () => void;
    readonly value: V | null;
};
type DownloadState = {
    readonly download: (data: Blob | string, filename: string, mimeType?: string) => void;
    readonly error: BrowserError | null;
    readonly isPending: boolean;
    readonly reset: () => void;
};
type ExportState = {
    readonly error: BrowserError | null;
    readonly exportAs: (input: ExportInput) => void;
    readonly isPending: boolean;
    readonly progress: number;
    readonly reset: () => void;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clipboardWriteError = (e: Clipboard.ClipboardError): BrowserError =>
    BrowserError.Clipboard({ code: B.errors.clipboardWrite.code, message: e.message });
const clipboardReadError = (e: Clipboard.ClipboardError): BrowserError =>
    BrowserError.Clipboard({ code: B.errors.clipboardRead.code, message: e.message });

// --- [ENTRY_POINT] -----------------------------------------------------------

const useClipboard = <V>(
    serializer: (value: V) => string = String,
    deserializer: (text: string) => V = (text) => text as V,
): ClipboardState<V> => {
    const runtime = useRuntime<Clipboard.Clipboard, never>();
    const [value, setValue] = useState<V | null>(null);
    const [error, setError] = useState<BrowserError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const copy = useCallback(
        (v: V) => {
            setIsPending(true);
            setError(null);
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Clipboard.Clipboard;
                    yield* svc.writeString(serializer(v));
                    setValue(v);
                }).pipe(
                    Effect.tapError((e) => Effect.sync(() => setError(clipboardWriteError(e)))),
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
            Effect.gen(function* () {
                const svc = yield* Clipboard.Clipboard;
                const text = yield* svc.readString;
                setValue(deserializer(text));
            }).pipe(
                Effect.tapError((e) => Effect.sync(() => setError(clipboardReadError(e)))),
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
    const runtime = useRuntime<Download, never>();
    const [error, setError] = useState<BrowserError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const download = useCallback(
        (data: Blob | string, filename: string, mimeType: string = B.defaults.mimeType) => {
            setIsPending(true);
            setError(null);
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Download;
                    yield* svc.download(data, filename, mimeType);
                }).pipe(
                    Effect.tapError(() => Effect.sync(() => setError(BrowserError.Download(B.errors.downloadFailed)))),
                    Effect.ensuring(Effect.sync(() => setIsPending(false))),
                ),
            );
        },
        [runtime],
    );
    const reset = useCallback(() => {
        setError(null);
        setIsPending(false);
    }, []);
    return { download, error, isPending, reset };
};
const useExport = (): ExportState => {
    const runtime = useRuntime<Export, never>();
    const [error, setError] = useState<BrowserError | null>(null);
    const [isPending, setIsPending] = useState(false);
    const [progress, setProgress] = useState(0);
    const exportAs = useCallback(
        (input: ExportInput) => {
            setIsPending(true);
            setError(null);
            setProgress(0);
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Export;
                    yield* svc[input.format]({ ...input, onProgress: setProgress });
                    setProgress(1);
                }).pipe(
                    Effect.tapError((e) => Effect.sync(() => setError(e))),
                    Effect.ensuring(Effect.sync(() => setIsPending(false))),
                ),
            );
        },
        [runtime],
    );
    const reset = useCallback(() => {
        setError(null);
        setIsPending(false);
        setProgress(0);
    }, []);
    return { error, exportAs, isPending, progress, reset };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ClipboardState, DownloadState, ExportState };
export { useClipboard, useDownload, useExport };
