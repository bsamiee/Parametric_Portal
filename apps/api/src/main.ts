/**
 * API server entry point with Layer composition.
 * Middleware composition + parallel health checks via Effect.all.
 */

import { createServer } from 'node:http';
import type { HttpApp } from '@effect/platform';
import { HttpApiSwagger, HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { AnthropicClientLive } from '@parametric-portal/ai/anthropic';
import { PgLive } from '@parametric-portal/database/client';
import { sessionToResult } from '@parametric-portal/database/models';
import { makeRepositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder } from '@parametric-portal/server/api';
import { ServiceUnavailableError, UnauthorizedError } from '@parametric-portal/server/errors';
import {
    createCorsLayer,
    createRequestIdMiddleware,
    createSecurityHeadersMiddleware,
    createSessionAuthLayer,
} from '@parametric-portal/server/middleware';
import { Effect, Layer, Option, pipe } from 'effect';
import { AppApi } from './api.ts';
import { OAuthServiceLive } from './oauth.ts';
import { AuthLive } from './routes/auth.ts';
import { IconsLive } from './routes/icons.ts';
import { IconGenerationServiceLive } from './services/icons.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cors: { allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'] },
    port: 4000,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const composeMiddleware = (app: HttpApp.Default): HttpApp.Default<never, never> =>
    pipe(app, createSecurityHeadersMiddleware(), createRequestIdMiddleware(), HttpMiddleware.logger);

// --- [LAYERS] ----------------------------------------------------------------

const SessionAuthLive = pipe(
    Layer.unwrapEffect(
        Effect.map(makeRepositories, (repos) =>
            createSessionAuthLayer((tokenHash: string) =>
                pipe(
                    repos.sessions.findByTokenHash(tokenHash),
                    Effect.map((session) => Option.map(session, sessionToResult)),
                    Effect.catchAll(() => Effect.fail(new UnauthorizedError({ reason: 'Session lookup failed' }))),
                ),
            ),
        ),
    ),
    Layer.provide(PgLive),
);

const HealthLive = HttpApiBuilder.group(AppApi, 'health', (handlers) =>
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
                            : Effect.fail(new ServiceUnavailableError({ reason: 'Database check failed' })),
                    ),
                ),
            );
    }),
);

const ApiLive = HttpApiBuilder.api(AppApi).pipe(
    Layer.provide(Layer.mergeAll(HealthLive, AuthLive, IconsLive)),
    Layer.provide(PgLive),
    Layer.provide(OAuthServiceLive),
    Layer.provide(IconGenerationServiceLive),
    Layer.provide(AnthropicClientLive),
);

const ServerLive = pipe(
    HttpApiBuilder.serve(composeMiddleware),
    Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
    Layer.provide(ApiLive),
    Layer.provide(createCorsLayer({ allowedOrigins: B.cors.allowedOrigins })),
    Layer.provide(SessionAuthLive),
    HttpServer.withLogAddress,
    Layer.provide(NodeHttpServer.layer(createServer, { port: B.port })),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
