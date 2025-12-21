/**
 * Bridge file browser APIs with React state via Effect-wrapped operations.
 * Provides useFileInput (file picker) and useFileDrop (drag-drop) hooks.
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkIdle, mkLoading, mkSuccess } from '@parametric-portal/types/async';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime.tsx';

// --- [TYPES] -----------------------------------------------------------------

// biome-ignore lint/style/useNamingConvention: _tag is standard Effect discriminated union convention
type FileError = { readonly _tag: 'FileError'; readonly message: string };

type FileInputState = {
    readonly accept: () => void;
    readonly files: ReadonlyArray<File>;
    readonly reset: () => void;
    readonly state: AsyncState<ReadonlyArray<File>, FileError>;
};

type FileDropState = {
    readonly isDragOver: boolean;
    readonly props: {
        readonly onDragLeave: (e: React.DragEvent) => void;
        readonly onDragOver: (e: React.DragEvent) => void;
        readonly onDrop: (e: React.DragEvent) => void;
    };
    readonly state: AsyncState<ReadonlyArray<File>, FileError>;
};

type FileInputOptions = {
    readonly accept?: string;
    readonly multiple?: boolean;
};

type FileHooksApi<_R> = {
    readonly useFileDrop: () => FileDropState;
    readonly useFileInput: (options?: FileInputOptions) => FileInputState;
};

type FileHooksConfig = {
    readonly timestampProvider?: () => number;
};

type StateSetter<A, E> = React.Dispatch<React.SetStateAction<AsyncState<A, E>>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        accept: '*/*',
        multiple: false,
        timestamp: ASYNC_TUNING.timestamp,
    },
    errors: {
        noFiles: 'No files selected',
        readFailed: 'Failed to read file',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFileError = (message: string): FileError => ({ _tag: 'FileError', message });

const interruptFiber =
    <A, E, R>(
        runtime: { runPromise: (effect: Effect.Effect<unknown, unknown, R>) => Promise<unknown> },
        fiber: Fiber.RuntimeFiber<A, E>,
    ) =>
    () =>
        void runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});

const filesToReadonlyArray = (fileList: FileList | null): ReadonlyArray<File> => (fileList ? Array.from(fileList) : []);

const dataTransferToFiles = (dataTransfer: DataTransfer | null): ReadonlyArray<File> =>
    dataTransfer ? Array.from(dataTransfer.files) : [];

const readFileAsText = (file: File): Effect.Effect<string, FileError, never> =>
    Effect.tryPromise({
        catch: () => mkFileError(B.errors.readFailed),
        try: () => file.text(),
    });

const readFileAsDataUrl = (file: File): Effect.Effect<string, FileError, never> =>
    Effect.async((resume) => {
        const reader = new FileReader();
        reader.onload = () => resume(Effect.succeed(reader.result as string));
        reader.onerror = () => resume(Effect.fail(mkFileError(B.errors.readFailed)));
        reader.readAsDataURL(file);
    });

const readFileAsArrayBuffer = (file: File): Effect.Effect<ArrayBuffer, FileError, never> =>
    Effect.tryPromise({
        catch: () => mkFileError(B.errors.readFailed),
        try: () => file.arrayBuffer(),
    });

const onSuccess =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (data: A) =>
        Effect.sync(() => setState(mkSuccess(data, ts)));

const onFailure =
    <A, E>(setState: StateSetter<A, E>, ts: () => number) =>
    (error: E) =>
        Effect.sync(() => setState(mkFailure(error, ts)));

const createFileSelectionEffect = (
    files: ReadonlyArray<File>,
    setState: StateSetter<ReadonlyArray<File>, FileError>,
    ts: () => number,
): Effect.Effect<void, never, never> =>
    files.length > 0
        ? onSuccess<ReadonlyArray<File>, FileError>(setState, ts)(files).pipe(Effect.asVoid)
        : onFailure<ReadonlyArray<File>, FileError>(setState, ts)(mkFileError(B.errors.noFiles)).pipe(Effect.asVoid);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createFileHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: FileHooksConfig = {}): FileHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useFileInput = (options: FileInputOptions = {}): FileInputState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(mkIdle);
        const [files, setFiles] = useState<ReadonlyArray<File>>([]);
        const inputRef = useRef<HTMLInputElement | null>(null);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const resolvedAccept = options.accept ?? B.defaults.accept;
        const resolvedMultiple = options.multiple ?? B.defaults.multiple;

        useEffect(() => {
            const input = globalThis.document?.createElement('input');
            if (input) {
                input.type = 'file';
                input.accept = resolvedAccept;
                input.multiple = resolvedMultiple;
                input.style.display = 'none';
            }
            inputRef.current = input ?? null;

            const handleChange = () => {
                const selectedFiles = filesToReadonlyArray(inputRef.current?.files ?? null);
                setFiles(selectedFiles);
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(createFileSelectionEffect(selectedFiles, setState, ts));
            };

            input?.addEventListener('change', handleChange);
            globalThis.document?.body.appendChild(input);

            const fiber = fiberRef.current;
            const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
            return () => {
                input?.removeEventListener('change', handleChange);
                input?.remove();
                cleanup?.();
            };
        }, [runtime, resolvedAccept, resolvedMultiple]);

        const accept = useCallback(() => {
            inputRef.current?.click();
        }, []);

        const reset = useCallback(() => {
            fiberRef.current && runtime.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {});
            fiberRef.current = null;
            if (inputRef.current) {
                inputRef.current.value = '';
            }
            setFiles([]);
            setState(mkIdle());
        }, [runtime]);

        return { accept, files, reset, state };
    };

    const useFileDrop = (): FileDropState => {
        const runtime = useRuntime();
        const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(mkIdle);
        const [isDragOver, setIsDragOver] = useState(false);
        const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);

        const onDragOver = useCallback((e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(true);
        }, []);

        const onDragLeave = useCallback((e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
        }, []);

        const onDrop = useCallback(
            (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(false);

                const droppedFiles = dataTransferToFiles(e.dataTransfer);
                setState(mkLoading(ts));
                fiberRef.current = runtime.runFork(createFileSelectionEffect(droppedFiles, setState, ts));
            },
            [runtime],
        );

        useEffect(() => {
            const fiber = fiberRef.current;
            const cleanup = fiber === null ? undefined : interruptFiber(runtime, fiber);
            return cleanup;
        }, [runtime]);

        return {
            isDragOver,
            props: { onDragLeave, onDragOver, onDrop },
            state,
        };
    };

    return Object.freeze({
        useFileDrop,
        useFileInput,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FileDropState, FileError, FileHooksApi, FileHooksConfig, FileInputOptions, FileInputState };
export {
    B as FILE_HOOKS_TUNING,
    createFileHooks,
    dataTransferToFiles,
    filesToReadonlyArray,
    mkFileError,
    readFileAsArrayBuffer,
    readFileAsDataUrl,
    readFileAsText,
};
