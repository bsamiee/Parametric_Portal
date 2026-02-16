import { it, layer } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Env } from '@parametric-portal/server/env';
import { Crypto, type CryptoError } from '@parametric-portal/server/security/crypto';
import { Array as A, ConfigProvider, Effect, FastCheck as fc, Layer, Logger, LogLevel, Redacted } from 'effect';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;
const _text = fc.string({ maxLength: 64, minLength: 0 });
const _nonempty = fc.string({ maxLength: 64, minLength: 1 });
const HMAC_RFC4231 = { data: 'what do ya want for nothing?', expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', key: 'Jefe' } as const;
const SHA256_NIST_VECTORS = [
    { expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', input: '' },
    { expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', input: 'abc' },
    { expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' },
] as const;
const _KEY_V1 = 'cGFyYW1ldHJpYy1wb3J0YWwtY3J5cHRvLWtleS0zMmI=';
const _KEY_V2 = 'dGVzdC1rZXktdmVyc2lvbi0y';
const _testEnv = new Map([
    ['ANTHROPIC_API_KEY',         'anthropic_test'                                        ],
    ['DATABASE_URL',              'postgres://postgres:postgres@localhost:5432/parametric'],
    ['DEPLOYMENT_MODE',           'selfhosted'                                            ],
    ['DOPPLER_CONFIG',            'dev'                                                   ],
    ['DOPPLER_PROJECT',           'parametric-portal'                                     ],
    ['DOPPLER_TOKEN',             'doppler_test'                                          ],
    ['EMAIL_PROVIDER',            'smtp'                                                  ],
    ['ENCRYPTION_KEY',            _KEY_V1                                                 ],
    ['GEMINI_API_KEY',            'gemini_test'                                           ],
    ['OPENAI_API_KEY',            'openai_test'                                           ],
    ['SMTP_HOST',                 'localhost'                                             ],
    ['STORAGE_ACCESS_KEY_ID',     'storage_test'                                          ],
    ['STORAGE_SECRET_ACCESS_KEY', 'storage_secret_test'                                   ],
]);
const _multiKeyEnv = new Map([..._testEnv, ['ENCRYPTION_KEYS', JSON.stringify([{ key: _KEY_V1, version: 1 }, { key: _KEY_V2, version: 2 }])]]);

// --- [LAYER] -----------------------------------------------------------------

const _layer = (env: Map<string, string>) => Crypto.Service.Default.pipe(
    Layer.provideMerge(Env.Service.Default),
    Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(env))),
    Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)),
);
layer(_layer(_testEnv))('Crypto', (it) => {
    // --- [ALGEBRAIC: ENCRYPTION] ---------------------------------------------
    // P1: Inverse + Non-determinism - decrypt(encrypt(x)) = x AND encrypt(x) ≠ encrypt(x)
    it.effect.prop('P1: inverse + nondeterminism', { x: _text }, ({ x }) => Effect.gen(function* () {
        const [c1, c2] = yield* Effect.all([Crypto.encrypt(x), Crypto.encrypt(x)]);
        expect(yield* Crypto.decrypt(c1)).toBe(x);
        expect(c1.join(',')).not.toBe(c2.join(','));
    }), { fastCheck: { numRuns: 100 } });
    // P2: Length Invariant - |encrypt(x)| = version + IV + |encode(x)| + tag
    it.effect.prop('P2: length formula', { x: _text }, ({ x }) => Crypto.encrypt(x).pipe(
        Effect.tap((c) => {expect(c.length).toBe(CIPHER.version + CIPHER.iv + new TextEncoder().encode(x).length + CIPHER.tag);}),
        Effect.asVoid,
    ), { fastCheck: { numRuns: 100 } });
    // P3: Tampering Detection - flip bit in ciphertext body -> OP_FAILED
    it.effect.prop('P3: tampering', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const ciphertext = yield* Crypto.encrypt(x);
        const tampered = new Uint8Array(ciphertext);
        (tampered[CIPHER.version + CIPHER.iv] as number) ^= 0x01;
        const error = yield* Crypto.decrypt(tampered).pipe(Effect.flip);
        expect([error.code, error.op]).toEqual(['OP_FAILED', 'decrypt']);
    }), { fastCheck: { numRuns: 100 } });
    // P4: Format Boundaries - version [0,255], minBytes
    it.effect('P4: format boundaries', () => Effect.all([
        Crypto.decrypt(new Uint8Array([0, ...Array.from<number>({ length: 28 }).fill(0)])).pipe(Effect.flip),
        Crypto.decrypt(new Uint8Array(CIPHER.minBytes - 1)).pipe(Effect.flip),
        Crypto.decrypt(new Uint8Array([255, ...crypto.getRandomValues(new Uint8Array(28))])).pipe(Effect.flip),
    ]).pipe(Effect.map(([v0, minB, v255]) => expect([v0.code, v0.op, minB.code, minB.op, v255.code, v255.op]).toEqual(
        ['INVALID_FORMAT', 'decrypt', 'INVALID_FORMAT', 'decrypt', 'KEY_NOT_FOUND', 'decrypt'],
    ))));
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
    // P10: Reencrypt - passthrough when current version, op remapping, KEY_NOT_FOUND for unknown
    it.effect.prop('P10: reencrypt', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const cipher = yield* Crypto.encrypt(x);
        const same = yield* Crypto.reencrypt(cipher);
        expect(same).toBe(cipher);
        const faked = new Uint8Array(cipher); faked[0] = 0x02;
        const error = yield* Crypto.reencrypt(faked).pipe(Effect.flip);
        expect([error.code, error.op]).toEqual(['KEY_NOT_FOUND', 'reencrypt']);
    }), { fastCheck: { numRuns: 50 } });
    // P11: AAD binding - decrypt with wrong/missing AAD fails
    it.effect.prop('P11: AAD binding', { x: _nonempty }, ({ x }) => Effect.gen(function* () {
        const aad = new TextEncoder().encode('bound-context');
        const cipher = yield* Crypto.encrypt(x, aad);
        expect(yield* Crypto.decrypt(cipher, aad)).toBe(x);
        const [wrongAad, noAad] = yield* Effect.all([Crypto.decrypt(cipher, new TextEncoder().encode('wrong')).pipe(Effect.flip), Crypto.decrypt(cipher).pipe(Effect.flip)]);
        expect([wrongAad.code, wrongAad.op, noAad.code, noAad.op]).toEqual(['OP_FAILED', 'decrypt', 'OP_FAILED', 'decrypt']);
    }), { fastCheck: { numRuns: 50 } });
});

// --- [ALGEBRAIC: HASH & COMPARE] ---------------------------------------------
// P7: Hash/Compare Laws - determinism, reflexivity, correctness, symmetry, NIST vectors, differential oracle, hex format
it.effect.prop('P7: hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) => Effect.gen(function* () {
    const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([Crypto.hash(x), Crypto.hash(x), Crypto.compare(x, x), Crypto.compare(x, y), Crypto.compare(y, x)]);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(createHash('sha256').update(x).digest('hex'));
    expect(eqSelf).toBe(true);
    expect(eqXY).toBe(x === y);
    expect(eqXY).toBe(eqYX);
}), { fastCheck: { numRuns: 100 } });
// P7b: NIST FIPS 180-4 SHA-256 known-answer vectors
it.effect('P7b: SHA-256 NIST vectors', () =>
    Effect.forEach(SHA256_NIST_VECTORS, (vector) => Crypto.hash(vector.input).pipe(Effect.tap((digest) => {
        expect(digest).toBe(vector.expected);
    }))).pipe(Effect.asVoid));
// P8: HMAC Laws - determinism, key sensitivity, RFC 4231 known-answer
it.effect.prop('P8: hmac laws', { k1: _nonempty, k2: _nonempty, msg: _nonempty }, ({ k1, k2, msg }) => Effect.gen(function* () {
    const [h1, h2, h3] = yield* Effect.all([Crypto.hmac(k1, msg), Crypto.hmac(k1, msg), Crypto.hmac(k2, msg)]);
    expect(h1).toBe(h2);
    expect(h1 === h3).toBe(k1 === k2);
}), { fastCheck: { numRuns: 100 } });
// P8b: RFC 4231 TC2 HMAC-SHA-256 known-answer vector
it.effect('P8b: HMAC RFC 4231 vector', () =>
    Crypto.hmac(HMAC_RFC4231.key, HMAC_RFC4231.data).pipe(Effect.tap((tag) => {
        expect(tag).toBe(HMAC_RFC4231.expected);
    }), Effect.asVoid));
// P9: Pair - uniqueness + hash derivation correctness
it.effect('P9: pair', () => Effect.gen(function* () {
    const pairs = yield* Crypto.pair.pipe(Effect.replicate(100), Effect.all);
    expect(new Set(pairs.map((p) => Redacted.value(p.token))).size).toBe(100);
    const first = A.headNonEmpty(pairs as A.NonEmptyArray<typeof pairs[number]>);
    expect(yield* Crypto.hash(Redacted.value(first.token))).toBe(first.hash);
}));

// --- [ALGEBRAIC: KEY ROTATION] -----------------------------------------------
// P12: Multi-key rotation - encrypt v1 → reencrypt under v2 → decrypt → original
it.effect.prop('P12: key rotation', { x: _nonempty }, ({ x }) => Context.Request.within('rotation-tenant', Effect.gen(function* () {
    const v1Cipher = yield* Crypto.encrypt(x).pipe(Effect.provide(_layer(_testEnv)));
    expect(v1Cipher[0]).toBe(1);
    const rotated = yield* Crypto.reencrypt(v1Cipher).pipe(Effect.provide(_layer(_multiKeyEnv)));
    expect(rotated[0]).toBe(2);
    expect(yield* Crypto.decrypt(rotated).pipe(Effect.provide(_layer(_multiKeyEnv)))).toBe(x);
})), { fastCheck: { numRuns: 50 } });
// P13: Service init errors - no keys, bad JSON, bad base64
it.effect('P13: service init errors', () => {
    const fail = (env: Map<string, string>) => Effect.scoped(Layer.launch(_layer(env))).pipe(Effect.flip);
    return Effect.all([
        fail(new Map([..._testEnv].filter(([key]) => key !== 'ENCRYPTION_KEY'))),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', '{bad']])),
        fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', JSON.stringify([{ key: '!!!', version: 1 }])]])),
    ]).pipe(Effect.tap((errors) => {
        const typed = errors as ReadonlyArray<CryptoError>;
        expect(typed.map((error) => [error.code, error.op])).toEqual([['KEY_NOT_FOUND', 'key'], ['INVALID_FORMAT', 'key'], ['INVALID_FORMAT', 'key']]);
    }), Effect.asVoid);
});
