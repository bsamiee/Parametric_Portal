/**
 * Shared cryptographic utilities for token hashing and generation.
 * Eliminates duplication between middleware and route handlers.
 */
import { type TokenHash, TokenHashSchema } from '@parametric-portal/types/database';
import { generateUuidv7Sync, type Uuidv7 } from '@parametric-portal/types/types';
import { Data, Effect, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TokenPair = {
    readonly hash: TokenHash;
    readonly token: Uuidv7;
};

class HashingError extends Data.TaggedError('HashingError')<{
    readonly cause: unknown;
}> {}

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
    Effect.gen(function* () {
        const token = generateToken();
        const hash = yield* hashString(token);
        return { hash, token };
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createTokenPair, generateToken, hashString, HashingError };
export type { TokenPair };
