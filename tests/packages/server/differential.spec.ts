/**
 * Differential tests: cross-validate implementations against independent references.
 */
import { it } from '@effect/vitest';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Transfer } from '@parametric-portal/server/utils/transfer';
import { Chunk, Effect, FastCheck as fc, Stream } from 'effect';
import { createHash } from 'node:crypto';
import { applyPatch, createPatch } from 'rfc6902';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _safeKey = fc.string({ maxLength: 16, minLength: 1 }).filter((k) => /^[a-zA-Z]\w*$/.test(k) && !['__proto__', 'constructor', 'prototype'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 2 }), { maxKeys: 6 }).filter((o) => !JSON.stringify(o).includes('"__proto__"'));
const _text = fc.string({ maxLength: 128, minLength: 0 });
const _ndjsonRow = fc.record({ content: fc.string({ maxLength: 32, minLength: 1 }).filter((s) => !s.includes('\n') && !s.includes('"')), type: fc.stringMatching(/^[a-z]{1,8}$/) });

// --- [ALGEBRAIC] -------------------------------------------------------------

// D1: SHA-256 differential — Crypto.hash vs Node crypto.createHash
it.effect.prop('D1: SHA-256 Crypto.hash = Node createHash', { input: _text }, ({ input }) =>
    Crypto.hash(input).pipe(Effect.tap((ours) => {
        const ref = createHash('sha256').update(input).digest('hex');
        expect(ours).toBe(ref);
    }), Effect.asVoid),
{ fastCheck: { numRuns: 200 } });

// D2: JSON Patch differential — Diff.create/apply vs rfc6902 applyPatch
it.effect.prop('D2: JSON Patch Diff.apply = rfc6902.applyPatch', { source: _json, target: _json }, ({ source, target }) => {
    const patch = Diff.create(source, target);
    const refPatch = createPatch(source, target);
    return patch == null
        ? Effect.sync(() => { expect(refPatch).toHaveLength(0); })
        : Diff.apply(source, patch).pipe(Effect.tap((ours) => {
            const refClone = structuredClone(source);
            applyPatch(refClone, structuredClone(refPatch));
            expect(ours).toEqual(refClone);
        }), Effect.asVoid);
}, { fastCheck: { numRuns: 200 } });

// D3: NDJSON parse differential — Transfer.import vs JSON.parse per-line
it.effect.prop('D3: NDJSON Transfer.import = JSON.parse per-line', { rows: fc.array(_ndjsonRow, { maxLength: 8, minLength: 1 }) }, ({ rows }) => {
    const ndjson = rows.map((row) => JSON.stringify(row)).join('\n');
    const ref = rows.map((row) => row.content);
    return Transfer.import(ndjson, { format: 'ndjson', type: 'test' }).pipe(
        Stream.runCollect,
        Effect.map((c) => Transfer.partition(Chunk.toArray(c))),
        Effect.tap(({ failures, items }) => {
            expect(failures).toHaveLength(0);
            expect(items.map((item) => item.content)).toEqual(ref);
        }),
        Effect.asVoid,
    );
}, { fastCheck: { numRuns: 100 } });

// D4: Patch op-count agreement — Diff.create length = rfc6902 createPatch length
it.effect.prop('D4: patch op-count agreement', { source: _json, target: _json }, ({ source, target }) =>
    Effect.sync(() => {
        const ours = Diff.create(source, target);
        const ref = createPatch(source, target);
        expect(ours?.ops.length ?? 0).toBe(ref.length);
    }),
{ fastCheck: { numRuns: 200 } });

// --- [EDGE_CASES] ------------------------------------------------------------

// D5: SHA-256 known vector (NIST empty string)
it.effect('D5: SHA-256 empty-string vector', () =>
    Crypto.hash('').pipe(Effect.tap((hex) => {
        expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    }), Effect.asVoid));

// D6: Patch create symmetry — create(a,b) ops vs create(b,a) ops resolve to opposite targets
it.effect.prop('D6: patch symmetry', { source: _json, target: _json }, ({ source, target }) => {
    const forward = Diff.create(source, target);
    const backward = Diff.create(target, source);
    return Effect.all([
        forward ? Diff.apply(source, forward) : Effect.succeed(source),
        backward ? Diff.apply(target, backward) : Effect.succeed(target),
    ]).pipe(Effect.tap(([fwd, bwd]) => {
        expect(fwd).toEqual(target);
        expect(bwd).toEqual(source);
    }), Effect.asVoid);
}, { fastCheck: { numRuns: 200 } });

// D7: NDJSON single-line edge case — Transfer.import matches JSON.parse for single object
it.effect('D7: NDJSON single-line', () => {
    const input = '{"type":"doc","content":"hello world"}';
    const ref = JSON.parse(input) as { content: string };
    return Transfer.import(input, { format: 'ndjson', type: 'doc' }).pipe(
        Stream.runCollect,
        Effect.map((c) => Transfer.partition(Chunk.toArray(c))),
        Effect.tap(({ items }) => { expect(items[0]?.content).toBe(ref.content); }),
        Effect.asVoid,
    );
});
