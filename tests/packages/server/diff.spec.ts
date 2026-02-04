import { it } from '@effect/vitest';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Array as A, Effect, FastCheck as fc, Option } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _safeKey = fc.string({ maxLength: 24, minLength: 1 }).filter((k) => !['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 3 }), { maxKeys: 8 }).filter((o) => !JSON.stringify(o).includes('"__proto__"'));

// --- [ALGEBRAIC] -------------------------------------------------------------

// P1: Identity Law - create(x, x) = null
it.effect.prop('P1: identity', { x: _json }, ({ x }) => Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }), { fastCheck: { numRuns: 200 } });

// P2: Inverse Law (symmetric) - apply(source, create(source, target)) = target
it.effect.prop('P2: inverse', { x: _json, y: _json }, ({ x, y }) =>
	Effect.forEach([[x, y], [y, x]] as const, ([s, t]) => Effect.fromNullable(Diff.create(s, t)).pipe(Effect.andThen((p) => Diff.apply(s, p)), Effect.tap((r) => { expect(r).toEqual(t); }), Effect.optionFromOptional))
		.pipe(Effect.tap(() => { Diff.create(x, y) ?? expect(x).toEqual(y); }), Effect.asVoid), { fastCheck: { numRuns: 200 } });

// P3: Empty Patch Identity - apply(x, ∅) = x
it.effect.prop('P3: empty patch', { x: _json }, ({ x }) => Diff.apply(x, { ops: [] }).pipe(Effect.tap((r) => { expect(r).toEqual(x); })), { fastCheck: { numRuns: 200 } });

// P4: Immutability - apply does not mutate input
it.effect.prop('P4: immutability', { x: _json, y: _json }, ({ x, y }) => {
	const original = structuredClone(x);
	return Effect.fromNullable(Diff.create(x, y)).pipe(Effect.andThen((p) => Diff.apply(x, p)), Effect.optionFromOptional, Effect.tap(() => { expect(x).toEqual(original); }), Effect.asVoid);
}, { fastCheck: { numRuns: 200 } });

// P5: Composition - apply(apply(a, p1), p2) ≡ apply(a, concat(p1, p2))
it.effect.prop('P5: composition', { a: _json, b: _json, c: _json }, ({ a, b, c }) => {
	const [p1, p2] = [Diff.create(a, b), Diff.create(b, c)];
	return Effect.all([
		Effect.gen(function* () { const mid = p1 ? yield* Diff.apply(a, p1) : a; return p2 ? yield* Diff.apply(mid, p2) : mid; }),
		Diff.apply(a, { ops: [...(p1?.ops ?? []), ...(p2?.ops ?? [])] }),
	]).pipe(Effect.tap(([seq, comp]) => { expect(seq).toEqual(comp); }));
}, { fastCheck: { numRuns: 200 } });

// P6: All RFC 6902 operations - parallel execution, single structural assertion
it.effect('P6: RFC6902 ops', () => Effect.all([
	Diff.apply({ a: 1 }, 		{ ops: [{ op: 'add', 	path: '/b', 	value: 2 }] }),
	Diff.apply({ a: 1, b: 2 }, 	{ ops: [{ op: 'remove', path: '/b' }] }),
	Diff.apply({ a: 1 }, 		{ ops: [{ op: 'replace', path: '/a', 	value: 9 }] }),
	Diff.apply({ a: 1, b: 2 }, 	{ ops: [{ from: '/a', 	op: 'move', 	path: '/c' }] }),
	Diff.apply({ a: 1 }, 		{ ops: [{ from: '/a', 	op: 'copy', 	path: '/b' }] }),
	Diff.apply({ a: 1 }, 		{ ops: [{ op: 'test', 	path: '/a', 	value: 1 }] }),
	Diff.apply({ arr: [1, 2] }, { ops: [{ op: 'add', 	path: '/arr/0', value: 0 }] }),
	Diff.apply({ arr: [1, 2] }, { ops: [{ op: 'add', 	path: '/arr/-', value: 3 }] }),
]).pipe(Effect.map((r) => expect(r).toEqual([{ a: 1, b: 2 }, { a: 1 }, { a: 9 }, { b: 2, c: 1 }, { a: 1, b: 1 }, { a: 1 }, { arr: [0, 1, 2] }, { arr: [1, 2, 3] }]))));

// --- [OPTION COMBINATORS] ----------------------------------------------------

// P7: fromSnapshots - Option semantics (Some/Some yields diff, None yields None)
it.effect.prop('P7: fromSnapshots', { x: _json, y: _json }, ({ x, y }) => Effect.sync(() => {
	const [direct, wrapped] = [Diff.create(x, y), Diff.fromSnapshots(Option.some(x), Option.some(y))];
	direct ? expect(Option.isSome(wrapped) && wrapped.value.ops).toEqual(direct.ops) : expect(Option.isNone(wrapped)).toBe(true);
}), { fastCheck: { numRuns: 200 } });

// P8: fromSnapshots None → None + enrichEntry/enrichEntries
it.effect('P8: Option combinators', () => Effect.sync(() => {
	const opts = [Option.none(), Option.some({})] as const;
	expect(A.flatMap(opts, (a) => A.map(opts, (b) => [a, b] as const)).filter(([a, b]) => Option.isNone(a) || Option.isNone(b)).every(([a, b]) => Option.isNone(Diff.fromSnapshots(a, b)))).toBe(true);
	const enriched = Diff.enrichEntry({ newData: Option.some({ a: 2 }), oldData: Option.some({ a: 1 }) });
	expect(Option.isSome(enriched.diff)).toBe(true);
	expect(Diff.enrichEntries([{ newData: Option.some({ a: 2 }), oldData: Option.some({ a: 1 }) }, { newData: Option.some({ b: 1 }), oldData: Option.some({ b: 1 }) }]).map((e) => Option.isSome(e.diff))).toEqual([true, false]);
}));

// --- [SECURITY + ERROR] ------------------------------------------------------

// P9: Prototype Pollution Prevention + Error aggregation
it.effect('P9: security + errors', () => Effect.all([
	Effect.all(['/__proto__/polluted', '/constructor/prototype/polluted'].map((p) => Diff.apply({}, { ops: [{ op: 'add', path: p, value: true }] }).pipe(Effect.ignore))).pipe(Effect.map(() => expect(({} as Record<string, unknown>)['polluted']).toBeUndefined())),
	Diff.apply({ x: 1 }, { ops: [{ op: 'remove', path: '/missing' }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
	Diff.apply({ x: 1 }, { ops: [{ op: 'remove', path: '/a' }, { op: 'remove', path: '/b' }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
	Diff.apply({ x: 1 }, { ops: [{ op: 'test', path: '/a', value: 99 }] }).pipe(Effect.flip, Effect.map((e) => [e._tag, e.operations.length])),
]).pipe(Effect.map(([_, e1, e2, e3]) => expect([e1, e2, e3]).toEqual([['PatchError', 1], ['PatchError', 2], ['PatchError', 1]]))));
