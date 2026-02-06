/**
 * Job status SSE streaming endpoint.
 * Real-time status updates via Server-Sent Events, MFA-gated subscription.
 */
import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Middleware } from '@parametric-portal/server/middleware';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Effect, } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const handleSubscribe = (jobs: typeof JobService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const ctx = yield* Context.Request.current;
		const appId = ctx.tenantId;
		return yield* StreamingService.sse({
			filter: (event) => event.tenantId === appId,
			name: 'jobs.status',
			serialize: (event) => ({ data: JSON.stringify(event), event: 'status', id: event.jobId }),
			source: jobs.onStatusChange(),
		});
	}).pipe(
		Effect.catchAll((error) => Effect.fail('_tag' in error && error._tag === 'Forbidden' ? error : HttpError.Internal.of('SSE failed', error))),
		Telemetry.span('jobs.subscribe', { kind: 'server', metrics: false }),
	);

// --- [LAYERS] ----------------------------------------------------------------

const JobsLive = HttpApiBuilder.group(ParametricApi, 'jobs', (handlers) =>
	Effect.gen(function* () {
		const jobs = yield* JobService;
		return handlers.handleRaw('subscribe', () => CacheService.rateLimit('realtime', handleSubscribe(jobs)),);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { JobsLive };
