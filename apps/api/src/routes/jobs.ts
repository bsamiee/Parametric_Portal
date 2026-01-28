/**
 * Job status SSE streaming endpoint.
 * Provides real-time job status updates via Server-Sent Events.
 *
 * [PATTERN] Uses JobService (infra) directly without domain wrapper.
 * JobService is a hybrid that owns both orchestration and events - see jobs.ts header for rationale.
 */
import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const handleSubscribe = Effect.fn('jobs.subscribe')(
	(jobs: typeof JobService.Service) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const ctx = yield* Context.Request.current;
			const appId = ctx.tenantId;
			return yield* StreamingService.sse({
				filter: (event) => event.appId === appId,
				name: 'jobs.status',
				serialize: (event) => ({ data: JSON.stringify(event), event: 'status', id: event.jobId }),
				source: jobs.onStatusChange(),
			});
		}).pipe(
			Effect.mapError((err) =>
				'_tag' in err && err._tag === 'Forbidden' ? err : HttpError.Internal.of('SSE failed', err),
			),
		),
);

// --- [LAYERS] ----------------------------------------------------------------

const JobsLive = HttpApiBuilder.group(ParametricApi, 'jobs', (handlers) =>
	Effect.gen(function* () {
		const jobs = yield* JobService;
		return handlers.handleRaw('subscribe', () =>
			CacheService.rateLimit('api', handleSubscribe(jobs)),
		);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { JobsLive };
