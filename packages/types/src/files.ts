/**
 * File domain types, MIME configuration, and metadata validation.
 * Core types only - validation logic lives in service layer.
 */
import { Effect, pipe, Schema as S } from 'effect';
import { AppError } from './app-error.ts';
import { companion, NonNegativeInt, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type MimeCategory = keyof typeof MIME_CONFIG;
type FileUploadConfig<T extends MimeType = MimeType> = { readonly allowedTypes?: ReadonlyArray<T>; readonly maxSizeBytes?: number };
type ValidatedFile<T extends MimeType = MimeType> = { readonly content: string; readonly dataUrl: string; readonly metadata: FileMetadata & { readonly mimeType: T } };

// --- [CONSTANTS] -------------------------------------------------------------

const TRANSFER_MIME = { csv: 'text/csv', ndjson: 'application/x-ndjson', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip' } as const;
const MIME_CONFIG = {
    archive: ['application/zip', 'application/gzip'],
    code: ['text/javascript', 'text/typescript', 'text/css'],
    document: ['application/json', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    image: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon'],
    model: ['model/gltf+json', 'model/gltf-binary', 'application/octet-stream'],
} as const;
const mimeToCategory = Object.freeze(
    Object.fromEntries(
        (Object.entries(MIME_CONFIG) as ReadonlyArray<[MimeCategory, ReadonlyArray<string>]>)
            .flatMap(([category, mimes]) => mimes.map((mime) => [mime, category] as const)),
    ) as Record<MimeType, MimeCategory>,
);
const B = Object.freeze({ limits: { maxSizeBytes: 512 * 1024 } } as const);

// --- [SCHEMA] ----------------------------------------------------------------

const MimeTypeSchema = S.Literal(
    ...MIME_CONFIG.archive,
    ...MIME_CONFIG.code,
    ...MIME_CONFIG.document,
    ...MIME_CONFIG.image,
    ...MIME_CONFIG.model,
);
type MimeType = typeof MimeTypeSchema.Type;
const MimeType = Object.freeze({ ...companion(MimeTypeSchema), config: MIME_CONFIG, toCategory: mimeToCategory });

const TransferAssetInputSchema = S.Struct({
    assetType: S.NonEmptyTrimmedString,
    content: S.NonEmptyString,
    createdAt: S.optional(S.String),
    id: S.optional(S.String),
    updatedAt: S.optional(S.String),
});
type TransferAssetInput = typeof TransferAssetInputSchema.Type;
const TransferAssetInput = Object.freeze(companion(TransferAssetInputSchema));

const TransferFormatSchema = S.Literal(...(Object.keys(TRANSFER_MIME) as [keyof typeof TRANSFER_MIME, ...(keyof typeof TRANSFER_MIME)[]]));
type TransferFormat = typeof TransferFormatSchema.Type;
const TransferFormat = Object.freeze({ ...companion(TransferFormatSchema), mime: TRANSFER_MIME });

const TransferFailureSchema = S.Struct({ error: S.String, row: S.Int });
type TransferFailure = typeof TransferFailureSchema.Type;
const TransferFailure = Object.freeze(companion(TransferFailureSchema));

const FileMetadataSchema = S.Struct({ lastModified: Timestamp.schema, mimeType: MimeType.schema, name: S.NonEmptyTrimmedString, size: NonNegativeInt.schema });
type FileMetadata = typeof FileMetadataSchema.Type;
const FileMetadata = Object.freeze(companion(FileMetadataSchema));

const ImportResultSchema = S.Struct({ failed: S.Array(TransferFailure.schema), imported: S.Int });
type ImportResult = typeof ImportResultSchema.Type;
const ImportResult = Object.freeze(companion(ImportResultSchema));

const ExportEncodingSchema = S.Literal('text', 'base64');
type ExportEncoding = typeof ExportEncodingSchema.Type;

const ExportMetaSchema = S.Struct({ encoding: ExportEncodingSchema, filename: S.String, format: TransferFormat.schema, mimeType: S.String });
type ExportMeta = typeof ExportMetaSchema.Type;
const ExportMeta = Object.freeze(companion(ExportMetaSchema));

const ExportResultSchema = S.Struct({ data: S.String, meta: ExportMetaSchema });
type ExportResult = typeof ExportResultSchema.Type;
const ExportResult = Object.freeze(companion(ExportResultSchema));

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

/** Foundation types for async export job system (webhooks/callbacks). */
type AsyncExportStatus = 'pending' | 'processing' | 'completed' | 'failed';
type AsyncExportJob<TUserId extends string = string> = {
    readonly completedAt: Date | null;
    readonly createdAt: Date;
    readonly error: string | null;
    readonly format: TransferFormat;
    readonly id: string;
    readonly progress: number;
    readonly resultUrl: string | null;
    readonly status: AsyncExportStatus;
    readonly userId: TUserId;
    readonly webhookUrl: string | null;
};
type AsyncExportRequest = {
    readonly format: TransferFormat;
    readonly webhookUrl?: string;
};

// --- [EXPORT] ----------------------------------------------------------------

export { ExportMeta, ExportResult, FileMetadata, ImportResult, MimeType, TransferAssetInput, TransferFailure, TransferFormat, validateFile };
export { ExportEncodingSchema, ExportMetaSchema, ExportResultSchema, ImportResultSchema, TransferAssetInputSchema, TransferFormatSchema, TRANSFER_MIME };
export type { AsyncExportJob, AsyncExportRequest, AsyncExportStatus, ExportEncoding, FileUploadConfig, MimeCategory, ValidatedFile };
