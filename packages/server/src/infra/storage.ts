/**
 * S3-compatible object storage with tenant isolation.
 * [PATTERN] Effect.acquireRelease for multipart, overload interfaces for polymorphic API.
 */
import { S3, S3ClientInstance } from '@effect-aws/client-s3';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Array as A, Chunk, Config, Duration, Effect, type Either, Layer, Match, Metric, Option, pipe, Redacted, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	batch: { concurrency: 10, deleteLimit: 1000 },
	multipart: { partSize: 5 * 1024 * 1024, threshold: 10 * 1024 * 1024 },
} as const;
const _env = Config.all({
	accessKeyId: Config.redacted('STORAGE_ACCESS_KEY_ID'),
	bucket: Config.string('STORAGE_BUCKET'),
	endpoint: Config.option(Config.string('STORAGE_ENDPOINT')),
	forcePathStyle: Config.boolean('STORAGE_FORCE_PATH_STYLE').pipe(Config.withDefault(false)),
	region: Config.string('STORAGE_REGION').pipe(Config.withDefault('us-east-1')),
	secretAccessKey: Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _path = (key: string) =>
	Context.Request.tenantId.pipe(Effect.map((t) => t === Context.Request.Id.system ? `system/${key}` : `tenants/${t}/${key}`));

// --- [LAYERS] ----------------------------------------------------------------

const _layer = Layer.unwrapEffect(_env.pipe(Effect.map((c) => S3.layer({
	credentials: { accessKeyId: Redacted.value(c.accessKeyId), secretAccessKey: Redacted.value(c.secretAccessKey) },
	endpoint: Option.getOrUndefined(c.endpoint), forcePathStyle: c.forcePathStyle, region: c.region,
}))));

// --- [SERVICE] ---------------------------------------------------------------

class StorageAdapter extends Effect.Service<StorageAdapter>()('server/StorageAdapter', {
	effect: Effect.gen(function* () {
		const m = yield* MetricsService, s3 = yield* S3, { bucket: B } = yield* _env;
		const $ = <A, E, R>(op: string, e: Effect.Effect<A, E, R>) =>
			Context.Request.tenantId.pipe(Effect.flatMap((t) => {
				const L = MetricsService.label({ op, tenant: t });
				return e.pipe(
					Metric.trackDuration(Metric.taggedWithLabels(m.storage.duration, L)),
					Effect.tap(() => MetricsService.inc(m.storage.operations, L)),
					Effect.tapError(() => MetricsService.inc(m.storage.errors, L)),
				);
			}));
		// --- [PUT] ---------------------------------------------------------------
		const _put = (i: StorageAdapter.PutInput) => _path(i.key).pipe(Effect.flatMap((k) => {
			const b = typeof i.body === 'string' ? new TextEncoder().encode(i.body) : i.body;
			return s3.putObject({ Body: b, Bucket: B, ContentType: i.contentType ?? 'application/octet-stream', Key: k, Metadata: i.metadata }).pipe(
				Effect.map((r) => ({ etag: r.ETag ?? '', key: i.key, size: b.length })),
			);
		}));
		const put: StorageAdapter.Put = ((i: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]) =>
			$(Array.isArray(i) ? 'put.batch' : 'put', (Array.isArray(i)
				? Effect.forEach(i as readonly StorageAdapter.PutInput[], _put, { concurrency: _config.batch.concurrency })
				: _put(i as StorageAdapter.PutInput)) as Effect.Effect<unknown>)
				.pipe(Effect.withSpan('storage.put'))) as StorageAdapter.Put;
		// --- [GET] ---------------------------------------------------------------
		const _get = (k: string) => Effect.gen(function* () {
			const fk = yield* _path(k);
			const r = yield* s3.getObject({ Bucket: B, Key: fk });
			const chunks = yield* Option.fromNullable(r.Body).pipe(Option.match({
				onNone: () => Effect.succeed(Chunk.empty<Uint8Array>()),
				onSome: (body) => Stream.fromAsyncIterable(body as AsyncIterable<Uint8Array>, (e) => e as Error).pipe(Stream.runCollect),
			}));
			const arr = Chunk.toReadonlyArray(chunks);
			const body = arr.reduce((acc, c) => { const r = new Uint8Array(acc.length + c.length); r.set(acc); r.set(c, acc.length); return r; }, new Uint8Array(0));
			return { body, contentType: r.ContentType ?? 'application/octet-stream', etag: Option.fromNullable(r.ETag), key: k, metadata: r.Metadata ?? {}, size: body.length };
		});
		const get: StorageAdapter.Get = ((i: string | readonly string[]) =>
			$(Array.isArray(i) ? 'get.batch' : 'get', (Array.isArray(i)
				? Effect.forEach(i as readonly string[], (k) => _get(k).pipe(Effect.either, Effect.map((r) => [k, r] as const)), { concurrency: _config.batch.concurrency }).pipe(Effect.map((e) => new Map(e)))
				: _get(i as string)) as Effect.Effect<unknown>)
				.pipe(Effect.withSpan('storage.get'))) as StorageAdapter.Get;
		// --- [COPY] --------------------------------------------------------------
		const _copy = (i: StorageAdapter.CopyInput) => Effect.all([_path(i.sourceKey), _path(i.destKey)]).pipe(
			Effect.flatMap(([s, d]) => s3.copyObject({
				Bucket: B,
				CopySource: `${B}/${s}`,
				Key: d,
				Metadata: i.metadata,
				MetadataDirective: Option.fromNullable(i.metadata).pipe(Option.match({ onNone: () => 'COPY' as const, onSome: () => 'REPLACE' as const })),
			}).pipe(Effect.map((r) => ({ destKey: i.destKey, etag: r.CopyObjectResult?.ETag ?? '', sourceKey: i.sourceKey })))),
		);
		const copy: StorageAdapter.Copy = ((i: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]) =>
			$(Array.isArray(i) ? 'copy.batch' : 'copy', (Array.isArray(i)
				? Effect.forEach(i as readonly StorageAdapter.CopyInput[], _copy, { concurrency: _config.batch.concurrency })
				: _copy(i as StorageAdapter.CopyInput)) as Effect.Effect<unknown>)
				.pipe(Effect.withSpan('storage.copy'))) as StorageAdapter.Copy;
		// --- [EXISTS] ------------------------------------------------------------
		const _exists = (k: string) => _path(k).pipe(
			Effect.flatMap((fk) => s3.headObject({ Bucket: B, Key: fk })),
			Effect.as(true),
			Effect.catchTag('NotFound', () => Effect.succeed(false)),
			Effect.catchTag('SdkError', () => Effect.succeed(false)),
		);
		const exists: StorageAdapter.Exists = ((i: string | readonly string[]) =>
			$(Array.isArray(i) ? 'head.batch' : 'head', (Array.isArray(i)
				? Effect.forEach(i as readonly string[], (k) => _exists(k).pipe(Effect.map((v) => [k, v] as const)), { concurrency: _config.batch.concurrency }).pipe(Effect.map((e) => new Map(e)))
				: _exists(i as string)) as Effect.Effect<unknown>)
				.pipe(Effect.withSpan('storage.exists'))) as StorageAdapter.Exists;
		// --- [REMOVE] ------------------------------------------------------------
		const remove: StorageAdapter.Remove = ((i: string | readonly string[]) => $('delete', Effect.gen(function* () {
			const keys = A.ensure(i);
			const objects = yield* Effect.forEach(keys, (k) => _path(k).pipe(Effect.map((f) => ({ Key: f }))), { concurrency: 'unbounded' });
			const batches = A.chunksOf(objects, _config.batch.deleteLimit);
			yield* Effect.forEach(batches, (b) => s3.deleteObjects({ Bucket: B, Delete: { Objects: b } }), { concurrency: _config.batch.concurrency });
		})).pipe(Effect.withSpan('storage.remove'))) as StorageAdapter.Remove;
		// --- [LIST] --------------------------------------------------------------
		const list = (o?: { prefix?: string; maxKeys?: number; continuationToken?: string }) =>
			$('list', _path(o?.prefix ?? '').pipe(Effect.flatMap((p) =>
				s3.listObjectsV2({ Bucket: B, ContinuationToken: o?.continuationToken, MaxKeys: o?.maxKeys ?? 1000, Prefix: p }).pipe(Effect.map((r) => ({
					continuationToken: r.NextContinuationToken,
					isTruncated: r.IsTruncated ?? false,
					items: pipe(r.Contents ?? [], A.map((x) => ({
						etag: x.ETag ?? '',
						key: x.Key?.replace(p.replace(o?.prefix ?? '', ''), '') ?? '',
						lastModified: x.LastModified ?? new Date(),
						size: x.Size ?? 0,
					}))),
				}))),
			))).pipe(Effect.withSpan('storage.list'));
		const listStream = (o?: { prefix?: string }) =>
			Stream.paginateEffect(undefined as string | undefined, (token) =>
				list({ continuationToken: token, prefix: o?.prefix }).pipe(
					Effect.map((r) => [r.items, Option.fromNullable(r.continuationToken).pipe(Option.filter(() => r.isTruncated))] as const),
				),
			).pipe(Stream.flatMap((element) => Stream.fromIterable(element)));
		// --- [SIGN] --------------------------------------------------------------
		// Overloads for type-safe presigned URL generation - 'get'/'put' don't require S3ClientInstance
		function sign(i: StorageAdapter.SignInputGetPut): Effect.Effect<string>;
		function sign(i: StorageAdapter.SignInputCopy): Effect.Effect<string, unknown, S3ClientInstance.S3ClientInstance>;
		function sign(i: StorageAdapter.SignInput): Effect.Effect<string, unknown, S3ClientInstance.S3ClientInstance>;
		function sign(i: StorageAdapter.SignInput) {
			const expiresIn = Math.floor(Duration.toSeconds(i.expires ?? Duration.hours(1)));
			return $(`sign-${i.op}`, Match.value(i).pipe(
				Match.when({ op: 'copy' }, (v) => Effect.all([_path(v.sourceKey), _path(v.destKey), S3ClientInstance.S3ClientInstance]).pipe(
					Effect.flatMap(([src, dst, client]) => Effect.tryPromise({
						catch: (e) => e as Error,
						try: () => getSignedUrl(client, new CopyObjectCommand({ Bucket: B, CopySource: `${B}/${src}`, Key: dst }), { expiresIn }),
					})),
				)),
				Match.when({ op: 'get' }, (v) => _path(v.key).pipe(Effect.flatMap((k) => s3.getObject({ Bucket: B, Key: k }, { expiresIn, presigned: true })))),
				Match.when({ op: 'put' }, (v) => _path(v.key).pipe(Effect.flatMap((k) => s3.putObject({ Bucket: B, Key: k }, { expiresIn, presigned: true })))),
				Match.exhaustive,
			)).pipe(Effect.withSpan('storage.sign'));
		}
		// --- [STREAM] ------------------------------------------------------------
		const getStream = (k: string) =>
			$('get-stream', _path(k).pipe(Effect.flatMap((fk) =>
				s3.getObject({ Bucket: B, Key: fk }).pipe(Effect.map((r) => ({
					contentType: r.ContentType ?? 'application/octet-stream',
					etag: Option.fromNullable(r.ETag),
					size: r.ContentLength ?? 0,
					stream: Option.fromNullable(r.Body as AsyncIterable<Uint8Array> | undefined).pipe(
						Option.match({ onNone: () => Stream.empty, onSome: (body) => Stream.fromAsyncIterable(body, (e) => e as Error) }),
					),
				}))),
			))).pipe(Effect.withSpan('storage.getStream'));
		const putStream = (i: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			$('put-stream', Effect.gen(function* () {
				const fk = yield* _path(i.key);
				const partSize = i.partSizeBytes ?? _config.multipart.partSize;
				const contentType = i.contentType ?? 'application/octet-stream';
				const chunks = yield* i.stream.pipe(				// Collect initial bytes up to threshold
					Stream.mapAccum(0, (acc, chunk) => [acc + chunk.length, { chunk, total: acc + chunk.length }] as const),
					Stream.takeWhile(({ total }) => total <= _config.multipart.threshold),
					Stream.map(({ chunk }) => chunk),
					Stream.runCollect,
				);
				const arr = Chunk.toReadonlyArray(chunks);
				const bytes = arr.reduce((acc, c) => { const r = new Uint8Array(acc.length + c.length); r.set(acc); r.set(c, acc.length); return r; }, new Uint8Array(0));
				return yield* bytes.length < _config.multipart.threshold
					? s3.putObject({ Body: bytes, Bucket: B, ContentType: contentType, Key: fk, Metadata: i.metadata }).pipe(
						Effect.map((r) => ({ etag: r.ETag ?? '', key: i.key, totalSize: bytes.length })),
					)
					: Effect.gen(function* () {
						const createRes = yield* s3.createMultipartUpload({ Bucket: B, ContentType: contentType, Key: fk, Metadata: i.metadata });
						const uploadId = yield* Effect.fromNullable(createRes.UploadId).pipe(Effect.mapError(() => new Error('Empty uploadId')));
						const parts = yield* Effect.acquireRelease(
							Effect.succeed(uploadId),
							(uid, exit) => exit._tag === 'Failure'
								? s3.abortMultipartUpload({ Bucket: B, Key: fk, UploadId: uid }).pipe(
									Effect.tap(() => Effect.logWarning('Multipart aborted', { key: i.key, uploadId: uid })),
									Effect.catchAll(() => Effect.void),
								)
								: Effect.void,
						).pipe(
							Effect.flatMap((uid) => Effect.forEach(
								A.range(0, Math.ceil(bytes.length / partSize) - 1),
								(idx) => s3.uploadPart({
									Body: bytes.slice(idx * partSize, Math.min((idx + 1) * partSize, bytes.length)),
									Bucket: B,
									Key: fk,
									PartNumber: idx + 1,
									UploadId: uid,
								}).pipe(Effect.map((r) => ({ ETag: r.ETag ?? '', PartNumber: idx + 1 }))),
								{ concurrency: 3 },
							)),
							Effect.scoped,
						);
						yield* s3.completeMultipartUpload({ Bucket: B, Key: fk, MultipartUpload: { Parts: parts }, UploadId: uploadId });
						return { etag: A.last(parts).pipe(Option.map((p) => p.ETag), Option.getOrElse(() => '')), key: i.key, totalSize: bytes.length };
					});
			})).pipe(Effect.withSpan('storage.putStream'));
		const abortUpload = (k: string, u: string) =>
			$('abort-multipart', _path(k).pipe(Effect.flatMap((fk) => s3.abortMultipartUpload({ Bucket: B, Key: fk, UploadId: u })))).pipe(Effect.withSpan('storage.abortUpload'));
		const listUploads = (o?: { prefix?: string }) =>
			$('list-multipart', _path(o?.prefix ?? '').pipe(Effect.flatMap((p) =>
				s3.listMultipartUploads({ Bucket: B, Prefix: p }).pipe(Effect.map((r) => ({
					uploads: pipe(r.Uploads ?? [], A.map((u) => ({
						initiated: u.Initiated ?? new Date(),
						key: u.Key?.replace(p.replace(o?.prefix ?? '', ''), '') ?? '',
						uploadId: u.UploadId ?? '',
					}))),
				}))),
			))).pipe(Effect.withSpan('storage.listUploads'));
		yield* Effect.logInfo('StorageAdapter initialized', { bucket: B });
		return { abortUpload, copy, exists, get, getStream, list, listStream, listUploads, put, putStream, remove, sign };
	}),
}) {
	static readonly S3ClientLayer = _layer;
}

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
