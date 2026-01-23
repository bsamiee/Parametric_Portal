/**
 * Authentication context tags for session and OAuth state.
 */
import { Duration, Effect, type Option, Schedule, Schema as S } from 'effect';
import type { HttpError } from './errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _isSecure = (process.env['API_BASE_URL'] ?? '').startsWith('https://');
const _cookie = <N extends string, P extends string>(name: N, path: P, maxAge: number) =>
	({ maxAge, name, path, sameSite: 'lax' as const, secure: _isSecure }) as const;


const OAuthProvider = { apple: 'apple', github: 'github', google: 'google', microsoft: 'microsoft' } as const;	/** External identity providers for OAuth flows */
const UserRole = Object.assign(																					/** User permission levels - order defines hierarchy (higher = more permissions) */
	S.Literal('admin', 'guest', 'member', 'owner', 'viewer'),
	{ order: { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 } as const },
);
const UserState = S.Literal('active', 'pending', 'suspended');													/** User account lifecycle states */

// --- [TAGS] ------------------------------------------------------------------

class Session extends Effect.Tag('server/Session')<Session, {	/** Authenticated session state provided by SessionAuth middleware. */
	readonly id: string;
	readonly mfaEnabled: boolean;
	readonly userId: string;
	readonly verifiedAt: Option.Option<Date>;
}>() {
	static readonly config = {
		cookie: {
			oauth: _cookie('oauthState', '/api/auth/oauth', 600),
			refresh: _cookie('refreshToken', '/api/auth', 2592000),
		},
		csrf: {
			expectedValue: 'XMLHttpRequest',
			header: 'x-requested-with'
		},
		durations: {
			pkce: Duration.minutes(10),
			refresh: Duration.days(30),
			session: Duration.days(7),
		},
		endpoints: {
			githubApi: 'https://api.github.com/user'
		},
		oauth: {
			retry: Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
			scopes: {
				github: ['user:email'],
				oidc: ['openid', 'profile', 'email']
			},
			timeout: Duration.seconds(10),
		},
	} as const;
}
class OAuth extends Effect.Tag('server/OAuth')<OAuth, {			/** OAuth provider abstraction for authorization flows. */
	readonly authenticate: (provider: typeof OAuthProvider[keyof typeof OAuthProvider], code: string, state: string, stateCookie: string) => Effect.Effect<{
		readonly access: string;
		readonly email: Option.Option<string>;
		readonly expiresAt: Option.Option<Date>;
		readonly externalId: string;
		readonly refresh: Option.Option<string>;
	}, HttpError.OAuth>;
	readonly createAuthorizationUrl: (provider: typeof OAuthProvider[keyof typeof OAuthProvider]) => Effect.Effect<{
		readonly stateCookie: string;
		readonly url: URL;
	}, HttpError.OAuth>;
}>() {}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Context = {
	OAuth,
	OAuthProvider,
	Session,
	UserRole,
	UserState,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Context {
	export type OAuth = typeof OAuth.Service;
	export type OAuthProvider = typeof OAuthProvider[keyof typeof OAuthProvider];
	export type UserRole = typeof UserRole.Type;
	export type Session = typeof Session.Service;
	export type UserState = typeof UserState.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Context };
