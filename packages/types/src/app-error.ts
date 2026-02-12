/**
 * Define client-side domain errors via Data.TaggedError.
 * Individual tags per domain enable Effect.catchTag discrimination.
 */
import { Data } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class Browser extends Data.TaggedError('Browser')<{
    readonly cause?: unknown;
    readonly code: 'CANVAS_CONTEXT' | 'CLIPBOARD_READ' | 'CLIPBOARD_UNAVAILABLE' | 'CLIPBOARD_WRITE' | 'DOWNLOAD_FAILED' | 'EXPORT_FAILED' | 'NO_SVG' | 'NO_VARIANTS' | 'STORAGE_FAILED' | 'STORAGE_READ' | 'STORAGE_WRITE';
    readonly details?: string;
}> {override get message() { return this.details ? `Browser[${this.code}]: ${this.details}` : `Browser[${this.code}]`; }}

class Database extends Data.TaggedError('Database')<{
    readonly cause?: unknown;
    readonly code: 'NOT_FOUND';
    readonly details?: string;
}> {override get message() { return this.details ? `Database[${this.code}]: ${this.details}` : `Database[${this.code}]`; }}

class File extends Data.TaggedError('File')<{
    readonly cause?: unknown;
    readonly code: 'FILE_EMPTY' | 'FILE_TOO_LARGE' | 'INVALID_CONTENT' | 'INVALID_TYPE' | 'READ_FAILED';
    readonly details?: string;
}> {override get message() { return this.details ? `File[${this.code}]: ${this.details}` : `File[${this.code}]`; }}

class Messaging extends Data.TaggedError('Messaging')<{
    readonly cause?: unknown;
    readonly code: 'SEND_FAILED' | 'TIMEOUT' | 'VALIDATION_FAILED';
    readonly details?: string;
}> {override get message() { return this.details ? `Messaging[${this.code}]: ${this.details}` : `Messaging[${this.code}]`; }}

// --- [FACTORIES] -------------------------------------------------------------

const browser = (code: Browser['code'], details?: string, cause?: unknown) => new Browser({ code, ...(cause !== undefined && { cause }), ...(details !== undefined && { details }) });
const database = (code: Database['code'], details?: string, cause?: unknown) => new Database({ code, ...(cause !== undefined && { cause }), ...(details !== undefined && { details }) });
const file = (code: File['code'], details?: string, cause?: unknown) => new File({ code, ...(cause !== undefined && { cause }), ...(details !== undefined && { details }) });
const messaging = (code: Messaging['code'], details?: string, cause?: unknown) => new Messaging({ code, ...(cause !== undefined && { cause }), ...(details !== undefined && { details }) });

// --- [NAMESPACE] -------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const AppError = {
    browser,
    database,
    file,
    messaging
} as const;

namespace AppError {
    export type Any = Browser | Database | File | Messaging;
    export type Browser = InstanceType<typeof Browser>;
    export type Database = InstanceType<typeof Database>;
    export type File = InstanceType<typeof File>;
    export type Messaging = InstanceType<typeof Messaging>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AppError };
