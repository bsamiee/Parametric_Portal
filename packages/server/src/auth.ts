/**
 * Configure auth runtime settings.
 * Server-only: cookies, CSRF, session durations, OAuth providers.
 */
import { Duration, Schedule } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _isSecure = (process.env['API_BASE_URL'] ?? '').startsWith('https://');
const _cookie = <N extends string, P extends string>(name: N, path: P, maxAge: number) =>
	({ maxAge, name, path, sameSite: 'lax' as const, secure: _isSecure }) as const;

const Auth = {
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

// --- [EXPORT] ----------------------------------------------------------------

export { Auth };
