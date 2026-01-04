/**
 * Validate files, dispatch MIME types, route content schemas.
 * Provides Effect-based decoding with branded content types.
 */
import type { ParseResult } from 'effect';
import { Effect, Option, pipe, Schema as S } from 'effect';
import { AppError } from './app-error.ts';
import { Svg } from './svg.ts';
import { Index, NonNegativeInt, Timestamp, VariantCount } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type MimeCategory = keyof typeof MIME_CONFIG;
type MimeType = (typeof MIME_CONFIG)[MimeCategory][number];
type FileMetadata = S.Schema.Type<typeof FileMetadataSchema>;
type ExportFormat = S.Schema.Type<typeof ExportFormatSchema>;
type ExportVariant = S.Schema.Type<typeof ExportVariantSchema>;
type ExportInput = S.Schema.Type<typeof ExportInputSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	bounds: { pngSize: { max: 4096, min: 16 } },
	defaults: { mimeType: 'text/plain', pngSize: 512 },
	limits: { maxSizeBytes: 512 * 1024 },
} as const);
const MIME_CONFIG = {
	archive: ['application/zip', 'application/gzip'],
	code: ['text/javascript', 'text/typescript', 'text/css'],
	document: ['application/json', 'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/xml'],
	image: ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon'],
	model: ['model/gltf+json', 'model/gltf-binary', 'application/octet-stream'],
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const safeJsonParse = (s: string): Option.Option<unknown> =>
	Option.fromNullable(Effect.runSync(Effect.try({ catch: () => null, try: () => JSON.parse(s) })));
/** Brand string schema with validation predicate. */
const contentBrand = <T extends string>(label: T, validate: (s: string) => boolean, msg: string) =>
	S.String.pipe(S.filter(validate, { message: () => msg }), S.brand(label));
const contentValidators = {
	gltfJson: (s: string) => safeJsonParse(s).pipe(
		Option.map((p) => p !== null && typeof p === 'object' && 'asset' in p),
		Option.getOrElse(() => false),
	),
	html: (s: string) => s.includes('<html') || s.includes('<!DOCTYPE'),
	json: (s: string) => Option.isSome(safeJsonParse(s)),
	pdf: (s: string) => s.startsWith('%PDF'),
	xml: (s: string) => s.includes('<?xml') || s.startsWith('<'),
} as const;

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
const PngSizeSchema = pipe(S.Number, S.int(), S.between(B.bounds.pngSize.min, B.bounds.pngSize.max), S.brand('PngSize'));
const ExportFormatSchema = S.Literal('png', 'svg', 'zip');
const ExportVariantSchema = S.Struct({ id: S.NonEmptyTrimmedString, svg: S.NonEmptyString });
const ExportInputSchema = S.Struct({
	filename: S.optional(S.NonEmptyTrimmedString),
	format: ExportFormatSchema,
	pngSize: S.optional(PngSizeSchema),
	svg: S.optional(S.NonEmptyString),
	variantCount: S.optional(VariantCount.schema),
	variantIndex: S.optional(Index.schema),
	variants: S.optional(S.Array(ExportVariantSchema)),
});
const JsonContentSchema = contentBrand('JsonContent', contentValidators.json, 'Invalid JSON content');
const HtmlContentSchema = contentBrand('HtmlContent', contentValidators.html, 'Invalid HTML content');
const XmlContentSchema = contentBrand('XmlContent', contentValidators.xml, 'Invalid XML content');
const PdfContentSchema = contentBrand('PdfContent', contentValidators.pdf, 'Invalid PDF content');
const GltfJsonContentSchema = contentBrand('GltfJsonContent', contentValidators.gltfJson, 'Invalid glTF JSON content');
const PassthroughContentSchema = S.String.pipe(S.brand('PassthroughContent'));

// --- [DISPATCH_TABLES] -------------------------------------------------------

const contentSchemas = {
	'application/gzip': PassthroughContentSchema,
	'application/json': JsonContentSchema,
	'application/octet-stream': PassthroughContentSchema,
	'application/pdf': PdfContentSchema,
	'application/zip': PassthroughContentSchema,
	'image/avif': PassthroughContentSchema,
	'image/bmp': PassthroughContentSchema,
	'image/gif': PassthroughContentSchema,
	'image/jpeg': PassthroughContentSchema,
	'image/png': PassthroughContentSchema,
	'image/svg+xml': Svg.sanitizedSchema,
	'image/tiff': PassthroughContentSchema,
	'image/webp': PassthroughContentSchema,
	'image/x-icon': PassthroughContentSchema,
	'model/gltf-binary': PassthroughContentSchema,
	'model/gltf+json': GltfJsonContentSchema,
	'text/css': PassthroughContentSchema,
	'text/csv': PassthroughContentSchema,
	'text/html': HtmlContentSchema,
	'text/javascript': PassthroughContentSchema,
	'text/markdown': PassthroughContentSchema,
	'text/plain': PassthroughContentSchema,
	'text/typescript': PassthroughContentSchema,
	'text/xml': XmlContentSchema,
} as const satisfies Record<MimeType, S.Schema.Any>;
type ContentDecoder = (content: string) => Effect.Effect<string, ParseResult.ParseError, never>;
/** Wrap schema into Effect decoder for uniform error channel. */
const createDecoder = (schema: S.Schema.Any): ContentDecoder => (content: string) =>
	S.decodeUnknown(schema)(content) as Effect.Effect<string, ParseResult.ParseError, never>;
const contentDecoders = Object.freeze(
	Object.fromEntries(
		(Object.keys(contentSchemas) as ReadonlyArray<MimeType>).map((mime) => [mime, createDecoder(contentSchemas[mime])]),
	) as { [K in MimeType]: ContentDecoder },
);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const validateEmpty = (file: File): Effect.Effect<File, AppError<'File'>> =>
	file.size === 0 ? Effect.fail(AppError.from('File', 'FILE_EMPTY')) : Effect.succeed(file);
const validateSize = (file: File, maxSize: number): Effect.Effect<File, AppError<'File'>> =>
	file.size > maxSize ? Effect.fail(AppError.from('File', 'FILE_TOO_LARGE', `File exceeds size limit: ${maxSize} bytes`)) : Effect.succeed(file);
const validateMimeType = (file: File): Effect.Effect<File, AppError<'File'>> =>
	S.is(MimeTypeSchema)(file.type) ? Effect.succeed(file) : Effect.fail(AppError.from('File', 'INVALID_TYPE', `Unsupported file type: ${file.type}`));
const extractMetadata = (file: File): Effect.Effect<FileMetadata, AppError<'File'>> =>
	pipe(
		S.decodeUnknown(FileMetadataSchema)({
			lastModified: file.lastModified,
			mimeType: file.type,
			name: file.name,
			size: file.size,
		}),
		Effect.mapError((e) => AppError.from('File', 'INVALID_TYPE', e.message)),
	);
const validateFile = (file: File, maxSize: number = B.limits.maxSizeBytes): Effect.Effect<FileMetadata, AppError<'File'>> =>
	Effect.gen(function* () {
		yield* validateEmpty(file);
		yield* validateSize(file, maxSize);
		yield* validateMimeType(file);
		return yield* extractMetadata(file);
	});
const validateContent = (mimeType: MimeType, content: string): Effect.Effect<string, AppError<'File'>> =>
	pipe(
		contentDecoders[mimeType](content),
		Effect.map(() => content),
		Effect.mapError(() => AppError.from('File', 'INVALID_CONTENT', AppError.withMimeType('Invalid file content', mimeType))),
	);

// --- [CONSTANTS] -------------------------------------------------------------

const mimeToCategory = Object.freeze(
	Object.fromEntries(
		(Object.entries(MIME_CONFIG) as ReadonlyArray<[MimeCategory, ReadonlyArray<MimeType>]>).flatMap(([category, mimes]) =>
			mimes.map((mime) => [mime, category] as const),
		),
	) as { readonly [K in MimeType]: MimeCategory },
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILES_TUNING, MIME_CONFIG, mimeToCategory, PngSizeSchema, validateContent, validateFile };
export type { ExportFormat, ExportInput, ExportVariant, FileMetadata, MimeCategory, MimeType };
