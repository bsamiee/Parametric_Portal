/** File validation, MIME dispatch, and content schema routing. */
import type { ParseResult } from 'effect';
import { Data, Effect, Option, pipe, Schema as S } from 'effect';
import { SvgSanitizedSchema } from './svg.ts';
import { NonNegativeInt, Timestamp } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type MimeType = S.Schema.Type<typeof MimeTypeSchema>
type MimeCategory = S.Schema.Type<typeof MimeCategorySchema>
type FileMetadata = S.Schema.Type<typeof FileMetadataSchema>

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	errors: {
		empty: { code: 'FILE_EMPTY', message: 'File is empty' },
		invalidContent: { code: 'INVALID_CONTENT', message: 'Invalid file content' },
		invalidType: { code: 'INVALID_TYPE', message: 'Unsupported file type' },
		readFailed: { code: 'READ_FAILED', message: 'Failed to read file' },
		tooLarge: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit' },
	},
	limits: { maxSizeBytes: 512 * 1024 },
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
	lastModified: Timestamp.schema,
	mimeType: MimeTypeSchema,
	name: S.NonEmptyTrimmedString,
	size: NonNegativeInt.schema,
});

const safeJsonParse = (s: string): Option.Option<unknown> =>
	Effect.try(() => JSON.parse(s)).pipe(Effect.option, Effect.runSync);
const JsonContentSchema = S.String.pipe(
	S.filter((s) => Option.isSome(safeJsonParse(s)), { message: () => 'Invalid JSON content' }),
	S.brand('JsonContent'),
);
const HtmlContentSchema = S.String.pipe(
	S.filter((s) => s.includes('<html') || s.includes('<!DOCTYPE'), { message: () => 'Invalid HTML content' }),
	S.brand('HtmlContent'),
);
const XmlContentSchema = S.String.pipe(
	S.filter((s) => s.includes('<?xml') || s.startsWith('<'), { message: () => 'Invalid XML content' }),
	S.brand('XmlContent'),
);
const PdfContentSchema = S.String.pipe(
	S.filter((s) => s.startsWith('%PDF'), { message: () => 'Invalid PDF content' }),
	S.brand('PdfContent'),
);
const GltfJsonContentSchema = S.String.pipe(
	S.filter(
		(s) =>
			safeJsonParse(s).pipe(
				Option.map((parsed) => parsed !== null && typeof parsed === 'object' && 'asset' in parsed),
				Option.getOrElse(() => false),
			),
		{ message: () => 'Invalid glTF JSON content' },
	),
	S.brand('GltfJsonContent'),
);
const PassthroughContentSchema = S.String.pipe(S.brand('PassthroughContent'));

// --- [CLASSES] ---------------------------------------------------------------

class FileError extends Data.TaggedError('FileError')<{
	readonly code: string;
	readonly message: string;
}> {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getCategory = (mimeType: MimeType): MimeCategory => categoryByMime[mimeType];
const extractMetadata = (file: File): Effect.Effect<FileMetadata, FileError> =>
	pipe(
		S.decodeUnknown(FileMetadataSchema)({
			lastModified: file.lastModified,
			mimeType: file.type,
			name: file.name,
			size: file.size,
		}),
		Effect.mapError((e) => new FileError({ code: B.errors.invalidType.code, message: e.message })),
	);

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
	(Object.entries(mimesByCategory) as ReadonlyArray<[MimeCategory, ReadonlyArray<MimeType>]>).flatMap(([cat, mimes]) =>
		mimes.map((m) => [m, cat]),
	),
) as Record<MimeType, MimeCategory>;
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
	'image/svg+xml': SvgSanitizedSchema,
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
const createDecoder = (schema: S.Schema.Any): ContentDecoder => (content: string) =>
	S.decodeUnknown(schema)(content) as Effect.Effect<string, ParseResult.ParseError, never>;
const contentDecoders = Object.freeze(
	Object.fromEntries(
		(Object.keys(contentSchemas) as ReadonlyArray<MimeType>).map((mime) => [mime, createDecoder(contentSchemas[mime])]),
	) as { [K in MimeType]: ContentDecoder },
);
const validationChecks = {
	empty: (file: File): Option.Option<FileError> =>
		file.size === 0 ? Option.some(new FileError(B.errors.empty)) : Option.none(),
	mimeType: (file: File): Option.Option<FileError> =>
		S.is(MimeTypeSchema)(file.type)
			? Option.none()
			: Option.some(new FileError({ code: B.errors.invalidType.code, message: `${B.errors.invalidType.message}: ${file.type}` })),
	size: (file: File, maxSize: number): Option.Option<FileError> =>
		file.size > maxSize
			? Option.some(new FileError({ code: B.errors.tooLarge.code, message: `${B.errors.tooLarge.message}: ${maxSize} bytes` }))
			: Option.none(),
} as const;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const checkOption = <T>(value: T, check: (v: T) => Option.Option<FileError>): Effect.Effect<T, FileError> =>
	pipe(check(value), Option.match({ onNone: () => Effect.succeed(value), onSome: Effect.fail }));
const validateFile = (file: File, maxSize: number = B.limits.maxSizeBytes): Effect.Effect<FileMetadata, FileError> =>
	Effect.gen(function* () {
		yield* checkOption(file, validationChecks.empty);
		yield* checkOption(file, (v) => validationChecks.size(v, maxSize));
		yield* checkOption(file, validationChecks.mimeType);
		return yield* extractMetadata(file);
	});
const validateContent = (mimeType: MimeType, content: string): Effect.Effect<string, FileError> =>
	pipe(
		contentDecoders[mimeType](content),
		Effect.map(() => content),
		Effect.mapError(() => new FileError({ code: B.errors.invalidContent.code, message: `${B.errors.invalidContent.message} for ${mimeType}` })),
	);
const isSupported = S.is(MimeTypeSchema);

// --- [EXPORT] ----------------------------------------------------------------

export {
	B as FILES_TUNING,
	categoryByMime,
	contentSchemas,
	extractMetadata,
	FileError,
	FileMetadataSchema,
	getCategory,
	isSupported,
	MimeCategorySchema,
	mimesByCategory,
	MimeTypeSchema,
	validateContent,
	validateFile,
	validationChecks,
};
export type { FileMetadata, MimeCategory, MimeType };
