/**
 * Unified metrics service with single polymorphic label function.
 * No custom types - uses Effect's official types directly.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Effect, HashSet, Metric, MetricLabel, Stream } from 'effect';
import { Context } from '../context.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	labels: {			// Prometheus label value limit is 128 chars; we truncate at 120 to leave room for suffix
		maxContent: 120,
		truncateSuffix: '...',
	},
} as const;
const _boundaries = {	// SLA-aligned histogram boundaries in seconds for different operation types.
	http: 		[0.001, 0.01, 0.1, 1, 10, 100] as const,					// Web request latencies
	jobs: 		[0.01, 0.1, 1, 10, 100, 1000] as const,						// Background processing
	oauth: 		[0.1, 0.5, 1, 2, 5, 10, 30] as const,						// OAuth token exchanges (external APIs)
	rateLimit: 	[0.0001, 0.001, 0.01, 0.1, 1] as const,						// Fast checks
	storage: 	[0.005, 0.025, 0.125, 0.625, 3.125, 15.625, 78.125, 390.625] as const,	// S3 operations (5x exponential)
	transfer: 	[0.1, 0.5, 2.5, 12.5, 62.5, 312.5] as const,				// Data transfers (5x exponential)
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _extractErrorTag = (err: unknown): string => typeof err === 'object' && err !== null && '_tag' in err ? String(err._tag) : 'UnknownError';

// --- [SERVICES] --------------------------------------------------------------

class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
	effect: Effect.succeed({
		audit: {
			failures: Metric.counter('audit_failures_total'),
			writes: Metric.counter('audit_writes_total'),
		},
		auth: {
			apiKeys: Metric.counter('auth_api_keys_total'),
			logins: Metric.counter('auth_logins_total'),
			logouts: Metric.counter('auth_logouts_total'),
			refreshes: Metric.counter('auth_refreshes_total'),
			session: {
				hits: Metric.counter('auth_session_hits_total'),
				lookups: Metric.counter('auth_session_lookups_total'),
				misses: Metric.counter('auth_session_misses_total'),
			},
		},
		circuit: { stateChanges: Metric.frequency('circuit_state_changes_total') },
		errors: Metric.frequency('errors_total'),
		fiber: {
			active: Metric.fiberActive,
			failures: Metric.fiberFailures,
			lifetimes: Metric.fiberLifetimes,
			started: Metric.fiberStarted,
			successes: Metric.fiberSuccesses,
		},
		http: {
			active: Metric.gauge('http_requests_active'),
			duration: Metric.timerWithBoundaries('http_request_duration_seconds', _boundaries.http),
			requests: Metric.counter('http_requests_total'),
		},
		jobs: {
			completions: Metric.counter('jobs_completed_total'),
			deadLettered: Metric.counter('jobs_dead_lettered_total'),
			duration: Metric.timerWithBoundaries('jobs_duration_seconds', _boundaries.jobs),
			enqueued: Metric.counter('jobs_enqueued_total'),
			failures: Metric.counter('jobs_failed_total'),
			queueDepth: Metric.gauge('jobs_queue_depth'),
			retries: Metric.counter('jobs_retried_total'),
			waitDuration: Metric.timerWithBoundaries('jobs_wait_duration_seconds', _boundaries.jobs),
		},
		mfa: {
			disabled: Metric.counter('mfa_disabled_total'),
			enrollments: Metric.counter('mfa_enrollments_total'),
			recoveryUsed: Metric.counter('mfa_recovery_used_total'),
			verifications: Metric.counter('mfa_verifications_total'),
		},
		oauth: {
			authentications: Metric.counter('oauth_authentications_total'),
			authorizations: Metric.counter('oauth_authorizations_total'),
			duration: Metric.timerWithBoundaries('oauth_duration_seconds', _boundaries.oauth),
		},
		rateLimit: {
			checkDuration: Metric.timerWithBoundaries('rate_limit_check_duration_seconds', _boundaries.rateLimit),
			rejections: Metric.counter('rate_limit_rejections_total'),
			storeFailures: Metric.counter('rate_limit_store_failures_total'),
		},
		search: {
			queries: Metric.counter('search_queries_total', { description: 'Total search queries' }),
			refreshes: Metric.counter('search_refreshes_total', { description: 'Total index refreshes' }),
			suggestions: Metric.counter('search_suggestions_total', { description: 'Total suggestion requests' }),
		},
		storage: {
			bytes: Metric.counter('storage_bytes_total'),
			duration: Metric.timerWithBoundaries('storage_operation_duration_seconds', _boundaries.storage),
			errors: Metric.counter('storage_errors_total'),
			multipart: {
				bytes: Metric.counter('storage_multipart_bytes_total'),
				parts: Metric.counter('storage_multipart_parts_total'),
				uploads: Metric.counter('storage_multipart_uploads_total'),
			},
			operations: Metric.counter('storage_operations_total'),
			stream: { duration: Metric.timerWithBoundaries('storage_stream_duration_seconds', _boundaries.storage) },
		},
		transfer: {
			duration: Metric.timerWithBoundaries('transfer_duration_seconds', _boundaries.transfer),
			exports: Metric.counter('transfer_exports_total'),
			imports: Metric.counter('transfer_imports_total'),
			rows: Metric.counter('transfer_rows_total'),
		},
	}),
}) {
	// --- [LABEL] -------------------------------------------------------------
	// Single polymorphic label function - accepts any dimensions, filters undefined values. Sanitizes values to prevent overflow and control character issues.
	static readonly label = (pairs: Record<string, string | undefined>): HashSet.HashSet<MetricLabel.MetricLabel> =>
		HashSet.fromIterable(
			Object.entries(pairs)
				.filter((entry): entry is [string, string] => entry[1] !== undefined)
				.map(([k, v]) => MetricLabel.make(k, ((s) =>
					s.length > _config.labels.maxContent
						? `${s.slice(0, _config.labels.maxContent)}${_config.labels.truncateSuffix}`
						: s
					// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars
				)(v.normalize('NFKC').replaceAll(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff\u00ad]/g, '')))),	// NOSONAR S6324
		);
	// --- [INCREMENT] ---------------------------------------------------------
	static readonly inc = (								// Increment counter with labels using official Metric.increment/incrementBy APIs.
		counter: Metric.Metric.Counter<number>,
		labels: HashSet.HashSet<MetricLabel.MetricLabel>,
		value = 1,
	): Effect.Effect<void> =>
		value === 1
			? Metric.increment(Metric.taggedWithLabels(counter, labels))
			: Metric.incrementBy(Metric.taggedWithLabels(counter, labels), value);
	// --- [TRACKING] ----------------------------------------------------------
	static readonly trackEffect = <A, E, R>(			// Unified effect tracker - composes duration + error + defect tracking via official Metric APIs.
		effect: Effect.Effect<A, E, R>,
		config: {
			readonly duration: ReturnType<typeof Metric.timerWithBoundaries>;
			readonly errors: Metric.Metric.Frequency<string>;
			readonly labels: HashSet.HashSet<MetricLabel.MetricLabel>;
		},
	): Effect.Effect<A, E, R> =>
		effect.pipe(
			Metric.trackDuration(Metric.taggedWithLabels(config.duration, config.labels)),
			Metric.trackErrorWith(Metric.taggedWithLabels(config.errors, config.labels), _extractErrorTag),
			Metric.trackDefectWith(Metric.taggedWithLabels(config.errors, config.labels), _extractErrorTag),
		);
	static readonly trackStream = <A, E, R>(			// Tracks stream element count by incrementing counter for each element.
		stream: Stream.Stream<A, E, R>,
		counter: Metric.Metric.Counter<number>,
		labelPairs: Record<string, string | undefined>,
	): Stream.Stream<A, E, R> => {
		const labels = MetricsService.label(labelPairs);
		return Stream.tap(stream, () => Metric.increment(Metric.taggedWithLabels(counter, labels)));
	};
	static readonly trackStreamProgress = <A, E, R>(	// Tracks stream progress with periodic logging and counter increment per element. Uses sampling to reduce logging overhead on high-volume streams.
		stream: Stream.Stream<A, E, R>,
		config: {
			readonly counter: Metric.Metric.Counter<number>;
			readonly labels: Record<string, string | undefined>;
			readonly logInterval?: number;
		},
	): Stream.Stream<A, E, R> => {
		const labels = MetricsService.label(config.labels);
		const interval = config.logInterval ?? 1000;
		return stream.pipe(
			Stream.zipWithIndex,
			Stream.tap(([, idx]) =>
				idx > 0 && idx % interval === 0
					? Effect.logInfo('Stream progress', { items: idx, ...config.labels })
					: Effect.void,
			),
			Stream.tap(() => Metric.increment(Metric.taggedWithLabels(config.counter, labels))),
			Stream.map(([item]) => item),
		);
	};
	// --- [HTTP_MIDDLEWARE] ---------------------------------------------------
	static readonly middleware = HttpMiddleware.make((app) =>	/** HTTP metrics middleware - tracks active requests, duration, errors per tenant. */
		Effect.gen(function* () {
			const metrics = yield* MetricsService;
			const req = yield* HttpServerRequest.HttpServerRequest;
			const path = (req.url.split('?')[0] ?? '/').split('/').map((seg) =>
				seg
					? ([
						[/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ':uuid'],
						[/^\d+$/, ':id'],
						[/^[0-9a-f]{6,64}$/i, ':hash'],
						[/^[A-Za-z0-9_-]{16,}={0,2}$/, ':token'],
					] as const).find(([re]) => re.test(seg))?.[1] ?? seg
					: seg,
			).join('/');
			const tenantId = yield* Context.Request.tenantId;
			const baseLabels = MetricsService.label({ method: req.method, path, tenant: tenantId });
			const tenantLabels = MetricsService.label({ tenant: tenantId });
			const activeGauge = Metric.taggedWithLabels(metrics.http.active, tenantLabels);
			yield* Metric.update(activeGauge, 1);
			return yield* app.pipe(
				Metric.trackDuration(Metric.taggedWithLabels(metrics.http.duration, baseLabels)),
				Metric.trackErrorWith(Metric.taggedWithLabels(metrics.errors, tenantLabels), _extractErrorTag),
				Effect.tap((res) => {
					const withStatus = HashSet.add(baseLabels, MetricLabel.make('status', String(res.status)));
					return Metric.increment(Metric.taggedWithLabels(metrics.http.requests, withStatus));
				}),
				Effect.ensuring(Metric.update(activeGauge, -1)),
			);
		}),
	);
}

// --- [EXPORT] ----------------------------------------------------------------

export { MetricsService };
