/**
 * Shared cryptographic utilities for token hashing and generation.
 * Eliminates duplication between middleware and route handlers.
 */
import type { Uuidv7 } from '@parametric-portal/types/database';
import { generateUuidv7Sync } from '@parametric-portal/types/types';
import { Effect } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TokenPair = {
    readonly hash: string;
    readonly token: Uuidv7;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hashString = (input: string): Effect.Effect<string, never> =>
    Effect.promise(async () => {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    });

const generateToken = (): Uuidv7 => generateUuidv7Sync();

const createTokenPair = (): Effect.Effect<TokenPair, never> =>
    Effect.gen(function* () {
        const token = generateToken();
        const hash = yield* hashString(token);
        return { hash, token };
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createTokenPair, generateToken, hashString };
export type { TokenPair };
