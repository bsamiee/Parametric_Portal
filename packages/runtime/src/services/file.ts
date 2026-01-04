/**
 * Provide file operations as Effect service via Context.Tag + Layer.
 * Bridges browser File API to Effect pipelines for reading and conversion.
 */
import { AppError } from '@parametric-portal/types/app-error';
import { Context, Effect, Layer, Option } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type FileOpsService = {
    readonly fromDataTransfer: (dataTransfer: DataTransfer | null) => Option.Option<ReadonlyArray<File>>;
    readonly fromFileList: (files: FileList | null) => Option.Option<ReadonlyArray<File>>;
    readonly toArrayBuffer: (file: File) => Effect.Effect<ArrayBuffer, AppError<'File'>>;
    readonly toDataUrl: (file: File) => Effect.Effect<string, AppError<'File'>>;
    readonly toText: (file: File) => Effect.Effect<string, AppError<'File'>>;
};

// --- [CLASSES] ---------------------------------------------------------------

class FileOps extends Context.Tag('FileOps')<FileOps, FileOpsService>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const fileOpsImpl: FileOpsService = {
    fromDataTransfer: (dataTransfer) =>
        Option.fromNullable(dataTransfer).pipe(
            Option.map((dt) => Array.from(dt.files)),
            Option.filter((arr) => arr.length > 0),
        ),
    fromFileList: (files) =>
        Option.fromNullable(files).pipe(
            Option.map(Array.from<File>),
            Option.filter((arr) => arr.length > 0),
        ),
    toArrayBuffer: (file) =>
        Effect.tryPromise({
            catch: () => AppError.from('File', 'READ_FAILED'),
            try: () => file.arrayBuffer(),
        }),
    toDataUrl: (file) =>
        Effect.async((resume) => {
            const reader = new FileReader();
            reader.onload = () => resume(Effect.succeed(reader.result as string));
            reader.onerror = () => resume(Effect.fail(AppError.from('File', 'READ_FAILED')));
            reader.readAsDataURL(file);
        }),
    toText: (file) =>
        Effect.tryPromise({
            catch: () => AppError.from('File', 'READ_FAILED'),
            try: () => file.text(),
        }),
};

// --- [LAYERS] ----------------------------------------------------------------

const FileOpsLive = Layer.succeed(FileOps, fileOpsImpl);

// --- [EXPORT] ----------------------------------------------------------------

export type { FileOpsService };
export { FileOps, FileOpsLive, fileOpsImpl };
