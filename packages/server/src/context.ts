/**
 * Unified request context: tenant isolation, session state, rate limiting, circuit breaker.
 * Single FiberRef + Effect.Tag replaces scattered context mechanisms.
 */
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import type { CircuitState } from 'cockatiel';
import type { Duration } from 'effect';
import { Effect, FiberRef, Layer, Option, Schedule, Schema as S } from 'effect';
import * as D from 'effect/Duration';

// --- [CONSTANTS] -------------------------------------------------------------

const _Id = { default: '00000000-0000-7000-8000-000000000001', system: '00000000-0000-7000-8000-000000000000' } as const;
const _isSecure = (process.env['API_BASE_URL'] ?? '').startsWith('https://');
const _cookie = <N extends string, P extends string>(name: N, path: P, maxAge: Duration.DurationInput) =>
	({ httpOnly: true, maxAge, name, path, sameSite: 'lax' as const, secure: _isSecure }) as const;
const _default: Context.Request.Data = {
	circuit: Option.none(),
	ipAddress: Option.none(),
	rateLimit: Option.none(),
	requestId: crypto.randomUUID(),
	session: Option.none(),
	tenantId: _Id.default,
	userAgent: Option.none(),
};
const _ref = FiberRef.unsafeMake<Context.Request.Data>(_default);

// --- [SCHEMA] ----------------------------------------------------------------

const OAuthProvider = S.Literal('apple', 'github', 'google', 'microsoft');
type _UserRoleValue = 'guest' | 'viewer' | 'member' | 'admin' | 'owner';
const _roleOrder: Record<_UserRoleValue, number> = { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 };
const UserRole = {
	hasAtLeast: (role: string, min: _UserRoleValue): boolean => role in _roleOrder && _roleOrder[role as _UserRoleValue] >= _roleOrder[min],
	Order: _roleOrder,
	schema: S.Literal('guest', 'viewer', 'member', 'admin', 'owner'),
} as const;

// --- [REQUEST] ---------------------------------------------------------------

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
	static readonly Id = _Id;
	static readonly current = FiberRef.get(_ref);
	static override readonly tenantId = FiberRef.get(_ref).pipe(Effect.map((ctx) => ctx.tenantId));
	static override readonly session = FiberRef.get(_ref).pipe(Effect.flatMap((ctx) => Option.match(ctx.session, { onNone: () => Effect.die('No session - route must be protected by SessionAuth middleware'), onSome: Effect.succeed })));
	static readonly update = (partial: Partial<Context.Request.Data>) => FiberRef.update(_ref, (ctx) => ({ ...ctx, ...partial }));
	static readonly locally = <A, E, R>(partial: Partial<Context.Request.Data>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		FiberRef.get(_ref).pipe(Effect.flatMap((ctx) => Effect.locally(effect, _ref, { ...ctx, ...partial })));
	static readonly within = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E, R> =>
		FiberRef.get(_ref).pipe(Effect.flatMap((current) => Effect.locally(effect, _ref, { ...current, ...ctx, tenantId: tenantId === _Id.system ? _Id.system : tenantId })));
	static readonly withinSync = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> =>
		Effect.gen(function* () {
			const id = tenantId === _Id.system ? _Id.system : tenantId;
			const sql = yield* SqlClient.SqlClient;
			const current = yield* FiberRef.get(_ref);
			const merged = { ...current, ...ctx, tenantId: id };
			return yield* sql.withTransaction(sql`SELECT set_config('app.current_tenant', ${id}, true)`.pipe(Effect.andThen(Effect.locally(effect, _ref, merged))));
		});
	static readonly system = (requestId = crypto.randomUUID()): Context.Request.Data => ({
		circuit: Option.none(),
		ipAddress: Option.none(),
		rateLimit: Option.none(),
		requestId,
		session: Option.none(),
		tenantId: _Id.system,
		userAgent: Option.none(),
	});
	static readonly SystemLayer = Layer.succeed(Request, Request.system());
	static readonly config = {
		cookie: {
			oauth: _cookie('oauthState', '/api/auth/oauth', D.minutes(10)),
			refresh: _cookie('refreshToken', '/api/auth', D.days(30)),
		},
		csrf: { expectedValue: 'XMLHttpRequest', header: 'x-requested-with' },
		durations: { pkce: D.minutes(10), refresh: D.days(30), session: D.days(7) },
		endpoints: { githubApi: 'https://api.github.com/user' },
		oauth: {
			capabilities: {
				apple: { oidc: true, pkce: true },
				github: { oidc: false, pkce: false },
				google: { oidc: true, pkce: true },
				microsoft: { oidc: true, pkce: true },
			} as const satisfies Record<S.Schema.Type<typeof OAuthProvider>, { oidc: boolean; pkce: boolean }>,
			retry: Schedule.exponential(D.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
			scopes: { github: ['user:email'], oidc: ['openid', 'profile', 'email'] },
			timeout: D.seconds(10),
		},
	} as const;
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Context = { OAuthProvider, Request, UserRole } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Context {
	export type OAuthProvider = S.Schema.Type<typeof OAuthProvider>;
	export type UserRole = S.Schema.Type<typeof UserRole.schema>;
	export namespace Request {
		export type Id = (typeof Request.Id)[keyof typeof Request.Id];
		export interface Session {
			readonly id: string;
			readonly mfaEnabled: boolean;
			readonly userId: string;
			readonly verifiedAt: Option.Option<Date>;
		}
		export interface RateLimit {
			readonly delay: Duration.Duration;
			readonly limit: number;
			readonly remaining: number;
			readonly resetAfter: Duration.Duration;
		}
		export interface Circuit {
			readonly name: string;
			readonly state: CircuitState;
		}
		export interface Data {
			readonly circuit: Option.Option<Circuit>;
			readonly ipAddress: Option.Option<string>;
			readonly rateLimit: Option.Option<RateLimit>;
			readonly requestId: string;
			readonly session: Option.Option<Session>;
			readonly tenantId: string;
			readonly userAgent: Option.Option<string>;
		}
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { Context };
