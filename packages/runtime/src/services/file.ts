/**
 * File I/O and validation service with SVG sanitization support.
 */
import { AppError } from '@parametric-portal/types/app-error';
import {
    type FileMetadata,
    type FileUploadConfig,
    type MimeType,
    type ValidatedFile,
    validateFile,
} from '@parametric-portal/types/files';
import { Svg } from '@parametric-portal/types/svg';
import { Context, Effect, Layer, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type FileOpsService = {
    readonly fromDataTransfer: (dataTransfer: DataTransfer | null) => Option.Option<ReadonlyArray<File>>;
    readonly fromFileList: (files: FileList | null) => Option.Option<ReadonlyArray<File>>;
    readonly processUpload: <T extends MimeType>(
        files: ReadonlyArray<File>,
        config: FileUploadConfig<T>,
    ) => Effect.Effect<ReadonlyArray<ValidatedFile<T>>, AppError<'File'>>;
    readonly toArrayBuffer: (file: File) => Effect.Effect<ArrayBuffer, AppError<'File'>>;
    readonly toDataUrl: (file: File) => Effect.Effect<string, AppError<'File'>>;
    readonly toText: (file: File) => Effect.Effect<string, AppError<'File'>>;
};

// --- [CLASSES] ---------------------------------------------------------------

class FileOps extends Context.Tag('FileOps')<FileOps, FileOpsService>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validateContent = (mimeType: MimeType, content: string): Effect.Effect<string, AppError<'File'>> =>
    mimeType === 'image/svg+xml'
        ? Svg.sanitize(content).pipe(
              Effect.mapError(() => AppError.from('File', 'INVALID_CONTENT', 'Invalid SVG markup')),
          )
        : Effect.succeed(content);

// --- [SERVICES] --------------------------------------------------------------

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
    processUpload: <T extends MimeType>(files: ReadonlyArray<File>, config: FileUploadConfig<T>) =>
        Effect.all(
            files.map((file) =>
                pipe(
                    validateFile(file, config.maxSizeBytes),
                    Effect.filterOrFail(
                        (m): m is FileMetadata & { readonly mimeType: T } =>
                            config.allowedTypes == null || config.allowedTypes.includes(m.mimeType as T),
                        () =>
                            AppError.from(
                                'File',
                                'INVALID_TYPE',
                                `Allowed: ${config.allowedTypes?.join(', ') ?? 'any'}`,
                            ),
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
                        ).pipe(Effect.map(({ content, dataUrl }) => ({ content, dataUrl, metadata }))),
                    ),
                ),
            ),
            { concurrency: 'unbounded' },
        ),
    toArrayBuffer: (file) =>
        Effect.tryPromise({
            catch: () => AppError.from('File', 'READ_FAILED'),
            try: () => file.arrayBuffer(),
        }),
    toDataUrl: (file) =>
        Effect.async<string, AppError<'File'>>((resume) => {
            const reader = new FileReader();
            reader.onload = () => resume(Effect.succeed(reader.result as string));
            reader.onerror = () => resume(Effect.fail(AppError.from('File', 'READ_FAILED')));
            reader.readAsDataURL(file);
        }),
    toText: (file) =>
        Effect.tryPromise({
            catch: () => AppError.from('File', 'READ_FAILED'),
            try: () => file.text(),
        }),
};

// --- [LAYERS] ----------------------------------------------------------------

const FileOpsLive = Layer.succeed(FileOps, fileOpsImpl);

// --- [EXPORT] ----------------------------------------------------------------

export type { FileOpsService };
export { FileOps, FileOpsLive, validateContent };
