import { layer } from '@effect/opentelemetry/Otlp';
import { Clipboard } from '@effect/platform-browser';
import { AppError } from '@parametric-portal/types/app-error';
import { Codec, Metadata } from '@parametric-portal/types/files';
import { Svg } from '@parametric-portal/types/svg';
import { Effect, Layer, Match, Option, pipe, Ref, Schema as S, Stream } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
    n: { maxBytes: 512 * 1024, nameMax: 64, pngSize: 512, readConcurrency: 2 },
    s: {
        defaultName: 'export',
        mimeFallback: 'application/octet-stream',
        otlpPath: '/v1',
        svgMime: 'image/svg+xml',
        variant: 'variant',
    },
    span: {
        clipboard: { copy: 'browser.clipboard.copy', paste: 'browser.clipboard.paste' },
        download: 'browser.download',
        export: 'browser.export',
        file: 'browser.file.process',
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _name = (raw: string | undefined, ext: string, index: number | undefined, count: number | undefined) => {
    const base = pipe(
        Option.fromNullable(raw),
        Option.map((text) =>
            text
                .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
                .replaceAll(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
                .toLowerCase()
                .trim()
                .replaceAll(/[^a-z0-9 -]/g, '')
                .replaceAll(/[ -]+/g, '_')
                .slice(0, B.n.nameMax),
        ),
        Option.filter((name) => name.length > 0),
        Option.getOrElse(() => B.s.defaultName),
    );
    const file =
        count !== undefined && count > 1 && index !== undefined
            ? `${base}_${B.s.variant}_${index + 1}.${ext}`
            : `${base}.${ext}`;
    return { base, file } as const;
};
const _download = (data: Blob | string, filename: string): void => {
    const isBlob = data instanceof Blob;
    const href = isBlob ? URL.createObjectURL(data) : data;
    Object.assign(globalThis.document.createElement('a'), { download: filename, href }).click();
    isBlob && URL.revokeObjectURL(href);
};
const _requireSvg = (svg: string | undefined) =>
    pipe(
        Option.fromNullable(svg),
        Option.flatMap(Svg.sanitize),
        Effect.mapError(() => AppError.browser('NO_SVG')),
    );
function _read(file: globalThis.File, mode: 'arrayBuffer'): Effect.Effect<ArrayBuffer, AppError.File>;
function _read(file: globalThis.File, mode: 'dataUrl'): Effect.Effect<string, AppError.File>;
function _read(file: globalThis.File, mode: 'text'): Effect.Effect<string, AppError.File>;
function _read(file: globalThis.File, mode: 'stream'): Stream.Stream<Uint8Array, AppError.File>;
function _read(file: globalThis.File, mode: Browser.ReadMode,): Effect.Effect<ArrayBuffer | string, AppError.File> | Stream.Stream<Uint8Array, AppError.File> {
    return Match.value(mode).pipe(
        Match.when('arrayBuffer', () => Effect.tryPromise({ catch: () => AppError.file('READ_FAILED'), try: () => file.arrayBuffer() }),),
        Match.when('text', () => Effect.tryPromise({ catch: () => AppError.file('READ_FAILED'), try: () => file.text() }), ),
        Match.when('dataUrl', () =>
            Effect.async<string, AppError.File>((resume) => {
                const reader = new FileReader();
                reader.onload = () =>
                    resume(
                        pipe(
                            Option.fromNullable(reader.result),
                            Option.filter((result): result is string => typeof result === 'string'),
                            Effect.mapError(() => AppError.file('READ_FAILED')),
                        ),
                    );
                reader.onerror = () => resume(Effect.fail(AppError.file('READ_FAILED')));
                reader.readAsDataURL(file);
            }),
        ),
        Match.when('stream', () => Stream.fromReadableStream({ evaluate: () => file.stream(), onError: () => AppError.file('READ_FAILED') }),),
        Match.exhaustive,
    );
}

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _export = {
    png: (input: Browser.ExportInput): Effect.Effect<void, AppError.Browser> => {
        const size = input.pngSize ?? B.n.pngSize;
        const name = _name(input.filename, input.format, input.variantIndex, input.variantCount);
        return Effect.gen(function* () {
            const svg = yield* _requireSvg(input.svg);
            const canvas = Object.assign(globalThis.document.createElement('canvas'), { height: size, width: size });
            const ctx = yield* Option.fromNullable(canvas.getContext('2d')).pipe(Effect.mapError(() => AppError.browser('CANVAS_CONTEXT')),);
            yield* Effect.async<void, AppError.Browser>((resume) => {
                const url = URL.createObjectURL(new Blob([svg], { type: B.s.svgMime }));
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, size, size);
                    _download(canvas.toDataURL(`image/${input.format}`), name.file);
                    URL.revokeObjectURL(url);
                    resume(Effect.void);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    resume(Effect.fail(AppError.browser('EXPORT_FAILED')));
                };
                img.src = url;
            });
        }).pipe(Effect.withSpan(`${B.span.export}.${input.format}`, { attributes: { format: input.format, size } }));
    },
    svg: (input: Browser.ExportInput): Effect.Effect<void, AppError.Browser> => {
        const name = _name(input.filename, input.format, input.variantIndex, input.variantCount);
        return _requireSvg(input.svg).pipe(
            Effect.tap((svg) => Effect.sync(() => _download(new Blob([svg], { type: B.s.svgMime }), name.file))),
            Effect.asVoid,
            Effect.withSpan(`${B.span.export}.${input.format}`, { attributes: { format: input.format } }),
        );
    },
    zip: (input: Browser.ExportInput): Effect.Effect<void, AppError.Browser> => {
        const name = _name(input.filename, input.format, undefined, undefined);
        const exportError = (cause: unknown) => AppError.browser('EXPORT_FAILED', undefined, cause);
        return Effect.gen(function* () {
            const variants = yield* pipe(
                Option.fromNullable(input.variants),
                Option.filter((v) => v.length > 0),
                Effect.mapError(() => AppError.browser('NO_VARIANTS')),
            );
            const { default: JSZip } = yield* Effect.tryPromise({ catch: exportError, try: () => import('jszip') });
            const zip = new JSZip();
            const total = variants.length;
            variants.forEach((content, index) => {
                Option.map(Svg.sanitize(content), (sanitized) => zip.file(`${name.base}_${B.s.variant}_${index + 1}.svg`, sanitized),);
                input.onProgress?.((index + 1) / total);
            });
            const blob = yield* Effect.tryPromise({
                catch: exportError,
                try: () => zip.generateAsync({ type: 'blob' }),
            });
            _download(blob, name.file);
        }).pipe(
            Effect.withSpan(`${B.span.export}.${input.format}`, {attributes: { format: input.format, variantCount: input.variants?.length ?? 0 },}),
        );
    },
} as const satisfies Record<Browser.ExportFormat, (input: Browser.ExportInput) => Effect.Effect<void, AppError.Browser>>;
const _processOne = <T extends Codec.Mime>(
    file: globalThis.File,
    allowedTypes: Browser.AllowedMime | undefined,
    maxSizeBytes: number,): Effect.Effect<Browser.Processed<T>, AppError.File> =>
    Effect.gen(function* () {
        yield* Effect.filterOrFail(
            Effect.succeed(file.size),
            (size) => size > 0,
            () => AppError.file('FILE_EMPTY'),
        );
        yield* Effect.filterOrFail(
            Effect.succeed(file.size),
            (size) => size <= maxSizeBytes,
            () => AppError.file('FILE_TOO_LARGE'),
        );
        const codec = yield* pipe(
            Option.fromNullable(file.type),
            Option.filter((t) => t.length > 0),
            Option.map((type) => Codec(type)),
            Option.match({
                onNone: () => _read(file, 'arrayBuffer').pipe(Effect.map((buf) => Codec(buf))),
                onSome: (resolved) => Effect.succeed(resolved),
            }),
        );
        const metadata = yield* S.decodeUnknown(Metadata)({ mime: codec.mime, name: file.name, size: file.size }).pipe(
            Effect.mapError((error) => AppError.file('INVALID_TYPE', undefined, error)),
            Effect.filterOrFail(
                (meta): meta is Metadata & { mime: T } => allowedTypes == null || allowedTypes.includes(meta.mime as Codec.Mime),
                () => AppError.file('INVALID_TYPE'),
            ),
        );
        const content = yield* _read(file, 'text').pipe(
            Effect.flatMap((text) =>
                metadata.mime === B.s.svgMime
                    ? Option.match(Svg.sanitize(text), {
                          onNone: () => Effect.fail(AppError.file('INVALID_CONTENT')),
                          onSome: Effect.succeed,
                      })
                    : Effect.succeed(text),
            ),
        );
        const dataUrl = yield* _read(file, 'dataUrl');
        return { content, dataUrl, metadata };
    }).pipe(Effect.withSpan(B.span.file, { attributes: { size: file.size } }));
function _process<T extends Codec.Mime>(input: globalThis.File, allowedTypes?: Browser.AllowedMime, maxSizeBytes?: number,): Effect.Effect<Browser.Processed<T>, AppError.File>;
function _process<T extends Codec.Mime>(input: ReadonlyArray<globalThis.File>, allowedTypes?: Browser.AllowedMime, maxSizeBytes?: number, onProgress?: (progress: number) => void,): Effect.Effect<ReadonlyArray<Browser.Processed<T>>, AppError.File>;
function _process<T extends Codec.Mime>(input: globalThis.File | ReadonlyArray<globalThis.File>, allowedTypes?: Browser.AllowedMime, maxSizeBytes?: number, onProgress?: (progress: number) => void,): Effect.Effect<Browser.Processed<T> | ReadonlyArray<Browser.Processed<T>>, AppError.File> {
    const size = maxSizeBytes ?? B.n.maxBytes;
    return Match.value(input).pipe(
        Match.when(
            (i: globalThis.File | ReadonlyArray<globalThis.File>): i is ReadonlyArray<globalThis.File> => Array.isArray(i),
            (files) =>
                Effect.gen(function* () {
                    const total = files.length;
                    const completed = yield* Ref.make(0);
                    return yield* Effect.forEach(
                        files,
                        (file) =>
                            _processOne<T>(file, allowedTypes, size).pipe(
                                Effect.tap(() => Ref.updateAndGet(completed, (n) => n + 1).pipe(Effect.tap((n) => Effect.sync(() => onProgress?.(n / total))),),),
                            ),
                        { concurrency: B.n.readConcurrency },
                    );
                }),
        ),
        Match.orElse((file) => _processOne<T>(file, allowedTypes, size)),
    );
}

// --- [SERVICES] --------------------------------------------------------------

class BrowserService extends Effect.Service<BrowserService>()('runtime/Browser', {
    dependencies: [Clipboard.layer],
    effect: Effect.gen(function* () {
        const clipboard = yield* Clipboard.Clipboard;
        return {
            copy: (text: string) =>
                clipboard.writeString(text).pipe(
                    Effect.mapError((e) => AppError.browser('CLIPBOARD_WRITE', undefined, e)),
                    Effect.withSpan(B.span.clipboard.copy),
                ),
            download: (data: Blob | string, filename: string, mimeType = B.s.mimeFallback) =>
                Effect.sync(() =>
                    _download(data instanceof Blob ? data : new Blob([data], { type: mimeType }), filename),
                ).pipe(Effect.withSpan(B.span.download)),
            export: (input: Browser.ExportInput) => _export[input.format](input),
            paste: clipboard.readString.pipe(
                Effect.mapError((e) => AppError.browser('CLIPBOARD_READ', undefined, e)),
                Effect.withSpan(B.span.clipboard.paste),
            ),
        } as const;
    }),
}) {static readonly Layer = BrowserService.Default.pipe(Layer.provideMerge(Clipboard.layer));}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Browser = {
    File: {
        fromTransfer: (source: DataTransfer | FileList | null) =>
            pipe(
                Option.fromNullable(source),
                Option.map((src) => Array.from('files' in src ? src.files : src)),
                Option.filter((files) => files.length > 0),
            ),
        process: _process,
        read: _read,
    },
    Service: BrowserService,
    Telemetry: {
        layer: (config: Browser.TelemetryConfig) =>
            Match.value(config.enabled).pipe(
                Match.when(true, () =>
                    layer({
                        baseUrl: `${config.apiUrl}${B.s.otlpPath}`,
                        resource: { serviceName: config.serviceName },
                    }),
                ),
                Match.orElse(() => Layer.empty),
            ),
    },
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Browser {
    export type ExportFormat = 'png' | 'svg' | 'zip';
    export type ExportInput = {
        readonly filename?: string;
        readonly format: ExportFormat;
        readonly onProgress?: (progress: number) => void;
        readonly pngSize?: number;
        readonly svg?: string;
        readonly variantCount?: number;
        readonly variantIndex?: number;
        readonly variants?: ReadonlyArray<string>;
    };
    export type TelemetryConfig = { readonly apiUrl: string; readonly enabled: boolean; readonly serviceName: string };
    export type AllowedMime = ReadonlyArray<Codec.Mime>;
    export type ReadMode = 'arrayBuffer' | 'dataUrl' | 'text' | 'stream';
    export type Processed<T extends Codec.Mime = Codec.Mime> = {readonly content: string; readonly dataUrl: string; readonly metadata: Metadata & { mime: T };};
}

// --- [EXPORT] ----------------------------------------------------------------

export { Browser };
