/** API server entry point with Layer composition. Uses DatabaseService.layer and static layer patterns. */

import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { PgLive } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { AuthContext } from '@parametric-portal/server/auth';
import { EncryptionKeyStore } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { AuditState } from '@parametric-portal/server/audit';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { TelemetryLive } from '@parametric-portal/server/telemetry';
import { TotpReplayGuard } from '@parametric-portal/server/totp-replay';
import { DurationMs, type Hex64 } from '@parametric-portal/types/types';
import { Config, Effect, Layer, Option } from 'effect';
import { OAuthLive } from './oauth.ts';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';
import { MfaLive } from './routes/mfa.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { UsersLive } from './routes/users.ts';
import { IconGenerationServiceLive } from './services/icons.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({ defaults: { corsOrigins: '*', port: 4000 } } as const);
const serverConfig = Effect.runSync(
    Config.all({
        corsOrigins: Config.string('CORS_ORIGINS').pipe(
            Config.withDefault(B.defaults.corsOrigins),
            Config.map((s) => s.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0) as ReadonlyArray<string>),
        ),
        port: Config.number('PORT').pipe(Config.withDefault(B.defaults.port)),
    }),
);

// --- [LAYERS] ----------------------------------------------------------------

const SessionLookupLive = Layer.effect(
    Middleware.SessionLookup,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return {
            lookup: (tokenHash: Hex64) =>
                db.sessions.findValidByTokenHash(tokenHash).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.succeed(Option.none<AuthContext>()),
                        onSome: (session) => db.mfaSecrets.findByUserId(session.userId).pipe(Effect.map((mfaOpt) => Option.some(AuthContext.fromSession({
                            id: session.id,
                            mfaRequired: Option.isSome(mfaOpt) && mfaOpt.value.enabledAt !== null,
                            mfaVerifiedAt: session.mfaVerifiedAt,
                            userId: session.userId,
                        })))),
                    })),
                    Effect.catchAll((error) => Effect.logError('Session lookup failed', { error: String(error) }).pipe(Effect.as(Option.none<AuthContext>()))),
                    Effect.provideService(MetricsService, metrics),
                ),
        };
    }),
);
const UserLookupLive = Layer.effect(
    Middleware.UserLookupService,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return { findById: (userId: string) => db.users.findById(userId as Parameters<typeof db.users.findById>[0]).pipe( Effect.provideService(MetricsService, metrics), ), };
    }),
);
const AppLookupLive = Layer.effect(
    Middleware.AppLookupService,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return {
            findBySlug: (slug: string) =>
                db.apps.findBySlug(slug).pipe(
                    Effect.map(Option.map((app) => ({ id: app.id, slug: app.slug }))),
                    Effect.provideService(MetricsService, metrics),
                ),
        };
    }),
);
const DatabaseLive = DatabaseService.layer;
const SessionAuthLive = Middleware.Auth.layer.pipe(Layer.provide(SessionLookupLive), Layer.provide(DatabaseLive), Layer.provide(MetricsService.layer));
const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const checkDatabase = () =>
            sql`SELECT 1`.pipe(
                Effect.as(true),
                Effect.catchAll(() => Effect.succeed(false)),
            );
        return handlers
            .handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
            .handle('readiness', () =>
                checkDatabase().pipe(
                    Effect.flatMap((dbOk) =>
                        dbOk
                            ? Effect.succeed({ checks: { database: true }, status: 'ok' as const })
                            : Effect.fail(
                                  new HttpError.ServiceUnavailable({
                                      reason: 'Database check failed',
                                      retryAfterMs: DurationMs.fromSeconds(30),
                                  }),
                              ),
                    ),
                ),
            );
    }),
);
const RateLimitLive = RateLimit.layer;
const InfraLayers = Layer.mergeAll(PgLive, TelemetryLive, EncryptionKeyStore.layer, RateLimitLive, MetricsService.layer, TotpReplayGuard.Default, AuditState.Default);
const RouteDependencies = Layer.mergeAll(DatabaseLive, OAuthLive, IconGenerationServiceLive);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(
    Layer.provide(Layer.mergeAll(AuditLive, AuthLive, HealthLive, IconsLive, MfaLive, TelemetryRouteLive, TransferLive, UsersLive)),
    Layer.provide(RouteDependencies),
    Layer.provide(InfraLayers),
);
const UserLookupServiceLive = UserLookupLive.pipe(Layer.provide(DatabaseLive), Layer.provide(MetricsService.layer));
const AppLookupServiceLive = AppLookupLive.pipe(Layer.provide(DatabaseLive), Layer.provide(MetricsService.layer));
/**
 * Middleware order is critical - do not reorder without understanding the dependencies:
 * 1. xForwardedHeaders - Must be first to extract real client IP from proxy headers
 * 2. trace - OpenTelemetry span creation, needs client IP from step 1
 * 3. security - HSTS/X-Content-Type-Options headers, stateless
 * 4. requestId - Generates unique ID, used by subsequent middleware for correlation
 * 5. requestContext - Builds RequestContext using IP (1) and requestId (4)
 * 6. metrics - Records request metrics, uses context from step 5
 * 7. logger - Structured logging, uses all above context
 */
const ServerLive = HttpApiBuilder.serve((app) =>
    app.pipe(
        Middleware.xForwardedHeaders,
        Middleware.trace,
        Middleware.security(),
        Middleware.requestId(),
        Middleware.requestContext(),
        Middleware.metrics,
        HttpMiddleware.logger,
    ),
).pipe(
    Layer.provide(Layer.mergeAll(AppLookupServiceLive, MetricsService.layer)),
    Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
    Layer.provide(ApiLive),
    Layer.provide(Middleware.cors({ allowedOrigins: serverConfig.corsOrigins })),
    Layer.provide(SessionAuthLive),
    Layer.provide(UserLookupServiceLive),
    HttpServer.withLogAddress,
    Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain(Layer.launch(ServerLive));
