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
		return handlers
			.handle('list', () => Middleware.guarded('webhooks', 'list', 'api', Middleware.feature('enableWebhooks').pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.list(tenantId)),
				Effect.map(Arr.map((item) => ({ active: item.active, eventTypes: item.eventTypes, timeout: item.endpoint.timeout, url: item.endpoint.url }))),
				Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
					? HttpError.NotFound.of('app', 'current')
					: HttpError.Internal.of('Webhook list failed', e),
				),
				Telemetry.span('webhooks.list', { kind: 'server', metrics: false }),
			)))
			.handle('register', ({ payload }) => Middleware.guarded('webhooks', 'register', 'mutation', Middleware.feature('enableWebhooks').pipe(
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
				Telemetry.span('webhooks.register', { kind: 'server', metrics: false }),
			)))
			.handle('remove', ({ path }) => Middleware.guarded('webhooks', 'remove', 'mutation', Middleware.feature('enableWebhooks').pipe(
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
				Telemetry.span('webhooks.remove', { kind: 'server', metrics: false }),
			)))
			.handle('test', ({ payload }) => Middleware.guarded('webhooks', 'test', 'mutation', Middleware.feature('enableWebhooks').pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.test(tenantId, new WebhookService.Endpoint(payload))),
				Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
					? HttpError.NotFound.of('app', 'current')
					: HttpError.Internal.of('Webhook test delivery failed', e),
				),
				Telemetry.span('webhooks.test', { kind: 'server', metrics: false }),
			)))
			.handle('retry', ({ path }) => Middleware.guarded('webhooks', 'retry', 'mutation', Middleware.feature('enableWebhooks').pipe(
				Effect.andThen(webhooks.retry(path.id)),
				Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
					? HttpError.NotFound.of('dlq', path.id)
					: HttpError.Internal.of('Webhook retry failed', e),
				),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.retry', { kind: 'server', metrics: false, 'webhook.delivery_id': path.id }),
			)))
			.handle('status', ({ urlParams }) => Middleware.guarded('webhooks', 'status', 'api', Middleware.feature('enableWebhooks').pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.status(tenantId, urlParams.url)),
				Effect.mapError((e) => e instanceof WebhookService.Error && e.reason === 'NotFound'
					? HttpError.NotFound.of('app', 'current')
					: HttpError.Internal.of('Webhook status failed', e),
				),
				Telemetry.span('webhooks.status', { kind: 'server', metrics: false }),
			)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebhooksLive };
