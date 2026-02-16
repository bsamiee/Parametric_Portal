import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Middleware } from '@parametric-portal/server/middleware';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as Arr, Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const WebhooksLive = HttpApiBuilder.group(ParametricApi, 'webhooks', (handlers) =>
    Effect.gen(function* () {
        const [webhooks, audit] = yield* Effect.all([WebhookService, AuditService]);
        const webhooksRoute = Middleware.resource('webhooks');
        return handlers
            .handle('list', () => webhooksRoute.api('list', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(Context.Request.currentTenantId),
                Effect.flatMap((tenantId) => webhooks.list(tenantId)),
                Effect.map(Arr.map((item) => ({ active: item.active, eventTypes: item.eventTypes, timeout: item.endpoint.timeout, url: item.endpoint.url }))),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('app', 'current')
                    : HttpError.Internal.of('Webhook list failed', e),
                ),
            )))
            .handle('register', ({ payload }) => webhooksRoute.mutation('register', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(Context.Request.currentTenantId),
                Effect.flatMap((tenantId) => webhooks.register(tenantId, {
                    active: payload.active,
                    endpoint: new WebhookService.Endpoint(payload),
                    eventTypes: payload.eventTypes,
                })),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('app', 'current')
                    : HttpError.Internal.of('Webhook registration failed', e),
                ),
                Effect.tap(() => audit.log('Webhook.register', { details: { url: payload.url } })),
                Effect.as({ success: true as const }),
            )))
            .handle('remove', ({ path }) => webhooksRoute.mutation('remove', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(Effect.all([Context.Request.currentTenantId, Effect.try({
                    catch: HttpError.Validation.of.bind(null, 'url', 'Malformed webhook URL encoding'),
                    try: decodeURIComponent.bind(null, path.url),
                })])),
                Effect.flatMap(([tenantId, decodedUrl]) => webhooks.remove(tenantId, decodedUrl)),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('app', 'current')
                    : HttpError.Internal.of('Webhook remove failed', e),
                ),
                Effect.tap(() => audit.log('Webhook.remove', { details: { url: path.url } })),
                Effect.as({ success: true as const }),
            )))
            .handle('test', ({ payload }) => webhooksRoute.mutation('test', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(Context.Request.currentTenantId),
                Effect.flatMap((tenantId) => webhooks.test(tenantId, new WebhookService.Endpoint(payload))),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('app', 'current')
                    : HttpError.Internal.of('Webhook test delivery failed', e),
                ),
            )))
            .handle('retry', ({ path }) => webhooksRoute.mutation('retry', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(webhooks.retry(path.id)),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('dlq', path.id)
                    : HttpError.Internal.of('Webhook retry failed', e),
                ),
                Effect.as({ success: true as const }),
                Telemetry.span('webhooks.retry', { 'webhook.delivery_id': path.id }),
            )))
            .handle('status', ({ urlParams }) => webhooksRoute.api('status', Middleware.feature('enableWebhooks').pipe(
                Effect.andThen(Context.Request.currentTenantId),
                Effect.flatMap((tenantId) => webhooks.status(tenantId, urlParams.url)),
                Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
                    ? HttpError.NotFound.of('app', 'current')
                    : HttpError.Internal.of('Webhook status failed', e),
                ),
            )));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebhooksLive };
