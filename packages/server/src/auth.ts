/**
 * Auth domain: Session context, OAuth result, API response schemas.
 * Uses S.Class for types with behavior, S.Struct for pure data shapes.
 */
import { SessionId, UserId } from '@parametric-portal/types/schema';
import { DurationMs, Url } from '@parametric-portal/types/types';
import { Duration, Option, Schema as S, Schedule } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

// Derive secure flag from API_BASE_URL - only true for HTTPS (prevents HTTP cookie issues)
const isSecureContext = (process.env['API_BASE_URL'] ?? '').startsWith('https://');
const B = Object.freeze({
    cookie: { maxAge: 2592000, name: 'refreshToken', path: '/api/auth', secure: isSecureContext },
    durations: {
        pkce: DurationMs.fromSeconds(600),
        refreshToken: Duration.days(30),
        refreshTokenMs: DurationMs.fromSeconds(30 * 24 * 60 * 60),
        session: Duration.days(7),
        sessionMs: DurationMs.fromSeconds(7 * 24 * 60 * 60),
    },
    endpoints: { githubApi: 'https://api.github.com/user' },
    oauth: {
        retry: Schedule.exponential(Duration.millis(100)).pipe(
            Schedule.jittered,
            Schedule.intersect(Schedule.recurs(3)),
        ),
        scopes: { github: ['user:email'], oidc: ['openid', 'profile', 'email'] },
        stateCookie: { maxAge: 600, name: 'oauthState', path: '/api/auth/oauth', secure: isSecureContext },
        timeout: Duration.seconds(10),
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const ApiResponse = <A, I, R>(data: S.Schema<A, I, R>) => S.Struct({ data, success: S.Literal(true) });
const OAuthProviderConfig = S.Struct({
    clientId: S.NonEmptyTrimmedString,
    clientSecret: S.Redacted(S.String),
    redirectUri: Url.schema,
    scopes: S.Array(S.String),
});

// --- [CLASSES] ---------------------------------------------------------------

class AuthContext extends S.Class<AuthContext>('AuthContext')({ sessionId: SessionId.schema, userId: UserId.schema }) {
    static readonly Tokens = S.Struct({ accessToken: S.String, expiresAt: S.DateTimeUtc });
    static readonly fromSession = (s: { readonly id: SessionId; readonly userId: UserId }) =>
        new AuthContext({ sessionId: s.id, userId: s.userId });
}
class OAuthResult extends S.Class<OAuthResult>('OAuthResult')({
    accessToken: S.String,
    email: S.OptionFromSelf(S.String),
    expiresAt: S.OptionFromSelf(S.DateFromSelf),
    providerAccountId: S.String,
    refreshToken: S.OptionFromSelf(S.String),
}) {
    get toNullableFields() {
        return {
            accessToken: this.accessToken,
            expiresAt: Option.getOrNull(this.expiresAt),
            providerAccountId: this.providerAccountId,
            refreshToken: Option.getOrNull(this.refreshToken),
        };
    }
    static readonly fromProvider = (
        tokens: {
            readonly accessToken: string;
            readonly expiresAt?: Date | undefined;
            readonly refreshToken?: string | undefined;
        },
        user: { readonly providerAccountId: string; readonly email?: string | null | undefined },
    ) =>
        new OAuthResult({
            accessToken: tokens.accessToken,
            email: Option.fromNullable(user.email),
            expiresAt: Option.fromNullable(tokens.expiresAt),
            providerAccountId: user.providerAccountId,
            refreshToken: Option.fromNullable(tokens.refreshToken),
        });
}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiResponse, B as AUTH_TUNING, AuthContext, OAuthProviderConfig, OAuthResult };
