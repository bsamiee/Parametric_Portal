/**
 * File domain types, MIME configuration, and metadata validation.
 * Core types only - validation logic lives in service layer.
 */
import { Effect, pipe, Schema as S } from 'effect';
import { AppError } from './app-error.ts';
import { NonNegativeInt, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type MimeCategory = keyof typeof MIME_CONFIG;
type MimeType = (typeof MIME_CONFIG)[MimeCategory][number];
type FileMetadata = S.Schema.Type<typeof FileMetadataSchema>;
type ValidatedFile<T extends MimeType = MimeType> = {
    readonly content: string;
    readonly dataUrl: string;
    readonly metadata: FileMetadata & { readonly mimeType: T };
};
type FileUploadConfig<T extends MimeType = MimeType> = {
    readonly allowedTypes?: ReadonlyArray<T>;
    readonly maxSizeBytes?: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    limits: { maxSizeBytes: 512 * 1024 },
} as const);
const MIME_CONFIG = {
    archive: ['application/zip', 'application/gzip'],
    code: ['text/javascript', 'text/typescript', 'text/css'],
    document: ['application/json', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/xml', ],
    image: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon', ],
    model: ['model/gltf+json', 'model/gltf-binary', 'application/octet-stream'],
} as const;
const mimeToCategory = Object.freeze(
    Object.fromEntries(
        (Object.entries(MIME_CONFIG) as ReadonlyArray<[MimeCategory, ReadonlyArray<string>]>)
            .flatMap(([category, mimes]) => mimes.map((mime) => [mime, category] as const)),
    ) as Record<MimeType, MimeCategory>,
);

// --- [SCHEMA] ----------------------------------------------------------------

const MimeTypeSchema = S.Literal(
    ...MIME_CONFIG.archive,
    ...MIME_CONFIG.code,
    ...MIME_CONFIG.document,
    ...MIME_CONFIG.image,
    ...MIME_CONFIG.model,
);
const FileMetadataSchema = S.Struct({
    lastModified: Timestamp.schema,
    mimeType: MimeTypeSchema,
    name: S.NonEmptyTrimmedString,
    size: NonNegativeInt.schema,
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const validateEmpty = (file: File): Effect.Effect<File, AppError<'File'>> => file.size === 0 ? Effect.fail(AppError.from('File', 'FILE_EMPTY')) : Effect.succeed(file);
const validateSize = (file: File, maxSize: number): Effect.Effect<File, AppError<'File'>> =>
    file.size > maxSize
        ? Effect.fail(AppError.from('File', 'FILE_TOO_LARGE', `Max: ${maxSize} bytes`))
        : Effect.succeed(file);
const decodeMetadata = (file: File): Effect.Effect<FileMetadata, AppError<'File'>> =>
    pipe(
        S.decodeUnknown(FileMetadataSchema)({
            lastModified: file.lastModified,
            mimeType: file.type,
            name: file.name,
            size: file.size,
        }),
        Effect.mapError((e) => AppError.from('File', 'INVALID_TYPE', e.message)),
    );
const validateFile = (
    file: File,
    maxSize: number = B.limits.maxSizeBytes,
): Effect.Effect<FileMetadata, AppError<'File'>> =>
    Effect.gen(function* () {
        yield* validateEmpty(file);
        yield* validateSize(file, maxSize);
        return yield* decodeMetadata(file);
    });

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILES_TUNING, MIME_CONFIG, mimeToCategory, validateFile };
export type { FileMetadata, FileUploadConfig, MimeCategory, MimeType, ValidatedFile, };
