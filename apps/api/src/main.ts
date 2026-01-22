import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchService } from '@parametric-portal/database/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { RequestContext } from '@parametric-portal/server/context';
import { EncryptionKeyStore } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { AuditService } from '@parametric-portal/server/audit';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { TelemetryLive } from '@parametric-portal/server/telemetry';
import { TotpReplayGuard } from '@parametric-portal/server/totp-replay';
import type { Hex64 } from '@parametric-portal/types/types';
import { Config, Duration, Effect, Layer, Option, Schedule } from 'effect';
import { OAuthLive } from './oauth.ts';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';
import { MfaLive } from './routes/mfa.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { SearchLive } from './routes/search.ts';
import { UsersLive } from './routes/users.ts';
import { IconGenerationServiceLive } from './services/icons.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const API_CONFIG = { defaults: { corsOrigins: '*', port: 4000 }, search: { refreshMinutes: 5 } } as const;
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

const makeSessionLookup = (db: typeof DatabaseService.Service, metrics: typeof MetricsService.Service) =>
    (tokenHash: Hex64) =>
        db.sessions.byHash(tokenHash).pipe(
            Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (s) => db.sessions.touch(s.id).pipe(Effect.catchAll((error) => Effect.logWarning('Session activity update failed', { error: String(error), sessionId: s.id }))) })),
            Effect.flatMap(Option.match({
                onNone: () => Effect.succeed(Option.none()),
                onSome: (session) => db.mfaSecrets.byUser(session.userId).pipe(Effect.map((mfaOpt) => {
                    const mfaEnabled = Option.isSome(mfaOpt) && Option.isSome(mfaOpt.value.enabledAt);
                    return Option.some({
                        mfaEnabled,
                        mfaVerified: Option.isSome(session.verifiedAt),
                        sessionId: session.id,
                        userId: session.userId,
                    });
                })),
            })),
            Effect.catchAll((error) => Effect.logError('Session lookup failed', { error: String(error) }).pipe(Effect.as(Option.none()))),
            Effect.provideService(MetricsService, metrics),
        );
const makeAppLookup = (db: typeof DatabaseService.Service) =>
    (namespace: string) =>
        db.apps.byNamespace(namespace).pipe(
            Effect.map((appOpt) => Option.map(appOpt, (app) => ({ id: app.id, namespace: app.namespace }))),
            Effect.orElseSucceed(() => Option.none()),
        );
const SessionAuthLive = Layer.unwrapEffect(
    Effect.map(Effect.all([DatabaseService, MetricsService]), ([db, metrics]) =>
        Middleware.Auth.makeLayer(makeSessionLookup(db, metrics)),
    ),
);
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
                            : Effect.fail(HttpError.serviceUnavailable('Database check failed', 30000)),
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
const DefaultRequestContext = Layer.succeed(RequestContext, {
    appId: RequestContext.Id.system,
    ipAddress: Option.none(),
    requestId: 'system',
    sessionId: Option.none(),
    userAgent: Option.none(),
    userId: Option.none(),
});
const InfraLayers = Layer.mergeAll(
    Client.layer,
    TelemetryLive,
    EncryptionKeyStore.layer,
    RateLimit.layer,
    MetricsService.Default,
    TotpReplayGuard.Default,
    AuditService.Default,
    DefaultRequestContext,
    NodeFileSystem.layer,
);
const ServiceLayers = Layer.mergeAll(DatabaseLive, OAuthLive, IconGenerationServiceLive, SearchService.Default).pipe(
    Layer.provide(InfraLayers),
);
const AppLayers = Layer.merge(InfraLayers, ServiceLayers);
const SessionAuthWithDeps = SessionAuthLive.pipe(Layer.provide(AppLayers));
const RouteLayers = Layer.mergeAll(AuditLive, AuthLive, HealthLive, IconsLive, MfaLive, SearchLive, TelemetryRouteLive, TransferLive, UsersLive).pipe(
    Layer.provide(AppLayers),
);
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayers));
const ServerLiveInner = Layer.unwrapEffect(
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const search = yield* SearchService;
		yield* Effect.forkScoped(
			search.refresh().pipe(
				Effect.tapError((e) => Effect.logWarning('Search refresh failed', { error: String(e) })),
				Effect.catchAll(() => Effect.void),
				Effect.repeat(Schedule.spaced(Duration.minutes(API_CONFIG.search.refreshMinutes))),
			),
        );
        return HttpApiBuilder.serve((app) =>
            app.pipe(
                Middleware.xForwardedHeaders,
                Middleware.trace,
                Middleware.security(),
                Middleware.requestId,
                Middleware.makeRequestContext(makeAppLookup(db)),
                Middleware.makeTenantContext(Client.tenant.set),
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
