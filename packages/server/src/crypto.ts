/**
 * Provide cryptographic utilities: hashing, encryption, token validation.
 * Versioned encryption keys enable seamless rotation; fails fast on missing key.
 */
import { timingSafeEqual } from 'node:crypto';
import { Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Array as A, Config, Context, Effect, Layer, Option, Redacted } from 'effect';
import { HttpError } from './http-errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const CRYPTO_CONFIG = {
	algorithm: 'aes-256-gcm' as const,
	currentKeyVersion: 1,
	ivLength: 12,
	keyAlgorithm: { length: 256, name: 'AES-GCM' },
	maxHistoricalVersions: 10,
	minEncryptedLength: 14, // 1 (version) + 12 (iv) + 1 (min ciphertext)
	version: { index: 0, length: 1, max: 255, min: 1 },
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class TokenPair {
	readonly hash: Hex64;
	readonly token: Uuidv7;
	constructor(input: { readonly hash: Hex64; readonly token: Uuidv7 }) {
		this.hash = input.hash;
		this.token = input.token;
	}
	static readonly create = Effect.gen(function* () {
		const token = Uuidv7.generateSync();
		const hashBuffer = yield* Effect.tryPromise({
			catch: () => HttpError.internal('Hashing failed'),
			try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
		});
		return new TokenPair({ hash: Hex64.fromBytes(new Uint8Array(hashBuffer)), token });
	});
}
class EncryptedKey {
	readonly ciphertext: Uint8Array;
	readonly iv: Uint8Array;
	readonly version: number;
	constructor(input: { readonly ciphertext: Uint8Array; readonly iv: Uint8Array; readonly version: number }) {
		this.ciphertext = input.ciphertext;
		this.iv = input.iv;
		this.version = input.version;
	}
	static readonly fromBytes = (bytes: Uint8Array): Effect.Effect<EncryptedKey, HttpError.Internal> =>
		Effect.suspend(() => {
			const version = bytes[CRYPTO_CONFIG.version.index];
			const iv = bytes.slice(CRYPTO_CONFIG.version.length, CRYPTO_CONFIG.version.length + CRYPTO_CONFIG.ivLength);
			const ciphertext = bytes.slice(CRYPTO_CONFIG.version.length + CRYPTO_CONFIG.ivLength);
			const lengthOk = bytes.length >= CRYPTO_CONFIG.minEncryptedLength;
			const versionOk = typeof version === 'number' && version >= CRYPTO_CONFIG.version.min && version <= CRYPTO_CONFIG.version.max;
			return lengthOk && versionOk && iv.length === CRYPTO_CONFIG.ivLength
				? Effect.succeed(new EncryptedKey({ ciphertext, iv, version }))
				: Effect.fail(HttpError.internal('Invalid encrypted data format', { bytes: bytes.length, version }));
		});
	static readonly decryptBytes = (bytes: Uint8Array) =>
		EncryptedKey.fromBytes(bytes).pipe(
			Effect.flatMap((encrypted) => encrypted.decrypt()),
			Effect.withSpan('crypto.decrypt.bytes'),
		);
	decrypt(): Effect.Effect<string, HttpError.Internal, EncryptionKeyStore> {
		const { ciphertext, iv, version } = this;
		return Effect.gen(function* () {
			const store = yield* EncryptionKeyStore;
			const key = yield* store.getKey(version);
			const decrypted = yield* Effect.tryPromise({
				catch: () => HttpError.internal('Decryption failed'),
				try: () => crypto.subtle.decrypt({ iv: iv.slice(), name: 'AES-GCM' }, key, ciphertext.slice()),
			});
			return new TextDecoder().decode(decrypted);
		}).pipe(Effect.withSpan('crypto.decrypt'));
	}
	toBytes(): Uint8Array { return new Uint8Array([this.version, ...this.iv, ...this.ciphertext]); }
}
class EncryptionKeyStore extends Context.Tag('crypto/EncryptionKeyStore')<EncryptionKeyStore, {
	readonly currentVersion: number;
	readonly getKey: (version: number) => Effect.Effect<CryptoKey, HttpError.Internal>;
}>() {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const keys = new Map<number, CryptoKey>();
			const importKey = (keyB64: string) =>
				Effect.tryPromise({
					catch: (cause) => cause,
					try: () => crypto.subtle.importKey('raw', Hex64.fromBase64(keyB64).slice(), CRYPTO_CONFIG.keyAlgorithm, false, ['encrypt', 'decrypt']),
				});
			const storeKey = (version: number, key: CryptoKey) => Effect.sync(() => keys.set(version, key));
			const importAndStore = (version: number, keyB64: string) => importKey(keyB64).pipe(Effect.flatMap((key) => storeKey(version, key)), Effect.catchAll(() => Effect.void));
			const loadHistoricalKey = (version: number) =>
				Effect.gen(function* () {
					const opt = yield* Config.option(Config.redacted(`ENCRYPTION_KEY_V${version}`));
					yield* Option.match(opt, { onNone: () => Effect.void, onSome: (redacted) => importAndStore(version, Redacted.value(redacted)) });
				});
			const currentRedacted = yield* Config.redacted('ENCRYPTION_KEY');
			const currentKey = yield* importKey(Redacted.value(currentRedacted));
			keys.set(CRYPTO_CONFIG.currentKeyVersion, currentKey);
			const historicalVersions = A.makeBy(CRYPTO_CONFIG.maxHistoricalVersions, (index) => index + CRYPTO_CONFIG.version.min).filter((version) => version !== CRYPTO_CONFIG.currentKeyVersion);
			yield* Effect.all(historicalVersions.map(loadHistoricalKey), { concurrency: 'unbounded' });
			yield* Effect.logInfo('EncryptionKeyStore initialized', { versions: Array.from(keys.keys()).sort((first, second) => first - second) });
			return {
				currentVersion: CRYPTO_CONFIG.currentKeyVersion,
				getKey: (version: number) =>
					Effect.fromNullable(keys.get(version)).pipe(
						Effect.mapError(() => HttpError.internal(`Encryption key version ${version} not found`)),
					),
			};
		}).pipe(Effect.orDie),
	);
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hash = (input: string) =>
    Effect.tryPromise({
        catch: () => HttpError.internal('Hashing failed'),
        try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
    }).pipe(
        Effect.map((hashBuffer) => Hex64.fromBytes(new Uint8Array(hashBuffer))),
        Effect.withSpan('crypto.hash'),
    );
const encrypt = (plaintext: string) =>
    Effect.gen(function* () {
        const store = yield* EncryptionKeyStore;
        const key = yield* store.getKey(store.currentVersion);
        const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.ivLength));
        const ciphertext = yield* Effect.tryPromise({
            catch: () => HttpError.internal('Encryption failed'),
            try: () => crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, new TextEncoder().encode(plaintext))
                .then((buf) => new Uint8Array(buf)),
        });
        return new EncryptedKey({ ciphertext, iv, version: store.currentVersion });
    }).pipe(Effect.withSpan('crypto.encrypt'));
const validate = <T extends { readonly expiresAt?: Date | Option.Option<Date> }>(config: {
    readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<T>, HttpError.Auth>;
    readonly messages: { readonly notFound: string; readonly expired: string }; }) => (tokenHash: Hex64) =>
    config.lookup(tokenHash).pipe(
        Effect.andThen(Option.match({
            onNone: () => Effect.fail(HttpError.auth(config.messages.notFound)),
            onSome: Effect.succeed,
        })),
        Effect.filterOrFail(
            (result) => Option.match(result.expiresAt instanceof Date ? Option.some(result.expiresAt) : (result.expiresAt ?? Option.none<Date>()), { onNone: () => true, onSome: (exp) => exp > new Date() }),
            () => HttpError.auth(config.messages.expired),
        ),
    );
const migrateEncrypted = (encryptedBytes: Uint8Array) =>
    Effect.gen(function* () {
        const store = yield* EncryptionKeyStore;
        const encrypted = yield* EncryptedKey.fromBytes(encryptedBytes);
        return encrypted.version === store.currentVersion
            ? { migrated: false as const }
            : yield* encrypted.decrypt().pipe(
                  Effect.flatMap((plaintext) =>
                      encrypt(plaintext).pipe(
                          Effect.map((newEncrypted) => ({
                              migrated: true as const,
                              newEncrypted: newEncrypted.toBytes(),
                              plaintext,
                          })),
                      ),
                  ),
              );
    }).pipe(Effect.withSpan('crypto.migrate'));

// --- [COMPARISON] ------------------------------------------------------------

const safeCompare = (first: string, second: string): boolean => { 	/** Timing-safe string comparison to prevent timing attacks. */
	const firstBuffer = Buffer.from(first);
	const secondBuffer = Buffer.from(second);
	return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
};

// --- [OBJECT] ----------------------------------------------------------------

const Crypto = {
	Key: { encrypt, migrate: migrateEncrypted, Store: EncryptionKeyStore },
	safeCompare,
	Token: { generate: Uuidv7.generateSync, hash, Pair: TokenPair, validate },
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, EncryptedKey, EncryptionKeyStore, TokenPair };
