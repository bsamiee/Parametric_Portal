/**
 * Centralized error messages for auth flows and API operations.
 * Single source of truth for all error reason strings across apps/api.
 */

// --- [TYPES] -----------------------------------------------------------------

type OAuthMessageKey = keyof typeof B.oauth;
type AuthMessageKey = keyof typeof B.auth;
type UserMessageKey = keyof typeof B.user;
type ApiKeyMessageKey = keyof typeof B.apiKey;
type MessageDomain = 'oauth' | 'auth' | 'user' | 'apiKey';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    apiKey: {
        deletionFailed: 'API key deletion failed',
        encryptionFailed: 'API key encryption failed',
        hashingFailed: 'API key hashing failed',
        insertFailed: 'API key insert failed',
        listFailed: 'API key list failed',
    },
    auth: {
        invalidRefreshToken: 'Invalid refresh token',
        invalidTokenIdFormat: 'Invalid token ID format',
        missingRefreshCookie: 'Missing refresh token cookie',
        refreshTokenInsertFailed: 'Refresh token insert failed',
        refreshTokenRevocationFailed: 'Refresh token revocation failed',
        responseBuildFailed: 'Response build failed',
        sessionInsertFailed: 'Session insert failed',
        sessionRevocationFailed: 'Session revocation failed',
        tokenGenerationFailed: 'Token generation failed',
        tokenHashingFailed: 'Token hashing failed',
        tokenLookupFailed: 'Token lookup failed',
        tokenRevocationFailed: 'Token revocation failed',
    },
    oauth: {
        accountUpsertFailed: 'OAuth account upsert failed',
        emailNotProvided: 'Email not provided',
        invalidEmailFormat: 'Invalid email format from provider',
        invalidUserIdFormat: 'Invalid user ID format',
        refreshTokenInsertFailed: 'Refresh token insert failed',
        responseBuildFailed: 'Response build failed',
        sessionInsertFailed: 'Session insert failed',
        tokenGenerationFailed: 'Token generation failed',
        userInsertFailed: 'User insert failed',
        userLookupFailed: 'User lookup failed',
    },
    user: {
        invalidUserIdFormat: 'Invalid user ID format',
        lookupFailed: 'User lookup failed',
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const messages = {
    apiKey: (key: ApiKeyMessageKey): string => B.apiKey[key],
    auth: (key: AuthMessageKey): string => B.auth[key],
    oauth: (key: OAuthMessageKey): string => B.oauth[key],
    user: (key: UserMessageKey): string => B.user[key],
} as const satisfies Record<MessageDomain, (key: never) => string>;

// --- [EXPORT] ----------------------------------------------------------------

export { B as AUTH_MESSAGES, messages };
export type { ApiKeyMessageKey, AuthMessageKey, MessageDomain, OAuthMessageKey, UserMessageKey };
