/**
 * Schema-derived arbitrary demonstration: Arbitrary.make() from @effect/schema.
 * Proves branded types round-trip and schema-derived values integrate with domain functions.
 */
import { it } from '@effect/vitest';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Email, Hex64, Index, Slug, Timestamp, Uuidv7 } from '@parametric-portal/types/types';
import { Arbitrary, Effect, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _email = Arbitrary.make(Email);
const _hex64 = Arbitrary.make(Hex64.schema);
const _index = Arbitrary.make(Index);
const _slug = Arbitrary.make(Slug);
const _timestamp = Arbitrary.make(Timestamp.schema);
const _uuidv7 = Arbitrary.make(Uuidv7.schema);

// --- [ALGEBRAIC: SCHEMA ROUNDTRIP] ------------------------------------------

// P1: Branded types round-trip through encode -> decode (identity law)
it.effect.prop('P1: branded roundtrip', { email: _email, hex: _hex64, idx: _index, slug: _slug, ts: _timestamp, uuid: _uuidv7 }, ({ email, hex, idx, slug, ts, uuid }) => Effect.sync(() => {
    expect(S.decodeUnknownSync(Email)(email)).toBe(email);
    expect(S.decodeUnknownSync(Hex64.schema)(hex)).toBe(hex);
    expect(S.decodeUnknownSync(Index)(idx)).toBe(idx);
    expect(S.decodeUnknownSync(Slug)(slug)).toBe(slug);
    expect(S.decodeUnknownSync(Timestamp.schema)(ts)).toBe(ts);
    expect(S.decodeUnknownSync(Uuidv7.schema)(uuid)).toBe(uuid);
}), { fastCheck: { numRuns: 100 } });

// P2: Schema constraints produce structurally valid values
it.effect.prop('P2: structural validity', { email: _email, hex: _hex64, slug: _slug, uuid: _uuidv7 }, ({ email, hex, slug, uuid }) => Effect.sync(() => {
    expect(email).toMatch(/@/);
    expect(hex).toMatch(/^[0-9a-f]{64}$/i);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}), { fastCheck: { numRuns: 100 } });

// P3: Numeric branded types respect bounds
it.effect.prop('P3: numeric bounds', { idx: _index, ts: _timestamp }, ({ idx, ts }) => Effect.sync(() => {
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(idx)).toBe(true);
    expect(ts).toBeGreaterThan(0);
}), { fastCheck: { numRuns: 100 } });

// --- [ALGEBRAIC: DOMAIN INTEGRATION] ----------------------------------------

// P6: Crypto.hash accepts schema-derived strings + determinism holds
it.effect.prop('P6: hash determinism', { hex: _hex64, uuid: _uuidv7 }, ({ hex, uuid }) => Effect.gen(function* () {
    const [h1, h2, h3, h4] = yield* Effect.all([Crypto.hash(hex), Crypto.hash(hex), Crypto.hash(uuid), Crypto.hash(uuid)]);
    expect(h1).toBe(h2);
    expect(h3).toBe(h4);
    expect(S.decodeUnknownSync(Hex64.schema)(h1)).toBe(h1);
}), { fastCheck: { numRuns: 50 } });

// P7: Diff.create identity law with schema-derived structs
it.effect.prop('P7: diff identity', { email: _email, idx: _index, slug: _slug }, ({ email, idx, slug }) => Effect.sync(() => {
    const obj = { email, idx, slug };
    expect(Diff.create(obj, obj)).toBeNull();
    expect(Diff.create(obj, { ...obj, slug: `${slug}x` })).not.toBeNull();
}), { fastCheck: { numRuns: 100 } });

// P8: Diff roundtrip with schema-derived values
it.effect.prop('P8: diff roundtrip', { a: _slug, b: _slug }, ({ a, b }) => {
    const before = { value: a };
    const after = { value: b };
    const patch = Diff.create(before, after);
    return patch
        ? Diff.apply(before, patch).pipe(Effect.tap((result) => { expect(result).toEqual(after); }), Effect.asVoid)
        : Effect.sync(() => { expect(a).toBe(b); });
}, { fastCheck: { numRuns: 100 } });

// P9: fromSnapshots with schema-derived Option values
it.effect.prop('P9: fromSnapshots', { a: _index, b: _index }, ({ a, b }) => Effect.sync(() => {
    const result = Diff.fromSnapshots(Option.some({ value: a }), Option.some({ value: b }));
    (a === b) ? expect(Option.isNone(result)).toBe(true) : expect(Option.isSome(result)).toBe(true);
}), { fastCheck: { numRuns: 100 } });
