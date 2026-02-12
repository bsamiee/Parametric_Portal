import { it, layer } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Array as A, ConfigProvider, Effect, FastCheck as fc, Layer, Logger, LogLevel, Redacted } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;
const _text = fc.string({ maxLength: 64, minLength: 0 });
const _nonempty = fc.string({ maxLength: 64, minLength: 1 });

// --- [LAYER] -----------------------------------------------------------------

const _testLayer = Crypto.Service.Default.pipe(
    Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['ENCRYPTION_KEY', 'cGFyYW1ldHJpYy1wb3J0YWwtY3J5cHRvLWtleS0zMmI=']])))),
    Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)),
);

layer(_testLayer)('Crypto', (it) => {
    // --- [ALGEBRAIC: ENCRYPTION] ---------------------------------------------
    // P1: Inverse + Non-determinism - decrypt(encrypt(x)) = x AND encrypt(x) ≠ encrypt(x)
    it.effect.prop('P1: inverse + nondeterminism', { x: _text }, ({ x }) => Effect.gen(function* () {
        const [c1, c2] = yield* Effect.all([Crypto.encrypt(x), Crypto.encrypt(x)]);
        expect(yield* Crypto.decrypt(c1)).toBe(x);
        expect(c1.join(',')).not.toBe(c2.join(','));
    }), { fastCheck: { numRuns: 100 } });
    // P2: Length Invariant - |encrypt(x)| = version + IV + |encode(x)| + tag
    it.effect.prop('P2: length formula', { x: _text }, ({ x }) => Crypto.encrypt(x).pipe(
        Effect.tap((c) => {
            expect(c.length).toBe(CIPHER.version + CIPHER.iv + new TextEncoder().encode(x).length + CIPHER.tag);
        }),
        Effect.asVoid,
    ), { fastCheck: { numRuns: 100 } });
    // P3: Tampering Detection - flip bit in ciphertext body -> OP_FAILED
    it.effect.prop('P3: tampering', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const ciphertext = yield* Crypto.encrypt(x);
        const tampered = new Uint8Array(ciphertext);
        (tampered[CIPHER.version + CIPHER.iv] as number) ^= 0x01;
        expect((yield* Crypto.decrypt(tampered).pipe(Effect.flip)).code).toBe('OP_FAILED');
    }), { fastCheck: { numRuns: 100 } });
    // P4: Format Boundaries - version [0,255], minBytes
    it.effect('P4: format boundaries', () => Effect.all([
        Crypto.decrypt(new Uint8Array([0, ...Array.from<number>({ length: 28 }).fill(0)])).pipe(Effect.flip),
        Crypto.decrypt(new Uint8Array(CIPHER.minBytes - 1)).pipe(Effect.flip),
        Crypto.decrypt(new Uint8Array([255, ...crypto.getRandomValues(new Uint8Array(28))])).pipe(Effect.flip),
    ]).pipe(Effect.map(([v0, minB, v255]) => expect([v0.code, minB.code, v255.code]).toEqual(['INVALID_FORMAT', 'INVALID_FORMAT', 'KEY_NOT_FOUND']))));
    // P5: Tenant Isolation - different tenants produce different ciphertexts + cross-tenant decrypt fails
    it.effect.prop('P5: tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _nonempty }, ({ t1, t2, x }) => {
        fc.pre(t1 !== t2);
        return Effect.gen(function* () {
            const [c1, c2] = yield* Effect.all([Context.Request.within(t1, Crypto.encrypt(x)), Context.Request.within(t2, Crypto.encrypt(x))]);
            expect(c1.slice(CIPHER.version + CIPHER.iv)).not.toEqual(c2.slice(CIPHER.version + CIPHER.iv));
            expect((yield* Context.Request.within(t2, Crypto.decrypt(c1)).pipe(Effect.flip)).code).toBe('OP_FAILED');
        });
    }, { fastCheck: { numRuns: 50 } });
    // P6: IV Quality - uniqueness + uniform distribution (chi-squared α=0.01, df=255, threshold=310.46)
    it.effect('P6: IV uniformity', () => Effect.gen(function* () {
        const ciphertexts = yield* Effect.forEach(fc.sample(_nonempty, { numRuns: 600 }), (value) => Crypto.encrypt(value));
        const vectors = ciphertexts.map((c) => Array.from(c.slice(CIPHER.version, CIPHER.version + CIPHER.iv)));
        const bytes = vectors.flat(), expected = bytes.length / 256;
        expect(new Set(vectors.map((v) => v.join(','))).size).toBe(600);
        const counts = Object.groupBy(bytes, (b) => b);
        expect(A.reduce(A.makeBy(256, (i) => counts[i]?.length ?? 0), 0, (s, o) => s + (o - expected) ** 2 / expected)).toBeLessThan(310.46);
    }));
    // P10: Reencrypt - passthrough when current version, KEY_NOT_FOUND for unknown
    it.effect.prop('P10: reencrypt', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const cipher = yield* Crypto.encrypt(x);
        const same = yield* Crypto.reencrypt(cipher);
        expect(same).toBe(cipher);
        const faked = new Uint8Array(cipher); faked[0] = 0x02;
        expect((yield* Crypto.reencrypt(faked).pipe(Effect.flip)).code).toBe('KEY_NOT_FOUND');
    }), { fastCheck: { numRuns: 50 } });
    // P11: AAD binding - decrypt with wrong/missing AAD fails
    it.effect.prop('P11: AAD binding', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const aad = new TextEncoder().encode('bound-context');
        const cipher = yield* Crypto.encrypt(x, aad);
        expect(yield* Crypto.decrypt(cipher, aad)).toBe(x);
        expect((yield* Crypto.decrypt(cipher, new TextEncoder().encode('wrong')).pipe(Effect.flip)).code).toBe('OP_FAILED');
        expect((yield* Crypto.decrypt(cipher).pipe(Effect.flip)).code).toBe('OP_FAILED');
    }), { fastCheck: { numRuns: 50 } });
});

// --- [ALGEBRAIC: HASH & COMPARE] ---------------------------------------------
// P7: Hash/Compare Laws - determinism, reflexivity, correctness, symmetry
it.effect.prop('P7: hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) => Effect.gen(function* () {
    const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([Crypto.hash(x), Crypto.hash(x), Crypto.compare(x, x), Crypto.compare(x, y), Crypto.compare(y, x)]);
    expect(h1).toBe(h2);
    expect(eqSelf).toBe(true);
    expect(eqXY).toBe(x === y);
    expect(eqXY).toBe(eqYX);
}), { fastCheck: { numRuns: 100 } });
// P8: HMAC Laws - determinism, key sensitivity
it.effect.prop('P8: hmac laws', { k1: _nonempty, k2: _nonempty, msg: _nonempty }, ({ k1, k2, msg }) => Effect.gen(function* () {
    const [h1, h2, h3] = yield* Effect.all([Crypto.hmac(k1, msg), Crypto.hmac(k1, msg), Crypto.hmac(k2, msg)]);
    expect(h1).toBe(h2);
    expect(h1 === h3).toBe(k1 === k2);
}), { fastCheck: { numRuns: 100 } });
// P9: Pair - uniqueness + hash derivation correctness
it.effect('P9: pair', () => Effect.gen(function* () {
    const pairs = yield* Crypto.pair.pipe(Effect.replicate(100), Effect.all);
    expect(new Set(pairs.map((p) => Redacted.value(p.token))).size).toBe(100);
    const first = A.headNonEmpty(pairs as A.NonEmptyArray<typeof pairs[number]>);
    expect(yield* Crypto.hash(Redacted.value(first.token))).toBe(first.hash);
}));
