/**
 * Bridge file browser APIs with React state via Effect-wrapped operations.
 * FileOps provided as Context.Tag service with Layer for dependency injection.
 */
import { AsyncState } from '@parametric-portal/types/async';
import { FileError } from '@parametric-portal/types/files';
import { Context, Effect, Fiber, Layer, Option, Schema as S } from 'effect';
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
type FileInputOptions = S.Schema.Type<typeof FileInputOptionsSchema>;
type StateSetter<A, E> = React.Dispatch<React.SetStateAction<AsyncState<A, E>>>;
type FileOpsService = {
    readonly fromDataTransfer: (dataTransfer: DataTransfer | null) => Option.Option<ReadonlyArray<File>>;
    readonly fromFileList: (files: FileList | null) => Option.Option<ReadonlyArray<File>>;
    readonly toArrayBuffer: (file: File) => Effect.Effect<ArrayBuffer, FileError>;
    readonly toDataUrl: (file: File) => Effect.Effect<string, FileError>;
    readonly toText: (file: File) => Effect.Effect<string, FileError>;
};

// --- [SCHEMA] ----------------------------------------------------------------

const FileInputOptionsSchema = S.Struct({
    accept: S.optional(S.String),
    multiple: S.optional(S.Boolean),
});

// --- [CONSTANTS] -------------------------------------------------------------

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

const fileOpsImpl: FileOpsService = {
    fromDataTransfer: (dataTransfer) =>
        Option.fromNullable(dataTransfer).pipe(
            Option.map((dt) => Array.from(dt.files)),
            Option.filter((arr) => arr.length > 0),
        ),
    fromFileList: (files) =>
        Option.fromNullable(files).pipe(
            Option.map(Array.from<File>),
            Option.filter((arr) => arr.length > 0),
        ),
    toArrayBuffer: (file) =>
        Effect.tryPromise({
            catch: () => new FileError(B.errors.readFailed),
            try: () => file.arrayBuffer(),
        }),
    toDataUrl: (file) =>
        Effect.async((resume) => {
            const reader = new FileReader();
            reader.onload = () => resume(Effect.succeed(reader.result as string));
            reader.onerror = () => resume(Effect.fail(new FileError(B.errors.readFailed)));
            reader.readAsDataURL(file);
        }),
    toText: (file) =>
        Effect.tryPromise({
            catch: () => new FileError(B.errors.readFailed),
            try: () => file.text(),
        }),
};
const setStateEffect = <A, E>(
    setState: StateSetter<A, E>,
    files: Option.Option<ReadonlyArray<File>>,
): Effect.Effect<void> =>
    Effect.sync(() =>
        setState(
            Option.match(files, {
                onNone: () => AsyncState.Failure(new FileError(B.errors.empty)) as AsyncState<A, E>,
                onSome: (f) => AsyncState.Success(f) as AsyncState<A, E>,
            }),
        ),
    );

// --- [SERVICES] --------------------------------------------------------------

class FileOps extends Context.Tag('FileOps')<FileOps, FileOpsService>() {}
const FileOpsLive = Layer.succeed(FileOps, fileOpsImpl);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFileInput = <R>(options: FileInputOptions = {}): FileInputState => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(AsyncState.Idle);
    const [selectedFiles, setSelectedFiles] = useState<ReadonlyArray<File>>([]);
    const inputRef = useRef<Option.Option<HTMLInputElement>>(Option.none());
    const fiberRef = useRef<Option.Option<Fiber.RuntimeFiber<unknown, unknown>>>(Option.none());
    useEffect(() => {
        const input = globalThis.document?.createElement('input');
        input &&
            Object.assign(
                Object.assign(input, {
                    accept: options.accept ?? B.defaults.accept,
                    multiple: options.multiple ?? B.defaults.multiple,
                    type: 'file',
                }).style,
                { display: 'none' },
            );
        inputRef.current = Option.fromNullable(input);
        const handleChange = () => {
            const newFiles = Option.flatMap(inputRef.current, (el) => fileOpsImpl.fromFileList(el.files));
            setSelectedFiles(Option.getOrElse(newFiles, () => []));
            setState(AsyncState.Loading());
            fiberRef.current = Option.some(runtime.runFork(setStateEffect(setState, newFiles)));
        };
        input?.addEventListener('change', handleChange);
        globalThis.document?.body.appendChild(input);
        return () => {
            input?.removeEventListener('change', handleChange);
            input?.remove();
            Option.map(fiberRef.current, (fiber) => runtime.runFork(Fiber.interrupt(fiber)));
        };
    }, [runtime, options.accept, options.multiple]);
    const accept = useCallback(() => Option.map(inputRef.current, (el) => el.click()), []);
    const reset = useCallback(() => {
        Option.map(fiberRef.current, (fiber) => runtime.runFork(Fiber.interrupt(fiber)));
        fiberRef.current = Option.none();
        Option.map(inputRef.current, (el) => Object.assign(el, { value: '' }));
        setSelectedFiles([]);
        setState(AsyncState.Idle());
    }, [runtime]);
    return { accept, files: selectedFiles, reset, state };
};
const useFileDrop = <R>(): FileDropState => {
    const runtime = useRuntime<R, never>();
    const [state, setState] = useState<AsyncState<ReadonlyArray<File>, FileError>>(AsyncState.Idle);
    const [isDragOver, setIsDragOver] = useState(false);
    const fiberRef = useRef<Option.Option<Fiber.RuntimeFiber<unknown, unknown>>>(Option.none());
    const handleDrag = useCallback((e: React.DragEvent, over: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(over);
    }, []);
    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            const droppedFiles = fileOpsImpl.fromDataTransfer(e.dataTransfer);
            setState(AsyncState.Loading());
            fiberRef.current = Option.some(runtime.runFork(setStateEffect(setState, droppedFiles)));
        },
        [runtime],
    );
    useEffect(
        () => () => {
            Option.map(fiberRef.current, (fiber) => runtime.runFork(Fiber.interrupt(fiber)));
        },
        [runtime],
    );
    return {
        isDragOver,
        props: {
            onDragLeave: (e: React.DragEvent) => handleDrag(e, false),
            onDragOver: (e: React.DragEvent) => handleDrag(e, true),
            onDrop,
        },
        state,
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FileDropState, FileInputOptions, FileInputState, FileOpsService };
export { B as FILE_TUNING, FileInputOptionsSchema, FileOps, FileOpsLive, fileOpsImpl, useFileDrop, useFileInput };
