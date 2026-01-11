/**
 * Bridge file upload to React state with progress tracking.
 * Uses FileOps service for processing, returns component-ready props.
 * Progress derived from per-file completion (completedFiles / totalFiles).
 */
import type { AppError } from '@parametric-portal/types/app-error';
import { AsyncState, type AsyncStateType } from '@parametric-portal/types/async';
import type { FileUploadConfig, MimeType, ValidatedFile } from '@parametric-portal/types/files';
import { Effect } from 'effect';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Runtime } from '../runtime';
import { FileOps } from '../services/file';

// --- [TYPES] -----------------------------------------------------------------

type FileValidationResult<T extends MimeType> =
    | { readonly status: 'success'; readonly file: ValidatedFile<T> }
    | { readonly status: 'error'; readonly name: string; readonly error: AppError<'File'> };
type FileUploadHookConfig<T extends MimeType> = FileUploadConfig<T> & {
    readonly acceptDirectory?: boolean;
    readonly defaultCamera?: 'environment' | 'user';
    readonly multiple?: boolean;
};
type FileUploadProps<T extends MimeType> = {
    readonly accept: ReadonlyArray<T>;
    readonly acceptDirectory?: boolean;
    readonly asyncState: AsyncStateType<ReadonlyArray<ValidatedFile<T>>, AppError<'File'>>;
    readonly defaultCamera?: 'environment' | 'user';
    readonly multiple?: boolean;
    readonly onFilesChange: (files: ReadonlyArray<File>) => void;
    readonly progress: number;
};
type FileUploadReturn<T extends MimeType> = {
    readonly error: AppError<'File'> | null;
    readonly fileResults: ReadonlyArray<FileValidationResult<T>>;
    readonly isPending: boolean;
    readonly progress: number;
    readonly props: FileUploadProps<T>;
    readonly reset: () => void;
    readonly results: ReadonlyArray<ValidatedFile<T>>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFileUpload = <T extends MimeType = MimeType>(config: FileUploadHookConfig<T> = {}): FileUploadReturn<T> => {
    const runtime = Runtime.use<FileOps, never>();
    const [state, setState] = useState<AsyncStateType<ReadonlyArray<ValidatedFile<T>>, AppError<'File'>>>(
        AsyncState.Idle(),
    );
    const [progress, setProgress] = useState(0);
    const completedRef = useRef(0);
    const isPending = AsyncState.isPending(state);
    const mutate = useCallback(
        (files: ReadonlyArray<File>) => {
            setState(AsyncState.Loading());
            setProgress(0);
            completedRef.current = 0;
            const total = files.length;
            runtime.runFork(
                Effect.gen(function* () {
                    const ops = yield* FileOps;
                    const results = yield* Effect.all(
                        files.map((file) =>
                            ops.processUpload<T>([file], config).pipe(
                                Effect.tap(() =>
                                    Effect.sync(() => {
                                        completedRef.current += 1;
                                        setProgress((completedRef.current / total) * 100);
                                    }),
                                ),
                                Effect.map((r) => r[0] as ValidatedFile<T>),
                            ),
                        ),
                        { concurrency: 'unbounded' },
                    );
                    return results as ReadonlyArray<ValidatedFile<T>>;
                }).pipe(
                    Effect.tap((data) => Effect.sync(() => setState(AsyncState.Success(data)))),
                    Effect.tapError((e) => Effect.sync(() => setState(AsyncState.Failure(e)))),
                ),
            );
        },
        [runtime, config],
    );
    const reset = useCallback(() => {
        setState(AsyncState.Idle());
        setProgress(0);
        completedRef.current = 0;
    }, []);
    const { error, fileResults, results } = useMemo(
        () =>
            AsyncState.$match(state, {
                Failure: (f) => ({
                    error: f.error,
                    fileResults: [] as ReadonlyArray<FileValidationResult<T>>,
                    results: [] as ReadonlyArray<ValidatedFile<T>>,
                }),
                Idle: () => ({
                    error: null,
                    fileResults: [] as ReadonlyArray<FileValidationResult<T>>,
                    results: [] as ReadonlyArray<ValidatedFile<T>>,
                }),
                Loading: () => ({
                    error: null,
                    fileResults: [] as ReadonlyArray<FileValidationResult<T>>,
                    results: [] as ReadonlyArray<ValidatedFile<T>>,
                }),
                Success: (s) => ({
                    error: null,
                    fileResults: s.data.map((file) => ({ file, status: 'success' as const })),
                    results: s.data,
                }),
            }),
        [state],
    );
    const props = useMemo<FileUploadProps<T>>(
        () => ({
            accept: config.allowedTypes ?? ([] as ReadonlyArray<T>),
            ...(config.acceptDirectory != null && { acceptDirectory: config.acceptDirectory }),
            asyncState: state,
            ...(config.defaultCamera != null && { defaultCamera: config.defaultCamera }),
            ...(config.multiple != null && { multiple: config.multiple }),
            onFilesChange: (files) => files.length > 0 && mutate(files),
            progress,
        }),
        [config.allowedTypes, config.acceptDirectory, config.defaultCamera, config.multiple, state, mutate, progress],
    );
    return useMemo(
        () => ({ error, fileResults, isPending, progress, props, reset, results }),
        [error, fileResults, isPending, progress, props, reset, results],
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FileUploadProps, FileUploadReturn, FileValidationResult };
export { useFileUpload };
