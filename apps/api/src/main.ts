/**
 * API server entry point with Layer composition.
 * Middleware composition + parallel health checks via Effect.all.
 */

import { createServer } from 'node:http';
import type { HttpApp } from '@effect/platform';
import { HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { PgLive } from '@parametric-portal/database/client';
import { makeRepositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder } from '@parametric-portal/server/api';
import { ServiceUnavailableError, UnauthorizedError } from '@parametric-portal/server/errors';
import {
    createCorsLayer,
    createRequestIdMiddleware,
    createSecurityHeadersMiddleware,
    createSessionAuthLayer,
} from '@parametric-portal/server/middleware';
import type { SessionResult } from '@parametric-portal/types/database';
import { Context, Effect, Layer, Option, pipe } from 'effect';

import { AnthropicServiceLive } from './anthropic.ts';
import { AppApi } from './api.ts';
import { OAuthServiceLive } from './oauth.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';

// --- [TYPES] -----------------------------------------------------------------

type HealthCheckFn = Effect.Effect<boolean, never, SqlClient.SqlClient>;
type HealthCheckRegistry = Record<string, HealthCheckFn>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: { allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'] },
    port: 4000,
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class HealthChecks extends Context.Tag('HealthChecks')<HealthChecks, HealthCheckRegistry>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toSessionResult = (session: typeof import('@parametric-portal/database/models').Session.Type): SessionResult => ({
    expiresAt: new Date(session.expiresAt.epochMillis),
    sessionId: session.id,
    userId: session.userId,
});

const composeMiddleware = (app: HttpApp.Default): HttpApp.Default<never, never> =>
    pipe(app, createSecurityHeadersMiddleware(), createRequestIdMiddleware(), HttpMiddleware.logger);

// --- [LAYERS] ----------------------------------------------------------------

const SessionAuthLive = Layer.unwrapEffect(
    Effect.map(makeRepositories, (repos) =>
        createSessionAuthLayer((tokenHash: string) =>
            pipe(
                repos.sessions.findByTokenHash(tokenHash),
                Effect.map((session) => Option.map(session, toSessionResult)),
                Effect.catchAll(() => Effect.fail(new UnauthorizedError({ reason: 'Session lookup failed' }))),
            ),
        ),
    ),
);

const HealthChecksLive = Layer.succeed(HealthChecks, {
    database: pipe(
        Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`SELECT 1`;
            return true;
        }),
        Effect.catchAll(() => Effect.succeed(false)),
    ),
});

const HealthLive = HttpApiBuilder.group(AppApi, 'health', (handlers) =>
    handlers
        .handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
        .handle('readiness', () =>
            pipe(
                Effect.gen(function* () {
                    const checks = yield* HealthChecks;
                    const results = yield* Effect.all(checks);
                    const allPassed = Object.values(results).every(Boolean);

                    return allPassed
                        ? { checks: results, status: 'ok' as const }
                        : yield* Effect.fail(
                              new ServiceUnavailableError({ reason: 'One or more health checks failed' }),
                          );
                }),
                Effect.orDie,
            ),
        ),
);

const ApiLive = HttpApiBuilder.api(AppApi).pipe(
    Layer.provide(HealthLive),
    Layer.provide(AuthLive),
    Layer.provide(IconsLive),
);

const ServerLive = pipe(
    HttpApiBuilder.serve(composeMiddleware),
    Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
    Layer.provide(ApiLive),
    Layer.provide(createCorsLayer({ allowedOrigins: B.cors.allowedOrigins })),
    Layer.provide(HealthChecksLive),
    Layer.provide(SessionAuthLive),
    Layer.provide(OAuthServiceLive),
    Layer.provide(AnthropicServiceLive),
    Layer.provide(PgLive),
    HttpServer.withLogAddress,
    Layer.provide(NodeHttpServer.layer(createServer, { port: B.port })),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
