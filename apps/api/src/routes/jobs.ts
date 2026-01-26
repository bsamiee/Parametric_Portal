/**
 * Job status SSE streaming endpoint.
 * Provides real-time job status updates via Server-Sent Events.
 *
 * [PATTERN] Uses JobService (infra) directly without domain wrapper.
 * JobService is a hybrid that owns both orchestration and events - see jobs.ts header for rationale.
 */
import { Headers, HttpApiBuilder, HttpServerResponse } from '@effect/platform';
import { Sse } from '@effect/experimental';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { RateLimit } from '@parametric-portal/server/security/rate-limit';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Stream } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const handleSubscribe = Effect.fn('jobs.subscribe')(
	(jobs: typeof JobService.Service) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const ctx = yield* Context.Request.current;
			const appId = ctx.tenantId;
			const encoder = new TextEncoder();
			const sseStream = jobs.onStatusChange().pipe(
				Stream.filter((event) => event.appId === appId),
				Stream.map((event) =>
					encoder.encode(Sse.encoder.write({
						_tag: 'Event',
						data: JSON.stringify(event),
						event: 'status',
						id: event.jobId,
					})),
				),
				Stream.catchAll((err) =>
					Stream.succeed(
						encoder.encode(Sse.encoder.write({
							_tag: 'Event',
							data: JSON.stringify({ error: String(err) }),
							event: 'error',
							id: undefined,
						})),
					),
				),
			);
			return HttpServerResponse.stream(sseStream, {
				contentType: 'text/event-stream',
				headers: Headers.fromInput({
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				}),
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
			RateLimit.apply('api', handleSubscribe(jobs)),
		);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { JobsLive };
