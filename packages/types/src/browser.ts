/** Export operations and browser error handling via TaggedEnum. */
import { Data, pipe, Schema as S } from 'effect';
import { Index, VariantCount } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ExportFormat = S.Schema.Type<typeof ExportFormatSchema>
type ExportVariant = S.Schema.Type<typeof ExportVariantSchema>
type ExportInput = S.Schema.Type<typeof ExportInputSchema>
type BrowserError = Data.TaggedEnum<{
	Clipboard: { readonly code: string; readonly message: string };
	Download: { readonly code: string; readonly message: string };
	Export: { readonly code: string; readonly message: string };
	Storage: { readonly code: string; readonly message: string };
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	bounds: {
		pngSize: { max: 4096, min: 16 },
	},
	defaults: { mimeType: 'text/plain', pngSize: 512 },
	errors: {
		canvasContext: { code: 'CANVAS_CONTEXT', message: 'Failed to get canvas 2D context' },
		clipboardRead: { code: 'CLIPBOARD_READ', message: 'Failed to read from clipboard' },
		clipboardUnavailable: { code: 'CLIPBOARD_UNAVAILABLE', message: 'Clipboard API not available' },
		clipboardWrite: { code: 'CLIPBOARD_WRITE', message: 'Failed to write to clipboard' },
		downloadFailed: { code: 'DOWNLOAD_FAILED', message: 'Download failed' },
		exportFailed: { code: 'EXPORT_FAILED', message: 'Export failed' },
		noSvg: { code: 'NO_SVG', message: 'No SVG content to export' },
		noVariants: { code: 'NO_VARIANTS', message: 'No variants to export' },
		storageFailed: { code: 'STORAGE_FAILED', message: 'Storage operation failed' },
		storageRead: { code: 'STORAGE_READ', message: 'Failed to read from storage' },
		storageWrite: { code: 'STORAGE_WRITE', message: 'Failed to write to storage' },
	},
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

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

// --- [CLASSES] ---------------------------------------------------------------

const BrowserError = (() => {
	const taggedEnum = Data.taggedEnum<BrowserError>();
	return {
		...taggedEnum,
		format: (e: BrowserError): string =>
			taggedEnum.$match(e, {
				Clipboard: (c) => `[Clipboard:${c.code}] ${c.message}`,
				Download: (d) => `[Download:${d.code}] ${d.message}`,
				Export: (x) => `[Export:${x.code}] ${x.message}`,
				Storage: (s) => `[Storage:${s.code}] ${s.message}`,
			}),
	};
})();

// --- [EXPORT] ----------------------------------------------------------------

export type { ExportFormat, ExportInput, ExportVariant };
export { B as BROWSER_TUNING, BrowserError, ExportFormatSchema, ExportInputSchema, ExportVariantSchema, PngSizeSchema };
