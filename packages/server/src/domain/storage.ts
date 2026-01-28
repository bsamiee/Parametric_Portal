/**
 * Storage domain service with tenant context and audit logging.
 * Wraps raw StorageAdapter with automatic audit logging for mutating operations.
 * Polymorphic API mirrors StorageAdapter: single/batch determined by input shape.
 */
import { Array as A, Effect, Match, Option, pipe, Predicate, Record, type Stream } from 'effect';
import { AuditService } from '../observe/audit.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { StorageAdapter } from '../infra/storage.ts';

// --- [SERVICES] --------------------------------------------------------------

class StorageService extends Effect.Service<StorageService>()('server/Storage', {
	effect: Effect.gen(function* () {
		const storage = yield* StorageAdapter;
		const audit = yield* AuditService;
		const _traced = <O>(name: string, op: Effect.Effect<O, unknown>, event: string, details: Record<string, unknown>, subjectId: string) =>
			pipe(
				op,
				Effect.tap((result) => Effect.all([
					audit.log(event, { details: {
						...details,
						...Match.value(result).pipe(
							Match.when(Predicate.isRecord, (r) => pipe(
								Record.get(r as Record<string, unknown>, 'size'),
								Option.filter(Predicate.isNumber),
								Option.match({ onNone: () => ({}), onSome: (size) => ({ size }) }),
							)),
							Match.orElse(() => ({})),
						),
					}, subjectId }),
				], { discard: true })),
				Telemetry.span(`storageDomain.${name}`),
			);
		const _tracedVoid = (name: string, op: Effect.Effect<void, unknown>, event: string, details: Record<string, unknown>, subjectId: string) =>
			pipe(
				op,
				Effect.tap(() => Effect.all([
					audit.log(event, { details, subjectId }),
				], { discard: true })),
				Telemetry.span(`storageDomain.${name}`),
			);
		function put(input: StorageAdapter.PutInput): Effect.Effect<StorageAdapter.PutResult, unknown>;
		function put(input: readonly StorageAdapter.PutInput[]): Effect.Effect<readonly StorageAdapter.PutResult[], unknown>;
		function put(input: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]): Effect.Effect<StorageAdapter.PutResult | readonly StorageAdapter.PutResult[], unknown> {
			return Match.value(input).pipe(
				Match.when((v: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]): v is readonly StorageAdapter.PutInput[] => Array.isArray(v), (items) => pipe(
					storage.put(items),
					Effect.tap((results) => Effect.all([
						audit.log('Storage.upload', { details: { count: items.length, keys: items.map((i) => i.key), totalSize: results.reduce((acc, r) => acc + r.size, 0) }, subjectId: pipe(A.head(items), Option.map((i) => i.key), Option.getOrUndefined) }),
					], { discard: true })),
					Telemetry.span('storageDomain.put.batch'),
				)),
				Match.orElse((item) => _traced('put', storage.put(item), 'Storage.upload', { contentType: item.contentType, key: item.key }, item.key)),
			);
		}
		function remove(key: string): Effect.Effect<void, unknown>;
		function remove(keys: readonly string[]): Effect.Effect<void, unknown>;
		function remove(keys: string | readonly string[]) {
			return Match.value(keys).pipe(
				Match.when((v: string | readonly string[]): v is readonly string[] => Array.isArray(v), (items) => _tracedVoid('remove.batch', storage.remove(items), 'Storage.delete', { count: items.length, keys: items }, pipe(A.head(items), Option.getOrElse(() => '')))),
				Match.orElse((item) => _tracedVoid('remove', storage.remove(item), 'Storage.delete', { key: item }, item)),
			);
		}
		function copy(input: StorageAdapter.CopyInput): Effect.Effect<StorageAdapter.CopyResult, unknown>;
		function copy(input: readonly StorageAdapter.CopyInput[]): Effect.Effect<readonly StorageAdapter.CopyResult[], unknown>;
		function copy(input: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]): Effect.Effect<StorageAdapter.CopyResult | readonly StorageAdapter.CopyResult[], unknown> {
			return Match.value(input).pipe(
				Match.when((v: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]): v is readonly StorageAdapter.CopyInput[] => Array.isArray(v), (items) => pipe(
					storage.copy(items),
					Effect.tap(() => Effect.all([
						audit.log('Storage.copy', { details: { copies: items.map((i) => ({ dest: i.destKey, source: i.sourceKey })), count: items.length }, subjectId: pipe(A.head(items), Option.map((i) => i.destKey), Option.getOrUndefined) }),
					], { discard: true })),
					Telemetry.span('storageDomain.copy.batch'),
				)),
				Match.orElse((item) => _traced('copy', storage.copy(item), 'Storage.copy', { destKey: item.destKey, sourceKey: item.sourceKey }, item.destKey)),
			);
		}
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
				pipe(
					storage.putStream(input),
					Effect.tap((result) => Effect.all([
						audit.log('Storage.stream_upload', { details: { contentType: input.contentType, key: input.key, size: result.totalSize }, subjectId: input.key }),
					], { discard: true })),
					Telemetry.span('storageDomain.putStream'),
				);
		const abortUpload = (key: string, uploadId: string) =>
			_tracedVoid('abort-multipart', storage.abortUpload(key, uploadId), 'Storage.abort_multipart', { key, uploadId }, key);
		return { abortUpload, copy, exists: storage.exists, get: storage.get, getStream: storage.getStream, list: storage.list, listStream: storage.listStream, listUploads: storage.listUploads, put, putStream, remove, sign: storage.sign };
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StorageService {
	export type Service = typeof StorageService.Service;
	export type SignInputGetPut = StorageAdapter.SignInputGetPut;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageService };
