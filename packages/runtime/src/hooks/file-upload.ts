/**
 * Validate and process uploaded files with type checking and content sanitization.
 * Composes FileOps service with validation rules to return AsyncState for component consumption.
 */
import { AppError } from '@parametric-portal/types/app-error';
import { AsyncState, type AsyncStateType } from '@parametric-portal/types/async';
import {
    FILES_TUNING,
    type FileMetadata,
    type MimeType,
    validateContent,
    validateFile,
} from '@parametric-portal/types/files';
import { Effect, pipe } from 'effect';
import { useMemo } from 'react';
import { fileOpsImpl } from '../services/file';
import { useEffectMutate } from './effect';

// --- [TYPES] -----------------------------------------------------------------

type ValidatedFile<T extends MimeType = MimeType> = {
    readonly content: string;
    readonly dataUrl: string;
    readonly file: File;
    readonly metadata: FileMetadata & { readonly mimeType: T };
};
type FileUploadConfig<T extends MimeType = MimeType> = {
    readonly allowedTypes?: ReadonlyArray<T>;
    readonly maxSizeBytes?: number;
};
type FileUploadState<T extends MimeType = MimeType> = {
    readonly error: AppError<'File'> | null;
    readonly isPending: boolean;
    readonly reset: () => void;
    readonly result: ValidatedFile<T> | null;
    readonly state: AsyncStateType<ValidatedFile<T>, AppError<'File'>>;
    readonly upload: (file: File) => void;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const processFile = <T extends MimeType>(
    file: File,
    allowedTypes: ReadonlyArray<T> | undefined,
    maxSizeBytes: number,
): Effect.Effect<ValidatedFile<T>, AppError<'File'>, never> =>
    pipe(
        validateFile(file, maxSizeBytes),
        Effect.filterOrFail(
            (m): m is FileMetadata & { readonly mimeType: T } =>
                allowedTypes == null || allowedTypes.includes(m.mimeType as T),
            () => AppError.from('File', 'INVALID_TYPE', `Allowed types: ${allowedTypes?.join(', ') ?? 'any'}`),
        ),
        Effect.flatMap((metadata) =>
            Effect.all(
                {
                    content: pipe(
                        fileOpsImpl.toText(file),
                        Effect.flatMap((text) => validateContent(metadata.mimeType, text)),
                    ),
                    dataUrl: fileOpsImpl.toDataUrl(file),
                },
                { concurrency: 'unbounded' },
            ).pipe(Effect.map(({ content, dataUrl }) => ({ content, dataUrl, file, metadata }))),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFileUpload = <T extends MimeType = MimeType>(config: FileUploadConfig<T> = {}): FileUploadState<T> => {
    const allowedTypes = config.allowedTypes;
    const maxSizeBytes = config.maxSizeBytes ?? FILES_TUNING.limits.maxSizeBytes;
    const effectFn = useMemo(
        () => (file: File) => processFile<T>(file, allowedTypes, maxSizeBytes),
        [allowedTypes, maxSizeBytes],
    );
    const { isPending, mutate, reset, state } = useEffectMutate(effectFn);
    const { error, result } = useMemo(
        () =>
            AsyncState.$match(state, {
                Failure: (f) => ({ error: f.error, result: null }),
                Idle: () => ({ error: null, result: null }),
                Loading: () => ({ error: null, result: null }),
                Success: (s) => ({ error: null, result: s.data }),
            }),
        [state],
    );
    return useMemo(
        () => ({ error, isPending, reset, result, state, upload: mutate }),
        [error, isPending, reset, result, state, mutate],
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FileUploadConfig, FileUploadState, ValidatedFile };
export { useFileUpload };
