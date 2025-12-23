/**
 * Shared cryptographic utilities for token hashing and generation.
 * Eliminates duplication between middleware and route handlers.
 */
import { Expiry, type TokenHash, TokenHashSchema } from '@parametric-portal/types/database';
import { generateUuidv7Sync, type Uuidv7 } from '@parametric-portal/types/types';
import { Config, Effect, Option, pipe, Redacted, Schema as S } from 'effect';
import { EncryptionError, HashingError, UnauthorizedError } from './errors.ts';

// --- [TYPES] -----------------------------------------------------------------

type TokenPair = {
    readonly hash: TokenHash;
    readonly token: Uuidv7;
};
type EncryptedKey = {
    readonly ciphertext: Uint8Array;
    readonly iv: Uint8Array;
};
type TokenValidationMessages = {
    readonly hashingFailed: string;
    readonly notFound: string;
    readonly expired: string;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hashString = (input: string): Effect.Effect<TokenHash, HashingError> =>
    Effect.tryPromise({
        catch: (cause) => new HashingError({ cause }),
        try: async () => {
            const encoder = new TextEncoder();
            const data = encoder.encode(input);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hex = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
            return S.decodeSync(TokenHashSchema)(hex);
        },
    });
const generateToken = (): Uuidv7 => generateUuidv7Sync();
const createTokenPair = (): Effect.Effect<TokenPair, HashingError> =>
    pipe(
        Effect.sync(generateToken),
        Effect.flatMap((token) =>
            pipe(
                hashString(token),
                Effect.map((hash) => ({ hash, token })),
            ),
        ),
    );

const validateTokenHash =
    <T extends { readonly expiresAt?: Date | Option.Option<Date> }>(
        lookup: (hash: TokenHash) => Effect.Effect<Option.Option<T>, UnauthorizedError>,
        messages: TokenValidationMessages,
    ) =>
    (hash: TokenHash): Effect.Effect<T, UnauthorizedError> =>
        pipe(
            lookup(hash),
            Effect.flatMap(
                Option.match({
                    onNone: () => Effect.fail(new UnauthorizedError({ reason: messages.notFound })),
                    onSome: (result) =>
                        pipe(
                            result.expiresAt instanceof Date
                                ? Option.some(result.expiresAt)
                                : (result.expiresAt ?? Option.none<Date>()),
                            Option.getOrUndefined,
                            Expiry.check,
                            ({ expired }) =>
                                expired
                                    ? Effect.fail(new UnauthorizedError({ reason: messages.expired }))
                                    : Effect.succeed(result),
                        ),
                }),
            ),
        );

const importEncryptionKey = pipe(
    Config.redacted('ENCRYPTION_KEY'),
    Effect.mapError((cause) => new EncryptionError({ cause })),
    Effect.flatMap((keyBase64Redacted) =>
        Effect.tryPromise({
            catch: (cause) => new EncryptionError({ cause }),
            try: async () => {
                const keyBase64 = Redacted.value(keyBase64Redacted);
                const keyBytes = Buffer.from(keyBase64, 'base64');
                return crypto.subtle.importKey('raw', keyBytes, { length: 256, name: 'AES-GCM' }, false, [
                    'encrypt',
                    'decrypt',
                ]);
            },
        }),
    ),
    Effect.cached,
);

const getEncryptionKey = (): Effect.Effect<CryptoKey, EncryptionError> =>
    Effect.flatMap(importEncryptionKey, (cached) => cached);

const encryptApiKey = (plaintext: string): Effect.Effect<EncryptedKey, EncryptionError> =>
    pipe(
        getEncryptionKey(),
        Effect.flatMap((key) =>
            Effect.tryPromise({
                catch: (cause) => new EncryptionError({ cause }),
                try: async () => {
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const encoded = new TextEncoder().encode(plaintext);
                    const ciphertext = new Uint8Array(
                        await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, encoded),
                    );
                    return { ciphertext, iv };
                },
            }),
        ),
    );

const decryptApiKey = (encrypted: EncryptedKey): Effect.Effect<string, EncryptionError> =>
    pipe(
        getEncryptionKey(),
        Effect.flatMap((key) =>
            Effect.tryPromise({
                catch: (cause) => new EncryptionError({ cause }),
                try: async () => {
                    const decrypted = await crypto.subtle.decrypt(
                        { iv: encrypted.iv.buffer as ArrayBuffer, name: 'AES-GCM' },
                        key,
                        encrypted.ciphertext.buffer as ArrayBuffer,
                    );
                    return new TextDecoder().decode(decrypted);
                },
            }),
        ),
    );
const decryptFromBytes = (keyEncrypted: Uint8Array): Effect.Effect<string, EncryptionError> =>
    decryptApiKey({ ciphertext: keyEncrypted.slice(12), iv: keyEncrypted.slice(0, 12) });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Token = Object.freeze({
    createPair: createTokenPair,
    generate: generateToken,
    hash: hashString,
    validate: validateTokenHash,
});
const Crypto = Object.freeze({
    decrypt: decryptApiKey,
    decryptFromBytes,
    encrypt: encryptApiKey,
});

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto, createTokenPair, decryptApiKey, encryptApiKey, generateToken, hashString, Token, validateTokenHash };
export type { EncryptedKey, TokenPair, TokenValidationMessages };
