/**
 * Cryptographic utilities: hashing, encryption, token generation/validation.
 * Supports versioned encryption keys for seamless rotation.
 */
import { Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Config, Context, Effect, Layer, Option, ParseResult, Redacted, Schema as S } from 'effect';
import { HttpError } from './http-errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    algorithm: 'aes-256-gcm' as const,
    currentKeyVersion: 1,
    ivLength: 12,
    keyAlgorithm: { length: 256, name: 'AES-GCM' },
    keyVersionHeader: 1,
    minEncryptedLength: 14, // 1 (version) + 12 (iv) + 1 (min ciphertext)
    versionLength: 1,
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class TokenPair extends S.Class<TokenPair>('TokenPair')({
    hash: Hex64.schema,
    token: Uuidv7.schema,
}) {
    static readonly create = Effect.gen(function* () {
        const token = Uuidv7.generateSync();
        const hashBuffer = yield* Effect.tryPromise({
            catch: () => new HttpError.Internal({ message: 'Hashing failed' }),
            try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
        });
        return new TokenPair({ hash: Hex64.fromBytes(new Uint8Array(hashBuffer)), token });
    });
}
class EncryptedKey extends S.Class<EncryptedKey>('EncryptedKey')({
    ciphertext: S.Uint8ArrayFromSelf,
    iv: S.Uint8ArrayFromSelf.pipe(S.filter((arr) => arr.length === B.ivLength, { message: () => `IV must be ${B.ivLength} bytes` }),),
    version: S.Number.pipe(S.int(), S.between(1, 255)),
}) {
    static readonly fromBytes = S.transformOrFail(S.Uint8ArrayFromSelf, EncryptedKey, {
        decode: (bytes) =>
            bytes.length < B.minEncryptedLength
                ? ParseResult.fail(new ParseResult.Type(S.Uint8ArrayFromSelf.ast, bytes, `Expected at least ${B.minEncryptedLength} bytes`))
                : ParseResult.succeed(new EncryptedKey({
                      ciphertext: bytes.slice(B.versionLength + B.ivLength),
                      iv: bytes.slice(B.versionLength, B.versionLength + B.ivLength),
                      version: bytes[0] ?? 1,
                  })),
        encode: ({ ciphertext, iv, version }) => ParseResult.succeed(new Uint8Array([version, ...iv, ...ciphertext])),
        strict: true,
    });
    static readonly decryptBytes = (bytes: Uint8Array) =>
        Effect.gen(function* () {
            const encrypted = yield* S.decodeUnknown(EncryptedKey.fromBytes)(bytes).pipe(
                Effect.mapError(() => new HttpError.Internal({ message: 'Invalid encrypted data format' })),
            );
            return yield* encrypted.decrypt();
        }).pipe(Effect.withSpan('crypto.decrypt.bytes'));
    decrypt(): Effect.Effect<string, InstanceType<typeof HttpError.Internal>, EncryptionKeyStore> {
        const { ciphertext, iv, version } = this;
        return Effect.gen(function* () {
            const store = yield* EncryptionKeyStore;
            const key = yield* store.getKey(version);
            const decrypted = yield* Effect.tryPromise({
                catch: () => new HttpError.Internal({ message: 'Decryption failed' }),
                try: () => crypto.subtle.decrypt({ iv: iv.slice(), name: 'AES-GCM' }, key, ciphertext.slice()),
            });
            return new TextDecoder().decode(decrypted);
        }).pipe(Effect.withSpan('crypto.decrypt'));
    }
    toBytes(): Uint8Array {return new Uint8Array([this.version, ...this.iv, ...this.ciphertext]);}
}
class EncryptionKeyStore extends Context.Tag('crypto/EncryptionKeyStore')<EncryptionKeyStore, {
    readonly currentVersion: number;
    readonly getKey: (version: number) => Effect.Effect<CryptoKey, InstanceType<typeof HttpError.Internal>>;
}>() {
    static readonly layer = Layer.effect(
        this,
        Effect.gen(function* () {
            const keys = new Map<number, CryptoKey>();
            const importKey = (keyB64: string) =>
                Effect.tryPromise({
                    catch: (cause) => cause,
                    try: () => crypto.subtle.importKey('raw', Hex64.fromBase64(keyB64).slice(), B.keyAlgorithm, false, ['encrypt', 'decrypt']),
                });
            const storeKey = (v: number, key: CryptoKey) => Effect.sync(() => keys.set(v, key));
            const importAndStore = (v: number, keyB64: string) => importKey(keyB64).pipe(Effect.flatMap((key) => storeKey(v, key)), Effect.catchAll(() => Effect.void));
            const loadHistoricalKey = (v: number) =>
                Effect.gen(function* () {
                    const opt = yield* Config.option(Config.redacted(`ENCRYPTION_KEY_V${v}`));
                    yield* Option.isSome(opt) ? importAndStore(v, Redacted.value(opt.value)) : Effect.void;
                });
            const currentRedacted = yield* Config.redacted('ENCRYPTION_KEY');
            const currentKey = yield* importKey(Redacted.value(currentRedacted));
            keys.set(B.currentKeyVersion, currentKey);
            const maxHistorical = 10;
            const historicalVersions = Array.from({ length: maxHistorical }, (_, i) => i + 1).filter((v) => v !== B.currentKeyVersion);
            yield* Effect.all(historicalVersions.map(loadHistoricalKey), { concurrency: 'unbounded' });
            yield* Effect.logInfo('EncryptionKeyStore initialized', { versions: Array.from(keys.keys()).sort((a, b) => a - b) });
            return {
                currentVersion: B.currentKeyVersion,
                getKey: (version: number) =>
                    Effect.fromNullable(keys.get(version)).pipe(
                        Effect.mapError(() => new HttpError.Internal({ message: `Encryption key version ${version} not found` })),
                    ),
            };
        }).pipe(Effect.orDie),
    );
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hash = (input: string) =>
    Effect.tryPromise({
        catch: () => new HttpError.Internal({ message: 'Hashing failed' }),
        try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
    }).pipe(
        Effect.map((hashBuffer) => Hex64.fromBytes(new Uint8Array(hashBuffer))),
        Effect.withSpan('crypto.hash'),
    );
const encrypt = (plaintext: string) =>
    Effect.gen(function* () {
        const store = yield* EncryptionKeyStore;
        const key = yield* store.getKey(store.currentVersion);
        const iv = crypto.getRandomValues(new Uint8Array(B.ivLength));
        const ciphertext = yield* Effect.tryPromise({
            catch: () => new HttpError.Internal({ message: 'Encryption failed' }),
            try: () => crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, new TextEncoder().encode(plaintext))
                .then((buf) => new Uint8Array(buf)),
        });
        return new EncryptedKey({ ciphertext, iv, version: store.currentVersion });
    }).pipe(Effect.withSpan('crypto.encrypt'));
const validate = <T extends { readonly expiresAt?: Date | Option.Option<Date> }>(config: {
    readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<T>, InstanceType<typeof HttpError.Auth>>;
    readonly messages: { readonly notFound: string; readonly expired: string }; }) => (tokenHash: Hex64) =>
    config.lookup(tokenHash).pipe(
        Effect.andThen(Option.match({
            onNone: () => Effect.fail(new HttpError.Auth({ reason: config.messages.notFound })),
            onSome: Effect.succeed,
        })),
        Effect.filterOrFail(
            (result) => {
                const expiresAt = result.expiresAt instanceof Date
                    ? Option.some(result.expiresAt)
                    : (result.expiresAt ?? Option.none<Date>());
                const exp = Option.getOrUndefined(expiresAt);
                return exp === undefined || exp > new Date();
            },
            () => new HttpError.Auth({ reason: config.messages.expired }),
        ),
    );
const migrateEncrypted = (encryptedBytes: Uint8Array) =>
    Effect.gen(function* () {
        const store = yield* EncryptionKeyStore;
        const encrypted = yield* S.decodeUnknown(EncryptedKey.fromBytes)(encryptedBytes).pipe(Effect.mapError(() => new HttpError.Internal({ message: 'Invalid encrypted data format' })),);
        const needsMigration = encrypted.version !== store.currentVersion;
        return needsMigration
            ? yield* encrypted.decrypt().pipe(
                  Effect.flatMap((plaintext) =>
                      encrypt(plaintext).pipe(
                          Effect.map((newEncrypted) => ({
                              migrated: true as const,
                              newEncrypted: newEncrypted.toBytes(),
                              plaintext,
                          })),
                      ),
                  ),
              )
            : { migrated: false as const };
    }).pipe(Effect.withSpan('crypto.migrate'));

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Crypto = Object.freeze({
    Key: { encrypt, migrate: migrateEncrypted, Store: EncryptionKeyStore },
    Token: { generate: Uuidv7.generateSync, hash, Pair: TokenPair, validate },
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, EncryptedKey, EncryptionKeyStore, TokenPair };
