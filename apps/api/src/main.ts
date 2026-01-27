/**
 * PENDING 2-STRING DOC HEADER
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
import { RateLimit } from '@parametric-portal/server/security/rate-limit';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { ReplayGuardService } from '@parametric-portal/server/security/totp-replay';
import { Config, Effect, Layer, ManagedRuntime } from 'effect';
import { AuditLive } from './routes/audit.ts';
import { AuthLive } from './routes/auth.ts';
import { HealthLive } from './routes/health.ts';
import { JobsLive } from './routes/jobs.ts';
import { SearchLive } from './routes/search.ts';
import { StorageLive } from './routes/storage.ts';
import { TelemetryRouteLive } from './routes/telemetry.ts';
import { TransferLive } from './routes/transfer.ts';
import { UsersLive } from './routes/users.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const serverConfig = Effect.runSync(
	Config.all({
		corsOrigins: Config.string('CORS_ORIGINS').pipe(
			Config.withDefault('*'),
			Config.map((s) => s.split(',').map((o) => o.trim()).filter(Boolean) as ReadonlyArray<string>),
		),
		port: Config.number('PORT').pipe(Config.withDefault(4000)),
	}),
);
const PlatformLayer = Layer.mergeAll(				// External resources (DB, S3, FileSystem, Telemetry) - no dependencies
	Client.layer,
	StorageAdapter.S3ClientLayer,
	NodeFileSystem.layer,
	Telemetry.Default,
);
const BaseInfraLayer = Layer.mergeAll(				// Database repos, search, pure utilities - depends on Platform
	DatabaseService.Default,
	SearchRepo.Default,
	MetricsService.Default,
	Crypto.Service.Default,
	Context.Request.SystemLayer,
).pipe(Layer.provideMerge(PlatformLayer));
const RateLimitLayer = RateLimit.Default.pipe(		// Provides RateLimiter + RateLimiterStore
	Layer.provideMerge(BaseInfraLayer),
);
const DataLayer = ReplayGuardService.Default.pipe(	// Requires RateLimiterStore from RateLimitLayer
	Layer.provideMerge(RateLimitLayer),
);
const CoreLayer = Layer.mergeAll(					// Infrastructure + Auth services - depends on Data (which includes Platform)
	StorageAdapter.Default,
	AuditService.Default,
	MfaService.Default,
	OAuthService.Default,
).pipe(Layer.provideMerge(DataLayer));
const DomainLayer = Layer.mergeAll(					// Business logic services - depends on Core (which includes Data + Platform)
	SessionService.Default,
	StorageService.Default,
	SearchService.Default,
	JobService.Default,
	PollingService.Default,
).pipe(Layer.provideMerge(CoreLayer));
// DomainLayer already includes all lower tiers via Layer.provideMerge chain
const AppLayer = DomainLayer;

// ManagedRuntime provides:
// 1. Clean lifecycle management (dispose() for graceful shutdown)
// 2. Testability (can create test runtime with mock layers)
// 3. Framework integration (React, Express, etc.)
const _AppRuntime = ManagedRuntime.make(AppLayer);	// MANAGED RUNTIME - All application services are available via AppRuntime.runPromise/runFork/etc.

// --- [HTTP_LAYER] ------------------------------------------------------------

const SessionAuthLayer = Layer.unwrapEffect(		// Session authentication middleware - Needs SessionService to validate tokens
	SessionService.pipe(Effect.map((session) => Middleware.Auth.makeLayer((hash) => session.lookup(hash)))),
).pipe(Layer.provide(AppLayer));
const RouteLayer = Layer.mergeAll(					// Route handlers - All routes get access to all application services
	AuditLive, AuthLive, HealthLive, JobsLive, SearchLive, StorageLive, TelemetryRouteLive, TransferLive, UsersLive,
).pipe(Layer.provide(AppLayer));
const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayer));

// --- [SERVER_LAYER] ----------------------------------------------------------

const ServerLayer = Layer.unwrapEffect(
	Effect.gen(function* () {
		const db = yield* DatabaseService;
		return HttpApiBuilder.serve((app) =>
			app.pipe(
				Middleware.xForwardedHeaders,
				Middleware.trace,
				Middleware.security(),
				Middleware.makeRequestContext(Middleware.makeAppLookup(db)),
				Middleware.metrics,
				RateLimit.headers,
				HttpMiddleware.logger,
			),
		).pipe(
			Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
			Layer.provide(ApiLayer),
			Layer.provide(Middleware.cors(serverConfig.corsOrigins)),
			Layer.provide(SessionAuthLayer),
			HttpServer.withLogAddress,
			Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
		);
	}),
).pipe(Layer.provide(AppLayer));

// --- [ENTRY_POINT] -----------------------------------------------------------

NodeRuntime.runMain(
	Effect.scoped(Layer.launch(ServerLayer)).pipe(
		Effect.onInterrupt(() => Effect.logInfo('Graceful shutdown initiated')),
		Effect.ensuring(Effect.logInfo('Server shutdown complete')),
	),
);
