/**
 * Storage domain service with tenant context, audit logging, and metrics.
 * Wraps raw StorageAdapter with automatic audit logging for mutating operations.
 * Polymorphic API mirrors StorageAdapter: single/batch determined by input shape.
 */
import { Array as A, Effect, Option, pipe, type Stream } from 'effect';
import { Context } from '../context.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { StorageAdapter } from '../infra/storage.ts';

// --- [SERVICES] --------------------------------------------------------------

class StorageService extends Effect.Service<StorageService>()('server/Storage', {
	effect: Effect.gen(function* () {
		const storage = yield* StorageAdapter;
		const audit = yield* AuditService;
		const metrics = yield* MetricsService;
		const userIdFromContext = (ctx: Context.Request.Data) => Option.match(ctx.session, { onNone: () => undefined, onSome: (s) => s.userId });
		const _putSingle = (input: StorageAdapter.PutInput) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.put(input);
				yield* audit.log('Storage.upload', { details: { contentType: input.contentType, key: input.key, size: result.size, userId: userIdFromContext(ctx) }, subjectId: input.key });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-put' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.put'));
		// Put object(s) with audit logging. Single input → single result; array input → array results.
		function put(input: StorageAdapter.PutInput): Effect.Effect<StorageAdapter.PutResult, unknown>;
		function put(input: readonly StorageAdapter.PutInput[]): Effect.Effect<readonly StorageAdapter.PutResult[], unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function put(input: any): any {
			return Array.isArray(input) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const results = yield* storage.put(input);
				yield* audit.log('Storage.upload', { details: { count: input.length, keys: pipe(input as readonly StorageAdapter.PutInput[], A.map((i) => i.key)), totalSize: A.reduce(results, 0, (acc, r) => acc + r.size), userId: userIdFromContext(ctx) }, subjectId: `batch:${input.length}` });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-put' }), input.length);
				return results;
			}).pipe(Effect.withSpan('storageDomain.put.batch')) : _putSingle(input);
		}
		const _removeSingle = (key: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.remove(key);
				yield* audit.log('Storage.delete', { details: { deleted: true, key, userId: userIdFromContext(ctx) }, subjectId: key });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-delete' }), 1);
			}).pipe(Effect.withSpan('storageDomain.remove'));
		// Remove object(s) with audit logging.
		function remove(key: string): Effect.Effect<void, unknown>;
		function remove(keys: readonly string[]): Effect.Effect<void, unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function remove(keys: any): any {
			return Array.isArray(keys) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.remove(keys);
				yield* audit.log('Storage.delete', { details: { count: keys.length, deleted: true, keys, userId: userIdFromContext(ctx) }, subjectId: `batch:${keys.length}` });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-delete' }), keys.length);
			}).pipe(Effect.withSpan('storageDomain.remove.batch')) : _removeSingle(keys);
		}
		const _copySingle = (input: StorageAdapter.CopyInput) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.copy(input);
				yield* audit.log('Storage.copy', { details: { destKey: input.destKey, sourceKey: input.sourceKey, userId: userIdFromContext(ctx) }, subjectId: input.destKey });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-copy' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.copy'));
		// Copy object(s) with audit logging. Single input → single result; array input → array results.
		function copy(input: StorageAdapter.CopyInput): Effect.Effect<StorageAdapter.CopyResult, unknown>;
		function copy(input: readonly StorageAdapter.CopyInput[]): Effect.Effect<readonly StorageAdapter.CopyResult[], unknown>;
		// biome-ignore lint/suspicious/noExplicitAny: overload implementation requires any
		function copy(input: any): any {
			return Array.isArray(input) ? Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const results = yield* storage.copy(input);
				yield* audit.log('Storage.copy', { details: { copies: pipe(input as readonly StorageAdapter.CopyInput[], A.map((i) => ({ dest: i.destKey, source: i.sourceKey }))), count: input.length, userId: userIdFromContext(ctx) }, subjectId: `batch:${input.length}` });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-copy' }), input.length);
				return results;
			}).pipe(Effect.withSpan('storageDomain.copy.batch')) : _copySingle(input);
		}
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const result = yield* storage.putStream(input);
				yield* audit.log('Storage.stream_upload', { details: { contentType: input.contentType, key: input.key, size: result.totalSize, userId: userIdFromContext(ctx) }, subjectId: input.key });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-stream-put' }), 1);
				return result;
			}).pipe(Effect.withSpan('storageDomain.putStream'));
		const abortUpload = (key: string, uploadId: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* storage.abortUpload(key, uploadId);
				yield* audit.log('Storage.abort_multipart', { details: { key, uploadId, userId: userIdFromContext(ctx) }, subjectId: key });
				yield* MetricsService.inc(metrics.storage.operations, MetricsService.label({ op: 'domain-abort-multipart' }), 1);
			}).pipe(Effect.withSpan('storageDomain.abortUpload'));
		// Pass-through read operations (no audit needed).
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

namespace StorageService {
	export type CopyInput = StorageAdapter.CopyInput;
	export type CopyResult = StorageAdapter.CopyResult;
	export type GetResult = StorageAdapter.GetResult;
	export type GetStreamResult = StorageAdapter.GetStreamResult;
	export type ListItem = StorageAdapter.ListItem;
	export type PutInput = StorageAdapter.PutInput;
	export type PutResult = StorageAdapter.PutResult;
	export type Service = typeof StorageService.Service;
	export type SignInput = StorageAdapter.SignInput;
	export type SignInputCopy = StorageAdapter.SignInputCopy;
	export type SignInputGetPut = StorageAdapter.SignInputGetPut;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageService };
