/**
 * Bridge file upload to React state with auto-wired props.
 * Uses FileOps service for processing, returns component-ready props.
 */
import type { AppError } from '@parametric-portal/types/app-error';
import { AsyncState, type AsyncStateType } from '@parametric-portal/types/async';
import type { FileUploadConfig, MimeType, ValidatedFile } from '@parametric-portal/types/files';
import { Effect } from 'effect';
import { useMemo } from 'react';
import { FileOps } from '../services/file';
import { useEffectMutate } from './effect';

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
};
type FileUploadReturn<T extends MimeType> = {
    readonly error: AppError<'File'> | null;
    readonly fileResults: ReadonlyArray<FileValidationResult<T>>;
    readonly isPending: boolean;
    readonly props: FileUploadProps<T>;
    readonly reset: () => void;
    readonly results: ReadonlyArray<ValidatedFile<T>>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFileUpload = <T extends MimeType = MimeType>(config: FileUploadHookConfig<T> = {}): FileUploadReturn<T> => {
    const processEffect = useMemo(
        () => (files: ReadonlyArray<File>) =>
            FileOps.pipe(Effect.flatMap((ops) => ops.processUpload<T>(files, config))),
        [config],
    );
    const { mutate, reset, state } = useEffectMutate(processEffect);
    const isPending = AsyncState.isPending(state);
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
        }),
        [config.allowedTypes, config.acceptDirectory, config.defaultCamera, config.multiple, state, mutate],
    );
    return useMemo(
        () => ({ error, fileResults, isPending, props, reset, results }),
        [error, fileResults, isPending, props, reset, results],
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FileUploadProps, FileUploadReturn, FileValidationResult };
export { useFileUpload };
