/**
 * S3-compatible object storage with tenant isolation.
 * Unified single/batch API; typed errors via @effect-aws/client-s3; full metrics/tracing.
 */
import { S3, S3ClientInstance } from '@effect-aws/client-s3';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Chunk, Config, Duration, Effect, Layer, Metric, Option, Redacted, Stream } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';

// --- [INTERNAL] --------------------------------------------------------------

const _configFromEnv = Config.all({
	accessKeyId: Config.redacted('STORAGE_ACCESS_KEY_ID'),
	bucket: Config.string('STORAGE_BUCKET'),
	endpoint: Config.option(Config.string('STORAGE_ENDPOINT')),
	forcePathStyle: Config.boolean('STORAGE_FORCE_PATH_STYLE').pipe(Config.withDefault(false)),
	region: Config.string('STORAGE_REGION').pipe(Config.withDefault('us-east-1')),
	secretAccessKey: Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
});
const _resolvePath = (key: string) =>
	Context.Request.tenantId.pipe(
		Effect.map((tenantId) => (tenantId === Context.Request.Id.system ? `system/${key}` : `tenants/${tenantId}/${key}`)),
	);

// --- [CONSTANTS] -------------------------------------------------------------

const MULTIPART_THRESHOLD = 10 * 1024 * 1024;
const PART_SIZE = 5 * 1024 * 1024;
const BATCH_CONCURRENCY = 10;
const DELETE_BATCH_LIMIT = 1000; // S3 deleteObjects max keys per request

// --- [LAYERS] ----------------------------------------------------------------

const _S3ClientLayer = Layer.unwrapEffect(
	_configFromEnv.pipe(Effect.map((config) => S3.layer({
		credentials: { accessKeyId: Redacted.value(config.accessKeyId), secretAccessKey: Redacted.value(config.secretAccessKey) },
		endpoint: Option.getOrUndefined(config.endpoint),
		forcePathStyle: config.forcePathStyle,
		region: config.region,
	}))),
);

// --- [SERVICE] ---------------------------------------------------------------

class StorageAdapter extends Effect.Service<StorageAdapter>()('server/StorageAdapter', {
	effect: Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const s3 = yield* S3;  // Capture S3 instance to eliminate requirement from method signatures
		const config = yield* _configFromEnv;
		const bucket = config.bucket;
		const _put = (input: { key: string; body: Uint8Array | string; contentType?: string; metadata?: Record<string, string> }) =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const fullKey = yield* _resolvePath(input.key);
				const body = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
				const result = yield* s3.putObject({ Body: body, Bucket: bucket, ContentType: input.contentType ?? 'application/octet-stream', Key: fullKey, Metadata: input.metadata }).pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'put', tenant: tenantId }))),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'put', tenant: tenantId }), 1)),
				);
				yield* Effect.all([
					MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'put', tenant: tenantId }), 1),
					MetricsService.inc(metrics.storage.bytes, MetricsService.label({ direction: 'upload', tenant: tenantId }), body.length),
				]);
				return { etag: (result as { ETag?: string }).ETag ?? '', key: input.key, size: body.length };
			}).pipe(Effect.withSpan('storage.put', { attributes: { 'storage.key': input.key, 'storage.size': input.body.length }, kind: 'client' }));
		function put(input: Parameters<typeof _put>[0]): ReturnType<typeof _put>;		/** Put object(s). Single input → single result; array input → array results. */
		function put(input: readonly Parameters<typeof _put>[0][]): Effect.Effect<readonly Effect.Effect.Success<ReturnType<typeof _put>>[]>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function put(input: any): any {
			return Array.isArray(input)
				? Effect.forEach(input as readonly Parameters<typeof _put>[0][], _put, { concurrency: BATCH_CONCURRENCY }).pipe(Effect.withSpan('storage.put.batch', { attributes: { 'storage.count': input.length }, kind: 'client' }))
				: _put(input as Parameters<typeof _put>[0]);
		}
		const _get = (key: string) =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const fullKey = yield* _resolvePath(key);
				const res = yield* s3.getObject({ Bucket: bucket, Key: fullKey }).pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'get', tenant: tenantId }))),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'get', tenant: tenantId }), 1)),
				);
				const typed = res as { Body?: NodeJS.ReadableStream; ContentType?: string; Metadata?: Record<string, string> };
				const body = yield* (typed.Body
					? Stream.fromAsyncIterable(typed.Body as AsyncIterable<Uint8Array>, (e) => e).pipe(
							Stream.runCollect,
							Effect.map((chunks) => new Uint8Array(Chunk.toReadonlyArray(chunks).flatMap((c) => Array.from(c)))),
							Effect.orDie,
						)
					: Effect.succeed(new Uint8Array(0)));
				yield* Effect.all([
					MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'get', tenant: tenantId }), 1),
					MetricsService.inc(metrics.storage.bytes, MetricsService.label({ direction: 'download', tenant: tenantId }), body.length),
				]);
				return { body, contentType: typed.ContentType ?? 'application/octet-stream', key, metadata: typed.Metadata ?? {}, size: body.length };
			}).pipe(Effect.withSpan('storage.get', { attributes: { 'storage.key': key }, kind: 'client' }));
		function get(key: string): ReturnType<typeof _get>;		/** Get object(s). Single key → single result; array keys → Map with Either for error isolation. */
		function get(keys: readonly string[]): Effect.Effect<ReadonlyMap<string, import('effect/Either').Either<Effect.Effect.Success<ReturnType<typeof _get>>, Effect.Effect.Error<ReturnType<typeof _get>>>>>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function get(keys: any): any {
			return Array.isArray(keys)
				? Effect.forEach(keys, (k: string) => _get(k).pipe(Effect.either, Effect.map((r) => [k, r] as const)), { concurrency: BATCH_CONCURRENCY }).pipe(
						Effect.map((entries) => new Map(entries)),
						Effect.withSpan('storage.get.batch', { attributes: { 'storage.count': keys.length }, kind: 'client' }),
					)
				: _get(keys);
		}
		const _copy = (input: { sourceKey: string; destKey: string; metadata?: Record<string, string> }) =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const [sourceFullKey, destFullKey] = yield* Effect.all([_resolvePath(input.sourceKey), _resolvePath(input.destKey)] as const);
				const result = yield* s3.copyObject({
					Bucket: bucket,
					CopySource: `${bucket}/${sourceFullKey}`,
					Key: destFullKey,
					Metadata: input.metadata,
					MetadataDirective: input.metadata ? 'REPLACE' : 'COPY',
				}).pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'copy', tenant: tenantId }))),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'copy', tenant: tenantId }), 1)),
				);
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'copy', tenant: tenantId }), 1);
				return { destKey: input.destKey, etag: ((result as { CopyObjectResult?: { ETag?: string } }).CopyObjectResult?.ETag) ?? '', sourceKey: input.sourceKey };
			}).pipe(Effect.withSpan('storage.copy', { attributes: { 'storage.destKey': input.destKey, 'storage.sourceKey': input.sourceKey }, kind: 'client' }));
		function copy(input: Parameters<typeof _copy>[0]): ReturnType<typeof _copy>;		/** Copy object(s) within same tenant. Single input → single result; array input → array results. */
		function copy(input: readonly Parameters<typeof _copy>[0][]): Effect.Effect<readonly Effect.Effect.Success<ReturnType<typeof _copy>>[]>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function copy(input: any): any {
			return Array.isArray(input)
				? Effect.forEach(input, _copy, { concurrency: BATCH_CONCURRENCY }).pipe(Effect.withSpan('storage.copy.batch', { attributes: { 'storage.count': input.length }, kind: 'client' }))
				: _copy(input);
		}
		function remove(key: string): Effect.Effect<void>;		/** Remove object(s). Uses batch deleteObjects with automatic chunking for >1000 keys. */
		function remove(keys: readonly string[]): Effect.Effect<void>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function remove(keys: any): any {
			return Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const keyArray: readonly string[] = Array.isArray(keys) ? keys : [keys];
				const resolved = yield* Effect.forEach(keyArray, (key) => _resolvePath(key).pipe(Effect.map((full) => ({ Key: full }))), { concurrency: 'unbounded' });
				yield* Effect.forEach(
					Chunk.chunksOf(Chunk.fromIterable(resolved), DELETE_BATCH_LIMIT),
					(batch) => s3.deleteObjects({ Bucket: bucket, Delete: { Objects: Chunk.toArray(batch) } }).pipe(
						Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'delete', tenant: tenantId }), batch.length)),
					),
					{ concurrency: BATCH_CONCURRENCY },
				).pipe(Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'delete', tenant: tenantId }))));
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'delete', tenant: tenantId }), keyArray.length);
			}).pipe(Effect.withSpan('storage.remove', { attributes: { 'storage.count': Array.isArray(keys) ? keys.length : 1 }, kind: 'client' }));
		}
		const list = (opts?: { prefix?: string; maxKeys?: number; continuationToken?: string }) =>	/** List objects with optional prefix and pagination. Errors: SdkError | NoSuchBucketError */
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const tenantPrefix = yield* _resolvePath(opts?.prefix ?? '');
				const res = yield* s3.listObjectsV2({
					Bucket: bucket,
					ContinuationToken: opts?.continuationToken,
					MaxKeys: opts?.maxKeys ?? 1000,
					Prefix: tenantPrefix,
				}).pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'list', tenant: tenantId }))),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'list', tenant: tenantId }), 1)),
				);
				const typed = res as { Contents?: Array<{ ETag?: string; Key?: string; LastModified?: Date; Size?: number }>; IsTruncated?: boolean; NextContinuationToken?: string };
				const stripPrefix = tenantPrefix.replace(opts?.prefix ?? '', '');
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'list', tenant: tenantId }), 1);
				return {
					continuationToken: typed.NextContinuationToken,
					isTruncated: typed.IsTruncated ?? false,
					items: (typed.Contents ?? []).map((obj) => ({
						etag: obj.ETag ?? '',
						key: obj.Key?.replace(stripPrefix, '') ?? '',
						lastModified: obj.LastModified ?? new Date(),
						size: obj.Size ?? 0,
					})),
				};
			}).pipe(Effect.withSpan('storage.list', { attributes: { 'storage.prefix': opts?.prefix ?? '' }, kind: 'client' }));
		const listStream = (opts?: { prefix?: string }) =>	/** Stream all objects matching prefix via pagination. */
			Stream.paginateEffect(undefined as string | undefined, (token) =>
				list({ continuationToken: token, prefix: opts?.prefix }).pipe(
					Effect.map((result) => [result.items, result.isTruncated ? Option.some(result.continuationToken) : Option.none()]),
				),
			).pipe(Stream.flatMap((items) => Stream.fromIterable(items)));
		const sign = (input:
			| { readonly op: 'get'; readonly key: string; readonly expires?: Duration.Duration }
			| { readonly op: 'put'; readonly key: string; readonly expires?: Duration.Duration }
			| { readonly op: 'copy'; readonly sourceKey: string; readonly destKey: string; readonly expires?: Duration.Duration }) => {
			const expires = Math.floor(Duration.toSeconds(input.expires ?? Duration.hours(1)));
			const core = input.op === 'copy'
				? Effect.all([_resolvePath(input.sourceKey), _resolvePath(input.destKey), S3ClientInstance.S3ClientInstance]).pipe(
					Effect.flatMap(([src, dest, client]) => Effect.tryPromise({
						catch: (e) => e as Error,
						try: () => getSignedUrl(client, new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${src}`, Key: dest }), { expiresIn: expires }),
					})),
				)
				: _resolvePath(input.key).pipe(
					Effect.flatMap((key) => input.op === 'get'
						? s3.getObject({ Bucket: bucket, Key: key }, { expiresIn: expires, presigned: true })
						: s3.putObject({ Bucket: bucket, Key: key }, { expiresIn: expires, presigned: true })),
				);
			return Context.Request.tenantId.pipe(
				Effect.flatMap((tenantId) => core.pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: `sign-${input.op}`, tenant: tenantId }))),
					Effect.tap(() => MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: `sign-${input.op}`, tenant: tenantId }), 1)),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'sign', tenant: tenantId }), 1)),
				)),
				Effect.withSpan('storage.sign', { attributes: { 'storage.op': input.op }, kind: 'client' }),
			);
		};
		const _exists = (key: string): Effect.Effect<boolean, never> =>
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const fullKey = yield* _resolvePath(key);
				const result = yield* s3.headObject({ Bucket: bucket, Key: fullKey }).pipe(
					Effect.map(() => true),
					Effect.catchAll(() => Effect.succeed(false)),
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'head', tenant: tenantId }))),
				);
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'head', tenant: tenantId }), 1);
				return result;
			}).pipe(Effect.withSpan('storage.exists', { attributes: { 'storage.key': key }, kind: 'client' }));
		function exists(key: string): Effect.Effect<boolean, never>;	/** Check existence of object(s). Single key → boolean; array keys → Map<key, boolean>. */
		function exists(keys: readonly string[]): Effect.Effect<ReadonlyMap<string, boolean>, never>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function exists(keys: any): any {
			return Array.isArray(keys)
				? Effect.forEach(keys, (k: string) => _exists(k).pipe(Effect.map((v) => [k, v] as const)), { concurrency: BATCH_CONCURRENCY }).pipe(
						Effect.map((entries) => new Map(entries)),
						Effect.withSpan('storage.exists.batch', { attributes: { 'storage.count': keys.length }, kind: 'client' }),
					)
				: _exists(keys);
		}
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			Context.Request.tenantId.pipe(
				Effect.flatMap((tenantId) =>
					Effect.gen(function* () {
						const fullKey = yield* _resolvePath(input.key);
						const partSize = input.partSizeBytes ?? PART_SIZE;
						const initialChunks = yield* input.stream.pipe(		// Collect initial bytes to check if multipart is needed
							Stream.mapAccum(0, (acc, chunk) => [acc + chunk.length, { bytes: chunk, cumulative: acc + chunk.length }]),
							Stream.takeWhile(({ cumulative }) => cumulative <= MULTIPART_THRESHOLD),
							Stream.map(({ bytes }) => bytes),
							Stream.runCollect,
						);
						const initialBytes = new Uint8Array(Chunk.toReadonlyArray(initialChunks).flatMap((c) => Array.from(c)));
						return yield* (initialBytes.length < MULTIPART_THRESHOLD	// Small file: single PUT
							? _put({ body: initialBytes, contentType: input.contentType, key: input.key, metadata: input.metadata }).pipe(Effect.map((result) => ({ etag: result.etag, key: input.key, totalSize: result.size })))
							: Effect.gen(function* () {	// Large file: multipart upload via S3 service
								const createRes = yield* s3.createMultipartUpload({ Bucket: bucket, ContentType: input.contentType ?? 'application/octet-stream', Key: fullKey, Metadata: input.metadata });
								const uploadId = createRes.UploadId ?? '';
								yield* (uploadId === '' ? Effect.fail(new Error('createMultipartUpload returned empty uploadId')) : Effect.void);
								yield* MetricsService.inc(metrics.storage.multipart.uploads, MetricsService.label({ tenant: tenantId }), 1);
								const chunks = Array.from({ length: Math.ceil(initialBytes.length / partSize) }, (_, idx) => initialBytes.slice(idx * partSize, Math.min((idx + 1) * partSize, initialBytes.length)));
								const uploadPartsAndComplete = Effect.gen(function* () {
									const parts = yield* Effect.forEach(chunks.map((chunk, idx) => ({ chunk, partNumber: idx + 1 })), ({ chunk, partNumber }) =>
										s3.uploadPart({ Body: chunk, Bucket: bucket, Key: fullKey, PartNumber: partNumber, UploadId: uploadId }).pipe(
											Effect.map((res) => ({ ETag: res.ETag ?? '', PartNumber: partNumber })),
											Effect.tap(() => Effect.all([MetricsService.inc(metrics.storage.multipart.parts, MetricsService.label({ tenant: tenantId }), 1), MetricsService.inc(metrics.storage.multipart.bytes, MetricsService.label({ tenant: tenantId }), chunk.length)])),
										), { concurrency: 3 });
									yield* s3.completeMultipartUpload({ Bucket: bucket, Key: fullKey, MultipartUpload: { Parts: parts }, UploadId: uploadId });
									yield* Effect.all([MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'multipart', tenant: tenantId }), 1), MetricsService.inc(metrics.storage.bytes, MetricsService.label({ direction: 'upload', tenant: tenantId }), initialBytes.length)]);
									return { etag: parts.at(-1)?.ETag ?? '', key: input.key, totalSize: initialBytes.length };
								});
								return yield* uploadPartsAndComplete.pipe(
									Effect.onExit((exit) => exit._tag === 'Failure'
										? s3.abortMultipartUpload({ Bucket: bucket, Key: fullKey, UploadId: uploadId }).pipe(
												Effect.tap(() => Effect.logWarning('Multipart upload aborted due to failure', { key: input.key, uploadId })),
												Effect.catchAll(() => Effect.void),	// Don't fail cleanup if abort fails
											)
										: Effect.void),
								);
							}));
					}).pipe(
						Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.stream.duration, MetricsService.label({ op: 'upload', tenant: tenantId }))),
					),
				),
				Effect.withSpan('storage.putStream', { attributes: { 'storage.key': input.key }, kind: 'client' }),
			);
		const getStream = (key: string) =>	/** Get object as stream (for large file downloads). Errors: SdkError | InvalidObjectStateError | NoSuchKeyError */
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const fullKey = yield* _resolvePath(key);
				const res = yield* s3.getObject({ Bucket: bucket, Key: fullKey }).pipe(
					Metric.trackDuration(Metric.taggedWithLabels(metrics.storage.duration, MetricsService.label({ op: 'get-stream', tenant: tenantId }))),
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'get', tenant: tenantId }), 1)),
				);
				const typed = res as { Body?: NodeJS.ReadableStream; ContentLength?: number; ContentType?: string };
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'get-stream', tenant: tenantId }), 1);
				return {
					contentType: typed.ContentType ?? 'application/octet-stream',
					size: typed.ContentLength ?? 0,
					stream: typed.Body ? Stream.fromAsyncIterable(typed.Body as AsyncIterable<Uint8Array>, (e) => e) : Stream.empty,
				};
			}).pipe(Effect.withSpan('storage.getStream', { attributes: { 'storage.key': key }, kind: 'client' }));
		const abortUpload = (key: string, uploadId: string) =>	/** Abort an in-progress multipart upload. */
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const fullKey = yield* _resolvePath(key);
				yield* s3.abortMultipartUpload({ Bucket: bucket, Key: fullKey, UploadId: uploadId }).pipe(
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'abort-multipart', tenant: tenantId }), 1)),
				);
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'abort-multipart', tenant: tenantId }), 1);
			}).pipe(Effect.withSpan('storage.abortUpload', { attributes: { 'storage.key': key, 'storage.uploadId': uploadId }, kind: 'client' }));
		const listUploads = (opts?: { prefix?: string }) =>		/** List in-progress multipart uploads. */
			Effect.gen(function* () {
				const tenantId = yield* Context.Request.tenantId;
				const tenantPrefix = yield* _resolvePath(opts?.prefix ?? '');
				const res = yield* s3.listMultipartUploads({ Bucket: bucket, Prefix: tenantPrefix }).pipe(
					Effect.tapError(() => MetricsService.inc(metrics.storage.errors, MetricsService.label({ op: 'list-multipart', tenant: tenantId }), 1)),
				);
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'list-multipart', tenant: tenantId }), 1);
				return {
					uploads: (res.Uploads ?? []).map((u) => ({
						initiated: u.Initiated ?? new Date(),
						key: u.Key?.replace(tenantPrefix.replace(opts?.prefix ?? '', ''), '') ?? '',
						uploadId: u.UploadId ?? '',
					})),
				};
			}).pipe(Effect.withSpan('storage.listUploads', { attributes: { 'storage.prefix': opts?.prefix ?? '' }, kind: 'client' }));
		yield* Effect.logInfo('StorageAdapter initialized', { bucket, region: config.region });
		return { abortUpload, copy, exists, get, getStream, list, listStream, listUploads, put, putStream, remove, sign };
	}),
}) {
	static readonly S3ClientLayer = _S3ClientLayer;	/** S3 client layer - provides @effect-aws S3 service. Exposed for external use. */
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StorageAdapter {
	export type PutInput = { key: string; body: Uint8Array | string; contentType?: string; metadata?: Record<string, string> };
	export type PutResult = { key: string; etag: string; size: number };
	export type GetResult = { body: Uint8Array; contentType: string; key: string; metadata: Record<string, string>; size: number };
	export type CopyInput = { sourceKey: string; destKey: string; metadata?: Record<string, string> };
	export type CopyResult = { sourceKey: string; destKey: string; etag: string };
	export type SignInput =
		| { readonly op: 'get'; readonly key: string; readonly expires?: Duration.Duration }
		| { readonly op: 'put'; readonly key: string; readonly expires?: Duration.Duration }
		| { readonly op: 'copy'; readonly sourceKey: string; readonly destKey: string; readonly expires?: Duration.Duration };
	export type Service = typeof StorageAdapter.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageAdapter };
