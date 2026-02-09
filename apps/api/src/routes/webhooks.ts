import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Middleware } from '@parametric-portal/server/middleware';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as EffectArray, Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const WebhooksLive = HttpApiBuilder.group(ParametricApi, 'webhooks', (handlers) =>
	Effect.gen(function* () {
		const [webhooks, audit] = yield* Effect.all([WebhookService, AuditService]);
		const requireAdmin = Middleware.mfaVerified.pipe(Effect.andThen(Middleware.role('admin')));
		return handlers
				.handle('list', () => CacheService.rateLimit('api', requireAdmin.pipe(
					Effect.andThen(Context.Request.currentTenantId),
					Effect.flatMap((tenantId) => webhooks.list(tenantId)),
					Effect.map(EffectArray.map((item) => ({ active: item.active, allowWebhookEvents: item.allowWebhookEvents, eventTypes: item.eventTypes, timeout: item.endpoint.timeout, url: item.endpoint.url }))),
					Effect.mapError((error): HttpError.Auth | HttpError.Forbidden | HttpError.Internal =>
						error instanceof HttpError.Auth || error instanceof HttpError.Forbidden || error instanceof HttpError.Internal
							? error
							: HttpError.Internal.of('Webhook list failed', error)),
					Telemetry.span('webhooks.list', { kind: 'server', metrics: false }),
				)))
			.handle('register', ({ payload }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.register(tenantId, {
					active: payload.active,
					allowWebhookEvents: payload.allowWebhookEvents,
					endpoint: new WebhookService.Endpoint({ secret: payload.secret, timeout: payload.timeout, url: payload.url }),
					eventTypes: payload.eventTypes,
				})),
				Effect.mapError((error) => HttpError.Internal.of('Webhook registration failed', error)),
				Effect.tap(() => audit.log('Webhook.register', { details: { url: payload.url } })),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.register', { kind: 'server', metrics: false }),
			)))
			.handle('remove', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Effect.all([Context.Request.currentTenantId, Effect.try({
					catch: HttpError.Validation.of.bind(null, 'url', 'Malformed webhook URL encoding'),
					try: decodeURIComponent.bind(null, path.url),
				})])),
				Effect.flatMap(([tenantId, decodedUrl]) => webhooks.remove(tenantId, decodedUrl)),
				Effect.mapError((error): HttpError.Validation | HttpError.Internal =>
					error instanceof HttpError.Validation || error instanceof HttpError.Internal
						? error
						: HttpError.Internal.of('Webhook remove failed', error)),
				Effect.tap(() => audit.log('Webhook.remove', { details: { url: path.url } })),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.remove', { kind: 'server', metrics: false }),
			)))
			.handle('test', ({ payload }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.test(tenantId, new WebhookService.Endpoint({ secret: payload.secret, timeout: payload.timeout, url: payload.url }))),
				Effect.mapError((error) => HttpError.Internal.of('Webhook test delivery failed', error)),
				Telemetry.span('webhooks.test', { kind: 'server', metrics: false }),
			)))
				.handle('retry', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
					Effect.andThen(webhooks.retry(path.id)),
					Effect.mapError((error): HttpError.NotFound | HttpError.Internal =>
					error instanceof WebhookService.Error && error.reason === 'NotFound'
						? HttpError.NotFound.of('dlq', path.id)
						: HttpError.Internal.of('Webhook retry failed', error)),
					Effect.as({ success: true as const }),
					Telemetry.span('webhooks.retry', { kind: 'server', metrics: false, 'webhook.delivery_id': path.id }),
				)))
				.handle('status', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
					Effect.andThen(Context.Request.currentTenantId),
					Effect.flatMap((tenantId) => webhooks.status(tenantId, urlParams.url)),
					Effect.mapError((error): HttpError.Auth | HttpError.Forbidden | HttpError.Internal =>
						error instanceof HttpError.Auth || error instanceof HttpError.Forbidden || error instanceof HttpError.Internal
							? error
							: HttpError.Internal.of('Webhook status failed', error)),
					Telemetry.span('webhooks.status', { kind: 'server', metrics: false }),
				)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebhooksLive };
