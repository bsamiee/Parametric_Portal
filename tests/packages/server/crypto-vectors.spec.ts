/**
 * [Crypto] oracle vector tests: NIST FIPS 180-4 SHA-256, RFC 4231 HMAC-SHA-256, AES-GCM structural.
 */
import { it, layer } from '@effect/vitest';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { ConfigProvider, Effect, Layer, Logger, LogLevel } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const CIPHER = { iv: 12, tag: 16, version: 1 } as const;
const SHA256_DIGEST_HEX_LENGTH = 64 as const;

/** NIST FIPS 180-4 SHA-256 test vectors (input -> expected hex digest). */
const SHA256_VECTORS = [
    { expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', input: '', label: 'empty string' },
    { expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', input: 'abc', label: '3-byte "abc"' },
    { expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', label: '448-bit block' },
] as const;

/** RFC 4231 Test Case 2: HMAC-SHA-256 with ASCII key "Jefe" and ASCII data. */
const HMAC_VECTORS = [
    { data: 'what do ya want for nothing?', expected: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', key: 'Jefe', label: 'RFC 4231 TC2' },
] as const;

/** Known plaintext inputs for structural validation. */
const STRUCTURAL_INPUTS = ['', 'a', 'hello world', '\u{1F600}'.repeat(16)] as const;

// --- [LAYER] -----------------------------------------------------------------

const _testLayer = Crypto.Service.Default.pipe(
    Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['ENCRYPTION_KEY', 'cGFyYW1ldHJpYy1wb3J0YWwtY3J5cHRvLWtleS0zMmI=']])))),
    Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)),
);

// --- [ALGEBRAIC: SHA-256 ORACLE] ---------------------------------------------

// P12: SHA-256 equivalence — Crypto.hash matches NIST FIPS 180-4 test vectors
it.effect('P12: SHA-256 NIST FIPS 180-4 vectors', () =>
    Effect.forEach(SHA256_VECTORS, (vector) =>
        Crypto.hash(vector.input).pipe(Effect.tap((digest) => {
            expect(digest).toBe(vector.expected);
            expect(digest).toHaveLength(SHA256_DIGEST_HEX_LENGTH);
        })),
    ).pipe(Effect.asVoid));

// --- [ALGEBRAIC: HMAC-SHA-256 ORACLE] ----------------------------------------

// P13: HMAC-SHA-256 equivalence — Crypto.hmac matches RFC 4231 Test Case 2
it.effect('P13: HMAC-SHA-256 RFC 4231 vectors', () =>
    Effect.forEach(HMAC_VECTORS, (vector) =>
        Crypto.hmac(vector.key, vector.data).pipe(Effect.tap((tag) => {
            expect(tag).toBe(vector.expected);
            expect(tag).toHaveLength(SHA256_DIGEST_HEX_LENGTH);
        })),
    ).pipe(Effect.asVoid));

// --- [ALGEBRAIC: CIPHERTEXT STRUCTURE] ---------------------------------------

layer(_testLayer)('Crypto vectors', (it) => {
    // P14: Ciphertext structural invariant — version byte + IV + ciphertext + tag
    it.effect('P14: AES-GCM ciphertext structure', () =>
        Effect.forEach(STRUCTURAL_INPUTS, (plaintext) =>
            Crypto.encrypt(plaintext).pipe(Effect.flatMap((cipher) => {
                const encoded = new TextEncoder().encode(plaintext);
                const expectedLength = CIPHER.version + CIPHER.iv + encoded.length + CIPHER.tag;
                expect(cipher[0]).toBe(1);
                expect(cipher.length).toBe(expectedLength);
                return Crypto.decrypt(cipher).pipe(Effect.tap((recovered) => { expect(recovered).toBe(plaintext); }));
            })),
        ).pipe(Effect.asVoid));

    // P15: Hash output format — 64 lowercase hex chars for all structural inputs
    it.effect('P15: hash output hex format', () =>
        Effect.forEach(STRUCTURAL_INPUTS, (input) =>
            Crypto.hash(input).pipe(Effect.tap((digest) => {
                expect(digest).toMatch(/^[0-9a-f]{64}$/);
            })),
        ).pipe(Effect.asVoid));
});
