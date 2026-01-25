/**
 * Unified cryptographic service with HKDF tenant key derivation.
 * Automatically derives tenant-scoped keys from Context.Request.tenantId.
 * Uses Effect.Encoding directly - no hand-rolled encoding.
 */
import { timingSafeEqual } from 'node:crypto';
import { type Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Cache, Config, Data, Duration, Effect, Encoding, Either, Option, Redacted } from 'effect';
import { Context } from '../context.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	cache: { capacity: 1000, ttl: Duration.hours(24) },
	hkdf: { hash: 'SHA-256', info: 'parametric-tenant-key-v1', salt: new Uint8Array(32) },
	iv: 12,
	key: { length: 256, name: 'AES-GCM' } as const,
	minBytes: 14,
	version: { current: 1, max: 255, min: 1 },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class EncryptError extends Data.TaggedError('CryptoEncryptError')<{
	readonly cause?: unknown;
	readonly tenantId: string;
}> {}
class DecryptError extends Data.TaggedError('CryptoDecryptError')<{
	readonly cause?: unknown;
	readonly code: 'DECRYPT_FAILED' | 'INVALID_FORMAT' | 'KEY_DERIVATION_FAILED';
	readonly tenantId: string;
}> {}

// --- [INTERNAL] --------------------------------------------------------------

const _parse = (bytes: Uint8Array) => {
	const v = bytes[0];
	return bytes.length >= _config.minBytes && typeof v === 'number' && v >= _config.version.min && v <= _config.version.max
		? Option.some({ cipher: bytes.slice(1 + _config.iv), iv: bytes.slice(1, 1 + _config.iv), v })
		: Option.none();
};
const _toHex64 = (bytes: Uint8Array): Hex64 => Encoding.encodeHex(bytes) as Hex64;

// --- [SERVICE] ---------------------------------------------------------------

class Service extends Effect.Service<Service>()('server/CryptoService', {
	effect: Effect.gen(function* () {
		const masterKey = yield* Config.redacted('ENCRYPTION_KEY').pipe(
			Effect.flatMap((r) =>
				Either.match(Encoding.decodeBase64(Redacted.value(r)), {
					onLeft: () => Effect.die(new Error('Invalid ENCRYPTION_KEY base64')),
					onRight: (bytes) => Effect.tryPromise({
						catch: (e) => e,
						try: () => crypto.subtle.importKey('raw', new Uint8Array(bytes), 'HKDF', false, ['deriveKey']),
					}),
				}),
			),
			Effect.orDie,
		);
		const tenantKeyCache = yield* Cache.make({
			capacity: _config.cache.capacity,
			lookup: (tenantId: string) => Effect.tryPromise({
				catch: () => new Error(`HKDF derivation failed for tenant ${tenantId}`),
				try: () => crypto.subtle.deriveKey(
					{
						hash: _config.hkdf.hash,
						info: new TextEncoder().encode(`${_config.hkdf.info}:${tenantId}`),
						name: 'HKDF',
						salt: _config.hkdf.salt,
					},
					masterKey,
					{ length: _config.key.length, name: _config.key.name },
					false,
					['encrypt', 'decrypt'],
				),
			}).pipe(Effect.orDie),
			timeToLive: _config.cache.ttl,
		});
		const deriveKey = (tenantId: string) => tenantKeyCache.get(tenantId);
		yield* Effect.logInfo('CryptoService initialized with HKDF tenant key derivation');
		return { deriveKey, version: _config.version.current };
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const encrypt = (plaintext: string): Effect.Effect<Uint8Array, EncryptError, Service> =>
	Effect.gen(function* () {
		const tenantId = yield* Context.Request.tenantId;
		const svc = yield* Service;
		const key = yield* svc.deriveKey(tenantId).pipe(
			Effect.mapError((e) => new EncryptError({ cause: e, tenantId })),
		);
		const iv = crypto.getRandomValues(new Uint8Array(_config.iv));
		const buf = yield* Effect.tryPromise({
			catch: (e) => new EncryptError({ cause: e, tenantId }),
			try: () => crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, new TextEncoder().encode(plaintext)),
		});
		return new Uint8Array([svc.version, ...iv, ...new Uint8Array(buf)]);
	}).pipe(Effect.withSpan('crypto.encrypt'));
const decrypt = (bytes: Uint8Array): Effect.Effect<string, DecryptError, Service> =>
	Effect.gen(function* () {
		const tenantId = yield* Context.Request.tenantId;
		const parsed = yield* Effect.fromNullable(_parse(bytes).pipe(Option.getOrNull)).pipe(
			Effect.mapError(() => new DecryptError({ code: 'INVALID_FORMAT', tenantId })),
		);
		const svc = yield* Service;
		const key = yield* svc.deriveKey(tenantId).pipe(
			Effect.mapError((e) => new DecryptError({ cause: e, code: 'KEY_DERIVATION_FAILED', tenantId })),
		);
		const buf = yield* Effect.tryPromise({
			catch: (e) => new DecryptError({ cause: e, code: 'DECRYPT_FAILED', tenantId }),
			try: () => crypto.subtle.decrypt({ iv: parsed.iv.slice(), name: 'AES-GCM' }, key, parsed.cipher.slice()),
		});
		return new TextDecoder().decode(buf);
	}).pipe(Effect.withSpan('crypto.decrypt'));
const hash = (input: string): Effect.Effect<Hex64> =>
	Effect.tryPromise({
		catch: (e) => e,
		try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
	}).pipe(
		Effect.map((buf) => _toHex64(new Uint8Array(buf))),
		Effect.orDie,
		Effect.withSpan('crypto.hash'),
	);
const timingSafeCompare = (a: string, b: string): boolean => {
	const bufA = new TextEncoder().encode(a);
	const bufB = new TextEncoder().encode(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Crypto = {
	decrypt,
	encrypt,
	Service,
	token: {
		compare: timingSafeCompare,
		hash,
		pair: Effect.gen(function* () {
			const tok = Uuidv7.generateSync();
			const h = yield* hash(tok);
			return { hash: h, token: tok } as const;
		}).pipe(Effect.withSpan('crypto.pair')),
	},
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Crypto {
	export type DecryptError = InstanceType<typeof DecryptError>;
	export type EncryptError = InstanceType<typeof EncryptError>;
	export type Pair = Effect.Effect.Success<typeof Crypto.token.pair>;
	export type Service = typeof Crypto.Service.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, DecryptError, EncryptError };
