/**
 * File I/O utilities. Stateless functions - no service ceremony needed.
 */
import { AppError } from '@parametric-portal/types/app-error';
import { Metadata } from '@parametric-portal/types/files';
import { Svg } from '@parametric-portal/types/svg';
import { Effect, Option, pipe, Schema as S } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const fromFiles = (source: DataTransfer | FileList | null): Option.Option<ReadonlyArray<File>> =>
    pipe(
        Option.fromNullable(source),
        Option.map((src) => Array.from('files' in src ? src.files : src)),
        Option.filter((files) => files.length > 0),
    );
const readFile = {
    arrayBuffer: (file: File): Effect.Effect<ArrayBuffer, AppError.File> =>
        Effect.tryPromise({ catch: () => AppError.file('READ_FAILED'), try: () => file.arrayBuffer() }),
    dataUrl: (file: File): Effect.Effect<string, AppError.File> =>
        Effect.async<string, AppError.File>((resume) => {
            const reader = new FileReader();
            reader.onload = () => resume(Effect.succeed(reader.result as string));
            reader.onerror = () => resume(Effect.fail(AppError.file('READ_FAILED')));
            reader.readAsDataURL(file);
        }),
    text: (file: File): Effect.Effect<string, AppError.File> =>
        Effect.tryPromise({ catch: () => AppError.file('READ_FAILED'), try: () => file.text() }),
} as const;
const validateFile = (file: File, maxSize = 512 * 1024): Effect.Effect<Metadata, AppError.File> =>
    Effect.succeed(file).pipe(
        Effect.filterOrFail(
            (f) => f.size > 0,
            () => AppError.file('FILE_EMPTY'),
        ),
        Effect.filterOrFail(
            (f) => f.size <= maxSize,
            () => AppError.file('FILE_TOO_LARGE'),
        ),
        Effect.andThen((f) =>
            S.decodeUnknown(Metadata)({ mime: f.type || 'application/octet-stream', name: f.name, size: f.size }).pipe(
                Effect.mapError((error) => AppError.file('INVALID_TYPE', undefined, error)),
            ),
        ),
    );
const validateContent = (mime: string, content: string): Effect.Effect<string, AppError.File> =>
    mime === 'image/svg+xml'
        ? Option.match(Svg.sanitize(content), {
              onNone: () => Effect.fail(AppError.file('INVALID_CONTENT')),
              onSome: Effect.succeed,
          })
        : Effect.succeed(content);
type ProcessedFile<T extends string> = {
    readonly content: string;
    readonly dataUrl: string;
    readonly metadata: Metadata & { mime: T };
};
const processOne = <T extends string>(
    file: File,
    allowedTypes?: ReadonlyArray<T>,
    maxSizeBytes?: number,
): Effect.Effect<ProcessedFile<T>, AppError.File> =>
    validateFile(file, maxSizeBytes).pipe(
        Effect.filterOrFail(
            (meta): meta is Metadata & { mime: T } => allowedTypes == null || allowedTypes.includes(meta.mime as T),
            () => AppError.file('INVALID_TYPE'),
        ),
        Effect.flatMap((metadata) =>
            Effect.map(
                Effect.all(
                    {
                        content: readFile
                            .text(file)
                            .pipe(Effect.flatMap((text) => validateContent(metadata.mime, text))),
                        dataUrl: readFile.dataUrl(file),
                    },
                    { concurrency: 2 },
                ),
                (result) => ({ ...result, metadata }),
            ),
        ),
    );
function process<T extends string>(
    input: File,
    allowedTypes?: ReadonlyArray<T>,
    maxSizeBytes?: number,
): Effect.Effect<ProcessedFile<T>, AppError.File>;
function process<T extends string>(
    input: ReadonlyArray<File>,
    allowedTypes?: ReadonlyArray<T>,
    maxSizeBytes?: number,
): Effect.Effect<ReadonlyArray<ProcessedFile<T>>, AppError.File>;
function process<T extends string>(
    input: File | ReadonlyArray<File>,
    allowedTypes?: ReadonlyArray<T>,
    maxSizeBytes?: number,
): Effect.Effect<ProcessedFile<T> | ReadonlyArray<ProcessedFile<T>>, AppError.File> {
    if (Array.isArray(input)) {
        return Effect.forEach(input as ReadonlyArray<File>, (file) => processOne(file, allowedTypes, maxSizeBytes), {
            concurrency: 'unbounded',
        });
    }
    return processOne(input as File, allowedTypes, maxSizeBytes);
}

// --- [EXPORT] ----------------------------------------------------------------

export { fromFiles, process, readFile, validateContent, validateFile };
export type { ProcessedFile };
