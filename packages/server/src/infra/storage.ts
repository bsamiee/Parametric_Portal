/**
 * S3-compatible object storage with tenant isolation.
 * [PATTERN] Effect.acquireRelease for multipart, overload interfaces for polymorphic API.
 */
import { S3, S3ClientInstance } from '@effect-aws/client-s3';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Buffer } from 'node:buffer';
import { Array as A, Chunk, Duration, Effect, Exit, Layer, Match, Metric, Option, Redacted, Stream, Struct } from 'effect';
import { constant } from 'effect/Function';
import { Env } from '../env.ts';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    batch:      { concurrency: 10, deleteLimit: 1000 },
    multipart:  { partSize: 5 * 1024 * 1024, threshold: 10 * 1024 * 1024 },
} as const;
const _layer = Layer.unwrapEffect(Env.Service.pipe(Effect.map((env) => S3.layer({
    credentials: {
        accessKeyId:     Redacted.value(env.storage.accessKeyId),
        secretAccessKey: Redacted.value(env.storage.secretAccessKey),
        ...Option.match(env.storage.sessionToken, { onNone: constant({}), onSome: (sessionToken) => ({ sessionToken: Redacted.value(sessionToken) }) }),
    },
    ...Option.match(env.storage.endpoint, { onNone: constant({}), onSome: (endpoint) => ({ endpoint }) }),
    forcePathStyle: env.storage.forcePathStyle,
    maxAttempts:    env.storage.maxAttempts,
    region:         env.storage.region,
    retryMode:      env.storage.retryMode,
}))));

// --- [FUNCTIONS] -------------------------------------------------------------

const _path = (key: string) => Context.Request.currentTenantId.pipe(Effect.map((t) => t === Context.Request.Id.system ? `system/${key}` : `tenants/${t}/${key}`));

// --- [SERVICES] --------------------------------------------------------------

class StorageAdapter extends Effect.Service<StorageAdapter>()('server/StorageAdapter', {
    effect: Effect.gen(function* () {
        const metrics = yield* MetricsService, s3 = yield* S3, env = yield* Env.Service;
        const bucket = env.storage.bucket;
        const track = <A, E, R>(op: string, eff: Effect.Effect<A, E, R>) =>
            Context.Request.currentTenantId.pipe(Effect.flatMap((t) => {
                const L = MetricsService.label({ op, tenant: t });
                return eff.pipe(Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, L)), Effect.tap(() => MetricsService.inc(metrics.storage.operations, L)), Effect.tapError(() => MetricsService.inc(metrics.storage.errors, L)));
            }));
        const _put = (input: { readonly key: string; readonly body: Uint8Array | string; readonly contentType?: string; readonly metadata?: Record<string, string> }) => _path(input.key).pipe(Effect.flatMap((key) => {
            const body = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
            return s3.putObject({ Body: body, Bucket: bucket, ContentType: input.contentType ?? 'application/octet-stream', Key: key, Metadata: input.metadata }).pipe(Effect.map((response) => ({ etag: response.ETag ?? '', key: input.key, size: body.length })));
        }));
        const _get = (key: string) => Effect.gen(function* () {
            const fk = yield* _path(key);
            const response = yield* s3.getObject({ Bucket: bucket, Key: fk });
            const chunks = yield* Option.match(Option.fromNullable(response.Body as AsyncIterable<Uint8Array> | null | undefined), {
                onNone: () => Effect.succeed(Chunk.empty<Uint8Array>()),
                onSome: (iterable) => Stream.runCollect(Stream.fromAsyncIterable(iterable, (error) => error as Error)),
            });
            const body = new Uint8Array(Buffer.concat(Chunk.toReadonlyArray(chunks)));
            return { body, contentType: response.ContentType ?? 'application/octet-stream', etag: Option.fromNullable(response.ETag), key, metadata: response.Metadata ?? {}, size: body.length };
        });
        const _copy = (input: { readonly sourceKey: string; readonly destKey: string; readonly metadata?: Record<string, string> }) => Effect.all([_path(input.sourceKey), _path(input.destKey)]).pipe(
            Effect.flatMap(([s, d]) => s3.copyObject({
                Bucket: bucket, CopySource: `${bucket}/${s}`, Key: d, Metadata: input.metadata,
                MetadataDirective: Option.fromNullable(input.metadata).pipe(Option.match({ onNone: () => 'COPY' as const, onSome: () => 'REPLACE' as const })),
            }).pipe(Effect.map((response) => ({ destKey: input.destKey, etag: response.CopyObjectResult?.ETag ?? '', sourceKey: input.sourceKey })))),
        );
        const _exists = (key: string) => _path(key).pipe(
            Effect.flatMap((fk) => s3.headObject({ Bucket: bucket, Key: fk })), Effect.as(true),
            Effect.catchTags({ NotFound: () => Effect.succeed(false), SdkError: () => Effect.succeed(false) }),
        );
        const put = (input: { readonly key: string; readonly body: Uint8Array | string; readonly contentType?: string; readonly metadata?: Record<string, string> } | readonly { readonly key: string; readonly body: Uint8Array | string; readonly contentType?: string; readonly metadata?: Record<string, string> }[]) =>
            Array.isArray(input)
                ? track('put.batch', Effect.forEach(input, _put, { concurrency: _CONFIG.batch.concurrency })).pipe(Telemetry.span('storage.put', { metrics: false }))
                : track('put', _put(input as { readonly key: string; readonly body: Uint8Array | string; readonly contentType?: string; readonly metadata?: Record<string, string> })).pipe(Telemetry.span('storage.put', { metrics: false }));
        const _getOne = (key: string) => track('get', _get(key)).pipe(Telemetry.span('storage.get', { metrics: false }));
        const _getMany = (keys: readonly string[]) => track('get.batch', Effect.forEach(keys, (key) => _get(key).pipe(Effect.either, Effect.map((either) => [key, either] as const)), { concurrency: _CONFIG.batch.concurrency }).pipe(Effect.map((entries) => new Map(entries)))).pipe(Telemetry.span('storage.get', { metrics: false }));
        const get: {
            (key: string): ReturnType<typeof _getOne>;
            (keys: readonly string[]): ReturnType<typeof _getMany>;
        } = ((input: string | readonly string[]) => Array.isArray(input) ? _getMany(input) : _getOne(input as string)) as never;
        const copy = (input: { readonly sourceKey: string; readonly destKey: string; readonly metadata?: Record<string, string> } | readonly { readonly sourceKey: string; readonly destKey: string; readonly metadata?: Record<string, string> }[]) =>
            Array.isArray(input)
                ? track('copy.batch', Effect.forEach(input, _copy, { concurrency: _CONFIG.batch.concurrency })).pipe(Telemetry.span('storage.copy', { metrics: false }))
                : track('copy', _copy(input as { readonly sourceKey: string; readonly destKey: string; readonly metadata?: Record<string, string> })).pipe(Telemetry.span('storage.copy', { metrics: false }));
        const exists = (input: string | readonly string[]) =>
            Array.isArray(input)
                ? track('head.batch', Effect.forEach(input, (key) => _exists(key).pipe(Effect.map((value) => [key, value] as const)), { concurrency: _CONFIG.batch.concurrency }).pipe(Effect.map((entries) => new Map(entries)))).pipe(Telemetry.span('storage.exists', { metrics: false }))
                : track('head', _exists(input as string)).pipe(Telemetry.span('storage.exists', { metrics: false }));
        const remove = (input: string | readonly string[]) =>
            track('delete', Effect.gen(function* () {
                const keys = A.ensure(input);
            const fullPaths = yield* Effect.forEach(keys, _path, { concurrency: 'unbounded' });
            const batches = A.chunksOf(fullPaths.map((f) => ({ Key: f })), _CONFIG.batch.deleteLimit);
            yield* Effect.forEach(batches, (b) => s3.deleteObjects({ Bucket: bucket, Delete: { Objects: b } }), { concurrency: _CONFIG.batch.concurrency });
            })).pipe(Telemetry.span('storage.remove', { metrics: false }));
        const list = (o?: { prefix?: string; maxKeys?: number; continuationToken?: string }) =>
            track('list', Effect.gen(function* () {
                const p = yield* _path(o?.prefix ?? '');
                const response = yield* s3.listObjectsV2({ Bucket: bucket, MaxKeys: o?.maxKeys ?? 1000, Prefix: p, ...(o?.continuationToken === undefined ? {} : { ContinuationToken: o.continuationToken }) });
                const prefixStrip = p.replace(o?.prefix ?? '', '');
                return {
                    continuationToken: response.NextContinuationToken, isTruncated: response.IsTruncated ?? false,
                    items: (response.Contents ?? []).map((x) => ({ etag: x.ETag ?? '', key: x.Key?.replace(prefixStrip, '') ?? '', lastModified: x.LastModified ?? new Date(), size: x.Size ?? 0 })),
                };
            })).pipe(Telemetry.span('storage.list', { metrics: false }));
        const listStream = (o?: { prefix?: string }) =>
            Stream.paginateEffect(undefined as string | undefined, (token) =>
                list({
                    ...(token === undefined ? {} : { continuationToken: token }),
                    ...(o?.prefix === undefined ? {} : { prefix: o.prefix }),
                }).pipe(Effect.map((response) => [response.items, response.isTruncated ? Option.fromNullable(response.continuationToken) : Option.none<string>()] as const)),
            ).pipe(Stream.flatMap((element) => Stream.fromIterable(element)));
        const sign = (input: { readonly op: 'get'; readonly key: string; readonly expires?: Duration.Duration } | { readonly op: 'put'; readonly key: string; readonly expires?: Duration.Duration } | { readonly op: 'copy'; readonly sourceKey: string; readonly destKey: string; readonly expires?: Duration.Duration }) => {
            const expiresIn = Math.floor(Duration.toSeconds(input.expires ?? Duration.hours(1)));
            return track(`sign-${input.op}`, Match.value(input).pipe(
                Match.when({ op: 'copy' }, (v) => Effect.all([_path(v.sourceKey), _path(v.destKey), S3ClientInstance.S3ClientInstance]).pipe(
                    Effect.flatMap(([src, dst, client]) => Effect.tryPromise({ catch: (error) => error as Error, try: () => getSignedUrl(client, new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${src}`, Key: dst }), { expiresIn }) })))),
                Match.when({ op: 'get' }, (v) => _path(v.key).pipe(Effect.flatMap((key) => s3.getObject({ Bucket: bucket, Key: key }, { expiresIn, presigned: true })))),
                Match.when({ op: 'put' }, (v) => _path(v.key).pipe(Effect.flatMap((key) => s3.putObject({ Bucket: bucket, Key: key }, { expiresIn, presigned: true })))),
                Match.exhaustive,
            )).pipe(Telemetry.span('storage.sign', { metrics: false }));
        };
        const getStream = (key: string) =>
            track('get-stream', _path(key).pipe(Effect.flatMap((fk) => s3.getObject({ Bucket: bucket, Key: fk })), Effect.map((response) => ({
                contentType: response.ContentType ?? 'application/octet-stream', etag: Option.fromNullable(response.ETag), size: response.ContentLength ?? 0,
                stream: Option.match(Option.fromNullable(response.Body as AsyncIterable<Uint8Array> | null | undefined), { onNone: () => Stream.empty, onSome: (iterable) => Stream.fromAsyncIterable(iterable, (error) => error as Error) }),
            })))).pipe(Telemetry.span('storage.getStream', { metrics: false }));
        const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
            track('put-stream', Effect.scoped(Effect.gen(function* () {
                const fk = yield* _path(input.key);
                const partSize = input.partSizeBytes ?? _CONFIG.multipart.partSize;
                const threshold = _CONFIG.multipart.threshold;
                const contentType = input.contentType ?? 'application/octet-stream';
                const pull = yield* Stream.toPull(input.stream);
                const _pullNext = () => pull.pipe(
                    Effect.map(Option.some),
                    Effect.catchAll((e) => Option.match(e, { onNone: () => Effect.succeed(Option.none<Chunk.Chunk<Uint8Array>>()), onSome: (err) => Effect.fail(err) })),
                );
                const _takePart = (s: { readonly done: boolean; readonly head: readonly Uint8Array[]; readonly tail: readonly Uint8Array[]; readonly size: number }, part: Uint8Array) =>
                    s.done ? { ...s, tail: A.append(s.tail, part) }
                        : part.length <= threshold - s.size ? { ...s, head: A.append(s.head, part), size: s.size + part.length }
                        : (() => { const headPart = part.slice(0, threshold - s.size); return { ...s, done: true, head: A.append(s.head, headPart), size: s.size + headPart.length, tail: A.append(s.tail, part.slice(threshold - s.size)) }; })();
                const headState = yield* Effect.iterate(
                    { done: false, ended: false, head: [] as readonly Uint8Array[], size: 0, tail: [] as readonly Uint8Array[] },
                    {
                        body: (s) => _pullNext().pipe(Effect.map(Option.match({
                            onNone: () => ({ ...s, done: true, ended: true }),
                            onSome: (chunk) => { const next = A.reduce(Chunk.toReadonlyArray(chunk), s, _takePart); return { ...next, ended: false }; },
                        }))),
                        while: (s) => !s.done,
                    },
                );
                const overflow = headState.tail.length > 0 ? Option.some(headState.tail) : Option.none<readonly Uint8Array[]>();
                const headBytes = Buffer.concat(headState.head);
                return yield* headState.ended && headState.size < threshold
                    ? s3.putObject({ Body: headBytes, Bucket: bucket, ContentType: contentType, Key: fk, Metadata: input.metadata }).pipe(Effect.map((response) => ({ etag: response.ETag ?? '', key: input.key, totalSize: headBytes.length })))
                    : Effect.gen(function* () {
                        const createRes = yield* s3.createMultipartUpload({ Bucket: bucket, ContentType: contentType, Key: fk, Metadata: input.metadata });
                        const uploadId = createRes?.UploadId ?? (yield* Effect.fail(new Error('Empty uploadId')));
                        const acquiredUid = yield* Effect.acquireRelease(
                            Effect.succeed(uploadId),
                            (uid, exit) => Exit.isFailure(exit) ? s3.abortMultipartUpload({ Bucket: bucket, Key: fk, UploadId: uid }).pipe(Effect.ignore) : Effect.void,
                        );
                        const _splitBuffer = (buffer: Uint8Array) => {
                            const count = Math.floor(buffer.length / partSize);
                            return { parts: A.makeBy(count, (idx) => buffer.slice(idx * partSize, (idx + 1) * partSize)), rest: buffer.slice(count * partSize) };
                        };
                        const tailStream = Stream.unfoldChunkEffect(undefined, () => _pullNext().pipe(Effect.map(Option.map((chunk) => [chunk, undefined] as const))));
                        const remainderStream = Stream.concat(Option.match(overflow, { onNone: () => Stream.empty, onSome: (chunks) => Stream.fromIterable(chunks) }), tailStream);
                        const headSplit = _splitBuffer(headBytes);
                        const headUploads = yield* Effect.forEach(headSplit.parts, (body, index) => s3.uploadPart({ Body: body, Bucket: bucket, Key: fk, PartNumber: index + 1, UploadId: acquiredUid }), { concurrency: 3 });
                        const headParts = A.map(headUploads, (response, index) => ({ ETag: response.ETag ?? '', PartNumber: index + 1 }));
                        const init = { buffer: headSplit.rest, nextPart: headParts.length + 1, parts: headParts, totalSize: headBytes.length };
                        const state = yield* Stream.runFoldEffect(remainderStream, init, (s, chunk) => {
                            const combined = Buffer.concat([s.buffer, chunk]);
                            const { parts, rest } = _splitBuffer(combined);
                            const start = s.nextPart;
                            return Effect.forEach(parts, (body, index) => s3.uploadPart({ Body: body, Bucket: bucket, Key: fk, PartNumber: start + index, UploadId: acquiredUid }), { concurrency: 3 }).pipe(
                                Effect.map((uploaded) => ({ buffer: rest, nextPart: start + parts.length, parts: A.appendAll(s.parts, A.map(uploaded, (response, index) => ({ ETag: response.ETag ?? '', PartNumber: start + index }))), totalSize: s.totalSize + chunk.length })),
                            );
                        });
                        const finalState = yield* state.buffer.length > 0
                            ? s3.uploadPart({ Body: state.buffer, Bucket: bucket, Key: fk, PartNumber: state.nextPart, UploadId: acquiredUid }).pipe(Effect.map((response) => ({ ...state, parts: A.append(state.parts, { ETag: response.ETag ?? '', PartNumber: state.nextPart }) })))
                            : Effect.succeed(state);
                        yield* s3.completeMultipartUpload({ Bucket: bucket, Key: fk, MultipartUpload: { Parts: finalState.parts }, UploadId: uploadId });
                        return { etag: A.last(finalState.parts).pipe(Option.map(Struct.get('ETag')), Option.getOrElse(constant(''))), key: input.key, totalSize: finalState.totalSize };
                    });
            }))).pipe(Telemetry.span('storage.putStream', { metrics: false }));
        const abortUpload = (key: string, uploadId: string) => track('abort-multipart', _path(key).pipe(Effect.flatMap((fk) => s3.abortMultipartUpload({ Bucket: bucket, Key: fk, UploadId: uploadId })))).pipe(Telemetry.span('storage.abortUpload', { metrics: false }));
        const listUploads = (o?: { prefix?: string }) =>
            track('list-multipart', Effect.gen(function* () {
                const p = yield* _path(o?.prefix ?? '');
                const response = yield* s3.listMultipartUploads({ Bucket: bucket, Prefix: p });
                const prefixStrip = p.replace(o?.prefix ?? '', '');
                return { uploads: (response.Uploads ?? []).map((u) => ({ initiated: u.Initiated ?? new Date(), key: u.Key?.replace(prefixStrip, '') ?? '', uploadId: u.UploadId ?? '' })) };
            })).pipe(Telemetry.span('storage.listUploads', { metrics: false }));
        yield* Effect.logInfo('StorageAdapter initialized', { bucket });
        return { abortUpload, copy, exists, get, getStream, list, listStream, listUploads, put, putStream, remove, sign };
    }),
}) { static readonly S3ClientLayer = _layer; }

// --- [EXPORT] ----------------------------------------------------------------

export { StorageAdapter };
