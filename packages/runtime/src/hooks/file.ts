/**
 * Bridge file browser APIs with React state via Effect-wrapped operations.
 */
import { type AsyncState, async } from '@parametric-portal/types/async';
import { type FileError, files } from '@parametric-portal/types/files';
import { Effect, Fiber } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

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
type StateSetter<A, E> = React.Dispatch<React.SetStateAction<AsyncState<A, E>>>;

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();
const filesApi = files();

const B = Object.freeze({
    defaults: {
        accept: '*/*',
        multiple: false,
    },
    errors: {
        empty: { code: 'FILE_EMPTY', message: 'No files selected' },
        readFailed: { code: 'READ_FAILED', message: 'Failed to read file' },
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const interruptFiber =
    <A, E, R>(
        runtime: { runFork: (effect: Effect.Effect<unknown, unknown, R>) => Fiber.RuntimeFiber<unknown, unknown> },
        fiber: Fiber.RuntimeFiber<A, E>,
    ) =>
    () => {
        runtime.runFork(Fiber.interrupt(fiber));
    };

const FileOps = Object.freeze({
    fromDataTransfer: (dataTransfer: DataTransfer | null): ReadonlyArray<File> =>
        dataTransfer ? Array.from(dataTransfer.files) : [],
    fromFileList: (fileList: FileList | null): ReadonlyArray<File> => (fileList ? Array.from(fileList) : []),
    readAsArrayBuffer: (file: File): Effect.Effect<ArrayBuffer, FileError, never> =>
        Effect.tryPromise({
            catch: () => filesApi.mkFileError(B.errors.readFailed.code, B.errors.readFailed.message),
            try: () => file.arrayBuffer(),
        }),
    readAsDataUrl: (file: File): Effect.Effect<string, FileError, never> =>
        Effect.async((resume) => {
            const reader = new FileReader();
            reader.onload = () => resume(Effect.succeed(reader.result as string));
            reader.onerror = () =>
                resume(Effect.fail(filesApi.mkFileError(B.errors.readFailed.code, B.errors.readFailed.message)));
            reader.readAsDataURL(file);
        }),
    text: (file: File): Effect.Effect<string, FileError, never> =>
        Effect.tryPromise({
            catch: () => filesApi.mkFileError(B.errors.readFailed.code, B.errors.readFailed.message),
            try: () => file.text(),
        }),
});

const StateCallbacks = Object.freeze({
    onFailure:
        <A, E>(setState: StateSetter<A, E>) =>
        (error: E) =>
            Effect.sync(() => setState(asyncApi.failure(error))),
    onSuccess:
        <A, E>(setState: StateSetter<A, E>) =>
        (data: A) =>
            Effect.sync(() => setState(asyncApi.success(data))),
});

const createFileSelectionEffect = (
    files: ReadonlyArray<File>,
    setState: StateSetter<ReadonlyArray<File>, FileError>,
): Effect.Effect<void, never, never> =>
    files.length > 0
        ? StateCallbacks.onSuccess<ReadonlyArray<File>, FileError>(setState)(files).pipe(Effect.asVoid)
        : StateCallbacks.onFailure<ReadonlyArray<File>, FileError>(setState)(
              filesApi.mkFileError(B.errors.empty.code, B.errors.empty.message),
          ).pipe(Effect.asVoid);

// --- [HOOKS] -----------------------------------------------------------------

const useFileInput = <R>(options: FileInputOptions = {}): FileInputState => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(asyncApi.idle);
    const [files, setFiles] = useState<ReadonlyArray<File>>([]);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const fiberRef = useRef<Fiber.RuntimeFiber<unknown, unknown> | null>(null);
    const resolvedAccept = options.accept ?? B.defaults.accept;
    const resolvedMultiple = options.multiple ?? B.defaults.multiple;
    useEffect(() => {
        const input = globalThis.document?.createElement('input');
        input &&
            Object.assign(input, {
                accept: resolvedAccept,
                multiple: resolvedMultiple,
                style: { display: 'none' },
                type: 'file',
            });
        inputRef.current = input ?? null;
        const handleChange = () => {
            const selectedFiles = FileOps.fromFileList(inputRef.current?.files ?? null);
            setFiles(selectedFiles);
            setState(asyncApi.loading());
            fiberRef.current = runtime.runFork(createFileSelectionEffect(selectedFiles, setState));
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
        fiberRef.current && runtime.runFork(Fiber.interrupt(fiberRef.current));
        fiberRef.current = null;
        inputRef.current && Object.assign(inputRef.current, { value: '' });
        setFiles([]);
        setState(asyncApi.idle());
    }, [runtime]);
    return { accept, files, reset, state };
};
const useFileDrop = <R>(): FileDropState => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(asyncApi.idle);
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
            const droppedFiles = FileOps.fromDataTransfer(e.dataTransfer);
            setState(asyncApi.loading());
            fiberRef.current = runtime.runFork(createFileSelectionEffect(droppedFiles, setState));
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

// --- [EXPORT] ----------------------------------------------------------------

export type { FileDropState, FileInputOptions, FileInputState };
export type { FileError } from '@parametric-portal/types/files';
export { B as FILE_TUNING, FileOps, interruptFiber, useFileDrop, useFileInput };
