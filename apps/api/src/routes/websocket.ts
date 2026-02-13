/**
 * WebSocket upgrade endpoint with authenticated tenant context.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { WebSocketService } from '@parametric-portal/server/platform/websocket';
import { Effect } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _Handled = Symbol.for('@effect/platform/HttpApp/handled');

// --- [FUNCTIONS] -------------------------------------------------------------

const handleConnect = (webSocket: typeof WebSocketService.Service) =>
    Effect.gen(function* () {
        yield* Middleware.feature('enableRealtime');
        yield* Middleware.permission('websocket', 'connect');
        const [request, socket, session, tenantId] = yield* Effect.all([
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.upgrade,
            Context.Request.sessionOrFail,
            Context.Request.currentTenantId,
        ]);
        yield* Effect.sync(() => {(request as unknown as Record<PropertyKey, unknown>)[_Handled] = true;});
        yield* webSocket.accept(socket, session.userId, tenantId);
        return HttpServerResponse.empty();
    }).pipe(
        HttpError.mapTo('WebSocket failed'),
        Telemetry.span('websocket.connect'),
    );

// --- [LAYERS] ----------------------------------------------------------------

const WebSocketLive = HttpApiBuilder.group(ParametricApi, 'websocket', (handlers) =>
    Effect.gen(function* () {
        const webSocket = yield* WebSocketService;
        return handlers.handleRaw('connect', () =>CacheService.rateLimit('realtime', handleConnect(webSocket)),);
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebSocketLive };
