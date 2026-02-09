/**
 * Storage domain service: audit-logged write operations.
 * Read-only ops (get, exists, list, sign) go directly through StorageAdapter.
 */
import { Array as A, Effect, Match, Number as N, Option, pipe, Predicate, Record, Struct, type Stream } from 'effect';
import { constant } from 'effect/Function';
import { AuditService } from '../observe/audit.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { StorageAdapter } from '../infra/storage.ts';

// --- [SERVICES] --------------------------------------------------------------

class StorageService extends Effect.Service<StorageService>()('server/Storage', {
	effect: Effect.gen(function* () {
		const storage = yield* StorageAdapter;
		const audit = yield* AuditService;
		const _sizeOf = (result: unknown) => Match.value(result).pipe(
			Match.when(Predicate.isRecord, (record) => pipe(Record.get(record as Record<string, unknown>, 'size'), Option.filter(Predicate.isNumber), Option.match({ onNone: constant({}), onSome: (size) => ({ size }) }))),
			Match.orElse(constant({})),
		);
		const _traced = <O>(name: string, op: Effect.Effect<O, unknown>, event: string, details: Record<string, unknown>, subjectId: string) =>
			pipe(op, Effect.tap((result) => audit.log(event, { details: { ...details, ..._sizeOf(result) }, subjectId })), Telemetry.span(`storageDomain.${name}`));
		function put(input: StorageAdapter.PutInput): Effect.Effect<StorageAdapter.PutResult, unknown>;
		function put(input: readonly StorageAdapter.PutInput[]): Effect.Effect<readonly StorageAdapter.PutResult[], unknown>;
		function put(input: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]): Effect.Effect<StorageAdapter.PutResult | readonly StorageAdapter.PutResult[], unknown> {
			return Match.value(input).pipe(
				Match.when((value: StorageAdapter.PutInput | readonly StorageAdapter.PutInput[]): value is readonly StorageAdapter.PutInput[] => Array.isArray(value), (items) => pipe(
					storage.put(items),
					Effect.tap((results) => audit.log('Storage.upload', { details: { count: items.length, keys: pipe(items, A.map(Struct.get('key'))), totalSize: pipe(results, A.map(Struct.get('size')), N.sumAll) }, subjectId: pipe(A.head(items), Option.map(Struct.get('key')), Option.getOrUndefined) })),
					Telemetry.span('storageDomain.put.batch'),
				)),
				Match.orElse((item) => _traced('put', storage.put(item), 'Storage.upload', { contentType: item.contentType, key: item.key }, item.key)),
			);
		}
		function remove(key: string): Effect.Effect<void, unknown>;
		function remove(keys: readonly string[]): Effect.Effect<void, unknown>;
		function remove(keys: string | readonly string[]) {
			return Match.value(keys).pipe(
				Match.when((value: string | readonly string[]): value is readonly string[] => Array.isArray(value), (items) => _traced('remove.batch', storage.remove(items), 'Storage.delete', { count: items.length, keys: items }, pipe(A.head(items), Option.getOrElse(() => '')))),
				Match.orElse((item) => _traced('remove', storage.remove(item), 'Storage.delete', { key: item }, item)),
			);
		}
		function copy(input: StorageAdapter.CopyInput): Effect.Effect<StorageAdapter.CopyResult, unknown>;
		function copy(input: readonly StorageAdapter.CopyInput[]): Effect.Effect<readonly StorageAdapter.CopyResult[], unknown>;
		function copy(input: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]): Effect.Effect<StorageAdapter.CopyResult | readonly StorageAdapter.CopyResult[], unknown> {
			return Match.value(input).pipe(
				Match.when((value: StorageAdapter.CopyInput | readonly StorageAdapter.CopyInput[]): value is readonly StorageAdapter.CopyInput[] => Array.isArray(value), (items) => pipe(
					storage.copy(items),
					Effect.tap(() => audit.log('Storage.copy', { details: { copies: pipe(items, A.map((item) => ({ dest: item.destKey, source: item.sourceKey }))), count: items.length }, subjectId: pipe(A.head(items), Option.map(Struct.get('destKey')), Option.getOrUndefined) })),
					Telemetry.span('storageDomain.copy.batch'),
				)),
				Match.orElse((item) => _traced('copy', storage.copy(item), 'Storage.copy', { destKey: item.destKey, sourceKey: item.sourceKey }, item.destKey)),
			);
		}
		const putStream = (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; contentType?: string; metadata?: Record<string, string>; partSizeBytes?: number }) =>
			pipe(
				storage.putStream(input),
				Effect.tap((result) => audit.log('Storage.stream_upload', { details: { contentType: input.contentType, key: input.key, size: result.totalSize }, subjectId: input.key })),
				Telemetry.span('storageDomain.putStream'),
			);
		const abortUpload = (key: string, uploadId: string) => _traced('abort-multipart', storage.abortUpload(key, uploadId), 'Storage.abort_multipart', { key, uploadId }, key);
		return { abortUpload, copy, put, putStream, remove };
	}),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace StorageService {
	export type Service = typeof StorageService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { StorageService };
