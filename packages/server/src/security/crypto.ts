/**
 * Unified cryptographic service with HKDF tenant key derivation.
 * Flat API: Crypto.hash, Crypto.compare, Crypto.pair (no nested token object).
 * Uses Effect.Encoding directly - no hand-rolled encoding.
 */
import { timingSafeEqual } from 'node:crypto';
import { type Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Cache, Config, Data, Duration, Effect, Encoding, Either, Number as N, Redacted } from 'effect';
import { Context } from '../context.ts';
import { Telemetry } from '../observe/telemetry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();
const _config = {
	cache: { capacity: 1000, ttl: Duration.hours(24) },
	hkdf: { hash: 'SHA-256', info: 'parametric-tenant-key-v1', salt: new Uint8Array(32) },
	iv: 12,
	key: { length: 256, name: 'AES-GCM' } as const,
	minBytes: 14,
	version: { current: 1, max: 255, min: 1 },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class CryptoError extends Data.TaggedError('CryptoError')<{
	readonly cause?: unknown;
	readonly code: 'INVALID_FORMAT' | 'KEY_FAILED' | 'OP_FAILED';
	readonly op: 'decrypt' | 'encrypt' | 'hmac' | 'key';
	readonly tenantId: string;
}> {}

// --- [SERVICE] ---------------------------------------------------------------

class Service extends Effect.Service<Service>()('server/CryptoService', {
	effect: Effect.gen(function* () {
		const masterKey = yield* Config.redacted('ENCRYPTION_KEY').pipe(
			Effect.flatMap((r) =>
				Encoding.decodeBase64(Redacted.value(r)).pipe(
					Either.match({
						onLeft: () => Effect.die(new Error('Invalid ENCRYPTION_KEY base64')),
						onRight: (bytes) => Effect.promise(() =>
							crypto.subtle.importKey('raw', new Uint8Array(bytes), 'HKDF', false, ['deriveKey']),
						),
					}),
				),
			),
		);
		const tenantKeyCache = yield* Cache.make({
			capacity: _config.cache.capacity,
			lookup: (tenantId: string) => Effect.promise(() =>
				crypto.subtle.deriveKey(
					{
						hash: _config.hkdf.hash,
						info: _encoder.encode(`${_config.hkdf.info}:${tenantId}`),
						name: 'HKDF',
						salt: _config.hkdf.salt,
					},
					masterKey,
					{ length: _config.key.length, name: _config.key.name },
					false,
					['encrypt', 'decrypt'],
				),
			),
			timeToLive: _config.cache.ttl,
		});
		const deriveKey = (tenantId: string) => tenantKeyCache.get(tenantId);
		yield* Effect.logInfo('CryptoService initialized with HKDF tenant key derivation');
		return { deriveKey };
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const compare = (a: string, b: string): Effect.Effect<boolean> =>
	Effect.sync(() => {
		const bufA = _encoder.encode(a);
		const bufB = _encoder.encode(b);
		return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
	});
const decrypt = (bytes: Uint8Array): Effect.Effect<string, CryptoError, Service> =>
	Telemetry.span(Effect.gen(function* () {
		const tenantId = yield* Context.Request.tenantId;
		yield* Effect.filterOrFail(
			Effect.succeed(bytes),
			(b) => b.length >= _config.minBytes && b[0] !== undefined && N.between({ maximum: _config.version.max, minimum: _config.version.min })(b[0]),
			() => new CryptoError({ code: 'INVALID_FORMAT', op: 'decrypt', tenantId }),
		);
		const iv = bytes.slice(1, 1 + _config.iv);
		const cipher = bytes.slice(1 + _config.iv);
		const svc = yield* Service;
		const key = yield* svc.deriveKey(tenantId).pipe(Effect.mapError((e) => new CryptoError({ cause: e, code: 'KEY_FAILED', op: 'decrypt', tenantId })),);
		const plaintext = yield* Effect.tryPromise({
			catch: (e) => new CryptoError({ cause: e, code: 'OP_FAILED', op: 'decrypt', tenantId }),
			try: () => crypto.subtle.decrypt({ iv, name: 'AES-GCM' }, key, cipher),
		});
		return _decoder.decode(plaintext);
	}), 'crypto.decrypt');
const encrypt = (plaintext: string): Effect.Effect<Uint8Array, CryptoError, Service> =>
	Telemetry.span(Effect.gen(function* () {
		const tenantId = yield* Context.Request.tenantId;
		const svc = yield* Service;
		const key = yield* svc.deriveKey(tenantId).pipe(Effect.mapError((e) => new CryptoError({ cause: e, code: 'KEY_FAILED', op: 'encrypt', tenantId })),);
		const iv = crypto.getRandomValues(new Uint8Array(_config.iv));
		const ciphertext = yield* Effect.tryPromise({
			catch: (e) => new CryptoError({ cause: e, code: 'OP_FAILED', op: 'encrypt', tenantId }),
			try: () => crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, _encoder.encode(plaintext)),
		});
		const ciphertextBytes = new Uint8Array(ciphertext);
		const result = new Uint8Array(1 + iv.length + ciphertextBytes.length);
		result[0] = _config.version.current;
		result.set(iv, 1);
		result.set(ciphertextBytes, 1 + iv.length);
		return result;
	}), 'crypto.encrypt');
const hash = (input: string): Effect.Effect<Hex64> =>
	Effect.promise(() => crypto.subtle.digest('SHA-256', _encoder.encode(input))).pipe(
		Effect.map((buf) => Encoding.encodeHex(new Uint8Array(buf)) as Hex64),
		Telemetry.span('crypto.hash'),
	);
const hmac = (key: string, data: string): Effect.Effect<Hex64> =>
	Effect.gen(function* () {
		const cryptoKey = yield* Effect.promise(() =>crypto.subtle.importKey('raw', _encoder.encode(key), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']),);
		const signature = yield* Effect.promise(() =>crypto.subtle.sign('HMAC', cryptoKey, _encoder.encode(data)),);
		return Encoding.encodeHex(new Uint8Array(signature)) as Hex64;
	}).pipe(Telemetry.span('crypto.hmac'));
const pair = Effect.gen(function* () {
	const tok = Uuidv7.generateSync();
	const h = yield* hash(tok);
	return { hash: h, token: tok } as const;
}).pipe(Telemetry.span('crypto.pair'));

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Crypto = { compare, decrypt, encrypt, hash, hmac, pair, Service } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Crypto {
	export type Error = CryptoError;
	export type Pair = Effect.Effect.Success<typeof Crypto.pair>;
	export type Service = typeof Crypto.Service.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, CryptoError };
