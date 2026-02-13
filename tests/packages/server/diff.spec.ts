import { it } from '@effect/vitest';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Array as A, Effect, FastCheck as fc, Option } from 'effect';
import { applyPatch, createPatch } from 'rfc6902';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _safeKey = fc.string({ maxLength: 24, minLength: 1 }).filter((k) => !['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 3 }), { maxKeys: 8 }).filter((o) => !JSON.stringify(o).includes('"__proto__"'));
const RFC6902_VECTORS = [
    { comment: 'A.1 add object member',       doc: { foo: 'bar' },                                                        expected: { baz: 'qux', foo: 'bar' },                                                      patch: [{ op: 'add', path: '/baz', value: 'qux' }] },
    { comment: 'A.2 add array element',        doc: { foo: ['bar', 'baz'] },                                               expected: { foo: ['bar', 'qux', 'baz'] },                                                  patch: [{ op: 'add', path: '/foo/1', value: 'qux' }] },
    { comment: 'A.3 remove object member',     doc: { baz: 'qux', foo: 'bar' },                                            expected: { foo: 'bar' },                                                                  patch: [{ op: 'remove', path: '/baz' }] },
    { comment: 'A.4 remove array element',     doc: { foo: ['bar', 'qux', 'baz'] },                                        expected: { foo: ['bar', 'baz'] },                                                         patch: [{ op: 'remove', path: '/foo/1' }] },
    { comment: 'A.5 replace value',            doc: { baz: 'qux', foo: 'bar' },                                            expected: { baz: 'boo', foo: 'bar' },                                                      patch: [{ op: 'replace', path: '/baz', value: 'boo' }] },
    { comment: 'A.6 move value (nested)',      doc: { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } },      expected: { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } },                 patch: [{ from: '/foo/waldo', op: 'move', path: '/qux/thud' }] },
    { comment: 'A.7 move array element',       doc: { foo: ['all', 'grass', 'cows', 'eat'] },                               expected: { foo: ['all', 'cows', 'eat', 'grass'] },                                        patch: [{ from: '/foo/1', op: 'move', path: '/foo/3' }] },
    { comment: 'A.8 test value (success)',     doc: { baz: 'qux', foo: ['a', 2, 'c'] },                                    expected: { baz: 'qux', foo: ['a', 2, 'c'] },                                              patch: [{ op: 'test', path: '/baz', value: 'qux' }, { op: 'test', path: '/foo/1', value: 2 }] },
    { comment: 'A.10 add nested object',       doc: { foo: 'bar' },                                                        expected: { child: { grandchild: {} }, foo: 'bar' },                                       patch: [{ op: 'add', path: '/child', value: { grandchild: {} } }] },
    { comment: 'A.14 tilde escape (~0 ~1)',    doc: { '/': 9, '~1': 10 },                                                  expected: { '/': 9, '~1': 10 },                                                            patch: [{ op: 'test', path: '/~01', value: 10 }] },
    { comment: 'A.16 add array via /-',        doc: { foo: ['bar'] },                                                      expected: { foo: ['bar', ['abc', 'def']] },                                                patch: [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }] },
    { comment: 'copy from nested path',        doc: { bar: 1, baz: [{ qux: 'hello' }] },                                   expected: { bar: 1, baz: [{ qux: 'hello' }], boo: { qux: 'hello' } },                     patch: [{ from: '/baz/0', op: 'copy', path: '/boo' }] },
    { comment: 'copy then mutate destination', doc: { foo: { bar: { baz: [{ boo: 'net' }] } } },                           expected: { bak: { bar: { baz: [{ boo: 'qux' }] } }, foo: { bar: { baz: [{ boo: 'net' }] } } }, patch: [{ from: '/foo', op: 'copy', path: '/bak' }, { op: 'replace', path: '/bak/bar/baz/0/boo', value: 'qux' }] },
    { comment: 'JSON Pointer special chars',   doc: { '': 0, 'a/b': 1, foo: ['bar', 'baz'], 'm~n': 8 },                   expected: { '': 0, 'a/b': 1, foo: ['bar', 'baz'], 'm~n': 8 },                             patch: [{ op: 'test', path: '/foo/0', value: 'bar' }, { op: 'test', path: '/', value: 0 }, { op: 'test', path: '/a~1b', value: 1 }, { op: 'test', path: '/m~0n', value: 8 }] },
] as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

// P1: Identity Law - create(x, x) = null
it.effect.prop('P1: identity', { x: _json }, ({ x }) => Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }), { fastCheck: { numRuns: 200 } });

// P2: Inverse Law + D2 (rfc6902 cross-validation) + D4 (op-count agreement)
it.effect.prop('P2: inverse + differential', { x: _json, y: _json }, ({ x, y }) => Effect.gen(function* () {
    const refPatch = createPatch(x, y);
    const patch = Diff.create(x, y);
    expect(patch?.ops.length ?? 0).toBe(refPatch.length);
    yield* Effect.forEach([[x, y], [y, x]] as const, ([s, t]) => Effect.gen(function* () {
        const p = Diff.create(s, t);
        (p === null) ? expect(s).toEqual(t) : expect(yield* Diff.apply(s, p)).toEqual(t);
        const refClone = structuredClone(s);
        applyPatch(refClone, createPatch(s, t));
        (p === null) ? expect(s).toEqual(refClone) : expect(refClone).toEqual(t);
    }));
}), { fastCheck: { numRuns: 200 } });

// P3: Empty Patch Identity - apply(x, empty) = x
it.effect.prop('P3: empty patch', { x: _json }, ({ x }) => Diff.apply(x, { ops: [] }).pipe(
    Effect.tap((r) => { expect(r).toEqual(x); }),
    Effect.asVoid,
), { fastCheck: { numRuns: 200 } });

// P4: Immutability - apply does not mutate input
it.effect.prop('P4: immutability', { x: _json, y: _json }, ({ x, y }) => {
    const original = structuredClone(x);
    return Effect.fromNullable(Diff.create(x, y)).pipe(Effect.andThen((p) => Diff.apply(x, p)), Effect.optionFromOptional, Effect.tap(() => { expect(x).toEqual(original); }), Effect.asVoid);
}, { fastCheck: { numRuns: 200 } });

// P5: Composition - apply(apply(a, p1), p2) = apply(a, concat(p1, p2))
it.effect.prop('P5: composition', { a: _json, b: _json, c: _json, ctx: fc.context() }, ({ a, b, c, ctx }) => {
    const [p1, p2] = [Diff.create(a, b), Diff.create(b, c)];
    ctx.log(`p1: ${p1 ? p1.ops.length : 'null'} ops, p2: ${p2 ? p2.ops.length : 'null'} ops`);
    return Effect.all([
        Effect.gen(function* () { const mid = p1 ? yield* Diff.apply(a, p1) : a; return p2 ? yield* Diff.apply(mid, p2) : mid; }),
        Diff.apply(a, { ops: [...(p1?.ops ?? []), ...(p2?.ops ?? [])] }),
    ]).pipe(
        Effect.tap(([seq, comp]) => { expect(seq).toEqual(comp); }),
        Effect.asVoid,
    );
}, { fastCheck: { numRuns: 200 } });

// P6: RFC 6902 authoritative test vectors
it.effect('P6: RFC6902 vectors', () =>
    Effect.forEach(RFC6902_VECTORS, (vector) =>
        Diff.apply(vector.doc as Record<string, unknown>, { ops: [...vector.patch] }).pipe(
            Effect.tap((result) => { expect(result, vector.comment).toEqual(vector.expected); }),
            Effect.asVoid,
        ),
    ).pipe(Effect.asVoid));

// --- [OPTION COMBINATORS] ----------------------------------------------------

// P7: fromSnapshots - Option semantics (Some/Some yields diff, None yields None)
it.effect.prop('P7: fromSnapshots', { x: _json, y: _json }, ({ x, y }) => Effect.sync(() => {
    const [direct, wrapped] = [Diff.create(x, y), Diff.fromSnapshots(Option.some(x), Option.some(y))];
    direct ? expect(Option.isSome(wrapped) && wrapped.value.ops).toEqual(direct.ops) : expect(Option.isNone(wrapped)).toBe(true);
}), { fastCheck: { numRuns: 200 } });

// P8: fromSnapshots None -> None + enrich (single + array)
it.effect('P8: Option combinators', () => Effect.sync(() => {
    const opts = [Option.none(), Option.some({})] as const;
    expect(A.flatMap(opts, (a) => A.map(opts, (b) => [a, b] as const)).filter(([a, b]) => Option.isNone(a) || Option.isNone(b)).every(([a, b]) => Option.isNone(Diff.fromSnapshots(a, b)))).toBe(true);
    const enriched = Diff.enrich({ newData: Option.some({ a: 2 }), oldData: Option.some({ a: 1 }) });
    expect(Option.isSome(enriched.diff)).toBe(true);
    expect(Diff.enrich([{ newData: Option.some({ a: 2 }), oldData: Option.some({ a: 1 }) }, { newData: Option.some({ b: 1 }), oldData: Option.some({ b: 1 }) }]).map((e) => Option.isSome(e.diff))).toEqual([true, false]);
}));

// P10: enrich None -> diff is None
it.effect('P10: enrich None paths', () => Effect.sync(() => {
    const none = Diff.enrich({ newData: Option.none(), oldData: Option.none() });
    const mixed = Diff.enrich({ newData: Option.some({ a: 1 }), oldData: Option.none() });
    expect([Option.isNone(none.diff), Option.isNone(mixed.diff)]).toEqual([true, true]);
}));

// --- [SECURITY + ERROR] ------------------------------------------------------

// P9: Prototype Pollution Prevention + Error aggregation
it.effect('P9: security + errors', () => Effect.all([
    Effect.all(['/__proto__/polluted', '/constructor/prototype/polluted'].map((p) => Diff.apply({}, { ops: [{ op: 'add', path: p, value: true }] }).pipe(Effect.ignore))).pipe(Effect.map(() => expect(({} as Record<string, unknown>)['polluted']).toBeUndefined())),
    Diff.apply({ x: 1 }, { ops: [{ op: 'remove', path: '/missing' }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
    Diff.apply({ x: 1 }, { ops: [{ op: 'remove', path: '/a' }, { op: 'remove', path: '/b' }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
    Diff.apply({ x: 1 }, { ops: [{ op: 'test', path: '/a', value: 99 }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
]).pipe(Effect.map(([_, e1, e2, e3]) => expect([e1, e2, e3]).toEqual([['PatchError', 1], ['PatchError', 2], ['PatchError', 1]]))));
