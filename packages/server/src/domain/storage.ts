/**
 * Storage domain service with tenant context, audit logging, and metrics.
 * Wraps raw StorageService with automatic audit logging for mutating operations.
 * Polymorphic API mirrors StorageService: single/batch determined by input shape.
 */
import { Effect, Option, type Stream } from 'effect';
import { Context } from '../context.ts';
import { AuditService } from './audit.ts';
import { MetricsService } from '../infra/metrics.ts';
import { StorageService } from '../infra/storage.ts';

// --- [SERVICES] --------------------------------------------------------------

class StorageDomainService extends Effect.Service<StorageDomainService>()('server/StorageDomain', {
	effect: Effect.gen(function* () {
		const storage = yield* StorageService;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const userIdFromContext = (ctx: Context.Request.Data) => Option.match(ctx.session, { onNone: () => undefined, onSome: (s) => s.userId });
		const _putSingle = (input: StorageService.PutInput) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.put(input);
				yield* audit.log('storage', input.key, 'upload', {
					after: { contentType: input.contentType, key: input.key, size: result.size, userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-put' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.put'));
		/** Put object(s) with audit logging. Single input → single result; array input → array results. */
		function put(input: StorageService.PutInput): Effect.Effect<StorageService.PutResult, unknown>;
		function put(input: readonly StorageService.PutInput[]): Effect.Effect<readonly StorageService.PutResult[], unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function put(input: any): any {
			return Array.isArray(input) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const results = yield* storage.put(input);
				yield* audit.log('storage', `batch:${input.length}`, 'upload', {
					after: { count: input.length, keys: input.map((i: StorageService.PutInput) => i.key), totalSize: results.reduce((acc, r) => acc + r.size, 0), userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-put' }), input.length);
				return results;
			}).pipe(Effect.withSpan('storageDomain.put.batch')) : _putSingle(input);
		}
		const _removeSingle = (key: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.remove(key);
				yield* audit.log('storage', key, 'delete', {
					after: { deleted: true, userId: userIdFromContext(ctx) },
					before: { key },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-delete' }), 1);
			}).pipe(Effect.withSpan('storageDomain.remove'));
		/** Remove object(s) with audit logging. */
		function remove(key: string): Effect.Effect<void, unknown>;
		function remove(keys: readonly string[]): Effect.Effect<void, unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function remove(keys: any): any {
			return Array.isArray(keys) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.remove(keys);
				yield* audit.log('storage', `batch:${keys.length}`, 'delete', {
					after: { count: keys.length, deleted: true, userId: userIdFromContext(ctx) },
					before: { keys },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-delete' }), keys.length);
			}).pipe(Effect.withSpan('storageDomain.remove.batch')) : _removeSingle(keys);
		}
		const _copySingle = (input: StorageService.CopyInput) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.copy(input);
				yield* audit.log('storage', input.destKey, 'copy', {
					after: { destKey: input.destKey, sourceKey: input.sourceKey, userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-copy' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.copy'));
		/** Copy object(s) with audit logging. Single input → single result; array input → array results. */
		function copy(input: StorageService.CopyInput): Effect.Effect<StorageService.CopyResult, unknown>;
		function copy(input: readonly StorageService.CopyInput[]): Effect.Effect<readonly StorageService.CopyResult[], unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function copy(input: any): any {
			return Array.isArray(input) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const results = yield* storage.copy(input);
				yield* audit.log('storage', `batch:${input.length}`, 'copy', {
					after: { copies: input.map((i: StorageService.CopyInput) => ({ dest: i.destKey, source: i.sourceKey })), count: input.length, userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-copy' }), input.length);
				return results;
			}).pipe(Effect.withSpan('storageDomain.copy.batch')) : _copySingle(input);
		}
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.putStream(input);
				yield* audit.log('storage', input.key, 'stream-upload', {
					after: { contentType: input.contentType, key: input.key, size: result.totalSize, userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-stream-put' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.putStream'));
		const abortUpload = (key: string, uploadId: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.abortUpload(key, uploadId);
				yield* audit.log('storage', key, 'abort-multipart', {
					after: { key, uploadId, userId: userIdFromContext(ctx) },
				});
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-abort-multipart' }), 1);
			}).pipe(Effect.withSpan('storageDomain.abortUpload'));
		/** Pass-through read operations (no audit needed). */
		const get = storage.get;
		const getStream = storage.getStream;
		const list = storage.list;
		const listStream = storage.listStream;
		const listUploads = storage.listUploads;
		const exists = storage.exists;
		const sign = storage.sign;
		return { abortUpload, copy, exists, get, getStream, list, listStream, listUploads, put, putStream, remove, sign };
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StorageDomainService {
	export type PutInput = StorageService.PutInput;
	export type PutResult = StorageService.PutResult;
	export type CopyInput = StorageService.CopyInput;
	export type CopyResult = StorageService.CopyResult;
	export type SignInput = StorageService.SignInput;
	export type GetResult = StorageService.GetResult;
	export type Service = typeof StorageDomainService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageDomainService };
