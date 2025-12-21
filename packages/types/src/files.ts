/**
 * Provide file validation schemas and types for SVG and general file handling.
 */
import { Effect, Option, pipe, Schema as S } from 'effect';
import { match, P } from 'ts-pattern';

// --- [TYPES] -----------------------------------------------------------------

type FileMetadata = S.Schema.Type<typeof FileMetadataSchema>;
type SvgFile = S.Schema.Type<typeof SvgFileSchema>;
type FileError = {
    readonly _tag: 'FileError';
    readonly code: string;
    readonly message: string;
};
type FilesConfig = {
    readonly maxSizeBytes?: number;
};
type FilesApi = {
    readonly errors: typeof B.errors;
    readonly limits: typeof B.limits;
    readonly match: typeof match;
    readonly mimeTypes: typeof B.mimeTypes;
    readonly mkFileError: typeof mkFileError;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly schemas: typeof schemas;
    readonly validateFile: (file: File, maxSize?: number) => Effect.Effect<FileMetadata, FileError>;
    readonly validateSvgContent: (content: string) => Effect.Effect<string, FileError>;
};

// --- [SCHEMA] ----------------------------------------------------------------

const FileMetadataSchema = S.Struct({
    lastModified: S.Number,
    mimeType: S.String,
    name: pipe(S.String, S.nonEmptyString()),
    size: pipe(S.Number, S.nonNegative()),
});

const SvgContentSchema = pipe(
    S.String,
    S.filter((content) => content.includes('<svg'), {
        message: () => 'Content must contain <svg element',
    }),
);

const SvgFileSchema = S.Struct({
    content: SvgContentSchema,
    metadata: FileMetadataSchema,
});

const schemas = Object.freeze({
    fileMetadata: FileMetadataSchema,
    svgContent: SvgContentSchema,
    svgFile: SvgFileSchema,
} as const);

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    errors: {
        empty: { code: 'FILE_EMPTY', message: 'File is empty' },
        invalidType: { code: 'INVALID_TYPE', message: 'Invalid file type' },
        readFailed: { code: 'READ_FAILED', message: 'Failed to read file' },
        tooLarge: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit' },
    },
    limits: {
        maxSizeBytes: 512 * 1024,
    },
    mimeTypes: ['image/svg+xml'] as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFileError = (code: string, message: string): FileError => ({
    _tag: 'FileError',
    code,
    message,
});

const extractMetadata = (file: File): FileMetadata => ({
    lastModified: file.lastModified,
    mimeType: file.type,
    name: file.name,
    size: file.size,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const validationChecks = {
    empty: (file: File): Option.Option<FileError> =>
        file.size === 0 ? Option.some(mkFileError(B.errors.empty.code, B.errors.empty.message)) : Option.none(),
    mimeType: (file: File): Option.Option<FileError> =>
        B.mimeTypes.includes(file.type as (typeof B.mimeTypes)[number])
            ? Option.none()
            : Option.some(mkFileError(B.errors.invalidType.code, B.errors.invalidType.message)),
    size: (file: File, maxSize: number): Option.Option<FileError> =>
        file.size > maxSize
            ? Option.some(mkFileError(B.errors.tooLarge.code, `${B.errors.tooLarge.message}: ${maxSize} bytes`))
            : Option.none(),
} as const;

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

const validateSvgContent = (content: string): Effect.Effect<string, FileError> =>
    pipe(
        Effect.succeed(content),
        Effect.flatMap((c) =>
            c.includes('<svg')
                ? Effect.succeed(c)
                : Effect.fail(mkFileError(B.errors.invalidType.code, 'Content must contain <svg element')),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const files = (config: FilesConfig = {}): FilesApi => {
    const maxSize = config.maxSizeBytes ?? B.limits.maxSizeBytes;
    return Object.freeze({
        errors: B.errors,
        limits: B.limits,
        match,
        mimeTypes: B.mimeTypes,
        mkFileError,
        Option,
        P,
        schemas,
        validateFile: (file: File, customMaxSize?: number) => validateFile(file, customMaxSize ?? maxSize),
        validateSvgContent,
    } as FilesApi);
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILES_TUNING, files, mkFileError, validateFile, validateSvgContent };
export type { FileError, FileMetadata, FilesApi, FilesConfig, SvgFile };
