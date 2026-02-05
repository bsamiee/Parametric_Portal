import { it } from '@effect/vitest';
import { Transfer, TransferError } from '@parametric-portal/server/utils/transfer';
import { Array as A, Chunk, Effect, Either, FastCheck as fc, Stream } from 'effect';
import { expect } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type Asset = { content: string; id: string; ordinal: number; type: string; updatedAt: number };

// --- [CONSTANTS] -------------------------------------------------------------

const _safe = fc.string({ maxLength: 32, minLength: 1 }).filter((v) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(v));
const _item = fc.record({ content: _safe, id: fc.uuid(), type: _safe, updatedAt: fc.integer({ max: 1_700_604_800_000, min: 1_700_000_000_000 }) });

// --- [ALGEBRAIC: CODEC ROUNDTRIPS] -------------------------------------------

// P1: Text codec roundtrip (ndjson, yaml)
it.effect.prop('P1: text roundtrip', { format: fc.constantFrom<'ndjson' | 'yaml'>('ndjson', 'yaml'), items: fc.array(_item, { maxLength: 6, minLength: 1 }) }, ({ format, items }) => Effect.gen(function* () {
	const enriched: readonly Asset[] = A.map(items, (item, index) => ({ ...item, ordinal: index + 1 }));
	const exported = yield* Stream.fromIterable(enriched).pipe((s) => Transfer.export(s, format), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('')));
	const { failures, items: parsed } = Transfer.partition(Chunk.toArray(yield* Transfer.import(exported, { format }).pipe(Stream.runCollect)));
	expect(failures).toHaveLength(0);
	expect(A.map(parsed, (x) => x.content)).toEqual(A.map(items, (x) => x.content));
}), { fastCheck: { numRuns: 60 } });

// P2: Binary codec roundtrip (xlsx, zip)
it.effect.prop('P2: binary roundtrip', { format: fc.constantFrom<'xlsx' | 'zip'>('xlsx', 'zip'), items: fc.array(_item, { maxLength: 4, minLength: 0 }) }, ({ format, items }) => Effect.gen(function* () {
	const enriched: readonly Asset[] = A.map(items, (item, index) => ({ ...item, ordinal: index + 1 }));
	const { count, data } = yield* Stream.fromIterable(enriched).pipe((s) => Transfer.export(s, format));
	const buffer = Buffer.from(data, 'base64');
	const { items: parsed } = Transfer.partition(Chunk.toArray(yield* Transfer.import(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { format }).pipe(Stream.runCollect)));
	expect(count).toBe(items.length);
	expect(A.map(parsed, (x) => x.content)).toEqual(A.map(items, (x) => x.content));
}), { fastCheck: { numRuns: 15 } });

// --- [BOUNDARY + SECURITY] ---------------------------------------------------

// P3: Empty inputs = identity stream
it.effect('P3: empty inputs', () => Effect.all((['ndjson', 'csv', 'yaml'] as const).map((fmt) => Transfer.import('', { format: fmt }).pipe(Stream.runCollect, Effect.map((c) => Chunk.size(c))))).pipe(Effect.map((sizes) => expect(sizes).toEqual([0, 0, 0]))));

// P4: Import modes + row limit + too large entry
it.effect('P4: modes + limits', () => Effect.all([
	Transfer.import('arbitrary', { format: 'txt', mode: 'file', type: 'doc' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.type)),
	Transfer.import('test', { type: 'unknown' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items.length)),
	Transfer.import('{"content":"x"}', { format: 'ndjson', type: 'fallback' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.type)),
	Transfer.import('type,content\ndoc,hello', { format: 'csv' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
	Transfer.import(A.replicate(JSON.stringify({ content: 'x', type: 't' }), 10_001).join('\n'), { format: 'ndjson' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
	Transfer.import(`{"type":"t","content":"${'x'.repeat(1_100_000)}"}`, { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
]).pipe(Effect.map(([file, detect, fallback, csv, rowLimit, tooLarge]) => expect([file, detect, fallback, csv, rowLimit, tooLarge]).toEqual(['doc', 1, 'fallback', 'hello', 'ROW_LIMIT', 'TOO_LARGE']))));

// P5: Path traversal rejected
it.effect('P5: path security', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
	Effect.flatMap((JSZip) => Effect.all(['../escape.txt', '/etc/passwd'].map((path) => {
		const archive = new JSZip();
		archive.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: path, size: 1, type: 'text' }], version: 1 }));
		archive.file(path, 'pwned');
		return Effect.promise(() => archive.generateAsync({ type: 'arraybuffer' })).pipe(Effect.flatMap((buf) => Transfer.import(buf, { format: 'zip' }).pipe(Stream.runCollect)), Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures.some((f) => f.code === 'INVALID_PATH')));
	}))),
	Effect.map((results) => expect(results).toEqual([true, true]))));

// P6: Zip edge cases (bomb, no manifest, invalid format, invalid manifest, hash mismatch)
it.effect('P6: zip security', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
	Effect.flatMap((JSZip) => {
		const bomb = new JSZip(); bomb.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: 'bomb.txt', size: 60_000_000, type: 'text' }], version: 1 })); bomb.file('bomb.txt', 'A'.repeat(60_000_000), { compression: 'DEFLATE' });
		const plain = new JSZip(); plain.file('doc.txt', 'hello');
		const badManifest = new JSZip(); badManifest.file('manifest.json', '{invalid json}');
		const badHash = new JSZip(); badHash.file('manifest.json', JSON.stringify({ entries: [{ hash: 'wrong', mime: 'text/plain', name: 'a.txt', size: 1, type: 'text' }], version: 1 })); badHash.file('a.txt', 'content');
		return Effect.all([Effect.promise(() => bomb.generateAsync({ compression: 'DEFLATE', compressionOptions: { level: 9 }, type: 'arraybuffer' })), Effect.promise(() => plain.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => badManifest.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => badHash.generateAsync({ type: 'arraybuffer' }))]);
	}),
	Effect.flatMap(([bombBuf, plainBuf, badManifestBuf, badHashBuf]) => Effect.all([
		Transfer.import(bombBuf, 		{ format: 'zip' }).pipe(Stream.runCollect, Effect.flip, Effect.map((e) => ['COMPRESSION_RATIO', 'ARCHIVE_LIMIT', 'TOO_LARGE'].includes(e.code))),
		Transfer.import(plainBuf, 		{ format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
		Transfer.import(new Uint8Array([0, 1, 2, 3]).buffer, { format: 'zip' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
		Transfer.import(badManifestBuf, { format: 'zip' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
		Transfer.import(badHashBuf, 	{ format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
	])),
	Effect.map(([bombErr, content, invalidFmt, invalidManifest, hashMismatch]) => expect([bombErr, content, invalidFmt, invalidManifest, hashMismatch]).toEqual([true, 'hello', 'INVALID_FORMAT', 'INVALID_MANIFEST', 'HASH_MISMATCH']))));

// --- [ERROR PATHS] -----------------------------------------------------------

// P7: Parse errors by format
it.effect('P7: parse errors', () => Effect.all([
	Transfer.import('{"type":"a"}\n{invalid}\n{"type":"b"}', { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
	Transfer.import('{"content":"x"}',		{ format: 'ndjson', type: '' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
	Transfer.import('type,content\n,hello', { format: 'csv' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
	Transfer.import('not: valid: yaml: [', 	{ format: 'yaml' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
	Transfer.import('"unclosed quote\n', 	{ format: 'csv' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
]).pipe(Effect.map(([ndjson, missing, csv, yaml, parser]) => expect([ndjson, missing, csv, yaml, parser]).toEqual(['INVALID_RECORD', 'MISSING_TYPE', 'MISSING_TYPE', 'INVALID_RECORD', 'PARSER_ERROR']))));

// P8: Partition separates Either + XML CDATA + exports
it.effect('P8: partition + xml + exports', () => Effect.all([
	Effect.sync(() => Transfer.partition([Either.right({ content: 'a', ordinal: 1, type: 't' }), Either.left(new TransferError.Parse({ code: 'INVALID_RECORD', ordinal: 2 })), Either.right({ content: 'b', ordinal: 3, type: 't' })])),
	Transfer.import('<?xml version="1.0"?><root><item type="doc"><![CDATA[nested]]></item></root>', { format: 'xml' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
	Stream.fromIterable([{ content: 'test', id: '1', ordinal: 1, type: 'doc', updatedAt: 1_700_000_000_000 }] as const).pipe((s) => Transfer.export(s, 'xml'), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('').includes('CDATA'))),
	Stream.fromIterable([{ content: 'test', id: '1', ordinal: 1, type: 'doc', updatedAt: 1_700_000_000_000 }] as const).pipe((s) => Transfer.export(s, 'csv'), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('').includes('test'))),
]).pipe(Effect.map(([part, xml, xmlCdata, csvExport]) => expect([[part.items.length, part.failures.length, part.ordinalMap], xml, xmlCdata, csvExport]).toEqual([[2, 1, [1, 3]], 'nested', true, true]))));
