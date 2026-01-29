/**
 * Unified request context: tenant isolation, session state, rate limiting, circuit breaker.
 * Single FiberRef + Effect.Tag replaces scattered context mechanisms.
 *
 * Cookie handling: minimal typed wrapper over @effect/platform HttpServerResponse.
 * - 3 operations: get (read), set (write), clear (delete)
 * - Type-safe keys via CookieKey union
 * - Encryption handled at domain layer (oauth.ts), not here
 */
import type { ShardId, Snowflake } from '@effect/cluster';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Cookie, CookiesError } from '@effect/platform/Cookies';
import { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { Data, Effect, FiberId, FiberRef, type Duration, Layer, Option, Order, pipe, Record, Schedule, Schema as S } from 'effect';
import * as D from 'effect/Duration';
import { constant, dual } from 'effect/Function';

// --- [CONSTANTS] -------------------------------------------------------------

const _Id = { default: '00000000-0000-7000-8000-000000000001', job: '00000000-0000-7000-8000-000000000002', system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff' } as const;
const _clusterDefault: Context.Request.ClusterState = { entityId: null, entityType: null, isLeader: false, runnerId: null, shardId: null };
const _ref = FiberRef.unsafeMake<Context.Request.Data>({
	circuit: Option.none(),
	cluster: Option.none(),
	ipAddress: Option.none(),
	rateLimit: Option.none(),
	requestId: crypto.randomUUID(),
	session: Option.none(),
	tenantId: _Id.default,
	userAgent: Option.none(),
});

// --- [SCHEMA] ----------------------------------------------------------------

const OAuthProvider = S.Literal('apple', 'github', 'google', 'microsoft');
const UserRole = (() => {	// UserRole: IIFE encapsulates rank/order internals
	const schema = S.Literal('guest', 'viewer', 'member', 'admin', 'owner');
	type Value = S.Schema.Type<typeof schema>;
	const rank: Record<Value, number> = { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 };
	const order = Order.mapInput(Order.number, (role: Value) => rank[role]);
	return {
		hasAtLeast: (role: string, min: Value): boolean => role in rank && Order.greaterThanOrEqualTo(order)(role as Value, min),
		Order: order,
		schema,
	} as const;
})();
// Branded types for serialization boundaries
const RunnerId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('RunnerId'));
const ShardIdString = S.String.pipe(S.pattern(/^[a-zA-Z0-9_-]+:\d+$/), S.brand('ShardIdString'));

// --- [ERRORS] ----------------------------------------------------------------

class ClusterContextRequired extends Data.TaggedError('ClusterContextRequired')<{readonly operation: string;}> {} // Cluster context required but not available - use when accessing cluster state outside cluster scope

// --- [SERIALIZABLE] ----------------------------------------------------------

class Serializable extends S.Class<Serializable>('server/Context.Serializable')({	// Schema-backed serializable context for distributed tracing propagation.
	ipAddress: S.optional(S.String),
	requestId: S.String,
	// Cluster fields for cross-pod trace correlation (S.optional = backward compatible)
	runnerId: S.optional(RunnerId),
	sessionId: S.optional(S.String),
	shardId: S.optional(ShardIdString),
	tenantId: S.String,
	userId: S.optional(S.String),
}) {
	private static readonly makeShardIdString = (shardId: ShardId.ShardId): typeof ShardIdString.Type => S.decodeSync(ShardIdString)(shardId.toString());
	static readonly fromData = (ctx: Context.Request.Data): Serializable =>
		new Serializable({
			ipAddress: Option.getOrUndefined(ctx.ipAddress),
			requestId: ctx.requestId,
			tenantId: ctx.tenantId,
			...Option.match(ctx.session, { onNone: constant({}), onSome: (s) => ({ sessionId: s.id, userId: s.userId }) }),
			...Option.match(ctx.cluster, {	// Cluster fields: null → undefined for S.optional, ShardId → branded string
				onNone: constant({}),
				onSome: (c) => ({ runnerId: c.runnerId ?? undefined, shardId: c.shardId ? Serializable.makeShardIdString(c.shardId) : undefined }),
			}),
		});
}

// --- [REQUEST] ---------------------------------------------------------------

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
	static readonly Id = _Id;
	static readonly current = FiberRef.get(_ref);
	static override readonly tenantId = Request.current.pipe(Effect.map((ctx) => ctx.tenantId));
	static override readonly session = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.session, { onNone: () => Effect.die('No session - route must be protected by SessionAuth middleware'), onSome: Effect.succeed })));
	static readonly update = (partial: Partial<Context.Request.Data>) => FiberRef.update(_ref, (ctx) => ({ ...ctx, ...partial }));
	static readonly locally = <A, E, R>(partial: Partial<Context.Request.Data>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.locallyWith(effect, _ref, (ctx) => ({ ...ctx, ...partial }));
	static readonly within = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E, R> => Effect.locallyWith(effect, _ref, (current) => ({ ...current, ...ctx, tenantId }));
	static readonly withinSync = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> =>SqlClient.SqlClient.pipe(Effect.flatMap((sql) => sql.withTransaction(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.pipe(Effect.andThen(Effect.locallyWith(effect, _ref, (current) => ({ ...current, ...ctx, tenantId })))))),);
	static readonly system = (requestId = crypto.randomUUID()): Context.Request.Data => ({
		circuit: Option.none(),
		cluster: Option.none(),
		ipAddress: Option.none(),
		rateLimit: Option.none(),
		requestId,
		session: Option.none(),
		tenantId: _Id.system,
		userAgent: Option.none(),
	});
	static readonly SystemLayer = Layer.succeed(Request, Request.system());
	static readonly cookie = (() => {	// Cookie: IIFE encapsulates secure flag and config
		const secure = (process.env['API_BASE_URL'] ?? '').startsWith('https://');
		const cfg = {
			oauth: { name: 'oauthState', options: { httpOnly: true, maxAge: D.minutes(10), path: '/api/auth/oauth', sameSite: 'lax', secure } },
			refresh: { name: 'refreshToken', options: { httpOnly: true, maxAge: D.days(30), path: '/api/auth', sameSite: 'lax', secure } },
		} as const satisfies Record<string, { readonly name: string; readonly options: Cookie['options'] }>;
		return {
			clear: (key: keyof typeof cfg) => (res: HttpServerResponse.HttpServerResponse) => HttpServerResponse.expireCookie(res, cfg[key].name, cfg[key].options),
			get: <E>(key: keyof typeof cfg, req: HttpServerRequest.HttpServerRequest, onNone: () => E): Effect.Effect<string, E> => Effect.fromNullable(req.cookies[cfg[key].name]).pipe(Effect.mapError(onNone)),
			keys: Object.keys(cfg) as ReadonlyArray<keyof typeof cfg>,
			read: <A, I extends Readonly<Record<string, string | undefined>>, R>(schema: S.Schema<A, I, R>) => HttpServerRequest.schemaCookies(schema),
			set: (key: keyof typeof cfg, value: string) => (res: HttpServerResponse.HttpServerResponse): Effect.Effect<HttpServerResponse.HttpServerResponse, CookiesError> => HttpServerResponse.setCookie(res, cfg[key].name, value, cfg[key].options),
		} as const;
	})();
	static readonly toSerializable = Request.current.pipe(Effect.map(Serializable.fromData));
	static readonly clusterState = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.cluster, { onNone: () => Effect.fail(new ClusterContextRequired({ operation: 'cluster' })), onSome: Effect.succeed })),);
	static readonly shardId = Request.current.pipe(Effect.map((ctx) => Option.flatMapNullable(ctx.cluster, (c) => c.shardId)));
	static readonly runnerId = Request.current.pipe(Effect.map((ctx) => Option.flatMapNullable(ctx.cluster, (c) => c.runnerId)));
	static readonly isLeader = Request.current.pipe(Effect.map((ctx) => Option.exists(ctx.cluster, (c) => c.isLeader)));
	static readonly makeRunnerId = (snowflake: Snowflake.Snowflake): typeof RunnerId.Type => S.decodeSync(RunnerId)(String(snowflake));
	static readonly withinCluster: {
		<A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>): Effect.Effect<A, E, R>;
		(partial: Partial<Context.Request.ClusterState>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	} = dual(2, <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>) =>
		Effect.locallyWith(effect, _ref, (ctx) => ({
			...ctx,
			cluster: Option.some({ ...Option.getOrElse(ctx.cluster, constant(_clusterDefault)), ...partial }),
		})),
	);
	static readonly toAttrs = (ctx: Context.Request.Data, fiberId: FiberId.FiberId): Record.ReadonlyRecord<string, string> =>	// Observability attributes for tracing spans. Includes all context fields formatted for OTEL.
		Record.getSomes({
			'circuit.name': Option.map(ctx.circuit, (c) => c.name),
			'circuit.state': Option.map(ctx.circuit, (c) => c.state),
			'client.ip': ctx.ipAddress,
			'client.ua': Option.map(ctx.userAgent, (ua) => (ua.length > 120 ? `${ua.slice(0, 117)}...` : ua)),
			'cluster.entity_id': Option.flatMapNullable(ctx.cluster, (c) => c.entityId),
			'cluster.entity_type': Option.flatMapNullable(ctx.cluster, (c) => c.entityType),
			'cluster.is_leader': Option.map(ctx.cluster, (c) => String(c.isLeader)),
			'cluster.runner_id': Option.flatMapNullable(ctx.cluster, (c) => c.runnerId),
			'cluster.shard_id': pipe(ctx.cluster, Option.flatMapNullable((c) => c.shardId), Option.map((s) => s.toString())),
			'fiber.id': Option.some(FiberId.threadName(fiberId)),
			'ratelimit.limit': Option.map(ctx.rateLimit, (rl) => String(rl.limit)),
			'ratelimit.remaining': Option.map(ctx.rateLimit, (rl) => String(rl.remaining)),
			'request.id': Option.some(ctx.requestId),
			'session.id': Option.map(ctx.session, (s) => s.id),
			'session.mfa': Option.map(ctx.session, (s) => String(s.mfaEnabled)),
			'tenant.id': Option.some(ctx.tenantId),
			'user.id': Option.map(ctx.session, (s) => s.userId),
		});
	static readonly config = {
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
const Context = { OAuthProvider, Request, Serializable, UserRole } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Context {
	export type OAuthProvider = S.Schema.Type<typeof OAuthProvider>;
	export type UserRole = S.Schema.Type<typeof UserRole.schema>;
	export type CookieKey = (typeof Request.cookie.keys)[number];
	export type Serializable = InstanceType<typeof Serializable>;
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
			readonly state: string;
		}
		export interface Data {
			readonly circuit: Option.Option<Circuit>;
			readonly cluster: Option.Option<ClusterState>;
			readonly ipAddress: Option.Option<string>;
			readonly rateLimit: Option.Option<RateLimit>;
			readonly requestId: string;
			readonly session: Option.Option<Session>;
			readonly tenantId: string;
			readonly userAgent: Option.Option<string>;
		}
		export type RunnerId = S.Schema.Type<typeof RunnerId>;	// Branded runner ID (18-19 digit snowflake)
		export interface ClusterState {							// Cluster state: outer Option in Data, inner nulls avoid nesting
			readonly entityId: string | null;
			readonly entityType: string | null;
			readonly isLeader: boolean;
			readonly runnerId: RunnerId | null;
			readonly shardId: ShardId.ShardId | null;
		}
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { Context };
