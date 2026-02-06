/**
 * Unified request context: tenant isolation, session state, rate limiting, circuit breaker.
 * FiberRef+Effect.Tag composition, cookie handling, cluster state propagation.
 */
import type { ShardId, Snowflake } from '@effect/cluster';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Cookie } from '@effect/platform/Cookies';
import type { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { Client } from '@parametric-portal/database/client';
import { Config, Data, Effect, FiberId, FiberRef, type Duration, Layer, Option, Order, pipe, Record, Schedule, Schema as S } from 'effect';
import { HttpError } from './errors.ts';
import * as D from 'effect/Duration';
import { constant, dual } from 'effect/Function';

// --- [CONSTANTS] -------------------------------------------------------------

const _ID = { default: '00000000-0000-7000-8000-000000000001', job: '00000000-0000-7000-8000-000000000002', system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff' } as const;

// --- [SCHEMA] ----------------------------------------------------------------

const OAuthProvider = S.Literal('apple', 'github', 'google', 'microsoft');
const _RunnerId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('RunnerId'));
const _ShardIdString = S.String.pipe(S.pattern(/^[a-zA-Z0-9_-]+:\d+$/), S.brand('ShardIdString'));
const UserRole = (() => {
	const rank = { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 } as const;
	const order = Order.mapInput(Order.number, (role: keyof typeof rank) => rank[role]);
	return {
		hasAtLeast: (role: string, min: string): boolean => role in rank && min in rank ? Order.greaterThanOrEqualTo(order)(role as keyof typeof rank, min as keyof typeof rank) : false,
		Order: order,
		schema: S.String,
	} as const;
})();

// --- [SERIALIZABLE] ----------------------------------------------------------

class Serializable extends S.Class<Serializable>('server/Context.Serializable')({	// Schema-backed serializable context for distributed tracing propagation.
	appNamespace: S.optional(S.String),
	ipAddress: S.optional(S.String),
	requestId: S.String,
	// Cluster fields for cross-pod trace correlation (S.optional = backward compatible)
	runnerId: S.optional(_RunnerId),
	sessionId: S.optional(S.String),
	shardId: S.optional(_ShardIdString),
	tenantId: S.String,
	userId: S.optional(S.String),
}) {
	private static readonly makeShardIdString = (shardId: ShardId.ShardId): S.Schema.Type<typeof _ShardIdString> => S.decodeSync(_ShardIdString)(shardId.toString());
	static readonly fromData = (ctx: Context.Request.Data): Serializable =>
		new Serializable({
			appNamespace: Option.getOrUndefined(ctx.appNamespace),
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
	static readonly Id = _ID;
	private static readonly _ref = FiberRef.unsafeMake<Context.Request.Data>({
		appNamespace: Option.none(),
		circuit: 	Option.none(),
		cluster: 	Option.none(),
		ipAddress: 	Option.none(),
		rateLimit: 	Option.none(),
		requestId: 	crypto.randomUUID(),
		session: 	Option.none(),
		tenantId: 	_ID.default,
		userAgent: 	Option.none(),
	});
	static readonly current = FiberRef.get(Request._ref);
	static readonly currentTenantId = Request.current.pipe(Effect.map((ctx) => ctx.tenantId));
	static readonly sessionOrFail = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.session, { onNone: () => Effect.fail(HttpError.Auth.of('Missing session')), onSome: Effect.succeed })));
	static readonly toAttrs = (ctx: Context.Request.Data, fiberId: FiberId.FiberId): Record.ReadonlyRecord<string, string> =>	// Observability attributes for tracing spans. Includes all context fields formatted for OTEL.
		Record.getSomes({
			'app.namespace': 			ctx.appNamespace,
			'circuit.name': 			Option.map(ctx.circuit, (c) => c.name),
			'circuit.state': 			Option.map(ctx.circuit, (c) => c.state),
			'client.ip': 				ctx.ipAddress,
			'client.ua': 				Option.map(ctx.userAgent, (ua) => (ua.length > 120 ? `${ua.slice(0, 117)}...` : ua)),
			'cluster.entity_id': 		Option.flatMapNullable(ctx.cluster, (c) => c.entityId),
			'cluster.entity_type': 		Option.flatMapNullable(ctx.cluster, (c) => c.entityType),
			'cluster.is_leader': 		Option.map(ctx.cluster, (c) => String(c.isLeader)),
			'cluster.runner_id':		Option.flatMapNullable(ctx.cluster, (c) => c.runnerId),
			'cluster.shard_id': 		pipe(ctx.cluster, Option.flatMapNullable((c) => c.shardId), Option.map((s) => s.toString())),
			'fiber.id': 				Option.some(FiberId.threadName(fiberId)),
			'ratelimit.delay_ms':		Option.map(ctx.rateLimit, (rl) => String(D.toMillis(rl.delay))),
			'ratelimit.limit': 			Option.map(ctx.rateLimit, (rl) => String(rl.limit)),
			'ratelimit.remaining': 		Option.map(ctx.rateLimit, (rl) => String(rl.remaining)),
				'ratelimit.reset_after_ms': Option.map(ctx.rateLimit, (rl) => String(D.toMillis(rl.resetAfter))),
				'request.id': 				Option.some(ctx.requestId),
				'session.kind': 			Option.map(ctx.session, (s) => s.kind),
				'session.mfa': 				Option.map(ctx.session, (s) => String(s.mfaEnabled)),
				'tenant.id': 				Option.some(ctx.tenantId),
			});
	static readonly attrs = Effect.all([Request.current, Effect.fiberId], { concurrency: 'unbounded' }).pipe(Effect.map(([ctx, fiberId]) => Request.toAttrs(ctx, fiberId)),);
	static readonly annotate = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Request.attrs.pipe(
			Effect.flatMap((attrs) =>
				Effect.optionFromOptional(Effect.currentSpan).pipe(
					Effect.flatMap(Option.match({
						onNone: () => effect.pipe(Effect.annotateLogs(attrs)),
						onSome: () => Effect.annotateCurrentSpan(attrs).pipe(Effect.andThen(effect.pipe(Effect.annotateLogs(attrs))),),
					})),
				),
			),
		);
	static readonly update = (partial: Partial<Context.Request.Data>) => FiberRef.update(Request._ref, (ctx) => ({ ...ctx, ...partial })).pipe(Effect.andThen(Request.annotate(Effect.void)));
	static readonly locally = <A, E, R>(partial: Partial<Context.Request.Data>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.locallyWith(Request.annotate(effect), Request._ref, (ctx) => ({ ...ctx, ...partial }));
	static readonly within = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E, R> => Effect.locallyWith(Request.annotate(effect), Request._ref, (current) => ({ ...current, ...ctx, tenantId }));
	static readonly withinSync = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> => Client.tenant.with(tenantId, Effect.locallyWith(Request.annotate(effect), Request._ref, (current) => ({ ...current, ...ctx, tenantId })));
	static readonly system = (requestId = crypto.randomUUID()): Context.Request.Data => ({
		appNamespace: Option.none(),
		circuit: Option.none(),
		cluster: Option.none(),
		ipAddress: Option.none(),
		rateLimit: Option.none(),
		requestId,
		session: Option.none(),
		tenantId: _ID.system,
		userAgent: Option.none(),
	});
	static readonly SystemLayer = Layer.succeed(Request, Request.system());
	static readonly cookie = (() => {	// Cookie: IIFE encapsulates secure flag and config
		const secure = Config.string('API_BASE_URL').pipe(
			Config.withDefault('http://localhost:4000'),
			Config.map((url) => url.startsWith('https://')),
		);
		const configuration = {
			oauth: { name: 'oauthState', options: { httpOnly: true, maxAge: D.minutes(10), path: '/api/auth/oauth', sameSite: 'lax' } },
			refresh: { name: 'refreshToken', options: { httpOnly: true, maxAge: D.days(30), path: '/api/auth', sameSite: 'lax' } },
		} as const satisfies Record<string, { readonly name: string; readonly options: Cookie['options'] }>;
		return {
			clear: (key: keyof typeof configuration) => (res: HttpServerResponse.HttpServerResponse) => secure.pipe(Effect.map((s) => HttpServerResponse.expireCookie(res, configuration[key].name, { ...configuration[key].options, secure: s }))),
			get: <E>(key: keyof typeof configuration, req: HttpServerRequest.HttpServerRequest, onNone: () => E): Effect.Effect<string, E> => Effect.fromNullable(req.cookies[configuration[key].name]).pipe(Effect.mapError(onNone)),
			keys: Object.keys(configuration) as ReadonlyArray<keyof typeof configuration>,
			read: <A, I extends Readonly<Record<string, string | undefined>>, R>(schema: S.Schema<A, I, R>) => HttpServerRequest.schemaCookies(schema),
			set: (key: keyof typeof configuration, value: string) => (res: HttpServerResponse.HttpServerResponse) => secure.pipe(Effect.flatMap((s) => HttpServerResponse.setCookie(res, configuration[key].name, value, { ...configuration[key].options, secure: s }))),
		} as const;
	})();
	static readonly toSerializable = Request.current.pipe(Effect.map(Serializable.fromData));
	static readonly clusterState = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.cluster, { onNone: () => Effect.fail(new (class extends Data.TaggedError('ClusterContextRequired')<{ readonly operation: string }> {})(({ operation: 'cluster' }))), onSome: Effect.succeed })),);
	static readonly shardId = Request.current.pipe(Effect.map((ctx) => Option.flatMapNullable(ctx.cluster, (c) => c.shardId)));
	static readonly runnerId = Request.current.pipe(Effect.map((ctx) => Option.flatMapNullable(ctx.cluster, (c) => c.runnerId)));
	static readonly isLeader = Request.current.pipe(Effect.map((ctx) => Option.exists(ctx.cluster, (c) => c.isLeader)));
	static readonly makeRunnerId = (snowflake: Snowflake.Snowflake): S.Schema.Type<typeof _RunnerId> => S.decodeSync(_RunnerId)(String(snowflake));
	static readonly withinCluster: {
		<A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>): Effect.Effect<A, E, R>;
		(partial: Partial<Context.Request.ClusterState>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
	} = dual(2, <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>) =>
		Effect.locallyWith(Request.annotate(effect), Request._ref, (ctx) => ({
			...ctx,
			cluster: Option.some({ ...Option.getOrElse(ctx.cluster, constant({ entityId: null, entityType: null, isLeader: false, runnerId: null, shardId: null } as Context.Request.ClusterState)), ...partial }),
		})),
	);
	static readonly config = {
		csrf: { expectedValue: 'XMLHttpRequest', header: 'x-requested-with' },
		durations: { pkce: D.minutes(10), refresh: D.days(30), session: D.days(7) },
		endpoints: { githubApi: 'https://api.github.com/user' },
		oauth: {
			capabilities: {
				apple: 		{ oidc: true, 	pkce: true 	},
				github: 	{ oidc: false, 	pkce: false },
				google: 	{ oidc: true, 	pkce: true 	},
				microsoft: 	{ oidc: true, 	pkce: true 	},
			} as const satisfies Record<S.Schema.Type<typeof OAuthProvider>, { oidc: boolean; pkce: boolean }>,
			retry: Schedule.exponential(D.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
			scopes: { github: ['user:email'], oidc: ['openid', 'profile', 'email'] },
			timeout: D.seconds(10),
		},
	} as const;
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Context = {
	OAuthProvider,
	Request,
	Serializable,
	UserRole
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Context {
	export type OAuthProvider = S.Schema.Type<typeof OAuthProvider>;
	export type UserRole = S.Schema.Type<typeof UserRole.schema>;
	export type CookieKey = (typeof Request.cookie.keys)[number];
	export type Serializable = InstanceType<typeof Serializable>;
	export namespace Request {
		export type Id = (typeof Request.Id)[keyof typeof Request.Id];
			export interface Session {readonly appId: string; readonly id: string; readonly kind: 'apiKey' | 'session'; readonly mfaEnabled: boolean; readonly userId: string; readonly verifiedAt: Option.Option<Date>;}
		export interface RateLimit {readonly delay: Duration.Duration; readonly limit: number; readonly remaining: number; readonly resetAfter: Duration.Duration;}
		export interface Circuit {readonly name: string; readonly state: string;}
		export interface Data {
			readonly appNamespace: Option.Option<string>; readonly circuit: Option.Option<Circuit>; readonly cluster: Option.Option<ClusterState>;
			readonly ipAddress: Option.Option<string>; readonly rateLimit: Option.Option<RateLimit>; readonly requestId: string;
			readonly session: Option.Option<Session>; readonly tenantId: string; readonly userAgent: Option.Option<string>;
		}
		export type RunnerId = S.Schema.Type<typeof _RunnerId>;	// Branded runner ID (18-19 digit snowflake)
		export interface ClusterState {							// Cluster state: outer Option in Data, inner nulls avoid nesting
			readonly entityId: string | null; readonly entityType: string | null; readonly isLeader: boolean;
			readonly runnerId: RunnerId | null; readonly shardId: ShardId.ShardId | null;
		}
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { Context };
