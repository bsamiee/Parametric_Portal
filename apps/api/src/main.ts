/**
 * API server entrypoint: layer composition, middleware pipeline, graceful shutdown.
 * Architecture: Platform → Services → HTTP (3-tier, linear dependency chain).
 */
import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer, HttpServerResponse } from '@effect/platform';
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { AiRuntime } from '@parametric-portal/ai/runtime';
import { SearchService } from '@parametric-portal/ai/search';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { Middleware } from '@parametric-portal/server/middleware';
import { Auth } from '@parametric-portal/server/domain/auth';
import { FeatureService } from '@parametric-portal/server/domain/features';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { TransferService } from '@parametric-portal/server/domain/transfer';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { EmailAdapter } from '@parametric-portal/server/infra/email';
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
import { PolicyService } from '@parametric-portal/server/security/policy';
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

// --- [CONSTANTS] -------------------------------------------------------------

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

const ServicesLayer = Layer.mergeAll(Auth.Service.Default, EmailAdapter.Default, FeatureService.Default, NotificationService.Default, StorageService.Default, TransferService.Default, AiRuntime.Default, SearchService.Default, JobService.Default, PollingService.Default, EventBus.Default, WebhookService.Default, WebSocketService.Default, PolicyService.Default).pipe(
	Layer.provideMerge(Layer.mergeAll(PollingService.Crons, PurgeService.Crons, SearchService.EmbeddingCron)),
	Layer.provideMerge(PurgeService.Handlers),
	Layer.provideMerge(Layer.mergeAll(StorageAdapter.Default, AuditService.Default)),
	Layer.provideMerge(ReplayGuardService.Default),
	Layer.provideMerge(CacheService.Layer),
	Layer.provideMerge(Resilience.Layer),
	Layer.provideMerge(Layer.mergeAll(DatabaseService.Default, SearchRepo.Default, MetricsService.Default, Crypto.Service.Default, StreamingService.Default, ClusterService.Default)),
	Layer.provideMerge(PlatformLayer),
);

// --- [HTTP_LAYER] ------------------------------------------------------------
// Route handlers, auth middleware, API composition.

const RouteLayer = Layer.mergeAll(AdminLive, AuditLive, AuthLive, HealthLive, JobsLive, SearchLive, StorageLive, TelemetryRouteLive, TransferLive, UsersLive, WebhooksLive, WebSocketLive);
const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayer));

// --- [SERVER_LAYER] ----------------------------------------------------------
// HTTP server with middleware pipeline + auth + CORS in single MiddlewareLayer.

const ServerLayer = Layer.unwrapEffect(Effect.gen(function* () {
	const [database, auth, serverConfig] = yield* Effect.all([Effect.orDie(DatabaseService), Effect.orDie(Auth.Service), Effect.orDie(ServerConfig)]);
		const MiddlewareLayer = Middleware.layer({
				apiKeyLookup: (hash) => {
					const now = new Date();
					return database.apiKeys.byHash(hash).pipe(
						Effect.map(Option.filter((key) => Option.isNone(key.deletedAt) && Option.match(key.expiresAt, { onNone: () => true, onSome: (expiresAt) => expiresAt >= now }))),
						Effect.tap(Option.match({
							onNone: () => Effect.void,
							onSome: (key) => database.apiKeys.touch(key.id).pipe(Effect.ignore),
						})),
						Effect.map(Option.map((key) => ({ id: key.id, userId: key.userId }))),
					);
				},
			cors: serverConfig.corsOrigins,
			sessionLookup: (hash) => auth.session.lookup(hash),
			});
	return HttpApiBuilder.serve((application) => Middleware.pipeline(database)(application).pipe(
		CacheService.headers,
		HttpMiddleware.logger,
		Effect.catchAllDefect((defect) => Effect.logError('Unhandled request defect', { defect: String(defect) }).pipe(
			Effect.andThen(HttpServerResponse.unsafeJson({ details: 'Unhandled request defect', error: 'InternalServerError' }, { status: 500 })),
		)),
	)).pipe(
		Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
		Layer.provide(ApiLayer),
		Layer.provide(MiddlewareLayer),
		HttpServer.withLogAddress,
		Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
	);
})).pipe(Layer.provide(ServicesLayer));

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain((Effect.scoped(Layer.launch(ServerLayer)).pipe(
	Effect.onInterrupt(() => Effect.logInfo('Graceful shutdown initiated')),
	Effect.ensuring(Effect.logInfo('Server shutdown complete')),
) as Effect.Effect<never>));
