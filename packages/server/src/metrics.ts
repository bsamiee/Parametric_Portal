/**
 * Provide unified metrics: HTTP, MFA, audit, rate-limit observability.
 * Segments by app label from RequestContext for multi-tenant analysis.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Effect, Metric, Option, Stream } from 'effect';
import { RequestContext } from './context.ts';

// --- [SERVICES] --------------------------------------------------------------

class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
	effect: Effect.succeed({
		audit: { failures: Metric.counter('audit_failures_total'), writes: Metric.counter('audit_writes_total') },
		auth: {
			apiKeys: Metric.counter('auth_api_keys_total'),
			logins: Metric.counter('auth_logins_total'),
			logouts: Metric.counter('auth_logouts_total'),
			refreshes: Metric.counter('auth_refreshes_total'),
		},
		circuit: { stateChanges: Metric.frequency('circuit_state_changes_total') },
		errors: Metric.frequency('errors_total'),
		http: { active: Metric.gauge('http_requests_active'), duration: Metric.timer('http_request_duration_seconds'), requests: Metric.counter('http_requests_total') },
		mfa: { disabled: Metric.counter('mfa_disabled_total'), enrollments: Metric.counter('mfa_enrollments_total'), recoveryUsed: Metric.counter('mfa_recovery_used_total'), verifications: Metric.counter('mfa_verifications_total') },
		rateLimit: { checkDuration: Metric.timer('rate_limit_check_duration_seconds'), rejections: Metric.frequency('rate_limit_rejections_total'), storeFailures: Metric.counter('rate_limit_store_failures_total') },
		transfer: {
			duration: Metric.timer('transfer_duration_seconds'),
			exports: Metric.counter('transfer_exports_total'),
			imports: Metric.counter('transfer_imports_total'),
			rows: Metric.counter('transfer_rows_total'),
		},
	}),
}) {
	static readonly trackStream = <A, E, R>( 	/** Universal stream counter - tracks items processed through any stream with configurable tags. */
		stream: Stream.Stream<A, E, R>,
		counter: Metric.Metric.Counter<number>,
		tags: Record<string, string>,
	): Stream.Stream<A, E, R> =>
		Stream.unwrap(Effect.sync(() => {
			const state = { count: 0 };
			const tagged = Object.entries(tags).reduce((metric, [key, val]) => metric.pipe(Metric.tagged(key, val)), counter);
			return stream.pipe(
				Stream.tap(() => Effect.sync(() => { state.count += 1; })),
				Stream.ensuring(Metric.update(tagged, state.count)),
			);
		}));
}

// --- [MIDDLEWARE] ------------------------------------------------------------

const metricsMiddleware = HttpMiddleware.make((app) =>
	Effect.gen(function* () {
		const metrics = yield* MetricsService;
		const req = yield* HttpServerRequest.HttpServerRequest;
		const path = req.url.split('?')[0] ?? '/';
		const appId = Option.getOrElse(Option.map((yield* Effect.serviceOption(RequestContext)), (ctx) => ctx.appId), () => 'unknown');
		const active = metrics.http.active.pipe(Metric.tagged('app', appId));
		yield* Metric.modify(active, 1);
		return yield* app.pipe(
			Metric.trackDuration(metrics.http.duration.pipe(Metric.tagged('method', req.method), Metric.tagged('path', path), Metric.tagged('app', appId))),
			Metric.trackErrorWith(metrics.errors.pipe(Metric.tagged('app', appId)), (err) => typeof err === 'object' && err !== null && '_tag' in err ? String(err._tag) : 'UnknownError'),
			Effect.tap((res) => Metric.update(metrics.http.requests.pipe(Metric.tagged('method', req.method), Metric.tagged('path', path), Metric.tagged('status', String(res.status)), Metric.tagged('app', appId)), 1)),
			Effect.ensuring(Metric.modify(active, -1)),
		);
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { metricsMiddleware, MetricsService };
