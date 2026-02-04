/**
 * WebSocket upgrade endpoint with authenticated tenant context.
 */
import { HttpApiBuilder, HttpServerRequest } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { WebSocketService } from '@parametric-portal/server/platform/websocket';
import { Effect, } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _Handled = Symbol.for('@effect/platform/HttpApp/handled');

// --- [FUNCTIONS] -------------------------------------------------------------

const handleConnect = Effect.fn('websocket.connect')(
	(webSocket: typeof WebSocketService.Service) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const [request, socket, session, tenantId] = yield* Effect.all([
				HttpServerRequest.HttpServerRequest,
				HttpServerRequest.upgrade,
				Context.Request.sessionOrFail,
				Context.Request.currentTenantId,
			]);
			yield* Effect.sync(() => {(request as unknown as Record<PropertyKey, unknown>)[_Handled] = true;});
			yield* webSocket.accept(socket, session.userId, tenantId);
			return yield* Effect.fail(HttpError.Internal.of('WebSocket closed'));
		}).pipe(Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('WebSocket failed', error))),),
);

// --- [LAYERS] ----------------------------------------------------------------

const WebSocketLive = HttpApiBuilder.group(ParametricApi, 'websocket', (handlers) =>
	Effect.gen(function* () {
		const webSocket = yield* WebSocketService;
		return handlers.handleRaw('connect', () =>CacheService.rateLimit('api', handleConnect(webSocket)),);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebSocketLive };
