/**
 * Webhook management endpoints.
 * Admin-gated CRUD for webhook registrations, test delivery, retry, status.
 */
import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Middleware } from '@parametric-portal/server/middleware';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const WebhooksLive = HttpApiBuilder.group(ParametricApi, 'webhooks', (handlers) =>
	Effect.gen(function* () {
		const [webhooks, audit] = yield* Effect.all([WebhookService, AuditService]);
		const requireAdmin = Middleware.requireMfaVerified.pipe(Effect.andThen(Middleware.requireRole('admin')));
		return handlers
			.handle('list', () => CacheService.rateLimit('api', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.list(tenantId).pipe(Effect.map((items) => items.map((item) => ({ active: item.active, eventTypes: item.eventTypes, timeout: item.endpoint.timeout, url: item.endpoint.url }))),)),
				Telemetry.span('webhooks.list', { kind: 'server', metrics: false }),
			)))
			.handle('register', ({ payload }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.register(tenantId, {
					active: payload.active,
					endpoint: new WebhookService.Endpoint({ secret: payload.secret, timeout: payload.timeout, url: payload.url }),
					eventTypes: payload.eventTypes,
				}).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Webhook registration failed', error))),)),
				Effect.tap(() => audit.log('Webhook.register', { details: { url: payload.url } })),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.register', { kind: 'server', metrics: false, 'webhook.url': payload.url }),
			)))
			.handle('remove', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.remove(tenantId, decodeURIComponent(path.url)).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Webhook remove failed', error))),)),
				Effect.tap(() => audit.log('Webhook.remove', { details: { url: path.url } })),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.remove', { kind: 'server', metrics: false, 'webhook.url': decodeURIComponent(path.url) }),
			)))
			.handle('test', ({ payload }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.test(tenantId, new WebhookService.Endpoint({ secret: payload.secret, timeout: payload.timeout, url: payload.url })).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Webhook test delivery failed', error))),)),
				Telemetry.span('webhooks.test', { kind: 'server', metrics: false, 'webhook.url': payload.url }),
			)))
			.handle('retry', ({ path }) => CacheService.rateLimit('mutation', requireAdmin.pipe(
				Effect.andThen(webhooks.retry(path.id).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Webhook retry failed', error))),)),
				Effect.as({ success: true as const }),
				Telemetry.span('webhooks.retry', { kind: 'server', metrics: false, 'webhook.delivery_id': path.id }),
			)))
			.handle('status', ({ urlParams }) => CacheService.rateLimit('api', requireAdmin.pipe(
				Effect.andThen(Context.Request.currentTenantId),
				Effect.flatMap((tenantId) => webhooks.status(tenantId, urlParams.url)),
				Telemetry.span('webhooks.status', { kind: 'server', metrics: false }),
			)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { WebhooksLive };
