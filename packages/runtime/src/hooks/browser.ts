/**
 * Browser API hooks with Effect error handling and AsyncState lifecycle.
 */
import { Clipboard } from '@effect/platform-browser';
import { AppError } from '@parametric-portal/types/app-error';
import { AsyncState } from '@parametric-portal/types/async';
import { Effect, Option } from 'effect';
import { useCallback, useState } from 'react';
import { Runtime } from '../runtime';
import { Browser, type ExportInput } from '../services/browser';

// --- [TYPES] -----------------------------------------------------------------

type ClipboardState<V> = {
    readonly copy: (value: V) => void;
    readonly error: AppError.Browser | null;
    readonly isPending: boolean;
    readonly paste: () => void;
    readonly reset: () => void;
    readonly state: AsyncState.Of<V, AppError.Browser>;
    readonly value: V | null;
};
type DownloadState = {
    readonly download: (data: Blob | string, filename: string, mimeType?: string) => void;
    readonly error: AppError.Browser | null;
    readonly isPending: boolean;
    readonly reset: () => void;
    readonly state: AsyncState.Of<void, AppError.Browser>;
};
type ExportState = {
    readonly error: AppError.Browser | null;
    readonly exportAs: (input: ExportInput) => void;
    readonly isPending: boolean;
    readonly progress: number;
    readonly reset: () => void;
    readonly state: AsyncState.Of<void, AppError.Browser>;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const clipboardWriteError = (e: Clipboard.ClipboardError): AppError.Browser =>
    AppError.browser('CLIPBOARD_WRITE', undefined, e);
const clipboardReadError = (e: Clipboard.ClipboardError): AppError.Browser =>
    AppError.browser('CLIPBOARD_READ', undefined, e);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useClipboard = <V>(
    serializer: (value: V) => string = String,
    deserializer: (text: string) => V = (text) => text as V,
): ClipboardState<V> => {
    const runtime = Runtime.use<Clipboard.Clipboard, never>();
    const [state, setState] = useState<AsyncState.Of<V, AppError.Browser>>(AsyncState.idle());
    const copy = useCallback(
        (v: V) => {
            setState(AsyncState.loading());
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Clipboard.Clipboard;
                    yield* svc.writeString(serializer(v));
                    return v;
                }).pipe(
                    Effect.tap((data) => Effect.sync(() => setState(AsyncState.success(data)))),
                    Effect.tapError((e) => Effect.sync(() => setState(AsyncState.failure(clipboardWriteError(e))))),
                ),
            );
        },
        [runtime, serializer],
    );
    const paste = useCallback(() => {
        setState(AsyncState.loading());
        runtime.runFork(
            Effect.gen(function* () {
                const svc = yield* Clipboard.Clipboard;
                const text = yield* svc.readString;
                return deserializer(text);
            }).pipe(
                Effect.tap((data) => Effect.sync(() => setState(AsyncState.success(data)))),
                Effect.tapError((e) => Effect.sync(() => setState(AsyncState.failure(clipboardReadError(e))))),
            ),
        );
    }, [runtime, deserializer]);
    const reset = useCallback(() => setState(AsyncState.idle()), []);
    return {
        copy,
        error: Option.getOrNull(AsyncState.getError(state)),
        isPending: AsyncState.$is('Loading')(state),
        paste,
        reset,
        state,
        value: Option.getOrNull(AsyncState.getData(state)),
    };
};
const useDownload = (): DownloadState => {
    const runtime = Runtime.use<Browser, never>();
    const [state, setState] = useState<AsyncState.Of<void, AppError.Browser>>(AsyncState.idle());
    const download = useCallback(
        (data: Blob | string, filename: string, mimeType?: string) => {
            setState(AsyncState.loading());
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Browser;
                    yield* svc.download(data, filename, mimeType);
                }).pipe(
                    Effect.tap(() => Effect.sync(() => setState(AsyncState.success(undefined)))),
                    Effect.tapError((e) =>
                        Effect.sync(() =>
                            setState(AsyncState.failure(AppError.browser('DOWNLOAD_FAILED', undefined, e))),
                        ),
                    ),
                ),
            );
        },
        [runtime],
    );
    const reset = useCallback(() => setState(AsyncState.idle()), []);
    return {
        download,
        error: Option.getOrNull(AsyncState.getError(state)),
        isPending: AsyncState.$is('Loading')(state),
        reset,
        state,
    };
};
const useExport = (): ExportState => {
    const runtime = Runtime.use<Browser, never>();
    const [state, setState] = useState<AsyncState.Of<void, AppError.Browser>>(AsyncState.idle());
    const [progress, setProgress] = useState(0);
    const exportAs = useCallback(
        (input: ExportInput) => {
            setState(AsyncState.loading());
            setProgress(0);
            runtime.runFork(
                Effect.gen(function* () {
                    const svc = yield* Browser;
                    yield* svc.export({ ...input, onProgress: (p) => setProgress(p * 100) });
                    setProgress(100);
                }).pipe(
                    Effect.tap(() => Effect.sync(() => setState(AsyncState.success(undefined)))),
                    Effect.tapError((e) => Effect.sync(() => setState(AsyncState.failure(e)))),
                ),
            );
        },
        [runtime],
    );
    const reset = useCallback(() => {
        setState(AsyncState.idle());
        setProgress(0);
    }, []);
    return {
        error: Option.getOrNull(AsyncState.getError(state)),
        exportAs,
        isPending: AsyncState.$is('Loading')(state),
        progress,
        reset,
        state,
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ClipboardState, DownloadState, ExportState };
export { useClipboard, useDownload, useExport };
