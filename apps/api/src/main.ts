import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchService } from '@parametric-portal/database/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { Tenant } from '@parametric-portal/server/tenant';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { SessionService } from '@parametric-portal/server/domain/session';
import { MetricsService } from '@parametric-portal/server/infra/metrics';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import { Telemetry } from '@parametric-portal/server/infra/telemetry';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { ReplayGuardService } from '@parametric-portal/server/security/totp-replay';
import { Config, Effect, Layer, Option } from 'effect';
import { OAuthLive } from './services/oauth.ts';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { MfaLive } from './routes/mfa.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { UsersLive } from './routes/users.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const API_CONFIG = { defaults: { corsOrigins: '*', port: 4000 } } as const;
const serverConfig = Effect.runSync(
    Config.all({
        corsOrigins: Config.string('CORS_ORIGINS').pipe(
            Config.withDefault(API_CONFIG.defaults.corsOrigins),
            Config.map((s) => s.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0) as ReadonlyArray<string>),
        ),
        port: Config.number('PORT').pipe(Config.withDefault(API_CONFIG.defaults.port)),
    }),
);

// --- [LAYERS] ----------------------------------------------------------------

const DatabaseLive = DatabaseService.Default;

const makeAppLookup = (db: typeof DatabaseService.Service) =>
    (namespace: string): Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>> =>
        db.apps.byNamespace(namespace).pipe(
            Effect.map((appOpt) => Option.map(appOpt, (app) => ({ id: app.id, namespace: app.namespace }))),
            Effect.orElseSucceed(() => Option.none()),
        );
const SessionAuthLive = Layer.unwrapEffect(
    Effect.map(SessionService, (session) =>
        Middleware.Auth.makeLayer((hash) => session.lookup(hash)),
    ),
);
const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const audit = yield* AuditService;
        const checkDatabase = () =>
            db.withTransaction(Effect.succeed(true)).pipe(
                Effect.as(true),
                Effect.timeout('5 seconds'),
                Effect.catchAll(() => Effect.succeed(false)),
            );
        return handlers
            .handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
            .handle('readiness', () =>
                Effect.all([checkDatabase(), audit.getHealth()]).pipe(
                    Effect.flatMap(([dbOk, auditHealth]) =>
                        dbOk && auditHealth.state !== 'alerted'
                            ? Effect.succeed({ checks: { audit: auditHealth.state, database: true }, status: 'ok' as const })
                            : Effect.fail(HttpError.serviceUnavailable(dbOk ? `Audit system ${auditHealth.state}` : 'Database check failed', 30000)),
                    ),
                ),
            );
    }),
);
/**
 * [COMPOSABLE_LAYERS] Multi-tenant monorepo architecture:
 * - InfraLayers: Base infrastructure (Client.layer provides SqlClient once for all services)
 * - ServiceLayers: Domain services declare requirements via .Default (not standalone)
 * - AppLayers: Merges Infra + Services for complete dependency provision
 */
const InfraLayers = Layer.mergeAll(
    Client.layer,
    Telemetry.Default,
    Crypto.Service.Default,
    RateLimit.Default,
    MetricsService.Default,
    ReplayGuardService.Default,
    Tenant.Context.SystemLayer,
    NodeFileSystem.layer,
);
const ServiceLayers = Layer.mergeAll(DatabaseLive, SearchService.Default, OAuthLive, SessionService.Default, AuditService.Default).pipe(
    Layer.provide(InfraLayers),
);
const AppLayers = Layer.merge(InfraLayers, ServiceLayers);
const SessionAuthWithDeps = SessionAuthLive.pipe(Layer.provide(AppLayers));
const RouteLayers = Layer.mergeAll(AuditLive, AuthLive, HealthLive, MfaLive, TelemetryRouteLive, TransferLive, UsersLive).pipe(
    Layer.provide(AppLayers),
);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayers));
const ServerLiveInner = Layer.unwrapEffect(
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        return HttpApiBuilder.serve((app) =>
            app.pipe(
                Middleware.xForwardedHeaders,
                Middleware.trace,
                Middleware.security(),
                Middleware.makeRequestContext(makeAppLookup(db)),
                Middleware.metrics,
                RateLimit.headers,
                HttpMiddleware.logger,
            ),
        ).pipe(
            Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
            Layer.provide(ApiLive),
            Layer.provide(Middleware.cors(serverConfig.corsOrigins)),
            Layer.provide(SessionAuthWithDeps),
            HttpServer.withLogAddress,
            Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
        );
    }),
);
const ServerLive = ServerLiveInner.pipe(Layer.provide(AppLayers));

// --- [ENTRY_POINT] -----------------------------------------------------------

const shutdown = Effect.scoped(Layer.launch(ServerLive)).pipe(
    Effect.onInterrupt(() => Effect.logInfo('Graceful shutdown initiated')),
    Effect.ensuring(Effect.logInfo('Server shutdown complete')),
);
NodeRuntime.runMain(shutdown);
