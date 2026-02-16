/**
 * Unified cryptographic service with HKDF tenant key derivation and versioned key rotation.
 * Flat API (hash, compare, pair), Effect.Encoding, timing-safe comparison.
 */
import { timingSafeEqual } from 'node:crypto';
import { type Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Cache, Data, Duration, Effect, Encoding, Either, HashMap, Option, Redacted, Schema as S } from 'effect';
import { Context } from '../context.ts';
import { Env } from '../env.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();
const _CONFIG = {
    cache: { capacity: 1000, ttl: Duration.hours(24) },
    hkdf: { hash: 'SHA-256', info: 'parametric-tenant-key-v1', legacySalt: new Uint8Array(32) },
    iv: 12,
    key: { length: 256, name: 'AES-GCM' } as const,
    minBytes: 14,
    version: { max: 255, min: 1 },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class CryptoError extends Data.TaggedError('CryptoError')<{
    readonly cause?: unknown;
    readonly code: 'INVALID_FORMAT' | 'KEY_FAILED' | 'KEY_NOT_FOUND' | 'OP_FAILED';
    readonly op: 'decrypt' | 'encrypt' | 'hmac' | 'key' | 'reencrypt';
    readonly tenantId: string;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class Service extends Effect.Service<Service>()('server/CryptoService', {
    effect: Effect.gen(function* () {
        const env = yield* Env.Service;
        const multiKeyConfig = env.security.encryptionKeys;
        const parsed = yield* Option.match(multiKeyConfig, {
            onNone: () => Option.match(env.security.encryptionKey, {
                onNone: () => Effect.fail(new CryptoError({ code: 'KEY_NOT_FOUND', op: 'key', tenantId: Context.Request.Id.system })),
                onSome: (redacted): Effect.Effect<ReadonlyArray<{ readonly key: string; readonly version: number }>> => Effect.succeed([{ key: Redacted.value(redacted), version: 1 }]),
            }),
            onSome: (redacted) => S.decodeUnknown(S.parseJson(S.Array(S.Struct({ key: S.String, version: S.Number.pipe(S.int(), S.greaterThanOrEqualTo(1), S.lessThanOrEqualTo(255)) }))))(Redacted.value(redacted)).pipe(
                Effect.mapError((error) => new CryptoError({ cause: error, code: 'INVALID_FORMAT', op: 'key', tenantId: Context.Request.Id.system })),
            ),
        });
        const currentVersion = Option.getOrElse(
            env.security.encryptionKeyVersion,
            () => parsed.reduce<number>((max, entry) => Math.max(entry.version, max), 0),
        );
        const imported = yield* Effect.forEach(parsed, (entry) =>
            Either.match(Encoding.decodeBase64(entry.key), {
                onLeft: () => Effect.fail(new CryptoError({ code: 'INVALID_FORMAT', op: 'key', tenantId: Context.Request.Id.system })),
                onRight: (bytes) => Effect.tryPromise({
                    catch: (error) => new CryptoError({ cause: error, code: 'KEY_FAILED', op: 'key', tenantId: Context.Request.Id.system }),
                    try: () => crypto.subtle.importKey('raw', new Uint8Array(bytes), 'HKDF', false, ['deriveKey']),
                }).pipe(Effect.map((cryptoKey): readonly [number, CryptoKey] => [entry.version, cryptoKey])),
            }),
        );
        const keys = HashMap.fromIterable(imported);
        const tenantKeyCache = yield* Cache.make({
            capacity: _CONFIG.cache.capacity,
            lookup: (compositeKey: string) => Effect.gen(function* () {
                const separatorIndex = compositeKey.indexOf(':');
                const version = Number(compositeKey.slice(0, separatorIndex));
                const tenantId = compositeKey.slice(separatorIndex + 1);
                const masterKey = yield* Option.match(HashMap.get(keys, version), {
                    onNone: () => Effect.fail(new CryptoError({ code: "KEY_NOT_FOUND", op: "key", tenantId })),
                    onSome: Effect.succeed,
                });
                return yield* Effect.promise(() =>
                    crypto.subtle.deriveKey(
                        {
                            hash: _CONFIG.hkdf.hash,
                            info: _encoder.encode(`${_CONFIG.hkdf.info}:${tenantId}`),
                            name: 'HKDF',
                            salt: version === 1 ? new Uint8Array(_CONFIG.hkdf.legacySalt) : _encoder.encode(`parametric-portal-hkdf-v${version}`),
                        },
                        masterKey,
                        { length: _CONFIG.key.length, name: _CONFIG.key.name },
                        false,
                        ['encrypt', 'decrypt'],
                    ),
                );
            }),
            timeToLive: _CONFIG.cache.ttl,
        });
        const deriveKey = (tenantId: string, version?: number) => tenantKeyCache.get(`${version ?? currentVersion}:${tenantId}`);
        yield* Effect.logInfo(`CryptoService initialized with ${HashMap.size(keys)} versioned key(s), current version: ${currentVersion}`);
        return { currentVersion, deriveKey };
    }),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const compare = (a: string, b: string): Effect.Effect<boolean> =>
    Effect.sync(() => {
        const bufA = _encoder.encode(a);
        const bufB = _encoder.encode(b);
        return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
    }).pipe(Telemetry.span('crypto.compare', { metrics: false }));
const decrypt = (bytes: Uint8Array, additionalData?: BufferSource): Effect.Effect<string, CryptoError, Service> =>
    Telemetry.span(Effect.gen(function* () {
        const tenantId = yield* Context.Request.currentTenantId;
        yield* Effect.filterOrFail(
            Effect.succeed(bytes),
            (b) => b.length >= _CONFIG.minBytes && b[0] !== undefined && b[0] >= _CONFIG.version.min && b[0] <= _CONFIG.version.max,
            () => new CryptoError({ code: 'INVALID_FORMAT', op: 'decrypt', tenantId }),
        );
        const version = bytes[0] as number;
        const iv = bytes.slice(1, 1 + _CONFIG.iv);
        const cipher = bytes.slice(1 + _CONFIG.iv);
        const service = yield* Service;
        const key = yield* service.deriveKey(tenantId, version).pipe(Effect.mapError((error) => new CryptoError({ cause: error, code: error instanceof CryptoError && error.code === 'KEY_NOT_FOUND' ? 'KEY_NOT_FOUND' : 'KEY_FAILED', op: 'decrypt', tenantId })));
        const params: AesGcmParams = additionalData ? { additionalData, iv, name: 'AES-GCM' } : { iv, name: 'AES-GCM' };
        const plaintext = yield* Effect.tryPromise({
            catch: (error) => new CryptoError({ cause: error, code: 'OP_FAILED', op: 'decrypt', tenantId }),
            try: () => crypto.subtle.decrypt(params, key, cipher),
        });
        return _decoder.decode(plaintext);
    }), 'crypto.decrypt', { metrics: false });
const encrypt = (plaintext: string, additionalData?: BufferSource): Effect.Effect<Uint8Array, CryptoError, Service> =>
    Telemetry.span(Effect.gen(function* () {
        const tenantId = yield* Context.Request.currentTenantId;
        const service = yield* Service;
        const key = yield* service.deriveKey(tenantId, service.currentVersion).pipe(Effect.mapError((error) => new CryptoError({ cause: error, code: 'KEY_FAILED', op: 'encrypt', tenantId })));
        const iv = crypto.getRandomValues(new Uint8Array(_CONFIG.iv));
        const params: AesGcmParams = additionalData ? { additionalData, iv, name: 'AES-GCM' } : { iv, name: 'AES-GCM' };
        const ciphertext = yield* Effect.tryPromise({
            catch: (error) => new CryptoError({ cause: error, code: 'OP_FAILED', op: 'encrypt', tenantId }),
            try: () => crypto.subtle.encrypt(params, key, _encoder.encode(plaintext)),
        });
        const ciphertextBytes = new Uint8Array(ciphertext);
        const result = new Uint8Array(1 + iv.length + ciphertextBytes.length);
        result[0] = service.currentVersion;
        result.set(iv, 1);
        result.set(ciphertextBytes, 1 + iv.length);
        return result;
    }), 'crypto.encrypt', { metrics: false });
const reencrypt = (bytes: Uint8Array, additionalData?: BufferSource): Effect.Effect<Uint8Array, CryptoError, Service> =>
    Telemetry.span(Effect.gen(function* () {
        const service = yield* Service;
        return (bytes[0] === service.currentVersion)
            ? bytes
            : yield* decrypt(bytes, additionalData).pipe(
                Effect.flatMap((plaintext) => encrypt(plaintext, additionalData)),
                Effect.mapError((error) => new CryptoError({ cause: error, code: error.code, op: 'reencrypt', tenantId: error.tenantId })),
            );
    }), 'crypto.reencrypt', { metrics: false });
const hash = (input: string): Effect.Effect<Hex64> =>
    Effect.promise(() => crypto.subtle.digest('SHA-256', _encoder.encode(input))).pipe(
        Effect.map((buf) => Encoding.encodeHex(new Uint8Array(buf)) as Hex64),
        Telemetry.span('crypto.hash', { metrics: false }),
    );
const hmac = (key: string, data: string): Effect.Effect<Hex64> =>
    Effect.gen(function* () {
        const cryptoKey = yield* Effect.promise(() => crypto.subtle.importKey('raw', _encoder.encode(key), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']));
        const signature = yield* Effect.promise(() => crypto.subtle.sign('HMAC', cryptoKey, _encoder.encode(data)));
        return Encoding.encodeHex(new Uint8Array(signature)) as Hex64;
    }).pipe(Telemetry.span('crypto.hmac', { metrics: false }));
const pair = Effect.gen(function* () {
    const token = Uuidv7.generateSync();
    const hashed = yield* hash(token);
    return { hash: hashed, token: Redacted.make(token) } as const;
}).pipe(Telemetry.span('crypto.pair', { metrics: false }));

// --- [ENTRY] -----------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Crypto = {
    compare,
    decrypt,
    encrypt,
    hash,
    hmac,
    pair,
    reencrypt,
    Service
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Crypto {
    export type Error = CryptoError;
    export type Pair = Effect.Effect.Success<typeof Crypto.pair>;
    export type Service = typeof Crypto.Service.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, CryptoError };
