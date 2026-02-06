/**
 * API server entrypoint: layer composition, middleware pipeline, graceful shutdown.
 * Architecture: Platform → Services → HTTP (3-tier, linear dependency chain).
 */
import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { AiRuntime } from '@parametric-portal/ai/runtime';
import { SearchService } from '@parametric-portal/ai/search';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { Middleware } from '@parametric-portal/server/middleware';
import { Auth } from '@parametric-portal/server/domain/auth';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { EventBus } from '@parametric-portal/server/infra/events';
import { PurgeService } from '@parametric-portal/server/infra/handlers/purge';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { WebSocketService } from '@parametric-portal/server/platform/websocket';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { ReplayGuardService } from '@parametric-portal/server/security/totp-replay';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Config, Effect, Layer, Option } from 'effect';
import { AdminLive } from './routes/admin.ts';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { HealthLive } from './routes/health.ts';
import { JobsLive } from './routes/jobs.ts';
import { SearchLive } from './routes/search.ts';
import { StorageLive } from './routes/storage.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { UsersLive } from './routes/users.ts';
import { WebhooksLive } from './routes/webhooks.ts';
import { WebSocketLive } from './routes/websocket.ts';

// --- [CONFIG] ----------------------------------------------------------------

const ServerConfig = Config.all({
	corsOrigins: Config.string('CORS_ORIGINS').pipe(Config.withDefault('*'), Config.map((origins) => origins.split(',').map((origin) => origin.trim()).filter(Boolean) as ReadonlyArray<string>)),
	port: Config.number('PORT').pipe(Config.withDefault(4000)),
});

// --- [PLATFORM_LAYER] --------------------------------------------------------
// External resources: database client, S3, filesystem, telemetry collector.

const PlatformLayer = Layer.mergeAll(Client.layer, StorageAdapter.S3ClientLayer, NodeFileSystem.layer, Telemetry.Default);

// --- [SERVICES_LAYER] --------------------------------------------------------
// All application services in dependency order. Single provideMerge chain.
// Crons: domain services own their schedules (PollingService.Crons, PurgeService.Crons, SearchService.EmbeddingCron)

const ServicesLayer = Layer.mergeAll(Auth.Service.Default, StorageService.Default, AiRuntime.Default, SearchService.Default, JobService.Default, PollingService.Default, EventBus.Default, WebhookService.Default, WebSocketService.Default).pipe(
	Layer.provideMerge(Layer.mergeAll(PollingService.Crons, PurgeService.Crons, SearchService.EmbeddingCron)),
	Layer.provideMerge(PurgeService.Handlers),
	Layer.provideMerge(Layer.mergeAll(StorageAdapter.Default, AuditService.Default)),
	Layer.provideMerge(ReplayGuardService.Default),
	Layer.provideMerge(CacheService.Layer),
	Layer.provideMerge(Resilience.Layer),
	Layer.provideMerge(Layer.mergeAll(DatabaseService.Default, SearchRepo.Default, MetricsService.Default, Crypto.Service.Default, Context.Request.SystemLayer, StreamingService.Default, ClusterService.Layers.runner)),
	Layer.provideMerge(PlatformLayer),
);

// --- [HTTP_LAYER] ------------------------------------------------------------
// Route handlers, auth middleware, API composition.

const SessionAuthLayer = Layer.unwrapEffect(Effect.all([Auth.Service, DatabaseService]).pipe(
	Effect.map(([auth, database]) => Middleware.Auth.makeLayer(
		(hash) => auth.sessionLookup(hash),
		(hash) => database.apiKeys.byHash(hash).pipe(
			Effect.map(Option.filter((key) => Option.isNone(key.deletedAt))),
			Effect.tap(Option.match({
				onNone: () => Effect.void,
				onSome: (key) => database.apiKeys.touch(key.id).pipe(Effect.ignore),
			})),
			Effect.map(Option.map((key) => ({ expiresAt: key.expiresAt, id: key.id, userId: key.userId }))),
			Effect.catchAll(() => Effect.succeed(Option.none())),
		),
	)),
)).pipe(Layer.provide(ServicesLayer));
const RouteLayer = Layer.mergeAll(AdminLive, AuditLive, AuthLive, HealthLive, JobsLive, SearchLive, StorageLive, TelemetryRouteLive, TransferLive, UsersLive, WebhooksLive, WebSocketLive).pipe(Layer.provide(ServicesLayer));
const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayer));

// --- [SERVER_LAYER] ----------------------------------------------------------
// HTTP server with middleware pipeline: context → trace → security → metrics → logging.

const ServerLayer = Layer.unwrapEffect(Effect.gen(function* () {
	const database = yield* Effect.orDie(DatabaseService);
	const serverConfig = yield* Effect.orDie(ServerConfig);
	return HttpApiBuilder.serve((application) => application.pipe(
		Middleware.xForwardedHeaders,
		Middleware.makeRequestContext(Middleware.makeAppLookup(database)),
		Middleware.trace,
		Middleware.security(),
		Middleware.serverTiming,
		Middleware.metrics,
		CacheService.headers,
		HttpMiddleware.logger,
	)).pipe(
		Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
		Layer.provide(ApiLayer),
		Layer.provide(Middleware.cors(serverConfig.corsOrigins)),
		Layer.provide(SessionAuthLayer),
		HttpServer.withLogAddress,
		Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
	);
})).pipe(Layer.provide(ServicesLayer));

// --- [ENTRY_POINT] -----------------------------------------------------------

// NOTE: CurrentAddress requirement is a phantom type from @effect/cluster Entity.toLayer.
// Entity handlers yield Entity.CurrentAddress internally, but Entity.toLayer uses Exclude<RX, CurrentAddress>
// to remove it from layer requirements. TypeScript sometimes fails to compute this exclusion properly.
// This type assertion is safe because CurrentAddress is only available within entity scope (not app level).
// ShardingConfig is provided by ClusterService.Layers.runner via _storageLayers.
NodeRuntime.runMain((Effect.scoped(Layer.launch(ServerLayer)).pipe(
	Effect.onInterrupt(() => Effect.logInfo('Graceful shutdown initiated')),
	Effect.ensuring(Effect.logInfo('Server shutdown complete')),
) as Effect.Effect<never>));
