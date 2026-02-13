/**
 * Unified request context: tenant isolation, session state, rate limiting, circuit breaker.
 * FiberRef+Effect.Tag composition, cookie handling, cluster state propagation.
 */
import { Entity, type ShardId } from '@effect/cluster';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Cookie } from '@effect/platform/Cookies';
import type { SqlClient } from '@effect/sql';
import type { SqlError } from '@effect/sql/SqlError';
import { Client } from '@parametric-portal/database/client';
import { Config, Data, Duration, Effect, FiberId, FiberRef, Option, pipe, Record, Schedule, Schema as S } from 'effect';
import { HttpError } from './errors.ts';
import { constant, dual } from 'effect/Function';

// --- [CONSTANTS] -------------------------------------------------------------

const _ID = {
    default:        '00000000-0000-7000-8000-000000000001',
    job:            '00000000-0000-7000-8000-000000000002',
    ...Client.tenant.Id,
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _RunnerId =       S.NonEmptyTrimmedString;
const _ShardIdString =  S.String.pipe(S.pattern(/^[a-zA-Z0-9_-]+:\d+$/), S.brand('ShardIdString'));
const _RequestData = S.Struct({
    appNamespace:   S.OptionFromSelf(S.String),
    circuit:        S.OptionFromSelf(S.Struct({ name: S.String, state: S.String })),
    cluster:        S.OptionFromSelf(S.Struct({entityId: S.NullOr(S.String), entityType: S.NullOr(S.String), isLeader: S.Boolean, runnerId: S.NullOr(_RunnerId), shardId: S.NullOr(S.declare<ShardId.ShardId>((input): input is ShardId.ShardId => input !== null && typeof input === 'object' && 'toString' in input)),})),
    ipAddress:      S.OptionFromSelf(S.String),
    rateLimit:      S.OptionFromSelf(S.Struct({delay: S.DurationFromSelf, limit: S.Number, remaining: S.Number, resetAfter: S.DurationFromSelf,})),
    requestId:      S.String,
    session:        S.OptionFromSelf(S.Struct({appId: S.String, id: S.String, kind: S.Literal('apiKey', 'session'), mfaEnabled: S.Boolean, userId: S.String, verifiedAt: S.OptionFromSelf(S.DateFromSelf),})),
    tenantId:       S.String,
    userAgent:      S.OptionFromSelf(S.String),
});

// --- [SERIALIZABLE] ----------------------------------------------------------

class Serializable extends S.Class<Serializable>('server/Context.Serializable')({
    appNamespace: S.optional(S.String), ipAddress: S.optional(S.String), requestId: S.String,
    runnerId: S.optional(_RunnerId), sessionId: S.optional(S.String), shardId: S.optional(_ShardIdString),
    tenantId: S.String, userId: S.optional(S.String),
}) {
    static readonly fromData = (ctx: Context.Request.Data): Serializable =>
        new Serializable({
            appNamespace: Option.getOrUndefined(ctx.appNamespace), ipAddress: Option.getOrUndefined(ctx.ipAddress),
            requestId: ctx.requestId, tenantId: ctx.tenantId,
            ...Option.match(ctx.session, { onNone: constant({}), onSome: (session) => ({ sessionId: session.id, userId: session.userId }) }),
            ...Option.match(ctx.cluster, {
                onNone: constant({}),
                onSome: (cluster) => ({ runnerId: cluster.runnerId ?? undefined, shardId: cluster.shardId ? S.decodeSync(_ShardIdString)(cluster.shardId.toString()) : undefined }),
            }),
        });
}

// --- [REQUEST] ---------------------------------------------------------------

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
    static readonly Id = _ID;
    static readonly Headers = {
        appId:              'x-app-id',
        cfConnectingIp:     'cf-connecting-ip',
        circuitState:       'x-circuit-state',
        forwardedFor:       'x-forwarded-for',
        forwardedProto:     'x-forwarded-proto',
        idempotencyKey:     'idempotency-key',
        idempotencyOutcome: 'idempotency-outcome',
        rateLimit: {
            limit:          'x-ratelimit-limit',
            remaining:      'x-ratelimit-remaining',
            reset:          'x-ratelimit-reset',
            retryAfter:     'retry-after',
        },
        realIp:             'x-real-ip',
        requestedWith:      'x-requested-with',
        requestId:          'x-request-id',
        trace: [            'traceparent', 'tracestate', 'baggage'] as const,
    } as const;
    static readonly system = (requestId = crypto.randomUUID(), tenantId: Context.Request.Id = _ID.system): Context.Request.Data => ({ appNamespace: Option.none(), circuit: Option.none(), cluster: Option.none(), ipAddress: Option.none(), rateLimit: Option.none(), requestId, session: Option.none(), tenantId, userAgent: Option.none() });
    private static readonly _ref = FiberRef.unsafeMake<Context.Request.Data>(Request.system(_ID.default, _ID.unspecified));
    static readonly current = FiberRef.get(Request._ref);
    static readonly currentTenantId = Request.current.pipe(Effect.map((ctx) => ctx.tenantId));
    static readonly sessionOrFail = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.session, { onNone: () => Effect.fail(HttpError.Auth.of('Missing session')), onSome: Effect.succeed })));
    static readonly toAttrs = (ctx: Context.Request.Data, fiberId: FiberId.FiberId): Record.ReadonlyRecord<string, string> =>
        Record.getSomes({
            'app.namespace': ctx.appNamespace,
            'circuit.name': Option.map(ctx.circuit, (circuit) => circuit.name), 'circuit.state': Option.map(ctx.circuit, (circuit) => circuit.state),'client.address': ctx.ipAddress,
            'cluster.entity_id': Option.flatMapNullable(ctx.cluster, (cluster) => cluster.entityId), 'cluster.entity_type': Option.flatMapNullable(ctx.cluster, (cluster) => cluster.entityType),
            'cluster.is_leader': Option.map(ctx.cluster, (cluster) => String(cluster.isLeader)), 'cluster.runner_id': Option.flatMapNullable(ctx.cluster, (cluster) => cluster.runnerId),
            'cluster.shard_id': pipe(ctx.cluster, Option.flatMapNullable((cluster) => cluster.shardId), Option.map((shard) => shard.toString())),
            'http.request.header.x-request-id': Option.some(ctx.requestId),
            'ratelimit.delay_ms': Option.map(ctx.rateLimit, (rateLimit) => String(Duration.toMillis(rateLimit.delay))), 'ratelimit.limit': Option.map(ctx.rateLimit, (rateLimit) => String(rateLimit.limit)),
            'ratelimit.remaining': Option.map(ctx.rateLimit, (rateLimit) => String(rateLimit.remaining)), 'ratelimit.reset_after_ms': Option.map(ctx.rateLimit, (rateLimit) => String(Duration.toMillis(rateLimit.resetAfter))),'request.id': Option.some(ctx.requestId),
            'session.kind': Option.map(ctx.session, (session) => session.kind), 'session.mfa': Option.map(ctx.session, (session) => String(session.mfaEnabled)),'tenant.id': Option.some(ctx.tenantId), 'thread.name': Option.some(FiberId.threadName(fiberId)),
            'user_agent.original': Option.map(ctx.userAgent, (userAgent) => (userAgent.length > 120 ? `${userAgent.slice(0, 117)}...` : userAgent)),
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
    static readonly update = (partial: Partial<Context.Request.Data>) => FiberRef.update(Request._ref, (ctx): Context.Request.Data => ({
        appNamespace: partial.appNamespace ?? ctx.appNamespace,
        circuit: partial.circuit ?? ctx.circuit,
        cluster: partial.cluster ?? ctx.cluster,
        ipAddress: partial.ipAddress ?? ctx.ipAddress,
        rateLimit: partial.rateLimit ?? ctx.rateLimit,
        requestId: partial.requestId ?? ctx.requestId,
        session: partial.session ?? ctx.session,
        tenantId: partial.tenantId ?? ctx.tenantId,
        userAgent: partial.userAgent ?? ctx.userAgent,
    })).pipe(
        Effect.andThen(Option.fromNullable(partial.tenantId).pipe(Option.match({ onNone: () => Effect.void, onSome: (tenantId) => Client.tenant.set(tenantId) }))),
        Effect.andThen(Request.annotate(Effect.void)),
    );
    static readonly within = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E, R> =>
        Client.tenant.locally(tenantId, Effect.locallyWith(Request.annotate(effect), Request._ref, (current) => ({ ...current, ...ctx, tenantId })));
    static readonly withinSync = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>, ctx?: Partial<Context.Request.Data>): Effect.Effect<A, E | SqlError, R | SqlClient.SqlClient> => Client.tenant.with(tenantId, Request.within(tenantId, effect, ctx));
    static readonly cookie = (() => {   // Cookie: IIFE encapsulates secure flag and config
        const secure = Config.string('API_BASE_URL').pipe(
            Config.withDefault('http://localhost:4000'),
            Config.map((url) => url.startsWith('https://')),
        );
        const configuration = {
            oauth: { name: 'oauthState', options: { httpOnly: true, maxAge: Duration.minutes(10), path: '/api/auth/oauth', sameSite: 'lax' } },
            refresh: { name: 'refreshToken', options: { httpOnly: true, maxAge: Duration.days(30), path: '/api/auth', sameSite: 'lax' } },
        } as const satisfies Record<string, { readonly name: string; readonly options: Cookie['options'] }>;
        return {
            clear: (key: keyof typeof configuration) => (res: HttpServerResponse.HttpServerResponse) => secure.pipe(Effect.map((isSecure) => HttpServerResponse.expireCookie(res, configuration[key].name, { ...configuration[key].options, secure: isSecure }))),
            get: <E>(key: keyof typeof configuration, req: HttpServerRequest.HttpServerRequest, onNone: () => E): Effect.Effect<string, E> => Effect.fromNullable(req.cookies[configuration[key].name]).pipe(Effect.mapError(onNone)),
            keys: Object.keys(configuration) as ReadonlyArray<keyof typeof configuration>,
            read: <A, I extends Readonly<Record<string, string | undefined>>, R>(schema: S.Schema<A, I, R>) => HttpServerRequest.schemaCookies(schema),
            set: (key: keyof typeof configuration, value: string) => (res: HttpServerResponse.HttpServerResponse) => secure.pipe(Effect.flatMap((isSecure) => HttpServerResponse.setCookie(res, configuration[key].name, value, { ...configuration[key].options, secure: isSecure }))),
        } as const;
    })();
    static readonly auditFields = Request.current.pipe(Effect.map((ctx) => ({ ipAddress: Option.getOrUndefined(ctx.ipAddress), requestId: ctx.requestId, userAgent: Option.getOrUndefined(ctx.userAgent) })));
    static readonly toSerializable = Request.current.pipe(Effect.map(Serializable.fromData));
    static readonly clusterState = Request.current.pipe(Effect.flatMap((ctx) => Option.match(ctx.cluster, { onNone: () => Effect.fail(new (class extends Data.TaggedError('ClusterContextRequired')<{ readonly operation: string }> {})(({ operation: 'cluster' }))), onSome: Effect.succeed })),);
    static readonly withinCluster: {
        <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>): Effect.Effect<A, E, R>;
        (partial: Partial<Context.Request.ClusterState>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    } = dual(2, <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<Context.Request.ClusterState>) =>
        Effect.serviceOption(Entity.CurrentRunnerAddress).pipe(
            Effect.flatMap((runnerAddress) =>
                Effect.locallyWith(Request.annotate(effect), Request._ref, (ctx) => {
                    const current = Option.getOrElse(
                        ctx.cluster,
                        constant({ entityId: null, entityType: null, isLeader: false, runnerId: null, shardId: null }),
                    );
                    const merged = { ...current, ...partial };
                    return {
                        ...ctx,
                        cluster: Option.some({
                            ...merged,
                            runnerId: merged.runnerId ?? Option.getOrNull(Option.map(runnerAddress, (address) => address.toString())),
                        }),
                    };
                }),
            ),
        ),
    );
    static readonly config = {
        csrf: { expectedValue: 'XMLHttpRequest', header: Request.Headers.requestedWith },
        durations: { pkce: Duration.minutes(10), refresh: Duration.days(30), session: Duration.days(7) },
        endpoints: { githubApi: 'https://api.github.com/user' },
        oauth: {
            capabilities: { apple: { oidc: true, pkce: true }, github: { oidc: false, pkce: false }, google: { oidc: true, pkce: true }, microsoft: { oidc: true, pkce: true } } as const satisfies Record<'apple' | 'github' | 'google' | 'microsoft', { oidc: boolean; pkce: boolean }>,
            retry: Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
            scopes: { github: ['user:email'], oidc: ['openid', 'profile', 'email'] }, timeout: Duration.seconds(10),
        },
    } as const;
}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Context = { Request, Serializable } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Context {
    export type Serializable = InstanceType<typeof Serializable>;
    export namespace Request {
        export type Id = (typeof Request.Id)[keyof typeof Request.Id];
        export type Data = S.Schema.Type<typeof _RequestData>;
        export type Session = Data['session'] extends Option.Option<infer Session> ? Session : never;
        export type RateLimit = Data['rateLimit'] extends Option.Option<infer RateLimit> ? RateLimit : never;
        export type Circuit = Data['circuit'] extends Option.Option<infer Circuit> ? Circuit : never;
        export type ClusterState = Data['cluster'] extends Option.Option<infer ClusterState> ? ClusterState : never;
        export type AuditFields = { ipAddress: string | undefined; requestId: Data['requestId']; userAgent: string | undefined };
        export type RunnerId = S.Schema.Type<typeof _RunnerId>; // Branded runtime runner ID
    }
}

// --- [EXPORT] ----------------------------------------------------------------

export { Context };
