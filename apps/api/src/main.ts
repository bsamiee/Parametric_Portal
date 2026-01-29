/**
 * API server entrypoint: layer composition, middleware pipeline, graceful shutdown.
 * Architecture: Platform → Services → HTTP (3-tier, linear dependency chain).
 */
import { createServer } from 'node:http';
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { Middleware } from '@parametric-portal/server/middleware';
import { MfaService } from '@parametric-portal/server/domain/mfa';
import { OAuthService } from '@parametric-portal/server/domain/oauth';
import { SearchService } from '@parametric-portal/server/domain/search';
import { SessionService } from '@parametric-portal/server/domain/session';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { PollingService } from '@parametric-portal/server/observe/polling';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { ReplayGuardService } from '@parametric-portal/server/security/totp-replay';
import { Config, Effect, Layer } from 'effect';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { HealthLive } from './routes/health.ts';
import { JobsLive } from './routes/jobs.ts';
import { SearchLive } from './routes/search.ts';
import { StorageLive } from './routes/storage.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { UsersLive } from './routes/users.ts';

// --- [CONFIG] ----------------------------------------------------------------

const serverConfig = Effect.runSync(Config.all({
	corsOrigins: Config.string('CORS_ORIGINS').pipe(Config.withDefault('*'), Config.map((s) => s.split(',').map((o) => o.trim()).filter(Boolean) as ReadonlyArray<string>)),
	port: Config.number('PORT').pipe(Config.withDefault(4000)),
}));

// --- [PLATFORM_LAYER] --------------------------------------------------------
// External resources: database client, S3, filesystem, telemetry collector.

const PlatformLayer = Layer.mergeAll(Client.layer, StorageAdapter.S3ClientLayer, NodeFileSystem.layer, Telemetry.Default);

// --- [SERVICES_LAYER] --------------------------------------------------------
// All application services in dependency order. Single provideMerge chain.

const ServicesLayer = Layer.mergeAll(SessionService.Default, StorageService.Default, SearchService.Default, JobService.Default, PollingService.Default).pipe(
	Layer.provideMerge(Layer.mergeAll(MfaService.Default, OAuthService.Default)),
	Layer.provideMerge(Layer.mergeAll(StorageAdapter.Default, AuditService.Default)),
	Layer.provideMerge(ReplayGuardService.Default),
	Layer.provideMerge(CacheService.Layer),
	Layer.provideMerge(Layer.mergeAll(DatabaseService.Default, SearchRepo.Default, MetricsService.Default, Crypto.Service.Default, Context.Request.SystemLayer, StreamingService.Default)),
	Layer.provideMerge(PlatformLayer),
);

// --- [HTTP_LAYER] ------------------------------------------------------------
// Route handlers, auth middleware, API composition.

const SessionAuthLayer = Layer.unwrapEffect(SessionService.pipe(Effect.map((session) => Middleware.Auth.makeLayer((hash) => session.lookup(hash))))).pipe(Layer.provide(ServicesLayer));
const RouteLayer = Layer.mergeAll(AuditLive, AuthLive, HealthLive, JobsLive, SearchLive, StorageLive, TelemetryRouteLive, TransferLive, UsersLive).pipe(Layer.provide(ServicesLayer));
const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayer));

// --- [SERVER_LAYER] ----------------------------------------------------------
// HTTP server with middleware pipeline: context → trace → security → metrics → logging.

const ServerLayer = Layer.unwrapEffect(Effect.gen(function* () {
	const db = yield* DatabaseService;
	return HttpApiBuilder.serve((app) => app.pipe(
		Middleware.xForwardedHeaders,
		Middleware.makeRequestContext(Middleware.makeAppLookup(db)),
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

NodeRuntime.runMain(Effect.scoped(Layer.launch(ServerLayer)).pipe(
	Effect.onInterrupt(() => Effect.logInfo('Graceful shutdown initiated')),
	Effect.ensuring(Effect.logInfo('Server shutdown complete')),
));
