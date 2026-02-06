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
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import type { Url } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleSign = (
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly key: string; readonly op: 'get' | 'put'; readonly expiresInSeconds: number; readonly contentType?: string },
) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		const expires = Duration.seconds(payload.expiresInSeconds);
		const expiresAt = DateTime.addDuration(DateTime.unsafeNow(), expires);
		const input: StorageService.SignInputGetPut = { expires, key: payload.key, op: payload.op };
		const url = yield* Resilience.run('storage.sign', storage.sign(input), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
			Effect.mapError((error) => HttpError.Internal.of('Failed to generate presigned URL', error)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: `sign-${payload.op}` })),
			audit.log('Storage.sign', { details: { expiresInSeconds: payload.expiresInSeconds, key: payload.key, op: payload.op }, subjectId: payload.key }),
		], { discard: true });
		return { expiresAt, key: payload.key, op: payload.op, url: url as Url };
	}).pipe(Telemetry.span('storage.sign', { kind: 'server', metrics: false }));

const handleExists = (storage: typeof StorageService.Service, key: string) =>
	Resilience.run('storage.exists', storage.exists(key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
		Effect.map((exists) => ({ exists, key })),
		Effect.mapError((error) => HttpError.Internal.of('Failed to check object existence', error)),
		Telemetry.span('storage.exists', { kind: 'server', metrics: false }),
	);

const handleRemove = (storage: typeof StorageService.Service, audit: typeof AuditService.Service, key: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		yield* Resilience.run('storage.remove', storage.remove(key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
			Effect.mapError((error) => HttpError.Internal.of('Failed to delete object', error)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'delete' })),
			audit.log('Storage.delete', { details: { key }, subjectId: key }),
		], { discard: true });
		return { key, success: true as const };
	}).pipe(Telemetry.span('storage.remove', { kind: 'server', metrics: false }));

const handleUpload = (
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly file: Multipart.PersistedFile; readonly key?: string; readonly contentType?: string },
) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, fileSystem] = yield* Effect.all([MetricsService, FileSystem.FileSystem]);
		const key = payload.key ?? payload.file.name;
		const contentType = payload.contentType ?? payload.file.contentType;
		const body = yield* fileSystem.readFile(payload.file.path).pipe(
			Effect.mapError((error) => HttpError.Internal.of('Failed to read uploaded file', error)),
		);
		const result = yield* Resilience.run('storage.upload', storage.put({ body, contentType, key }), { circuit: 'storage', timeout: Duration.seconds(30) }).pipe(
			Effect.mapError((error) => HttpError.Internal.of('Failed to store object', error)),
		);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'upload' })),
			MetricsService.inc(metrics.storage.multipart.uploads, MetricsService.label({})),
			MetricsService.inc(metrics.storage.multipart.bytes, MetricsService.label({}), result.size),
			audit.log('Storage.upload', { details: { contentType, key, size: result.size }, subjectId: key }),
		], { discard: true });
		return { etag: result.etag, key: result.key, size: result.size };
	}).pipe(Telemetry.span('storage.upload', { kind: 'server', metrics: false }));

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
