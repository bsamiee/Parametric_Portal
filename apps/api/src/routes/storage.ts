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
import { Cause, DateTime, Duration, Effect, Option, Record } from 'effect';
import { constant } from 'effect/Function';

// --- [LAYERS] ----------------------------------------------------------------

const StorageLive = HttpApiBuilder.group(ParametricApi, 'storage', (handlers) =>
    Effect.gen(function* () {
        const [adapter, storage, audit, database] = yield* Effect.all([StorageAdapter, StorageService, AuditService, DatabaseService]);
        const storageRoute = Middleware.resource('storage');
        return handlers
            .handle('sign', ({ payload }) => storageRoute.api('sign', Effect.gen(function* () {
                const expires = Duration.seconds(payload.expiresInSeconds);
                const expiresAt = DateTime.addDuration(DateTime.unsafeNow(), expires);
                const input = { expires, key: payload.key, op: payload.op } satisfies Parameters<typeof adapter.sign>[0];
                const url = yield* Resilience.run('storage.sign', adapter.sign(input), { circuit: 'storage', timeout: Duration.seconds(10) });
                yield* audit.log('Storage.sign', { details: { expiresInSeconds: payload.expiresInSeconds, key: payload.key, op: payload.op }, subjectId: payload.key });
                return { expiresAt, key: payload.key, op: payload.op, url: url as Url };
            })))
            .handle('exists', ({ path }) => storageRoute.api('exists',
                Resilience.run('storage.exists', adapter.exists(path.key) as Effect.Effect<boolean, unknown>, { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(Effect.map((exists) => ({ exists, key: path.key })),),
            ))
            .handle('remove', ({ path }) => storageRoute.mutation('remove',
                Resilience.run('storage.remove', storage.remove(path.key), { circuit: 'storage', timeout: Duration.seconds(10) }).pipe(Effect.map(() => ({ key: path.key, success: true as const })),),
            ))
            .handle('upload', ({ payload }) => storageRoute.mutation('upload', Effect.gen(function* () {
                const fileSystem = yield* FileSystem.FileSystem;
                const key = payload.key ?? payload.file.name;
                const contentType = payload.contentType ?? payload.file.contentType;
                const body = yield* fileSystem.readFile(payload.file.path).pipe(HttpError.mapTo('Failed to read uploaded file'));
                const result = yield* Resilience.run('storage.upload', storage.put({ body, contentType, key }) as Effect.Effect<{ readonly key: string; readonly etag: string; readonly size: number }, unknown>, { circuit: 'storage', timeout: Duration.seconds(30) }).pipe(HttpError.mapTo('Failed to store object'));
                return { etag: result.etag, key: result.key, size: result.size };
            })))
            .handle('getAsset', ({ path }) => storageRoute.api('getAsset',
                database.assets.one([{ field: 'id', value: path.id }]).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(HttpError.NotFound.of('asset', path.id)),
                        onSome: Effect.succeed,
                    })),
                ),
            ))
            .handle('createAsset', ({ payload }) => storageRoute.mutation('createAsset', Effect.gen(function* () {
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
                });
                yield* audit.log('Asset.create', { details: { name: payload.name, type: payload.type }, subjectId: asset.id });
                return asset;
            })))
            .handle('updateAsset', ({ path, payload }) => storageRoute.mutation('updateAsset', Effect.gen(function* () {
                const tenantId = yield* Context.Request.currentTenantId;
                const updates = Record.getSomes({
                    content: Option.fromNullable(payload.content),
                    name: Option.fromNullable(payload.name),
                    status: Option.fromNullable(payload.status),
                    type: Option.fromNullable(payload.type),
                });
                yield* database.assets.set(path.id, updates, { app_id: tenantId }).pipe(HttpError.mapTo('Asset update failed'));
                const updated = yield* database.assets.one([{ field: 'id', value: path.id }]).pipe(
                    HttpError.mapTo('Asset reload failed'),
                    Effect.flatMap(Option.match({
                        onNone: constant(Effect.fail(HttpError.Internal.of('Asset reload failed', new Error('Asset not found after update')))),
                        onSome: Effect.succeed,
                    })),
                );
                yield* audit.log('Asset.update', { details: { fields: Object.keys(updates) }, subjectId: path.id });
                return updated;
            })))
            .handle('archiveAsset', ({ path }) => storageRoute.mutation('archiveAsset', Effect.gen(function* () {
                const tenantId = yield* Context.Request.currentTenantId;
                yield* database.assets.softDelete(path.id, tenantId).pipe(Effect.catchIf(Cause.isNoSuchElementException, constant(Effect.fail(HttpError.NotFound.of('asset', path.id)))),);
                yield* audit.log('Asset.delete', { details: { assetId: path.id }, subjectId: path.id });
                return { id: path.id, success: true as const };
            })))
            .handle('listAssets', ({ urlParams }) => storageRoute.api('listAssets', Effect.gen(function* () {
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
                });
            })));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { StorageLive };
