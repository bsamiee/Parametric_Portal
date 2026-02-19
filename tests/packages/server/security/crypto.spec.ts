/** Crypto tests: encryption roundtrip, hashing, key derivation, tenant isolation, IV quality. */
import { it, layer } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Env } from '@parametric-portal/server/env';
import { Crypto, type CryptoError } from '@parametric-portal/server/security/crypto';
import { Array as A, ConfigProvider, Effect, FastCheck as fc, Layer, Logger, LogLevel, Redacted } from 'effect';
import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;
const _text =     fc.string({ maxLength: 64, minLength: 0 });
const _nonempty = fc.string({ maxLength: 64, minLength: 1 });
const _aad =      new TextEncoder().encode('bound-context');
const HMAC_RFC4231 = { data: 'what do ya want for nothing?', expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', key: 'Jefe' } as const;
const SHA256_NIST = [
    { expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', input: '' },
    { expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', input: 'abc' },
    { expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' },
] as const;
const _KEY_V1 = 'cGFyYW1ldHJpYy1wb3J0YWwtY3J5cHRvLWtleS0zMmI=';
const _KEY_V2 = 'dGVzdC1rZXktdmVyc2lvbi0y';
const _testEnv = new Map([
    ['ANTHROPIC_API_KEY', 'anthropic_test'],   ['DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/parametric'],
    ['DEPLOYMENT_MODE', 'selfhosted'],         ['DOPPLER_CONFIG', 'dev'],         ['DOPPLER_PROJECT', 'parametric-portal'],
    ['DOPPLER_TOKEN', 'doppler_test'],         ['EMAIL_PROVIDER', 'smtp'],        ['ENCRYPTION_KEY', _KEY_V1],
    ['GEMINI_API_KEY', 'gemini_test'],         ['OPENAI_API_KEY', 'openai_test'], ['SMTP_HOST', 'localhost'],
    ['STORAGE_ACCESS_KEY_ID', 'storage_test'], ['STORAGE_SECRET_ACCESS_KEY', 'storage_secret_test'],
]);
const _multiKeyEnv = new Map([..._testEnv, ['ENCRYPTION_KEYS', JSON.stringify([{ key: _KEY_V1, version: 1 }, { key: _KEY_V2, version: 2 }])]]);

// --- [LAYER] -----------------------------------------------------------------

const _layer = (env: Map<string, string>) => Crypto.Service.Default.pipe(
    Layer.provideMerge(Env.Service.Default),
    Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(env))),
    Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)),
);
layer(_layer(_testEnv))('Crypto', (it) => {
    // --- [ALGEBRAIC] ---------------------------------------------------------
    // P1: Inverse + Non-determinism + Length formula - decrypt(encrypt(x)) = x, IVs differ, |cipher| = 1+IV+|x|+tag
    it.effect.prop('P1: inverse + nondet + length', { x: _text }, ({ x }) => Effect.gen(function* () {
        const [c1, c2] = yield* Effect.all([Crypto.encrypt(x), Crypto.encrypt(x)]);
        expect(yield* Crypto.decrypt(c1)).toBe(x);
        expect(c1.join(',')).not.toBe(c2.join(','));
        expect(c1.length).toBe(CIPHER.version + CIPHER.iv + new TextEncoder().encode(x).length + CIPHER.tag);
    }));
    // P2: Tampering + AAD binding - bit flip in ciphertext body + wrong/missing AAD → OP_FAILED
    it.effect.prop('P2: tampering + AAD', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const cipher = yield* Crypto.encrypt(x);
        const tampered = new Uint8Array(cipher); (tampered[CIPHER.version + CIPHER.iv] as number) ^= 0x01;
        const aadCipher = yield* Crypto.encrypt(x, _aad);
        expect(yield* Crypto.decrypt(aadCipher, _aad)).toBe(x);
        const [tErr, wrongAad, noAad] = yield* Effect.all([
            Crypto.decrypt(tampered).pipe(Effect.flip),
            Crypto.decrypt(aadCipher, new TextEncoder().encode('wrong')).pipe(Effect.flip),
            Crypto.decrypt(aadCipher).pipe(Effect.flip),
        ]);
        expect([tErr.code, wrongAad.code, noAad.code]).toEqual(['OP_FAILED', 'OP_FAILED', 'OP_FAILED']);
    }));
    // P3: Format boundaries + reencrypt - version 0, minBytes, version 255, passthrough identity, unknown version
    it.effect('P3: format + reencrypt', () => Effect.gen(function* () {
        const cipher = yield* Crypto.encrypt('test');
        expect(yield* Crypto.reencrypt(cipher)).toBe(cipher);
        const faked = new Uint8Array(cipher); faked[0] = 0x02;
        const [v0, minB, v255, reErr] = yield* Effect.all([
            Crypto.decrypt(new Uint8Array([0, ...Array.from<number>({ length: 28 }).fill(0)])).pipe(Effect.flip),
            Crypto.decrypt(new Uint8Array(CIPHER.minBytes - 1)).pipe(Effect.flip),
            Crypto.decrypt(new Uint8Array([255, ...crypto.getRandomValues(new Uint8Array(28))])).pipe(Effect.flip),
            Crypto.reencrypt(faked).pipe(Effect.flip),
        ]);
        expect([v0.code, v0.op, minB.code, minB.op, v255.code, v255.op, reErr.code, reErr.op]).toEqual([
            'INVALID_FORMAT', 'decrypt', 'INVALID_FORMAT', 'decrypt', 'KEY_NOT_FOUND', 'decrypt', 'KEY_NOT_FOUND', 'reencrypt',
        ]);
    }));
    // P4: Tenant isolation - different tenants → different ciphertext + cross-tenant decrypt fails
    it.effect.prop('P4: tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _nonempty }, ({ t1, t2, x }) => {
        fc.pre(t1 !== t2);
        return Effect.gen(function* () {
            const [c1, c2] = yield* Effect.all([Context.Request.within(t1, Crypto.encrypt(x)), Context.Request.within(t2, Crypto.encrypt(x))]);
            expect(c1.slice(CIPHER.version + CIPHER.iv)).not.toEqual(c2.slice(CIPHER.version + CIPHER.iv));
            expect((yield* Context.Request.within(t2, Crypto.decrypt(c1)).pipe(Effect.flip)).code).toBe('OP_FAILED');
        });
    });
    // P5: IV quality - uniqueness + uniform distribution (chi-squared α=0.001, df=255, threshold=330.52)
    it.effect('P5: IV uniformity', () => Effect.gen(function* () {
        const ciphertexts = yield* Effect.forEach(fc.sample(_nonempty, { numRuns: 600 }), (value) => Crypto.encrypt(value));
        const vectors = ciphertexts.map((c) => Array.from(c.slice(CIPHER.version, CIPHER.version + CIPHER.iv)));
        const bytes = vectors.flat(), expected = bytes.length / 256;
        expect(new Set(vectors.map((v) => v.join(','))).size).toBe(600);
        const counts = Object.groupBy(bytes, (b) => b);
        expect(A.reduce(A.makeBy(256, (i) => counts[i]?.length ?? 0), 0, (s, o) => s + (o - expected) ** 2 / expected)).toBeLessThan(330.52);
    }));
});
// P6: Hash/Compare laws - determinism, format, differential oracle, reflexivity, equivalence, symmetry
it.effect.prop('P6: hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) => Effect.gen(function* () {
    const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([Crypto.hash(x), Crypto.hash(x), Crypto.compare(x, x), Crypto.compare(x, y), Crypto.compare(y, x)]);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(createHash('sha256').update(x).digest('hex'));
    expect(eqSelf).toBe(true);
    expect(eqXY).toBe(x === y);
    expect(eqXY).toBe(eqYX);
}));
// P7: Known-answer vectors - SHA-256 NIST FIPS 180-4 + HMAC RFC 4231 TC2
it.effect('P7: known-answer vectors', () => Effect.gen(function* () {
    yield* Effect.forEach(SHA256_NIST, (v) => Crypto.hash(v.input).pipe(Effect.tap((d) => { expect(d).toBe(v.expected); })));
    expect(yield* Crypto.hmac(HMAC_RFC4231.key, HMAC_RFC4231.data)).toBe(HMAC_RFC4231.expected);
}));
// P8: HMAC laws - determinism + key sensitivity
it.effect.prop('P8: hmac laws', { k1: _nonempty, k2: _nonempty, msg: _nonempty }, ({ k1, k2, msg }) => Effect.gen(function* () {
    const [h1, h2, h3] = yield* Effect.all([Crypto.hmac(k1, msg), Crypto.hmac(k1, msg), Crypto.hmac(k2, msg)]);
    expect(h1).toBe(h2);
    expect(h1 === h3).toBe(k1 === k2);
}));
// P9: Pair - uniqueness + hash derivation correctness
it.effect('P9: pair', () => Effect.gen(function* () {
    const pairs = yield* Crypto.pair.pipe(Effect.replicate(100), Effect.all);
    expect(new Set(pairs.map((p) => Redacted.value(p.token))).size).toBe(100);
    const first = A.headNonEmpty(pairs as A.NonEmptyArray<typeof pairs[number]>);
    expect(yield* Crypto.hash(Redacted.value(first.token))).toBe(first.hash);
}));
// P10: Multi-key rotation - encrypt v1 → reencrypt under v2 → decrypt → original
it.effect.prop('P10: key rotation', { x: _nonempty }, ({ x }) => Context.Request.within('rotation-tenant', Effect.gen(function* () {
    const v1Cipher = yield* Crypto.encrypt(x).pipe(Effect.provide(_layer(_testEnv)));
    expect(v1Cipher[0]).toBe(1);
    const rotated = yield* Crypto.reencrypt(v1Cipher).pipe(Effect.provide(_layer(_multiKeyEnv)));
    expect(rotated[0]).toBe(2);
    expect(yield* Crypto.decrypt(rotated).pipe(Effect.provide(_layer(_multiKeyEnv)))).toBe(x);
})), { fastCheck: { numRuns: 50 } });
// --- [EDGE_CASES] ------------------------------------------------------------
// P11: Service init errors - no keys, bad JSON, bad base64, empty list, invalid version
it.effect('P11: service init errors', () => {
    const fail = (env: Map<string, string>) => Effect.scoped(Layer.launch(_layer(env))).pipe(Effect.flip);
    return Effect.all([
        fail(new Map([..._testEnv].filter(([key]) => key !== 'ENCRYPTION_KEY'))),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', '{bad']])),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', JSON.stringify([{ key: '!!!', version: 1 }])]])),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', '[]']])),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEY_VERSION', '0']])),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEY_VERSION', '2']])),
    ]).pipe(Effect.tap((errors) => {
        const typed = errors as ReadonlyArray<CryptoError>;
        expect(typed.map((error) => [error.code, error.op])).toEqual([
            ['KEY_NOT_FOUND', 'key'], ['INVALID_FORMAT', 'key'], ['INVALID_FORMAT', 'key'],
            ['INVALID_FORMAT', 'key'], ['INVALID_FORMAT', 'key'], ['KEY_NOT_FOUND', 'key'],
        ]);
    }), Effect.asVoid);
});
// P12: crypto.subtle rejection paths - importKey (KEY_FAILED), encrypt (OP_FAILED), decrypt (OP_FAILED)
it.effect('P12: subtle API failures', () => Effect.gen(function* () {
    const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('mock'));
    const initErr = yield* Effect.scoped(Layer.launch(_layer(_testEnv))).pipe(Effect.flip);
    importSpy.mockRestore();
    expect([(initErr as CryptoError).code, (initErr as CryptoError).op]).toEqual(['KEY_FAILED', 'key']);
    const encryptSpy = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('mock'));
    const encErr = yield* Crypto.encrypt('test').pipe(Effect.provide(_layer(_testEnv)), Effect.mapError((_): CryptoError => _ as unknown as CryptoError), Effect.flip);
    encryptSpy.mockRestore();
    expect([encErr.code, encErr.op]).toEqual(['OP_FAILED', 'encrypt']);
    const cipher = yield* Crypto.encrypt('test').pipe(Effect.provide(_layer(_testEnv)));
    const decSpy = vi.spyOn(crypto.subtle, 'decrypt').mockRejectedValueOnce(new Error('mock'));
    const decErr = yield* Crypto.decrypt(cipher).pipe(Effect.provide(_layer(_testEnv)), Effect.mapError((_): CryptoError => _ as unknown as CryptoError), Effect.flip);
    decSpy.mockRestore();
    expect([decErr.code, decErr.op]).toEqual(['OP_FAILED', 'decrypt']);
}));
