/**
 * API server entry point with Layer composition.
 * Uses DatabaseService.layer and static layer patterns.
 */
import { createServer } from 'node:http';
import type { HttpApp } from '@effect/platform';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { PgLive } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { AuthContext } from '@parametric-portal/server/auth';
import { EncryptionKeyService } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { createMetricsMiddleware, MetricsService } from '@parametric-portal/server/metrics';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { TelemetryLive } from '@parametric-portal/server/telemetry';
import { DurationMs, type Hex64 } from '@parametric-portal/types/types';
import { Config, Effect, Layer, Option } from 'effect';
import { OAuthLive } from './oauth.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const composeMiddleware = <E, R>(app: HttpApp.Default<E, R>) =>
    app.pipe(
        Middleware.xForwardedHeaders,
        Middleware.trace,
        createMetricsMiddleware(),
        Middleware.security(),
        Middleware.requestId(),
        HttpMiddleware.logger,
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
                    Effect.map(Option.map(AuthContext.fromSession)),
                    Effect.catchAll(() => Effect.succeed(Option.none<AuthContext>())),
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
const InfraLayers = Layer.mergeAll(PgLive, TelemetryLive, EncryptionKeyService.layer, RateLimitLive);
const RouteDependencies = Layer.mergeAll(DatabaseLive, OAuthLive, IconGenerationServiceLive);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(
    Layer.provide(Layer.mergeAll(HealthLive, AuthLive, IconsLive, TelemetryRouteLive)),
    Layer.provide(RouteDependencies),
    Layer.provide(InfraLayers),
);
const ServerLive = HttpApiBuilder.serve(composeMiddleware).pipe(
    Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
    Layer.provide(ApiLive),
    Layer.provide(Middleware.cors({ allowedOrigins: serverConfig.corsOrigins })),
    Layer.provide(SessionAuthLive),
    Layer.provide(MetricsService.layer),
    Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port }).pipe(HttpServer.withLogAddress)),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain(Layer.launch(ServerLive));
