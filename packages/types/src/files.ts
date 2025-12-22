/**
 * File validation and MIME type handling.
 * Grounding: Content-type dispatch with size/format validation.
 */
import { Effect, Option, pipe, Schema as S } from 'effect';

import { isSvgValid } from './svg.ts';

// --- [TYPES] -----------------------------------------------------------------

type MimeType = S.Schema.Type<typeof MimeTypeSchema>;
type MimeCategory = S.Schema.Type<typeof MimeCategorySchema>;
type FileMetadata = S.Schema.Type<typeof FileMetadataSchema>;
type FileError = {
    readonly _tag: 'FileError';
    readonly code: string;
    readonly message: string;
};
type ContentValidator = (content: string) => boolean;
type FilesConfig = {
    readonly maxSizeBytes?: number;
};
type FilesApi = {
    readonly errors: typeof B.errors;
    readonly getCategory: (mimeType: MimeType) => MimeCategory;
    readonly isSupported: (mimeType: string) => mimeType is MimeType;
    readonly limits: typeof B.limits;
    readonly mimesByCategory: typeof mimesByCategory;
    readonly mkFileError: typeof mkFileError;
    readonly schemas: typeof schemas;
    readonly validateContent: (mimeType: MimeType, content: string) => Effect.Effect<string, FileError>;
    readonly validateFile: (file: File, maxSize?: number) => Effect.Effect<FileMetadata, FileError>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    errors: {
        empty: { code: 'FILE_EMPTY', message: 'File is empty' },
        invalidContent: { code: 'INVALID_CONTENT', message: 'Invalid file content' },
        invalidType: { code: 'INVALID_TYPE', message: 'Unsupported file type' },
        readFailed: { code: 'READ_FAILED', message: 'Failed to read file' },
        tooLarge: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit' },
    },
    limits: {
        maxSizeBytes: 512 * 1024,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const MimeCategorySchema = S.Literal('image', 'document', 'model', 'code', 'archive');

const MimeTypeSchema = S.Literal(
    // Images
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/tiff',
    'image/bmp',
    'image/x-icon',
    // Documents
    'application/json',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
    'text/xml',
    // 3D Models
    'model/gltf+json',
    'model/gltf-binary',
    'application/octet-stream', // .glb, .bin, .wasm
    // Code
    'text/javascript',
    'text/typescript',
    'text/css',
    // Archives
    'application/zip',
    'application/gzip',
);

const FileMetadataSchema = S.Struct({
    lastModified: S.Number,
    mimeType: MimeTypeSchema,
    name: S.NonEmptyTrimmedString,
    size: pipe(S.Number, S.nonNegative()),
});

const schemas = Object.freeze({
    fileMetadata: FileMetadataSchema,
    mimeCategory: MimeCategorySchema,
    mimeType: MimeTypeSchema,
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const mimesByCategory: Record<MimeCategory, ReadonlyArray<MimeType>> = {
    archive: ['application/zip', 'application/gzip'],
    code: ['text/javascript', 'text/typescript', 'text/css'],
    document: [
        'application/json',
        'application/pdf',
        'text/plain',
        'text/csv',
        'text/markdown',
        'text/html',
        'text/xml',
    ],
    image: [
        'image/svg+xml',
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'image/avif',
        'image/tiff',
        'image/bmp',
        'image/x-icon',
    ],
    model: ['model/gltf+json', 'model/gltf-binary', 'application/octet-stream'],
} as const;

const categoryByMime: Record<MimeType, MimeCategory> = Object.fromEntries(
    (Object.entries(mimesByCategory) as ReadonlyArray<[MimeCategory, ReadonlyArray<MimeType>]>).flatMap(
        ([cat, mimes]) => mimes.map((m) => [m, cat]),
    ),
) as Record<MimeType, MimeCategory>;

const safeJsonParse = (str: string): unknown | null => {
    const exit = Effect.runSyncExit(Effect.try(() => JSON.parse(str) as unknown));
    return exit._tag === 'Success' ? exit.value : null;
};

const contentValidators: Record<MimeType, ContentValidator> = {
    'application/gzip': () => true,
    'application/json': (c) => safeJsonParse(c) !== null,
    'application/octet-stream': () => true,
    'application/pdf': (c) => c.startsWith('%PDF'),
    'application/zip': () => true,
    'image/avif': () => true,
    'image/bmp': () => true,
    'image/gif': () => true,
    'image/jpeg': () => true,
    'image/png': () => true,
    'image/svg+xml': isSvgValid,
    'image/tiff': () => true,
    'image/webp': () => true,
    'image/x-icon': () => true,
    'model/gltf-binary': () => true,
    'model/gltf+json': (c) => {
        const parsed = safeJsonParse(c);
        return parsed !== null && typeof parsed === 'object' && 'asset' in parsed;
    },
    'text/css': () => true,
    'text/csv': () => true,
    'text/html': (c) => c.includes('<html') || c.includes('<!DOCTYPE'),
    'text/javascript': () => true,
    'text/markdown': () => true,
    'text/plain': () => true,
    'text/typescript': () => true,
    'text/xml': (c) => c.includes('<?xml') || c.includes('<'),
} as const;

const validationChecks = {
    empty: (file: File): Option.Option<FileError> =>
        file.size === 0 ? Option.some(mkFileError(B.errors.empty.code, B.errors.empty.message)) : Option.none(),
    mimeType: (file: File): Option.Option<FileError> =>
        S.is(MimeTypeSchema)(file.type)
            ? Option.none()
            : Option.some(mkFileError(B.errors.invalidType.code, `${B.errors.invalidType.message}: ${file.type}`)),
    size: (file: File, maxSize: number): Option.Option<FileError> =>
        file.size > maxSize
            ? Option.some(mkFileError(B.errors.tooLarge.code, `${B.errors.tooLarge.message}: ${maxSize} bytes`))
            : Option.none(),
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFileError = (code: string, message: string): FileError => ({
    _tag: 'FileError',
    code,
    message,
});

const extractMetadata = (file: File): FileMetadata => ({
    lastModified: file.lastModified,
    mimeType: file.type as MimeType,
    name: file.name,
    size: file.size,
});

const getCategory = (mimeType: MimeType): MimeCategory => categoryByMime[mimeType];

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const validateFile = (file: File, maxSize: number = B.limits.maxSizeBytes): Effect.Effect<FileMetadata, FileError> =>
    pipe(
        Effect.succeed(file),
        Effect.flatMap((f) =>
            pipe(
                validationChecks.empty(f),
                Option.match({
                    onNone: () => Effect.succeed(f),
                    onSome: Effect.fail,
                }),
            ),
        ),
        Effect.flatMap((f) =>
            pipe(
                validationChecks.size(f, maxSize),
                Option.match({
                    onNone: () => Effect.succeed(f),
                    onSome: Effect.fail,
                }),
            ),
        ),
        Effect.flatMap((f) =>
            pipe(
                validationChecks.mimeType(f),
                Option.match({
                    onNone: () => Effect.succeed(f),
                    onSome: Effect.fail,
                }),
            ),
        ),
        Effect.map(extractMetadata),
    );

const validateContent = (mimeType: MimeType, content: string): Effect.Effect<string, FileError> =>
    contentValidators[mimeType](content)
        ? Effect.succeed(content)
        : Effect.fail(mkFileError(B.errors.invalidContent.code, `${B.errors.invalidContent.message} for ${mimeType}`));

// --- [ENTRY_POINT] -----------------------------------------------------------

const files = (config: FilesConfig = {}): FilesApi => {
    const maxSize = config.maxSizeBytes ?? B.limits.maxSizeBytes;
    return Object.freeze({
        errors: B.errors,
        getCategory,
        isSupported: S.is(MimeTypeSchema),
        limits: B.limits,
        mimesByCategory,
        mkFileError,
        schemas,
        validateContent,
        validateFile: (file: File, customMaxSize?: number) => validateFile(file, customMaxSize ?? maxSize),
    } as FilesApi);
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILES_TUNING, files, getCategory, mimesByCategory, mkFileError, validateContent, validateFile };
export type { FileError, FileMetadata, FilesApi, FilesConfig, MimeCategory, MimeType };
