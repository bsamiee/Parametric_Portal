/**
 * Define file validation and MIME type handling with content dispatch.
 * Content-type dispatch with size/format validation via Effect pipelines.
 */
import { Effect, Exit, Option, pipe, Schema as S } from 'effect';
import { svg } from './svg.ts';

const svgApi = svg();

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
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/tiff',
    'image/bmp',
    'image/x-icon',
    'application/json',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
    'text/xml',
    'model/gltf+json',
    'model/gltf-binary',
    'application/octet-stream',
    'text/javascript',
    'text/typescript',
    'text/css',
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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFileError = (code: string, message: string): FileError => ({
    _tag: 'FileError',
    code,
    message,
});
const extractMetadata = (file: File): Effect.Effect<FileMetadata, FileError> =>
    pipe(
        S.decodeUnknown(FileMetadataSchema)({
            lastModified: file.lastModified,
            mimeType: file.type,
            name: file.name,
            size: file.size,
        }),
        Effect.mapError((e) => mkFileError(B.errors.invalidType.code, e.message)),
    );
const getCategory = (mimeType: MimeType): MimeCategory => categoryByMime[mimeType];

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
const safeJsonParse = (str: string): unknown =>
    Exit.match(Effect.runSyncExit(Effect.try(() => JSON.parse(str) as unknown)), {
        onFailure: () => null,
        onSuccess: (v) => v,
    });
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
    'image/svg+xml': svgApi.validate.isSvgValid,
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

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const checkOption = <T>(value: T, check: (v: T) => Option.Option<FileError>): Effect.Effect<T, FileError> =>
    pipe(check(value), Option.match({ onNone: () => Effect.succeed(value), onSome: Effect.fail }));
const validateFile = (file: File, maxSize: number = B.limits.maxSizeBytes): Effect.Effect<FileMetadata, FileError> =>
    pipe(
        checkOption(file, validationChecks.empty),
        Effect.flatMap((f) => checkOption(f, (v) => validationChecks.size(v, maxSize))),
        Effect.flatMap((f) => checkOption(f, validationChecks.mimeType)),
        Effect.flatMap(extractMetadata),
    );
const validateContent = (mimeType: MimeType, content: string): Effect.Effect<string, FileError> =>
    contentValidators[mimeType](content)
        ? Effect.succeed(content)
        : Effect.fail(mkFileError(B.errors.invalidContent.code, `${B.errors.invalidContent.message} for ${mimeType}`));

// --- [ENTRY_POINT] -----------------------------------------------------------

const files = (config: FilesConfig = {}) => {
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
    });
};
// --- [EXPORT] ----------------------------------------------------------------

export { B as FILES_TUNING, files };
export type { FileError, FileMetadata, MimeType };
export type FilesApi = ReturnType<typeof files>;
