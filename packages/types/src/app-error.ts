/**
 * Unify domain errors via Data.TaggedError for Effect.gen yield.
 * Enables catchTag discrimination, structured formatting, domain-scoped codes.
 */
import { Data } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ErrorDomain = keyof typeof B;
type ErrorCode<D extends ErrorDomain> = keyof typeof B[D];

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	Browser: {
		CANVAS_CONTEXT: { code: 'CANVAS_CONTEXT' as const, message: 'Failed to get canvas 2D context' },
		CLIPBOARD_READ: { code: 'CLIPBOARD_READ' as const, message: 'Failed to read from clipboard' },
		CLIPBOARD_UNAVAILABLE: { code: 'CLIPBOARD_UNAVAILABLE' as const, message: 'Clipboard API not available' },
		CLIPBOARD_WRITE: { code: 'CLIPBOARD_WRITE' as const, message: 'Failed to write to clipboard' },
		DOWNLOAD_FAILED: { code: 'DOWNLOAD_FAILED' as const, message: 'Download failed' },
		EXPORT_FAILED: { code: 'EXPORT_FAILED' as const, message: 'Export failed' },
		NO_SVG: { code: 'NO_SVG' as const, message: 'No SVG content to export' },
		NO_VARIANTS: { code: 'NO_VARIANTS' as const, message: 'No variants to export' },
		STORAGE_FAILED: { code: 'STORAGE_FAILED' as const, message: 'Storage operation failed' },
		STORAGE_READ: { code: 'STORAGE_READ' as const, message: 'Failed to read from storage' },
		STORAGE_WRITE: { code: 'STORAGE_WRITE' as const, message: 'Failed to write to storage' },
	},
	Database: {
		NOT_FOUND: { code: 'NOT_FOUND' as const, message: 'Record not found' },
	},
	File: {
		FILE_EMPTY: { code: 'FILE_EMPTY' as const, message: 'File is empty' },
		FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE' as const, message: 'File exceeds size limit' },
		INVALID_CONTENT: { code: 'INVALID_CONTENT' as const, message: 'Invalid file content' },
		INVALID_TYPE: { code: 'INVALID_TYPE' as const, message: 'Unsupported file type' },
		READ_FAILED: { code: 'READ_FAILED' as const, message: 'Failed to read file' },
	},
	Messaging: {
		SEND_FAILED: { code: 'SEND_FAILED' as const, message: 'Failed to send message' },
		TIMEOUT: { code: 'TIMEOUT' as const, message: 'Operation timed out' },
		VALIDATION_FAILED: { code: 'VALIDATION_FAILED' as const, message: 'Schema validation failed' },
	},
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class AppError<D extends ErrorDomain = ErrorDomain> extends Data.TaggedError('AppError')<{
	readonly code: ErrorCode<D>;
	readonly domain: D;
	readonly message: string;
}> {
	/** Format error for logging/display with domain:code prefix. */
	get formatted(): string { return `[${this.domain}:${String(this.code)}] ${this.message}`; }
	/** Construct from domain-scoped error code with optional message override. */
	static from<D extends ErrorDomain>(domain: D, key: ErrorCode<D>, message?: string): AppError<D> {
		const entry = B[domain][key] as { readonly code: string; readonly message: string };
		return new AppError({ code: entry.code as ErrorCode<D>, domain, message: message ?? entry.message });
	}
	/** Append API context to message for failed external calls. */
	static withApi(msg: string, api: string): string { return `${msg} (${api})`; }
	/** Append MIME type to message using brackets for machine-readable context. */
	static withMimeType(msg: string, type: string): string { return `${msg} [${type}]`; }
}

// --- [EXPORT] ----------------------------------------------------------------

export type { ErrorCode, ErrorDomain };
export { AppError };
