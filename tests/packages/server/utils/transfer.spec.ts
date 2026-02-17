/**
 * Transfer tests: codec roundtrips, boundary limits, path security, zip edge
 * cases, parse errors, schema-derived arbs, model-based import composition.
 */
import { it } from '@effect/vitest';
import { Transfer, TransferError } from '@parametric-portal/server/utils/transfer';
import { Array as A, Chunk, Effect, Either, FastCheck as fc, Schema as S, Stream } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _safe =       fc.string({ maxLength: 32, minLength: 1 }).filter((v) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(v));
const _item =       fc.record({ content: _safe, id: fc.uuid(), type: _safe, updatedAt: fc.integer({ max: 1_700_604_800_000, min: 1_700_000_000_000 }) });
const _ParseError = S.Struct(TransferError.Parse.fields);
const _FatalError = S.Struct(TransferError.Fatal.fields);
const _serialize:   Record<'csv' | 'ndjson' | 'yaml', (items: readonly { content: string; type: string }[]) => string> = { csv: (items) => `type,content\n${items.map((i) => `${i.type},${i.content}`).join('\n')}`, ndjson: (items) => items.map((i) => JSON.stringify(i)).join('\n'), yaml: (items) => items.map((i) => `---\ntype: ${i.type}\ncontent: ${i.content}`).join('\n') } as const; // NOSONAR S3358

// --- [ALGEBRAIC] -------------------------------------------------------------

// P1: Text codec roundtrip (ndjson, yaml) + differential cross-validation
it.effect.prop('P1: text roundtrip', { format: fc.constantFrom<'ndjson' | 'yaml'>('ndjson', 'yaml'), items: fc.array(_item, { maxLength: 6, minLength: 1 }) }, ({ format, items }) => Effect.gen(function* () {
    const enriched = A.map(items, (item, index) => ({ ...item, ordinal: index + 1 }));
    const exported = yield* Stream.fromIterable(enriched).pipe((s) => Transfer.export(s, format), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('')));
    const { failures, items: parsed } = Transfer.partition(Chunk.toArray(yield* Transfer.import(exported, { format }).pipe(Stream.runCollect)));
    expect(failures).toHaveLength(0);
    expect(A.map(parsed, (x) => x.content)).toEqual(A.map(items, (x) => x.content));
    format === 'ndjson' && expect(A.map(parsed, (x) => x.content)).toEqual(exported.split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { content: string }).content));
}), { fastCheck: { numRuns: 60 } });
// P2: Binary codec roundtrip (xlsx, zip)
it.effect.prop('P2: binary roundtrip', { format: fc.constantFrom<'xlsx' | 'zip'>('xlsx', 'zip'), items: fc.array(_item, { maxLength: 4, minLength: 0 }) }, ({ format, items }) => Effect.gen(function* () {
    const enriched = A.map(items, (item, index) => ({ ...item, ordinal: index + 1 }));
    const { count, data } = yield* Stream.fromIterable(enriched).pipe((s) => Transfer.export(s, format));
    const buffer = Buffer.from(data, 'base64');
    const { items: parsed } = Transfer.partition(Chunk.toArray(yield* Transfer.import(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), { format }).pipe(Stream.runCollect)));
    expect(count).toBe(items.length);
    expect(A.map(parsed, (x) => x.content)).toEqual(A.map(items, (x) => x.content));
}), { fastCheck: { numRuns: 15 } });
// P3: Empty inputs = identity stream + modes + limits
it.effect('P3: empty + modes + limits', () => Effect.all([
    Effect.all((['ndjson', 'csv', 'yaml'] as const).map((fmt) => Transfer.import('', { format: fmt }).pipe(Stream.runCollect, Effect.map((c) => Chunk.size(c))))).pipe(Effect.map((sizes) => expect(sizes).toEqual([0, 0, 0]))),
    Transfer.import('arbitrary', { format: 'txt', mode: 'file', type: 'doc' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.type)),
    Transfer.import('{"content":"x"}', { format: 'ndjson', type: 'fallback' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.type)),
    Transfer.import('type,content\ndoc,hello', { format: 'csv' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
    Transfer.import(A.replicate(JSON.stringify({ content: 'x', type: 't' }), 10_001).join('\n'), { format: 'ndjson' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
    Transfer.import(`{"type":"t","content":"${'x'.repeat(1_100_000)}"}`, { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
]).pipe(Effect.tap(([_, file, fallback, csv, rowLimit, tooLarge]) => { expect([file, fallback, csv, rowLimit, tooLarge]).toEqual(['doc', 'fallback', 'hello', 'ROW_LIMIT', 'TOO_LARGE']); }), Effect.asVoid));
// P4: Path traversal rejected
it.effect('P4: path security', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
    Effect.flatMap((JSZip) => Effect.all(['../escape.txt', '/etc/passwd'].map((path) => {
        const archive = new JSZip();
        archive.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: path, size: 1, type: 'text' }], version: 1 }));
        archive.file(path, 'pwned');
        return Effect.promise(() => archive.generateAsync({ type: 'arraybuffer' })).pipe(Effect.flatMap((buf) => Transfer.import(buf, { format: 'zip' }).pipe(Stream.runCollect)), Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures.some((f) => f.code === 'INVALID_PATH')));
    }))),
    Effect.tap((results) => { expect(results).toEqual([true, true]); }), Effect.asVoid));
// P5: Zip edge cases (bomb, no manifest, invalid format, invalid manifest, hash mismatch)
it.effect('P5: zip security', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
    Effect.flatMap((JSZip) => {
        const bomb = new JSZip(); bomb.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: 'bomb.txt', size: 60_000_000, type: 'text' }], version: 1 })); bomb.file('bomb.txt', 'A'.repeat(1_000), { compression: 'DEFLATE' });
        const plain = new JSZip(); plain.file('doc.txt', 'hello');
        const badManifest = new JSZip(); badManifest.file('manifest.json', '{invalid json}');
        const badHash = new JSZip(); badHash.file('manifest.json', JSON.stringify({ entries: [{ hash: 'wrong', mime: 'text/plain', name: 'a.txt', size: 1, type: 'text' }], version: 1 })); badHash.file('a.txt', 'content');
        return Effect.all([Effect.promise(() => bomb.generateAsync({ compression: 'DEFLATE', compressionOptions: { level: 9 }, type: 'arraybuffer' })), Effect.promise(() => plain.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => badManifest.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => badHash.generateAsync({ type: 'arraybuffer' }))]);
    }),
    Effect.flatMap(([bombBuf, plainBuf, badManifestBuf, badHashBuf]) => Effect.all([
        Transfer.import(bombBuf,        { format: 'zip' }).pipe(Stream.runCollect, Effect.flip, Effect.map((e) => ['COMPRESSION_RATIO', 'ARCHIVE_LIMIT', 'TOO_LARGE'].includes(e.code))),
        Transfer.import(plainBuf,       { format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => { const item = Transfer.partition(Chunk.toArray(c)).items[0]; return [item?.content, item?.type]; })),
        Transfer.import(new Uint8Array([0, 1, 2, 3]).buffer, { format: 'zip' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
        Transfer.import(badManifestBuf, { format: 'zip' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
        Transfer.import(badHashBuf,     { format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    ])),
    Effect.tap(([bombErr, content, invalidFmt, invalidManifest, hashMismatch]) => { expect([bombErr, content, invalidFmt, invalidManifest, hashMismatch]).toEqual([true, ['hello', 'txt'], 'INVALID_FORMAT', 'INVALID_MANIFEST', 'HASH_MISMATCH']); }), Effect.asVoid));

// --- [EDGE_CASES] ------------------------------------------------------------

// E1: Parse errors by format + schema-derived error shapes
it.effect.prop('E1: error schemas', { fatal: _FatalError, parse: _ParseError }, ({ parse, fatal }) => Effect.sync(() => {
    expect(['DECOMPRESS', 'HASH_MISMATCH', 'INVALID_PATH', 'INVALID_RECORD', 'MISSING_TYPE', 'SCHEMA_MISMATCH', 'TOO_LARGE']).toContain(parse.code);
    expect(parse.detail === undefined || typeof parse.detail === 'string').toBe(true);
    expect(['ARCHIVE_LIMIT', 'COMPRESSION_RATIO', 'INVALID_FORMAT', 'INVALID_MANIFEST', 'PARSER_ERROR', 'ROW_LIMIT', 'UNSUPPORTED']).toContain(fatal.code);
}), { fastCheck: { numRuns: 100 } });
// E2: Parse errors by format
it.effect('E2: parse errors', () => Effect.all([
    Transfer.import('{"type":"a"}\n{invalid}\n{"type":"b"}', { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    Transfer.import('{"content":"x"}',      { format: 'ndjson', type: '' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    Transfer.import('type,content\n,hello', { format: 'csv' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    Transfer.import('not: valid: yaml: [',  { format: 'yaml' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    Transfer.import('"unclosed quote\n',    { format: 'csv' }).pipe(Stream.runCollect, Effect.either, Effect.map((r) => Either.isLeft(r) && r.left.code)),
]).pipe(Effect.tap(([ndjson, missing, csv, yaml, parser]) => { expect([ndjson, missing, csv, yaml, parser]).toEqual(['INVALID_RECORD', 'MISSING_TYPE', 'MISSING_TYPE', 'INVALID_RECORD', 'PARSER_ERROR']); }), Effect.asVoid));
// E3: Multi-input, partition, XML CDATA, export formats
it.effect('E3: multi-input + partition + xml + exports', () => Effect.all([
    Transfer.import(['{"type":"x","content":"1"}', '{"type":"y","content":"2"}'], { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c))), Effect.map((r) => [r.items.length, r.items[0]?.content, r.items[1]?.content])),
    Effect.sync(() => Transfer.partition([Either.right({ content: 'a', ordinal: 1, type: 't' }), Either.left(new TransferError.Parse({ code: 'INVALID_RECORD', ordinal: 2 })), Either.right({ content: 'b', ordinal: 3, type: 't' })])),
    Transfer.import('<?xml version="1.0"?><root><item type="doc"><![CDATA[nested]]></item></root>', { format: 'xml' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
    Stream.fromIterable([{ content: 'test', id: '1', ordinal: 1, type: 'doc', updatedAt: 1_700_000_000_000 }] as const).pipe((s) => Transfer.export(s, 'xml'), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('').includes('CDATA'))),
    Stream.fromIterable([{ content: 'test', id: '1', ordinal: 1, type: 'doc', updatedAt: 1_700_000_000_000 }] as const).pipe((s) => Transfer.export(s, 'csv'), Stream.runCollect, Effect.map((c) => Chunk.toArray(c).map((b) => new TextDecoder().decode(b)).join('').includes('test'))),
]).pipe(Effect.tap(([multi, part, xml, xmlCdata, csvExport]) => { expect([multi, [part.items.length, part.failures.length, part.ordinalMap], xml, xmlCdata, csvExport]).toEqual([[2, '1', '2'], [2, 1, [1, 3]], 'nested', true, true]); }), Effect.asVoid));
// E4: Auto-detect (no format), none-dispatch branches, Import error, hash/name/mime fields
it.effect('E4: auto-detect + none dispatch + error messages', () => Effect.all([
    Transfer.import('{"type":"t","content":"c","hash":"h1","name":"f.txt","mime":"text/plain"}').pipe(Stream.runCollect, Effect.map((c) => { const item = Transfer.partition(Chunk.toArray(c)).items[0]; return [item?.hash, item?.name, item?.mime]; })),
    Transfer.import('hello world').pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.type)),
    Transfer.import(`${'x'.repeat(1_100_000)}`, { type: 'doc' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
    Effect.sync(() => new TransferError.Import({ code: 'BATCH_FAILED', rows: [1, 2] }).message),
    Effect.sync(() => new TransferError.Parse({ code: 'INVALID_RECORD', detail: 'bad', ordinal: 1 }).message),
    Effect.sync(() => new TransferError.Parse({ code: 'INVALID_RECORD', ordinal: 1 }).message),
    Effect.sync(() => new TransferError.Fatal({ code: 'PARSER_ERROR', detail: 'oops' }).message),
    Effect.sync(() => new TransferError.Fatal({ code: 'PARSER_ERROR' }).message),
    Transfer.import('type,content\ndoc,hello').pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
]).pipe(Effect.tap(([fields, autoType, noneTooLarge, importMsg, parseMsgD, parseMsgN, fatalMsgD, fatalMsgN, autoDetectCsv]) => {
    expect([fields, autoType, noneTooLarge, autoDetectCsv]).toEqual([['h1', 'f.txt', 'text/plain'], 'txt', 'TOO_LARGE', 'hello']);
    expect([importMsg, parseMsgN, fatalMsgN]).toEqual(['Import[BATCH_FAILED] rows: 1, 2', 'Parse[INVALID_RECORD]@1', 'Fatal[PARSER_ERROR]']);
    expect(parseMsgD).toContain('bad'); expect(fatalMsgD).toContain('oops');
}), Effect.asVoid));
// E5: Zip manifest missing type/no-hash + CSV hash/name/mime + XML no-type + ndjson without type key
it.effect('E5: deep branch coverage', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
    Effect.flatMap((JSZip) => {
        const noType = new JSZip(); noType.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: 'a.txt', size: 1 }], version: 1 })); noType.file('a.txt', 'data');
        const tooLarge = new JSZip(); tooLarge.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: 'big.txt', size: 1_200_000, type: 'doc' }], version: 1 })); tooLarge.file('big.txt', 'x'.repeat(100));
        const noHash = new JSZip(); noHash.file('manifest.json', JSON.stringify({ entries: [{ mime: 'text/plain', name: 'b.txt', size: 4, type: 'doc' }, { mime: 'image/png', name: 'img.png', size: 4, type: 'image' }], version: 1 })); noHash.file('b.txt', 'test'); noHash.file('img.png', new Uint8Array([1, 2, 3, 4]));
        return Effect.all([Effect.promise(() => noType.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => tooLarge.generateAsync({ type: 'arraybuffer' })), Effect.promise(() => noHash.generateAsync({ type: 'arraybuffer' }))]);
    }),
    Effect.flatMap(([noTypeBuf, tooLargeBuf, noHashBuf]) => Effect.all([
        Transfer.import(noTypeBuf, { format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
        Transfer.import(tooLargeBuf, { format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
        Transfer.import(noHashBuf, { format: 'zip' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items.map((i) => i.type))),
        Transfer.import('type,content,hash,name,mime\ndoc,hi,h1,f.txt,text/plain\nimg,px,,,', { format: 'csv' }).pipe(Stream.runCollect, Effect.map((c) => { const parsed = Transfer.partition(Chunk.toArray(c)); return [parsed.items[0]?.hash, parsed.items[1]?.hash]; })),
        Transfer.import('<?xml version="1.0"?><root><item>bare text</item></root>', { format: 'xml', type: '' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
        Transfer.import('{"content":"v"}', { format: 'ndjson', type: '' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures[0]?.code)),
        Transfer.import('{"type":"t"}', { format: 'ndjson' }).pipe(Stream.runCollect, Effect.map((c) => Transfer.partition(Chunk.toArray(c)).items[0]?.content)),
    ])),
    Effect.tap(([noType, tooLarge, noHash, csvFields, xmlNoType, ndjsonNoType, ndjsonNoContent]) => {
        expect([noType, tooLarge, noHash, csvFields, xmlNoType, ndjsonNoType]).toEqual(['MISSING_TYPE', 'TOO_LARGE', ['doc', 'image'], ['h1', undefined], 'MISSING_TYPE', 'MISSING_TYPE']);
        expect(ndjsonNoContent).toBe('{"type":"t"}');
    }), Effect.asVoid));

// --- [COMMANDS] --------------------------------------------------------------

class ImportCommand implements fc.AsyncCommand<{ formatsSeen: Set<string>; itemCount: number }, { items: readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] }> {
    format: 'csv' | 'ndjson' | 'yaml';
    items: readonly { content: string; type: string }[];
    constructor(format: 'csv' | 'ndjson' | 'yaml', items: readonly { content: string; type: string }[]) { this.format = format; this.items = items; }
    check = () => true;
    async run(model: { formatsSeen: Set<string>; itemCount: number }, real: { items: readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] }): Promise<void> {
        const rows = await Effect.runPromise(Transfer.import(_serialize[this.format](this.items), { format: this.format }).pipe(Stream.runCollect, Effect.map(Chunk.toArray)));
        const { failures, items: parsed } = Transfer.partition(rows);
        expect(failures).toHaveLength(0);
        expect(parsed).toHaveLength(this.items.length);
        // biome-ignore lint/style/noParameterAssign: fc.AsyncCommand.run mutates model by contract
        model.itemCount += this.items.length; model.formatsSeen.add(this.format);
        Object.assign(real, { items: [...real.items, ...rows] });
    }
    toString = () => `Import(${this.format}, ${this.items.length} items)`;
}
class VerifyCommand implements fc.AsyncCommand<{ formatsSeen: Set<string>; itemCount: number }, { items: readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] }> {
    check = (model: Readonly<{ itemCount: number }>) => model.itemCount > 0;
    async run(model: { itemCount: number }, real: { items: readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] }): Promise<void> {
        expect(Transfer.partition(real.items as readonly Either.Either<{ content: string; ordinal: number; type: string }, never>[]).items).toHaveLength(model.itemCount);
    }
    toString = () => 'Verify';
}
const _allCommands = [
    fc.tuple(fc.constantFrom<'csv' | 'ndjson' | 'yaml'>('ndjson', 'yaml', 'csv'), fc.array(_safe.map((content) => ({ content, type: 'doc' })), { maxLength: 4, minLength: 1 })).map(([format, items]) => new ImportCommand(format, items)),
    fc.constant(new VerifyCommand()),
];
// P6: Model-based command sequence — import operations across formats are composable
it.effect('P6: model-based import', () => Effect.promise(() => fc.assert(
    fc.asyncProperty(fc.commands(_allCommands, { size: '-1' }), async (cmds) => {
        await fc.asyncModelRun(() => ({ model: { formatsSeen: new Set<string>(), itemCount: 0 }, real: { items: [] as readonly Either.Either<{ content: string; ordinal: number; type: string }, unknown>[] } }), cmds);
    }), { numRuns: 30 },
)));
