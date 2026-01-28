/**
 * Storage presigned URL endpoints for direct S3 access.
 * [PATTERN] Tenant-scoped keys, time-limited URLs, MFA verification.
 */
import { FileSystem, HttpApiBuilder, type Multipart } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import type { Url } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Match, Option, } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleSign = Effect.fn('storage.sign')((
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly key: string; readonly op: 'get' | 'put'; readonly expiresInSeconds: number; readonly contentType?: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		const expires = Duration.seconds(payload.expiresInSeconds);
		const expiresAt = DateTime.addDuration(DateTime.unsafeNow(), expires);
		const input: StorageService.SignInputGetPut = Match.value(payload.op).pipe(
			Match.when('get', () => ({ expires, key: payload.key, op: 'get' as const })),
			Match.when('put', () => ({ expires, key: payload.key, op: 'put' as const })),
			Match.exhaustive,
		);
		const url = yield* storage.sign(input).pipe(
			Effect.mapError((err) => HttpError.Internal.of('Failed to generate presigned URL', err)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: `sign-${payload.op}` })),
			audit.log('Storage.sign', { details: { expiresInSeconds: payload.expiresInSeconds, key: payload.key, op: payload.op }, subjectId: payload.key }),
		], { discard: true });
		return { expiresAt, key: payload.key, op: payload.op, url: url as Url };
	}),
);
const handleExists = Effect.fn('storage.exists')((storage: typeof StorageService.Service, key: string) =>
	storage.exists(key).pipe(
		Effect.map((exists) => ({ exists, key })),
		Effect.mapError((err) => HttpError.Internal.of('Failed to check object existence', err)),
	),
);
const handleRemove = Effect.fn('storage.remove')((storage: typeof StorageService.Service, audit: typeof AuditService.Service, key: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		yield* storage.remove(key).pipe(
			Effect.mapError((err) => HttpError.Internal.of('Failed to delete object', err)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'delete' })),
			audit.log('Storage.delete', { details: { key }, subjectId: key }),
		], { discard: true });
		return { key, success: true as const };
	}),
);
const handleUpload = Effect.fn('storage.upload')((
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly file: Multipart.PersistedFile; readonly key?: string; readonly contentType?: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, fs] = yield* Effect.all([MetricsService, FileSystem.FileSystem]);
		const key = Option.getOrElse(Option.fromNullable(payload.key), () => payload.file.name);
		const contentType = Option.getOrElse(Option.fromNullable(payload.contentType), () => payload.file.contentType);
		const body = yield* fs.readFile(payload.file.path).pipe(
			Effect.mapError((err) => HttpError.Internal.of('Failed to read uploaded file', err)),
		);
		const result = yield* storage.put({ body, contentType, key }).pipe(
			Effect.mapError((err) => HttpError.Internal.of('Failed to store object', err)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'upload' })),
			MetricsService.inc(metrics.storage.multipart.uploads, MetricsService.label({})),
			MetricsService.inc(metrics.storage.multipart.bytes, MetricsService.label({}), result.size),
			audit.log('Storage.upload', { details: { contentType, key, size: result.size }, subjectId: key }),
		], { discard: true });
		return { etag: result.etag, key: result.key, size: result.size };
	}),
);

// --- [LAYERS] ----------------------------------------------------------------

const StorageLive = HttpApiBuilder.group(ParametricApi, 'storage', (handlers) =>
	Effect.gen(function* () {
		const [storage, audit] = yield* Effect.all([StorageService, AuditService]);
		return handlers
			.handle('sign', ({ payload }) => CacheService.rateLimit('api', handleSign(storage, audit, payload)))
			.handle('exists', ({ path }) => CacheService.rateLimit('api', handleExists(storage, path.key)))
			.handle('remove', ({ path }) => CacheService.rateLimit('mutation', handleRemove(storage, audit, path.key)))
			.handle('upload', ({ payload }) => CacheService.rateLimit('mutation', handleUpload(storage, audit, payload)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { StorageLive };
