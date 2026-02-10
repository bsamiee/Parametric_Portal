/**
 * Storage presigned URL endpoints + asset CRUD + storage listing.
 * [PATTERN] Tenant-scoped keys, time-limited URLs, MFA verification.
 */
import { FileSystem, HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import type { Url } from '@parametric-portal/types/types';
import { Cause, DateTime, Duration, Effect, Function as F, Option, Record } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const StorageLive = HttpApiBuilder.group(ParametricApi, 'storage', (handlers) =>
	Effect.gen(function* () {
		const [adapter, storage, audit, database] = yield* Effect.all([StorageAdapter, StorageService, AuditService, DatabaseService]);
		return handlers
			.handle('sign', ({ payload }) => Middleware.guarded('storage', 'sign', 'api', Effect.gen(function* () {
				const expires = Duration.seconds(payload.expiresInSeconds);
				const expiresAt = DateTime.addDuration(DateTime.unsafeNow(), expires);
				const input: StorageAdapter.SignInputGetPut = { expires, key: payload.key, op: payload.op };
				const url = yield* Resilience.run('storage.sign', adapter.sign(input), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Failed to generate presigned URL')));
				yield* audit.log('Storage.sign', { details: { expiresInSeconds: payload.expiresInSeconds, key: payload.key, op: payload.op }, subjectId: payload.key });
				return { expiresAt, key: payload.key, op: payload.op, url: url as Url };
			})))
			.handle('exists', ({ path }) => Middleware.guarded('storage', 'exists', 'api',
				Resilience.run('storage.exists', adapter.exists(path.key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
					Effect.map((exists) => ({ exists, key: path.key })),
					Effect.mapError((error) => HttpError.Internal.of('Failed to check object existence', error)),
				),
			))
			.handle('remove', ({ path }) => Middleware.guarded('storage', 'remove', 'mutation',
				Resilience.run('storage.remove', storage.remove(path.key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(
					Effect.map(() => ({ key: path.key, success: true as const })),
					Effect.mapError((error) => HttpError.Internal.of('Failed to delete object', error)),
				),
			))
			.handle('upload', ({ payload }) => Middleware.guarded('storage', 'upload', 'mutation', Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem;
				const key = payload.key ?? payload.file.name;
				const contentType = payload.contentType ?? payload.file.contentType;
				const body = yield* fileSystem.readFile(payload.file.path).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Failed to read uploaded file')));
				const result = yield* Resilience.run('storage.upload', storage.put({ body, contentType, key }), { circuit: 'storage', timeout: Duration.seconds(30) }).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Failed to store object')));
				return { etag: result.etag, key: result.key, size: result.size };
			})))
			.handle('getAsset', ({ path }) => Middleware.guarded('storage', 'getAsset', 'api',
				database.assets.one([{ field: 'id', value: path.id }]).pipe(
					Effect.mapError((error) => HttpError.Internal.of('Asset lookup failed', error)),
					Effect.flatMap(Option.match({
						onNone: () => Effect.fail(HttpError.NotFound.of('asset', path.id)),
						onSome: Effect.succeed,
					})),
				),
			))
			.handle('createAsset', ({ payload }) => Middleware.guarded('storage', 'createAsset', 'mutation', Effect.gen(function* () {
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
				}).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Asset creation failed')));
				yield* audit.log('Asset.create', { details: { name: payload.name, type: payload.type }, subjectId: asset.id });
				return asset;
			})))
			.handle('updateAsset', ({ path, payload }) => Middleware.guarded('storage', 'updateAsset', 'mutation', Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				const updates = Record.getSomes({
					content: Option.fromNullable(payload.content),
					name: Option.fromNullable(payload.name),
					status: Option.fromNullable(payload.status),
					type: Option.fromNullable(payload.type),
				});
				yield* database.assets.set(path.id, updates, { app_id: tenantId }).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Asset update failed')));
				const updated = yield* database.assets.one([{ field: 'id', value: path.id }]).pipe(
					Effect.mapError(HttpError.Internal.of.bind(undefined, 'Asset reload failed')),
					Effect.flatMap(Option.match({
						onNone: F.constant(Effect.fail(HttpError.Internal.of('Asset reload failed', new Error('Asset not found after update')))),
						onSome: Effect.succeed,
					})),
				);
				yield* audit.log('Asset.update', { details: { fields: Object.keys(updates) }, subjectId: path.id });
				return updated;
			})))
			.handle('archiveAsset', ({ path }) => Middleware.guarded('storage', 'archiveAsset', 'mutation', Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				yield* database.assets.softDelete(path.id, tenantId).pipe(
					Effect.catchIf(Cause.isNoSuchElementException, F.constant(Effect.fail(HttpError.NotFound.of('asset', path.id)))),
					Effect.mapError(HttpError.Internal.of.bind(undefined, 'Asset archive failed')),
				);
				yield* audit.log('Asset.delete', { details: { assetId: path.id }, subjectId: path.id });
				return { id: path.id, success: true as const };
			})))
			.handle('listAssets', ({ urlParams }) => Middleware.guarded('storage', 'listAssets', 'api', Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				const predicates = database.assets.preds({
					after: urlParams.after,
					app_id: tenantId,
					before: urlParams.before,
					type: urlParams.type,
				});
				return yield* database.assets.page(predicates, {
					asc: urlParams.sort === 'asc',
					cursor: urlParams.cursor,
					limit: urlParams.limit,
				}).pipe(Effect.mapError(HttpError.Internal.of.bind(undefined, 'Asset listing failed')));
			})));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { StorageLive };
