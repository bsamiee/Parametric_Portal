/**
 * Storage presigned URL endpoints + asset CRUD + storage listing.
 * [PATTERN] Tenant-scoped keys, time-limited URLs, MFA verification.
 */
import { FileSystem, HttpApiBuilder, type Multipart } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import type { Url } from '@parametric-portal/types/types';
import { Cause, DateTime, Duration, Effect, Option, Record } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const _requireTenantAsset = (database: typeof DatabaseService.Service, assetId: string, tenantId: string) =>
	database.assets.one([{ field: 'id', value: assetId }]).pipe(
		Effect.mapError((error) => HttpError.Internal.of('Asset lookup failed', error)),
		Effect.flatMap(Option.match({
			onNone: () => Effect.fail(HttpError.NotFound.of('asset', assetId)),
			onSome: Effect.succeed,
		})),
		Effect.filterOrFail(
			(asset) => asset.appId === tenantId,
			() => HttpError.NotFound.of('asset', assetId),
		),
	);

const handleSign = (
	adapter: typeof StorageAdapter.Service,
	audit: typeof AuditService.Service,
	payload: { readonly key: string; readonly op: 'get' | 'put'; readonly expiresInSeconds: number; readonly contentType?: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		const expires = Duration.seconds(payload.expiresInSeconds);
		const expiresAt = DateTime.addDuration(DateTime.unsafeNow(), expires);
		const input: StorageAdapter.SignInputGetPut = { expires, key: payload.key, op: payload.op };
		const url = yield* Resilience.run('storage.sign', adapter.sign(input), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(Effect.mapError((error) => HttpError.Internal.of('Failed to generate presigned URL', error)),);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: `sign-${payload.op}` })),
			audit.log('Storage.sign', { details: { expiresInSeconds: payload.expiresInSeconds, key: payload.key, op: payload.op }, subjectId: payload.key }),
		], { discard: true });
		return { expiresAt, key: payload.key, op: payload.op, url: url as Url };
	}).pipe(Telemetry.span('storage.sign', { kind: 'server', metrics: false }));
const handleExists = (adapter: typeof StorageAdapter.Service, key: string) =>
	Resilience.run('storage.exists', adapter.exists(key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
		Effect.map((exists) => ({ exists, key })),
		Effect.mapError((error) => HttpError.Internal.of('Failed to check object existence', error)),
		Telemetry.span('storage.exists', { kind: 'server', metrics: false }),
	);
const handleRemove = (storage: typeof StorageService.Service, audit: typeof AuditService.Service, key: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const metrics = yield* MetricsService;
		yield* Resilience.run('storage.remove', storage.remove(key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(Effect.mapError((error) => HttpError.Internal.of('Failed to delete object', error)),);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'delete' })),
			audit.log('Storage.delete', { details: { key }, subjectId: key }),
		], { discard: true });
		return { key, success: true as const };
	}).pipe(Telemetry.span('storage.remove', { kind: 'server', metrics: false }));
const handleUpload = (
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly file: Multipart.PersistedFile; readonly key?: string; readonly contentType?: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, fileSystem] = yield* Effect.all([MetricsService, FileSystem.FileSystem]);
		const key = payload.key ?? payload.file.name;
		const contentType = payload.contentType ?? payload.file.contentType;
		const body = yield* fileSystem.readFile(payload.file.path).pipe(Effect.mapError((error) => HttpError.Internal.of('Failed to read uploaded file', error)),);
		const result = yield* Resilience.run('storage.upload', storage.put({ body, contentType, key }), { circuit: 'storage', timeout: Duration.seconds(30) }).pipe(Effect.mapError((error) => HttpError.Internal.of('Failed to store object', error)),);
		yield* Effect.all([
			MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'upload' })),
			MetricsService.inc(metrics.storage.multipart.uploads, MetricsService.label({})),
			MetricsService.inc(metrics.storage.multipart.bytes, MetricsService.label({}), result.size),
			audit.log('Storage.upload', { details: { contentType, key, size: result.size }, subjectId: key }),
		], { discard: true });
		return { etag: result.etag, key: result.key, size: result.size };
	}).pipe(Telemetry.span('storage.upload', { kind: 'server', metrics: false }));
const handleGetAsset = (database: typeof DatabaseService.Service, assetId: string) =>
	Effect.gen(function* () {
		const tenantId = yield* Context.Request.currentTenantId;
		return yield* _requireTenantAsset(database, assetId, tenantId);
	}).pipe(Telemetry.span('storage.getAsset', { kind: 'server', metrics: false }));
const handleCreateAsset = (
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	payload: { readonly content: string; readonly hash?: string; readonly name?: string; readonly storageRef?: string; readonly type: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [tenantId, session] = yield* Effect.all([Context.Request.currentTenantId, Context.Request.sessionOrFail]);
		const asset = yield* database.assets.insert({
			appId: tenantId,
			content: payload.content,
			deletedAt: Option.none(),
			hash: Option.fromNullable(payload.hash),
			name: Option.fromNullable(payload.name),
			status: 'active' as const,
			storageRef: Option.fromNullable(payload.storageRef),
			type: payload.type,
			updatedAt: undefined,
			userId: Option.some(session.userId),
		}).pipe(Effect.mapError((error) => HttpError.Internal.of('Asset creation failed', error)),);
		yield* audit.log('Asset.create', { details: { name: payload.name, type: payload.type }, subjectId: asset.id });
		return asset;
	}).pipe(Telemetry.span('storage.createAsset', { kind: 'server', metrics: false }));
const handleUpdateAsset = (
	database: typeof DatabaseService.Service,
	audit: typeof AuditService.Service,
	assetId: string,
	payload: { readonly content?: string; readonly name?: string; readonly status?: string; readonly type?: string },) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const tenantId = yield* Context.Request.currentTenantId;
		yield* _requireTenantAsset(database, assetId, tenantId);
		const updates = Record.getSomes({
			content: Option.fromNullable(payload.content),
			name: Option.fromNullable(payload.name),
			status: Option.fromNullable(payload.status),
			type: Option.fromNullable(payload.type),
		});
		yield* database.assets.set(assetId, updates, { app_id: tenantId }).pipe(Effect.mapError((error) => HttpError.Internal.of('Asset update failed', error)),);
		const updated = yield* database.assets.one([{ field: 'id', value: assetId }]).pipe(
			Effect.mapError((error) => HttpError.Internal.of('Asset reload failed', error)),
			Effect.flatMap(Option.match({
				onNone: () => Effect.fail(HttpError.Internal.of('Asset reload failed', new Error('Asset not found after update'))),
				onSome: Effect.succeed,
			})),
		);
		yield* audit.log('Asset.update', { details: { fields: Object.keys(updates) }, subjectId: assetId });
		return updated;
	}).pipe(Telemetry.span('storage.updateAsset', { kind: 'server', metrics: false }));
const handleArchiveAsset = (database: typeof DatabaseService.Service, audit: typeof AuditService.Service, assetId: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const tenantId = yield* Context.Request.currentTenantId;
		yield* database.assets.softDelete(assetId, tenantId).pipe(Effect.mapError((error) => Cause.isNoSuchElementException(error) ? HttpError.NotFound.of('asset', assetId) : HttpError.Internal.of('Asset archive failed', error)),);
		yield* audit.log('Asset.archive', { details: { assetId }, subjectId: assetId });
		return { id: assetId, success: true as const };
	}).pipe(Telemetry.span('storage.archiveAsset', { kind: 'server', metrics: false }));
const handleListAssets = (
	database: typeof DatabaseService.Service,
	urlParams: { readonly after?: Date; readonly before?: Date; readonly cursor?: string; readonly limit: number; readonly sort?: string; readonly type?: string },) =>
	Effect.gen(function* () {
		const tenantId = yield* Context.Request.currentTenantId;
		const predicates = database.assets.preds({
			after: urlParams.after,
			app_id: tenantId,
			before: urlParams.before,
			type: urlParams.type,
		});
		const result = yield* database.assets.page(predicates, {
			asc: urlParams.sort === 'asc',
			cursor: urlParams.cursor,
			limit: urlParams.limit,
		}).pipe(Effect.mapError((error) => HttpError.Internal.of('Asset listing failed', error)),);
		return {
			...result,
			items: result.items.map((asset) => ({
				id: asset.id,
				name: Option.getOrNull(asset.name),
				size: asset.size,
				status: asset.status,
				storageRef: Option.getOrNull(asset.storageRef),
				type: asset.type,
				updatedAt: asset.updatedAt,
			})),
		};
	}).pipe(Telemetry.span('storage.listAssets', { kind: 'server', metrics: false }));

// --- [LAYERS] ----------------------------------------------------------------

const StorageLive = HttpApiBuilder.group(ParametricApi, 'storage', (handlers) =>
	Effect.gen(function* () {
		const [adapter, storage, audit, database] = yield* Effect.all([StorageAdapter, StorageService, AuditService, DatabaseService]);
		return handlers
			.handle('sign', ({ payload }) => CacheService.rateLimit('api', handleSign(adapter, audit, payload)))
			.handle('exists', ({ path }) => CacheService.rateLimit('api', handleExists(adapter, path.key)))
			.handle('remove', ({ path }) => CacheService.rateLimit('mutation', handleRemove(storage, audit, path.key)))
			.handle('upload', ({ payload }) => CacheService.rateLimit('mutation', handleUpload(storage, audit, payload)))
			.handle('getAsset', ({ path }) => CacheService.rateLimit('api', handleGetAsset(database, path.id)))
			.handle('createAsset', ({ payload }) => CacheService.rateLimit('mutation', handleCreateAsset(database, audit, payload)))
			.handle('updateAsset', ({ path, payload }) => CacheService.rateLimit('mutation', handleUpdateAsset(database, audit, path.id, payload)))
			.handle('archiveAsset', ({ path }) => CacheService.rateLimit('mutation', handleArchiveAsset(database, audit, path.id)))
			.handle('listAssets', ({ urlParams }) => CacheService.rateLimit('api', handleListAssets(database, urlParams)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { StorageLive };
