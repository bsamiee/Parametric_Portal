/**
 * Unified cookie operations with schema validation at boundary.
 * Uses @effect/platform schemaCookies for typed access - eliminates manual parsing.
 * Encryption is domain concern (oauth.ts), not handled here.
 */
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Cookie, CookiesError } from '@effect/platform/Cookies';
import type { ParseError } from 'effect/ParseResult';
import { Duration, Effect, Option, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _isProduction = (process.env['API_BASE_URL'] ?? '').startsWith('https://');

const _config = {
	oauth: {
		name: 'oauthState',
		options: {
			httpOnly: true,
			maxAge: Duration.minutes(10),
			path: '/api/auth/oauth',
			sameSite: 'lax',
			secure: _isProduction,
		},
	},
	refresh: {
		name: 'refreshToken',
		options: {
			httpOnly: true,
			maxAge: Duration.days(30),
			path: '/api/auth',
			sameSite: 'lax',
			secure: _isProduction,
		},
	},
} as const satisfies Record<string, { readonly name: string; readonly options: Cookie['options'] }>;

// --- [SCHEMA] ----------------------------------------------------------------

const RefreshTokenSchema = S.Struct({ refreshToken: S.String });

const OAuthStateSchema = S.Struct({ oauthState: S.String });

const SessionTokenSchema = S.Struct({ sessionToken: S.optional(S.String) });

// --- [FUNCTIONS] -------------------------------------------------------------

/**
 * Read cookies with schema validation.
 * ParseError on invalid/missing required cookies - caller handles via catchTag.
 */
const read = <A, I extends Readonly<Record<string, string | undefined>>, R>(
	schema: S.Schema<A, I, R>,
): Effect.Effect<A, ParseError, HttpServerRequest.HttpServerRequest | R> =>
	HttpServerRequest.schemaCookies(schema);

/**
 * Read cookies optionally - returns Option.none() on parse failure.
 * Use for cookies that may not exist (first visit, cleared).
 */
const readOptional = <A, I extends Readonly<Record<string, string | undefined>>, R>(
	schema: S.Schema<A, I, R>,
): Effect.Effect<Option.Option<A>, never, HttpServerRequest.HttpServerRequest | R> =>
	HttpServerRequest.schemaCookies(schema).pipe(
		Effect.map((v) => Option.some(v)),
		Effect.catchTag('ParseError', () => Effect.succeed(Option.none())),
	);

/**
 * Set cookie with typed key.
 * CookiesError on invalid value - propagates to caller.
 */
const set = (
	key: Cookies.Key,
	value: string,
) => (res: HttpServerResponse.HttpServerResponse): Effect.Effect<HttpServerResponse.HttpServerResponse, CookiesError> =>
	HttpServerResponse.setCookie(res, _config[key].name, value, _config[key].options);

/**
 * Clear cookie by setting expired.
 * Pure function - no Effect needed.
 */
const clear = (
	key: Cookies.Key,
) => (res: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse =>
	HttpServerResponse.expireCookie(res, _config[key].name, _config[key].options);

// --- [ACCESSORS] -------------------------------------------------------------

/**
 * Pre-built accessor for refresh token cookie.
 * ParseError if cookie missing or invalid.
 */
const refreshToken: Effect.Effect<string, ParseError, HttpServerRequest.HttpServerRequest> =
	read(RefreshTokenSchema).pipe(Effect.map((c) => c.refreshToken));

/**
 * Pre-built accessor for OAuth state cookie.
 * ParseError if cookie missing or invalid.
 */
const oauthState: Effect.Effect<string, ParseError, HttpServerRequest.HttpServerRequest> =
	read(OAuthStateSchema).pipe(Effect.map((c) => c.oauthState));

/**
 * Pre-built optional accessor for session token cookie.
 * Returns Option.none() if cookie missing.
 */
const sessionToken: Effect.Effect<Option.Option<string>, never, HttpServerRequest.HttpServerRequest> =
	readOptional(SessionTokenSchema).pipe(
		Effect.map(Option.flatMap((c) => Option.fromNullable(c.sessionToken))),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Cookies = {
	clear,
	oauthState,
	read,
	readOptional,
	refreshToken,
	sessionToken,
	set,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Cookies {
	export type Key = keyof typeof _config;
	export type Options = Cookie['options'];
	export type RefreshToken = S.Schema.Type<typeof RefreshTokenSchema>;
	export type OAuthState = S.Schema.Type<typeof OAuthStateSchema>;
	export type SessionToken = S.Schema.Type<typeof SessionTokenSchema>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Cookies };
