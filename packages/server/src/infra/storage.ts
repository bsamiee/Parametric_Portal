/**
 * S3-compatible object storage with tenant isolation.
 * [PATTERN] Effect.acquireRelease for multipart, overload interfaces for polymorphic API.
 */
import { S3, S3ClientInstance } from '@effect-aws/client-s3';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Array as A, Chunk, Config, Duration, Effect, type Either, Exit, Layer, Match, Metric, Option, Redacted, Stream } from 'effect';
import { constant } from 'effect/Function';
import { Struct } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	batch: 		{ concurrency: 10, deleteLimit: 1000 },
	multipart: 	{ partSize: 5 * 1024 * 1024, threshold: 10 * 1024 * 1024 },
} as const;
const _ENV = Config.all({
	accessKeyId: 		Config.redacted('STORAGE_ACCESS_KEY_ID'),
	bucket: 			Config.string('STORAGE_BUCKET'),
	endpoint: 			Config.option(Config.string('STORAGE_ENDPOINT')),
	forcePathStyle: 	Config.boolean('STORAGE_FORCE_PATH_STYLE').pipe(Config.withDefault(false)),
	region: 			Config.string('STORAGE_REGION').pipe(Config.withDefault('us-east-1')),
	secretAccessKey: 	Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _path = (key: string) => Context.Request.currentTenantId.pipe(Effect.map((t) => t === Context.Request.Id.system ? `system/${key}` : `tenants/${t}/${key}`));
const _concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => chunks.reduce((acc, c) => { const r = new Uint8Array(acc.length + c.length); r.set(acc); r.set(c, acc.length); return r; }, new Uint8Array(0));

// --- [LAYERS] ----------------------------------------------------------------

const _layer = Layer.unwrapEffect(_ENV.pipe(Effect.map((c) => S3.layer({
	credentials: { accessKeyId: Redacted.value(c.accessKeyId), secretAccessKey: Redacted.value(c.secretAccessKey) },
	endpoint: Option.getOrUndefined(c.endpoint), forcePathStyle: c.forcePathStyle, region: c.region,
}))));

// --- [SERVICE] ---------------------------------------------------------------

class StorageAdapter extends Effect.Service<StorageAdapter>()('server/StorageAdapter', {
		effect: Effect.gen(function* () {
			const metrics = yield* MetricsService, s3 = yield* S3, { bucket } = yield* _ENV;
			const track = <A, E, R>(op: string, eff: Effect.Effect<A, E, R>) =>
				Context.Request.currentTenantId.pipe(Effect.flatMap((t) => {
					const L = MetricsService.label({ op, tenant: t });
					return eff.pipe(
						Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, L)),
						Effect.tap(() => MetricsService.inc(metrics.storage.operations, L)),
						Effect.tapError(() => MetricsService.inc(metrics.storage.errors, L)),
					);
				}));
			const _dispatch = <I, A, B, E, R>(
				input: I | readonly I[],
				operation: {
					readonly names: { readonly batch: string; readonly single: string };
					readonly batch: (items: readonly I[]) => Effect.Effect<B, E, R>;
					readonly single: (item: I) => Effect.Effect<A, E, R>;
				},
			): Effect.Effect<A | B, E, R> => (Array.isArray(input)
				? track(operation.names.batch, operation.batch(input))
				: track(operation.names.single, operation.single(input as I)));
			// --- [PUT] ---------------------------------------------------------------
			const _put = (input: StorageAdapter.PutInput) => _path(input.key).pipe(Effect.flatMap((key) => {
				const body = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
				return s3.putObject({ Body: body, Bucket: bucket, ContentType: input.contentType ?? 'application/octet-stream', Key: key, Metadata: input.metadata }).pipe(
					Effect.map((response) => ({ etag: response.ETag ?? '', key: input.key, size: body.length })),
				);
			}));
			// --- [GET] ---------------------------------------------------------------
			const _get = (key: string) => Effect.gen(function* () {
				const fk = yield* _path(key);
				const response = yield* s3.getObject({ Bucket: bucket, Key: fk });
				const chunks = yield* Option.match(Option.fromNullable(response.Body as AsyncIterable<Uint8Array> | null | undefined), {
					onNone: () => Effect.succeed(Chunk.empty<Uint8Array>()),
					onSome: (iterable) => Stream.runCollect(Stream.fromAsyncIterable(iterable, (error) => error as Error)),
				});
				const body = _concatBytes(Chunk.toReadonlyArray(chunks));
				return { body, contentType: response.ContentType ?? 'application/octet-stream', etag: Option.fromNullable(response.ETag), key, metadata: response.Metadata ?? {}, size: body.length };
			});
			// --- [COPY] --------------------------------------------------------------
			const _copy = (input: StorageAdapter.CopyInput) => Effect.all([_path(input.sourceKey), _path(input.destKey)]).pipe(
				Effect.flatMap(([s, d]) => s3.copyObject({
				Bucket: bucket,
				CopySource: `${bucket}/${s}`,
				Key: d,
				Metadata: input.metadata,
				MetadataDirective: Option.fromNullable(input.metadata).pipe(Option.match({ onNone: () => 'COPY' as const, onSome: () => 'REPLACE' as const })),
				}).pipe(Effect.map((response) => ({ destKey: input.destKey, etag: response.CopyObjectResult?.ETag ?? '', sourceKey: input.sourceKey })))),
			);
			// --- [EXISTS] ------------------------------------------------------------
			const _exists = (key: string) => _path(key).pipe(
				Effect.flatMap((fk) => s3.headObject({ Bucket: bucket, Key: fk })),
				Effect.as(true),
				Effect.catchTags({
					NotFound: () => Effect.succeed(false),
					SdkError: () => Effect.succeed(false),
				}),
			);
			const _operations = {
				copy: {
					batch: (items: readonly StorageAdapter.CopyInput[]) => Effect.forEach(items, _copy, { concurrency: _CONFIG.batch.concurrency }),
					names: { batch: 'copy.batch', single: 'copy' },
					single: _copy,
				},
				exists: {
					batch: (items: readonly string[]) => Effect.forEach(items, (key) =>
						_exists(key).pipe(Effect.map((value) => [key, value] as const)), { concurrency: _CONFIG.batch.concurrency }).pipe(
						Effect.map((entries) => new Map(entries)),
					),
					names: { batch: 'head.batch', single: 'head' },
					single: _exists,
				},
				get: {
					batch: (items: readonly string[]) => Effect.forEach(items, (key) =>
						_get(key).pipe(Effect.either, Effect.map((either) => [key, either] as const)), { concurrency: _CONFIG.batch.concurrency }).pipe(
						Effect.map((entries) => new Map(entries)),
					),
					names: { batch: 'get.batch', single: 'get' },
					single: _get,
				},
				put: {
					batch: (items: readonly StorageAdapter.PutInput[]) => Effect.forEach(items, _put, { concurrency: _CONFIG.batch.concurrency }),
					names: { batch: 'put.batch', single: 'put' },
					single: _put,
				},
			} as const;
			const put: StorageAdapter.Put = ((input: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]) => _dispatch(input, _operations.put).pipe(Telemetry.span('storage.put', { metrics: false }))) as StorageAdapter.Put;
			const get: StorageAdapter.Get = ((input: string | readonly string[]) => _dispatch(input, _operations.get).pipe(Telemetry.span('storage.get', { metrics: false }))) as StorageAdapter.Get;
			const copy: StorageAdapter.Copy = ((input: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]) => _dispatch(input, _operations.copy).pipe(Telemetry.span('storage.copy', { metrics: false }))) as StorageAdapter.Copy;
			const exists: StorageAdapter.Exists = ((input: string | readonly string[]) => _dispatch(input, _operations.exists).pipe(Telemetry.span('storage.exists', { metrics: false }))) as StorageAdapter.Exists;
		// --- [REMOVE] ------------------------------------------------------------
		const remove: StorageAdapter.Remove = ((input: string | readonly string[]) => track('delete', Effect.gen(function* () {
			const keys = A.ensure(input);
			const fullPaths = yield* Effect.forEach(keys, _path, { concurrency: 'unbounded' });
			const objects = fullPaths.map((f) => ({ Key: f }));
			const batches = A.chunksOf(objects, _CONFIG.batch.deleteLimit);
			yield* Effect.forEach(batches, (b) => s3.deleteObjects({ Bucket: bucket, Delete: { Objects: b } }), { concurrency: _CONFIG.batch.concurrency });
			})).pipe(Telemetry.span('storage.remove', { metrics: false }))) as StorageAdapter.Remove;
		// --- [LIST] --------------------------------------------------------------
		const list = (o?: { prefix?: string; maxKeys?: number; continuationToken?: string }) =>
			track('list', Effect.gen(function* () {
				const p = yield* _path(o?.prefix ?? '');
				const response = yield* s3.listObjectsV2({ Bucket: bucket, ContinuationToken: o?.continuationToken, MaxKeys: o?.maxKeys ?? 1000, Prefix: p });
				const prefixStrip = p.replace(o?.prefix ?? '', '');
				const items = (response.Contents ?? []).map((x) => ({
					etag: x.ETag ?? '',
					key: x.Key?.replace(prefixStrip, '') ?? '',
					lastModified: x.LastModified ?? new Date(),
					size: x.Size ?? 0,
				}));
				return { continuationToken: response.NextContinuationToken, isTruncated: response.IsTruncated ?? false, items };
				})).pipe(Telemetry.span('storage.list', { metrics: false }));
		const listStream = (o?: { prefix?: string }) =>
			Stream.paginateEffect(undefined as string | undefined, (token) =>
				list({ continuationToken: token, prefix: o?.prefix }).pipe(
					Effect.map((response) => {
						const next = response.isTruncated ? Option.fromNullable(response.continuationToken) : Option.none<string>();
						return [response.items, next] as const;
					}),
				),
			).pipe(Stream.flatMap((element) => Stream.fromIterable(element)));
		// --- [SIGN] --------------------------------------------------------------
		// Overloads for type-safe presigned URL generation - 'get'/'put' don't require S3ClientInstance
		function sign(input: StorageAdapter.SignInputGetPut): Effect.Effect<string>;
		function sign(input: StorageAdapter.SignInputCopy): Effect.Effect<string, unknown, S3ClientInstance.S3ClientInstance>;
		function sign(input: StorageAdapter.SignInput): Effect.Effect<string, unknown, S3ClientInstance.S3ClientInstance>;
		function sign(input: StorageAdapter.SignInput) {
			const expiresIn = Math.floor(Duration.toSeconds(input.expires ?? Duration.hours(1)));
			const signCopyUrl = (src: string, dst: string, client: typeof S3ClientInstance.S3ClientInstance.Service) =>
				Effect.tryPromise({ catch: (error) => error as Error, try: () => getSignedUrl(client, new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${src}`, Key: dst }), { expiresIn }) });
			return track(`sign-${input.op}`, Match.value(input).pipe(
				Match.when({ op: 'copy' }, (v) => Effect.all([_path(v.sourceKey), _path(v.destKey), S3ClientInstance.S3ClientInstance]).pipe(Effect.flatMap(([src, dst, client]) => signCopyUrl(src, dst, client)))),
				Match.when({ op: 'get' }, (v) => _path(v.key).pipe(Effect.flatMap((key) => s3.getObject({ Bucket: bucket, Key: key }, { expiresIn, presigned: true })))),
				Match.when({ op: 'put' }, (v) => _path(v.key).pipe(Effect.flatMap((key) => s3.putObject({ Bucket: bucket, Key: key }, { expiresIn, presigned: true })))),
				Match.exhaustive,
				)).pipe(Telemetry.span('storage.sign', { metrics: false }));
		}
		// --- [STREAM] ------------------------------------------------------------
		const getStream = (key: string) =>
			track('get-stream', Effect.gen(function* () {
				const fk = yield* _path(key);
				const response = yield* s3.getObject({ Bucket: bucket, Key: fk });
				const stream = Option.match(Option.fromNullable(response.Body as AsyncIterable<Uint8Array> | null | undefined), {
					onNone: () => Stream.empty,
					onSome: (iterable) => Stream.fromAsyncIterable(iterable, (error) => error as Error),
				});
				return { contentType: response.ContentType ?? 'application/octet-stream', etag: Option.fromNullable(response.ETag), size: response.ContentLength ?? 0, stream };
				})).pipe(Telemetry.span('storage.getStream', { metrics: false }));
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			track('put-stream', Effect.scoped(Effect.gen(function* () {
				const fk = yield* _path(input.key);
				const partSize = input.partSizeBytes ?? _CONFIG.multipart.partSize;
				const threshold = _CONFIG.multipart.threshold;
				const contentType = input.contentType ?? 'application/octet-stream';
				const pull = yield* Stream.toPull(input.stream);
				const _pullNext = () => pull.pipe(
					Effect.map(Option.some),
					Effect.catchAll((e) => Option.match(e, {
						onNone: () => Effect.succeed(Option.none<Chunk.Chunk<Uint8Array>>()),
						onSome: (err) => Effect.fail(err),
					})),
				);
				const _takePart = (s: { readonly done: boolean; readonly head: readonly Uint8Array[]; readonly tail: readonly Uint8Array[]; readonly size: number }, part: Uint8Array) =>
					Match.value(s.done).pipe(
						Match.when(true, () => ({ ...s, tail: A.append(s.tail, part) })),
						Match.orElse(() => {
							const remaining = threshold - s.size;
							return Match.value(part.length <= remaining).pipe(
								Match.when(true, () => ({ ...s, head: A.append(s.head, part), size: s.size + part.length })),
								Match.orElse(() => {
									const headPart = part.slice(0, remaining);
									const tailPart = part.slice(remaining);
									return { ...s, done: true, head: A.append(s.head, headPart), size: s.size + headPart.length, tail: A.append(s.tail, tailPart) };
								}),
							);
						}),
					);
				const headState = yield* Effect.iterate(
					{ done: false, ended: false, head: [] as readonly Uint8Array[], size: 0, tail: [] as readonly Uint8Array[] },
					{
						body: (s) => _pullNext().pipe(Effect.map(Option.match({
							onNone: () => ({ ...s, done: true, ended: true }),
							onSome: (chunk) => {
								const parts = Chunk.toReadonlyArray(chunk);
								const next = A.reduce(parts, s, _takePart);
								return { ...next, ended: false };
							},
						}))),
						while: (s) => !s.done,
					},
				);
				const overflow = Match.value(headState.tail.length > 0).pipe(
					Match.when(true, () => Option.some(headState.tail)),
					Match.orElse(() => Option.none<readonly Uint8Array[]>()),
				);
				const headBytes = _concatBytes(headState.head);
				const useSimplePut = headState.ended && headState.size < threshold;
				return yield* Match.value(useSimplePut).pipe(
					Match.when(true, () =>
						s3.putObject({ Body: headBytes, Bucket: bucket, ContentType: contentType, Key: fk, Metadata: input.metadata }).pipe(
							Effect.map((response) => ({ etag: response.ETag ?? '', key: input.key, totalSize: headBytes.length })),
						),
					),
					Match.orElse(() => Effect.gen(function* () {
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
						const tailStream = Stream.unfoldChunkEffect(undefined, () =>_pullNext().pipe(Effect.map(Option.map((chunk) => [chunk, undefined] as const))),);
						const remainderStream = Stream.concat(
							Option.match(overflow, { onNone: () => Stream.empty, onSome: (chunks) => Stream.fromIterable(chunks) }),
							tailStream,
						);
						const headSplit = _splitBuffer(headBytes);
						const headUploads = yield* Effect.forEach(headSplit.parts, (body, index) => s3.uploadPart({ Body: body, Bucket: bucket, Key: fk, PartNumber: index + 1, UploadId: acquiredUid }), { concurrency: 3 });
						const headParts = A.map(headUploads, (response, index) => ({ ETag: response.ETag ?? '', PartNumber: index + 1 }));
						const init = { buffer: headSplit.rest, nextPart: headParts.length + 1, parts: headParts, totalSize: headBytes.length };
						const state = yield* Stream.runFoldEffect(remainderStream, init, (s, chunk) => {
							const combined = _concatBytes([s.buffer, chunk]);
							const { parts, rest } = _splitBuffer(combined);
							const start = s.nextPart;
							return Effect.forEach(parts, (body, index) => s3.uploadPart({ Body: body, Bucket: bucket, Key: fk, PartNumber: start + index, UploadId: acquiredUid }), { concurrency: 3 }).pipe(
								Effect.map((uploaded) => ({
									buffer: rest,
									nextPart: start + parts.length,
									parts: A.appendAll(s.parts, A.map(uploaded, (response, index) => ({ ETag: response.ETag ?? '', PartNumber: start + index }))),
									totalSize: s.totalSize + chunk.length,
								})),
							);
						});
						const finalState = yield* Match.value(state.buffer.length > 0).pipe(
							Match.when(true, () =>
								s3.uploadPart({ Body: state.buffer, Bucket: bucket, Key: fk, PartNumber: state.nextPart, UploadId: acquiredUid }).pipe(
									Effect.map((response) => ({ ...state, parts: A.append(state.parts, { ETag: response.ETag ?? '', PartNumber: state.nextPart }) })),
								),
							),
							Match.orElse(() => Effect.succeed(state)),
						);
						yield* s3.completeMultipartUpload({ Bucket: bucket, Key: fk, MultipartUpload: { Parts: finalState.parts }, UploadId: uploadId });
						const etag = A.last(finalState.parts).pipe(Option.map(Struct.get('ETag')), Option.getOrElse(constant('')));
						return { etag, key: input.key, totalSize: finalState.totalSize };
					})),
				);
				}))).pipe(Telemetry.span('storage.putStream', { metrics: false }));
			const abortUpload = (key: string, uploadId: string) => track('abort-multipart', _path(key).pipe(Effect.flatMap((fk) => s3.abortMultipartUpload({ Bucket: bucket, Key: fk, UploadId: uploadId })))).pipe(Telemetry.span('storage.abortUpload', { metrics: false }));
		const listUploads = (o?: { prefix?: string }) =>
			track('list-multipart', Effect.gen(function* () {
				const p = yield* _path(o?.prefix ?? '');
				const response = yield* s3.listMultipartUploads({ Bucket: bucket, Prefix: p });
				const prefixStrip = p.replace(o?.prefix ?? '', '');
				const uploads = (response.Uploads ?? []).map((u) => ({
					initiated: u.Initiated ?? new Date(),
					key: u.Key?.replace(prefixStrip, '') ?? '',
					uploadId: u.UploadId ?? '',
				}));
				return { uploads };
				})).pipe(Telemetry.span('storage.listUploads', { metrics: false }));
		yield* Effect.logInfo('StorageAdapter initialized', { bucket });
		return { abortUpload, copy, exists, get, getStream, list, listStream, listUploads, put, putStream, remove, sign };
	}),
}) {static readonly S3ClientLayer = _layer;}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StorageAdapter {
	export type PutInput = { readonly key: string; readonly body: Uint8Array | string; readonly contentType?: string; readonly metadata?: Record<string, string> };
	export type PutResult = { readonly key: string; readonly etag: string; readonly size: number };
	export type GetResult = { readonly body: Uint8Array; readonly contentType: string; readonly etag: Option.Option<string>; readonly key: string; readonly metadata: Record<string, string>; readonly size: number };
	export type GetStreamResult = { readonly contentType: string; readonly etag: Option.Option<string>; readonly size: number; readonly stream: Stream.Stream<Uint8Array, Error> };
	export type CopyInput = { readonly sourceKey: string; readonly destKey: string; readonly metadata?: Record<string, string> };
	export type CopyResult = { readonly sourceKey: string; readonly destKey: string; readonly etag: string };
	export type ListItem = { readonly key: string; readonly size: number; readonly lastModified: Date; readonly etag: string };
	export type SignInputGetPut = { readonly op: 'get'; readonly key: string; readonly expires?: Duration.Duration } | { readonly op: 'put'; readonly key: string; readonly expires?: Duration.Duration };
	export type SignInputCopy = { readonly op: 'copy'; readonly sourceKey: string; readonly destKey: string; readonly expires?: Duration.Duration };
	export type SignInput = SignInputGetPut | SignInputCopy;
	// Polymorphic overload interfaces - callers see correct narrowed types
	export interface Put { (i: PutInput): Effect.Effect<PutResult>; (i: readonly PutInput[]): Effect.Effect<readonly PutResult[]>; }
	export interface Get { (k: string): Effect.Effect<GetResult>; (k: readonly string[]): Effect.Effect<ReadonlyMap<string, Either.Either<GetResult, unknown>>>; }
	export interface Copy { (i: CopyInput): Effect.Effect<CopyResult>; (i: readonly CopyInput[]): Effect.Effect<readonly CopyResult[]>; }
	export interface Exists { (k: string): Effect.Effect<boolean>; (k: readonly string[]): Effect.Effect<ReadonlyMap<string, boolean>>; }
	export interface Remove { (k: string): Effect.Effect<void>; (k: readonly string[]): Effect.Effect<void>; }
	export type Service = typeof StorageAdapter.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageAdapter };
