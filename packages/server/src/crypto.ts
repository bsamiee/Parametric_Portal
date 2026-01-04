/**
 * Cryptographic utilities: hashing, encryption, token generation/validation.
 * Effect.fn for tracing, Schema.Class for domain models, Layer.effect for services.
 */
import { Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Config, Context, Duration, Effect, Layer, Metric, Option, ParseResult, Redacted, Schema as S } from 'effect';
import { HttpError } from './http-errors.ts';
import { cryptoOpDuration } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type TokenValidation<T> = {
    readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<T>, InstanceType<typeof HttpError.Auth>>;
    readonly messages: { readonly notFound: string; readonly expired: string };
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    ivLength: 12,
    keyAlgorithm: { length: 256, name: 'AES-GCM' },
    minEncryptedLength: 13,
} as const);

// --- [CLASSES] ---------------------------------------------------------------

class TokenPair extends S.Class<TokenPair>('TokenPair')({
    hash: Hex64.schema,
    token: Uuidv7.schema,
}) {
    static readonly create = Effect.gen(function* () {
        const token = Uuidv7.generateSync();
        const hashBuffer = yield* Effect.tryPromise({
            catch: (_cause) => new HttpError.Internal({ message: 'Hashing failed' }),
            try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
        });
        return new TokenPair({ hash: Hex64.fromBytes(new Uint8Array(hashBuffer)), token });
    });
}
class EncryptedKey extends S.Class<EncryptedKey>('EncryptedKey')({
    ciphertext: S.Uint8ArrayFromSelf,
    iv: S.Uint8ArrayFromSelf.pipe(
        S.filter((arr) => arr.length === B.ivLength, { message: () => `IV must be ${B.ivLength} bytes` }),
    ),
}) {
    /** Decode Uint8Array (iv || ciphertext) ↔ EncryptedKey. Encode receives struct shape, not instance. */
    static readonly fromBytes = S.transformOrFail(S.Uint8ArrayFromSelf, EncryptedKey, {
        decode: (bytes) =>
            bytes.length < B.minEncryptedLength
                ? ParseResult.fail(
                      new ParseResult.Type(
                          S.Uint8ArrayFromSelf.ast,
                          bytes,
                          `Expected at least ${B.minEncryptedLength} bytes`,
                      ),
                  )
                : ParseResult.succeed(
                      new EncryptedKey({ ciphertext: bytes.slice(B.ivLength), iv: bytes.slice(0, B.ivLength) }),
                  ),
        encode: ({ ciphertext, iv }) => ParseResult.succeed(new Uint8Array([...iv, ...ciphertext])),
        strict: true,
    });
    /** Static: decrypt from raw bytes (parses then decrypts). */
    static readonly decryptBytes = Effect.fn('crypto.decrypt.bytes')((bytes: Uint8Array) =>
        Effect.gen(function* () {
            const encrypted = yield* S.decodeUnknown(EncryptedKey.fromBytes)(bytes);
            return yield* encrypted.decrypt();
        }),
    );
    /** Instance: decrypt this encrypted key (requires EncryptionKeyService in context). */
    decrypt(): Effect.Effect<string, InstanceType<typeof HttpError.Internal>, EncryptionKeyService> {
        const { iv, ciphertext } = this;
        return Effect.fn('crypto.decrypt')(() =>
            Effect.gen(function* () {
                const key = yield* EncryptionKeyService;
                return yield* Effect.tryPromise({
                    catch: (_cause) => new HttpError.Internal({ message: 'Encryption failed' }),
                    try: () => crypto.subtle.decrypt({ iv: iv.slice(), name: 'AES-GCM' }, key, ciphertext.slice()),
                }).pipe(Effect.map((buf) => new TextDecoder().decode(buf)));
            }),
        )();
    }
    /** Serialize to bytes (iv || ciphertext) for storage/transmission. */
    toBytes(): Uint8Array {
        return new Uint8Array([...this.iv, ...this.ciphertext]);
    }
}
class EncryptionKeyService extends Context.Tag('crypto/EncryptionKey')<EncryptionKeyService, CryptoKey>() {
    /** Layer fails as defect if ENCRYPTION_KEY missing/invalid - this is a startup configuration error, not runtime. */
    static readonly layer = Layer.effect(
        this,
        Effect.gen(function* () {
            const redacted = yield* Config.redacted('ENCRYPTION_KEY');
            return yield* Effect.tryPromise({
                catch: (cause) => cause,
                try: () =>
                    crypto.subtle.importKey(
                        'raw',
                        Hex64.fromBase64(Redacted.value(redacted)).slice(),
                        B.keyAlgorithm,
                        false,
                        ['encrypt', 'decrypt'],
                    ),
            });
        }).pipe(Effect.orDie),
    );
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const recordCryptoMetric = (operation: string, duration: Duration.Duration) =>
    Metric.update(cryptoOpDuration.pipe(Metric.tagged('operation', operation)), Duration.toSeconds(duration));
const hash = Effect.fn('crypto.hash')((input: string) =>
    Effect.tryPromise({
        catch: (_cause) => new HttpError.Internal({ message: 'Hashing failed' }),
        try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
    }).pipe(
        Effect.timed,
        Effect.tap(([duration]) => recordCryptoMetric('hash', duration)),
        Effect.map(([_, buf]) => Hex64.fromBytes(new Uint8Array(buf))),
    ),
);
const encrypt = Effect.fn('crypto.encrypt')(function* (plaintext: string) {
    const key = yield* EncryptionKeyService;
    const iv = crypto.getRandomValues(new Uint8Array(B.ivLength));
    const [duration, ciphertext] = yield* Effect.tryPromise({
        catch: (_cause) => new HttpError.Internal({ message: 'Encryption failed' }),
        try: () =>
            crypto.subtle
                .encrypt({ iv, name: 'AES-GCM' }, key, new TextEncoder().encode(plaintext))
                .then((buf) => new Uint8Array(buf)),
    }).pipe(Effect.timed);
    yield* recordCryptoMetric('encrypt', duration);
    return new EncryptedKey({ ciphertext, iv });
});
const validate =
    <T extends { readonly expiresAt?: Date | Option.Option<Date> }>({ lookup, messages }: TokenValidation<T>) =>
    (tokenHash: Hex64) =>
        lookup(tokenHash).pipe(
            Effect.flatMap(
                Option.match({
                    onNone: () => Effect.fail(new HttpError.Auth({ reason: messages.notFound })),
                    onSome: Effect.succeed,
                }),
            ),
            Effect.filterOrFail(
                (result) => {
                    const expiresAt =
                        result.expiresAt instanceof Date
                            ? Option.some(result.expiresAt)
                            : (result.expiresAt ?? Option.none<Date>());
                    const exp = Option.getOrUndefined(expiresAt);
                    return exp === undefined || exp > new Date();
                },
                () => new HttpError.Auth({ reason: messages.expired }),
            ),
        );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Crypto = Object.freeze({
    Key: { encrypt, Service: EncryptionKeyService },
    Token: { generate: Uuidv7.generateSync, hash, Pair: TokenPair, validate },
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, EncryptedKey, EncryptionKeyService, TokenPair };
export type { TokenValidation };
