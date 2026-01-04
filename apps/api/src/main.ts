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
import { HttpError } from '@parametric-portal/server/http-errors';
import { createMetricsMiddleware } from '@parametric-portal/server/metrics';
import { Middleware } from '@parametric-portal/server/middleware';
import { TelemetryLive } from '@parametric-portal/server/telemetry';
import { AuthContext } from '@parametric-portal/server/auth';
import { DurationMs, type Hex64 } from '@parametric-portal/types/types';
import { Config, Effect, Layer, Metric, Option } from 'effect';
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
    corsOrigins: Config.string('CORS_ORIGINS').pipe(
        Config.withDefault(B.defaults.corsOrigins),
        Config.map((s) => s.split(',') as ReadonlyArray<string>),
    ),
    port: Config.number('PORT').pipe(Config.withDefault(B.defaults.port)),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const composeMiddleware = (app: HttpApp.Default): HttpApp.Default =>
    app.pipe(
        Middleware.trace(),
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
        return {
            lookup: (tokenHash: Hex64) =>
                db.sessions.findValidByTokenHash(tokenHash).pipe(
                    Effect.map(Option.map(AuthContext.fromSession)),
                    Effect.catchAll(() => Effect.succeed(Option.none<AuthContext>())),
                ),
        };
    }),
);
const DatabaseLive = DatabaseService.layer;
const SessionAuthLive = Middleware.Auth.layer.pipe(Layer.provide(SessionLookupLive), Layer.provide(DatabaseLive));
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
const MetricsRouteLive = HttpApiBuilder.group(ParametricApi, 'metrics', (handlers) =>
    handlers.handle('list', () =>
        Effect.map(Metric.snapshot, (snapshot) =>
            snapshot
                .map((entry) => `${entry.metricKey.name}{} ${JSON.stringify(entry.metricState)}`)
                .join('\n'),
        ),
    ),
);
const InfraLayers = Layer.mergeAll(TelemetryLive, EncryptionKeyService.layer);
const RouteDependencies = Layer.mergeAll(DatabaseLive, OAuthLive, IconGenerationServiceLive);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(
    Layer.provide(Layer.mergeAll(HealthLive, AuthLive, IconsLive, MetricsRouteLive, TelemetryRouteLive)),
    Layer.provide(RouteDependencies),
    Layer.provide(InfraLayers),
    Layer.provide(PgLive),
);
const ServerLive = Layer.unwrapEffect(
    Effect.map(ServerConfig, (config) =>
        HttpApiBuilder.serve(composeMiddleware).pipe(
            Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
            Layer.provide(ApiLive),
            Layer.provide(Middleware.cors({ allowedOrigins: config.corsOrigins })),
            Layer.provide(SessionAuthLive),
            Layer.provide(NodeHttpServer.layer(createServer, { port: config.port }).pipe(HttpServer.withLogAddress)),
        ),
    ),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain(Layer.launch(ServerLive));
