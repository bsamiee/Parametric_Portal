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
import { EncryptionKeyService } from '@parametric-portal/server/crypto';
import { ServiceUnavailable } from '@parametric-portal/server/domain-errors';
import { createMetricsMiddleware, Metrics } from '@parametric-portal/server/metrics';
import { Middleware } from '@parametric-portal/server/middleware';
import { TelemetryService } from '@parametric-portal/server/telemetry';
import { AuthContext } from '@parametric-portal/types/database';
import { type Hex64 } from '@parametric-portal/types/types';
import { Config, Effect, Layer, Option, pipe } from 'effect';
import { ParametricApi } from '@parametric-portal/server/api';
import { OAuthLive } from './oauth.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { IconGenerationServiceLive } from './services/icons.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        corsOrigins: '*',
        port: 4000,
    },
} as const);

// --- [CONFIG] ----------------------------------------------------------------

const ServerConfig = Config.all({
    corsOrigins: pipe(
        Config.string('CORS_ORIGINS'),
        Config.withDefault(B.defaults.corsOrigins),
        Config.map((s) => s.split(',') as ReadonlyArray<string>),
    ),
    port: pipe(Config.number('PORT'), Config.withDefault(B.defaults.port)),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const composeMiddleware = (app: HttpApp.Default): HttpApp.Default =>
    pipe(
        app,
        Middleware.trace(),
        createMetricsMiddleware(),
        Middleware.security(),
        Middleware.requestId(),
        HttpMiddleware.logger,
    ) as HttpApp.Default;

// --- [LAYERS] ----------------------------------------------------------------

const SessionLookupLive = Layer.effect(
    Middleware.SessionLookup,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        return {
            lookup: (tokenHash: Hex64): Effect.Effect<Option.Option<AuthContext>, never, never> =>
                pipe(
                    db.sessions.findValidByTokenHash(tokenHash),
                    Effect.map(Option.map(AuthContext.fromSession)),
                    Effect.catchAll(() => Effect.succeed(Option.none<AuthContext>())),
                ),
        };
    }),
);
const DatabaseLive = DatabaseService.layer.pipe(Layer.provide(PgLive));
const SessionAuthLive = Middleware.Auth.layer.pipe(Layer.provide(SessionLookupLive), Layer.provide(DatabaseLive));
const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const checkDatabase = () =>
            pipe(
                sql`SELECT 1`,
                Effect.as(true),
                Effect.catchAll(() => Effect.succeed(false)),
            );
        return handlers
            .handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
            .handle('readiness', () =>
                pipe(
                    checkDatabase(),
                    Effect.flatMap((dbOk) =>
                        dbOk
                            ? Effect.succeed({ checks: { database: true }, status: 'ok' as const })
                            : Effect.fail(
                                  new ServiceUnavailable({
                                      reason: 'Database check failed',
                                      retryAfterSeconds: 30,
                                  }),
                              ),
                    ),
                ),
            );
    }),
);
const MetricsRouteLive = HttpApiBuilder.group(ParametricApi, 'metrics', (handlers) =>
    Effect.gen(function* () {
        const { registry } = yield* Metrics;
        return handlers.handle('list', () => Effect.promise(() => registry.metrics()));
    }),
);
const RouteDependencies = Layer.mergeAll(
    DatabaseLive,
    OAuthLive,
    IconGenerationServiceLive,
    EncryptionKeyService.layer,
);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(
    Layer.provide(Layer.mergeAll(HealthLive, AuthLive, IconsLive, MetricsRouteLive, TelemetryRouteLive)),
    Layer.provide(RouteDependencies),
    Layer.provide(PgLive),
);
const ServerLive = Layer.unwrapEffect(
    Effect.map(ServerConfig, (config) => {
        const httpServerLayer = NodeHttpServer.layer(createServer, { port: config.port }).pipe(
            HttpServer.withLogAddress,
        );
        return pipe(
            HttpApiBuilder.serve(composeMiddleware),
            Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
            Layer.provide(ApiLive),
            Layer.provide(Middleware.cors({ allowedOrigins: config.corsOrigins })),
            Layer.provide(SessionAuthLive),
            Layer.provide(Metrics.layer),
            Layer.provide(TelemetryService.layer),
            Layer.provide(httpServerLayer),
        );
    }),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain(Layer.launch(ServerLive));
