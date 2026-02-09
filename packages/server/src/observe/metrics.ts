/**
 * Unified metrics service with single polymorphic label function.
 * No custom types - uses Effect's official types directly.
 */
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Effect, HashSet, Match, Metric, MetricLabel, Stream } from 'effect';
import { Context } from '../context.ts';

// --- [SERVICES] --------------------------------------------------------------

class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
	effect: Effect.succeed({
		ai: { duration: Metric.timerWithBoundaries('ai_duration_seconds', [0.1, 0.5, 2.5, 12.5, 62.5, 312.5]), embeddings: Metric.counter('ai_embeddings_total'), errors: Metric.frequency('ai_errors_total'), requests: Metric.counter('ai_requests_total'), tokens: Metric.counter('ai_tokens_total') },
		audit: { failures: Metric.counter('audit_failures_total'), writes: Metric.counter('audit_writes_total') },
		auth: {
			apiKey: { hits: Metric.counter('auth_api_key_hits_total'), lookups: Metric.counter('auth_api_key_lookups_total'), misses: Metric.counter('auth_api_key_misses_total') },
			apiKeys: Metric.counter('auth_api_keys_total'), logins: Metric.counter('auth_logins_total'), logouts: Metric.counter('auth_logouts_total'),
			refreshes: Metric.counter('auth_refreshes_total'), session: { hits: Metric.counter('auth_session_hits_total'), lookups: Metric.counter('auth_session_lookups_total'), misses: Metric.counter('auth_session_misses_total') },
		},
		cache: { evictions: Metric.counter('cache_evictions_total'), hits: Metric.counter('cache_hits_total'), lookupDuration: Metric.timerWithBoundaries('cache_lookup_duration_seconds', [0.001, 0.01, 0.1, 1]), misses: Metric.counter('cache_misses_total') },
		circuit: { stateChanges: Metric.frequency('circuit_state_changes_total') },
		cluster: {
			entityActivations: Metric.counter('cluster_entity_activations_total'), entityDeactivations: Metric.counter('cluster_entity_deactivations_total'),
			entityLifetime: Metric.timerWithBoundaries('cluster_entity_lifetime_seconds', [1, 5, 30, 60, 300, 600, 1800, 3600]),
			errors: Metric.counter('cluster_errors_total'), messageLatency: Metric.timerWithBoundaries('cluster_message_latency_seconds', [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5]),
			messagesReceived: Metric.counter('cluster_messages_received_total'), messagesSent: Metric.counter('cluster_messages_sent_total'), redeliveries: Metric.counter('cluster_redeliveries_total'),
		},
		database: { cacheHitRatio: Metric.gauge('database_cache_hit_ratio_percent'), ioReads: Metric.gauge('database_io_reads_total'), ioWrites: Metric.gauge('database_io_writes_total'), vectorIndexScans: Metric.gauge('database_vector_index_scans_total') },
		errors: Metric.frequency('errors_total'),
		events: {
			deadLettered: Metric.counter('events_dead_lettered_total'), deliveryLatency: Metric.timerWithBoundaries('events_delivery_latency_seconds', [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5]),
			duplicatesSkipped: Metric.counter('events_duplicates_skipped_total'), emitted: Metric.counter('events_emitted_total'), outboxDepth: Metric.gauge('events_outbox_depth'),
			processed: Metric.counter('events_processed_total'), retries: Metric.counter('events_retries_total'), subscriptions: Metric.gauge('events_subscriptions_active'),
		},
		fiber: { active: Metric.fiberActive, failures: Metric.fiberFailures, lifetimes: Metric.fiberLifetimes, started: Metric.fiberStarted, successes: Metric.fiberSuccesses },
		http: { active: Metric.gauge('http_requests_active'), duration: Metric.timerWithBoundaries('http_request_duration_seconds', [0.001, 0.01, 0.1, 1, 10, 100]), requests: Metric.counter('http_requests_total') },
		jobs: {
			cancellations: Metric.counter('jobs_cancelled_total'), completions: Metric.counter('jobs_completed_total'), deadLettered: Metric.counter('jobs_dead_lettered_total'),
			dlqSize: Metric.gauge('jobs_dlq_size'), duration: Metric.timerWithBoundaries('jobs_duration_seconds', [0.01, 0.1, 1, 10, 100, 1000]), enqueued: Metric.counter('jobs_enqueued_total'),
			failures: Metric.counter('jobs_failed_total'), processingSeconds: Metric.timerWithBoundaries('jobs_processing_seconds', [0.01, 0.1, 1, 10, 100, 1000]),
			queueDepth: Metric.gauge('jobs_queue_depth'), retries: Metric.counter('jobs_retried_total'), waitDuration: Metric.timerWithBoundaries('jobs_wait_duration_seconds', [0.01, 0.1, 1, 10, 100, 1000]),
		},
		mfa: { disabled: Metric.counter('mfa_disabled_total'), enrollments: Metric.counter('mfa_enrollments_total'), recoveryUsed: Metric.counter('mfa_recovery_used_total'), verifications: Metric.counter('mfa_verifications_total') },
		oauth: { authentications: Metric.counter('oauth_authentications_total'), authorizations: Metric.counter('oauth_authorizations_total'), duration: Metric.timerWithBoundaries('oauth_duration_seconds', [0.1, 0.5, 1, 2, 5, 10, 30]) },
		rateLimit: { checkDuration: Metric.timerWithBoundaries('rate_limit_check_duration_seconds', [0.0001, 0.001, 0.01, 0.1, 1]), rejections: Metric.counter('rate_limit_rejections_total'), storeFailures: Metric.counter('rate_limit_store_failures_total') },
		resilience: { bulkheadRejections: Metric.counter('resilience_bulkhead_rejections_total'), fallbacks: Metric.counter('resilience_fallbacks_total'), hedges: Metric.counter('resilience_hedges_total'), retries: Metric.counter('resilience_retries_total'), timeouts: Metric.counter('resilience_timeouts_total') },
		rpc: { duration: Metric.timerWithBoundaries('rpc_duration_seconds', [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5]), errors: Metric.frequency('rpc_errors_total'), requests: Metric.counter('rpc_requests_total') },
		rtc: { connections: Metric.counter('rtc_connections_total'), events: Metric.counter('rtc_events_total') },
		search: { queries: Metric.counter('search_queries_total', { description: 'Total search queries' }), refreshes: Metric.counter('search_refreshes_total', { description: 'Total index refreshes' }), suggestions: Metric.counter('search_suggestions_total', { description: 'Total suggestion requests' }) },
		singleton: {
			duration: Metric.timerWithBoundaries('singleton_duration_seconds', [0.01, 0.1, 1, 10, 100, 1000]),
			executions: Metric.counter('singleton_executions_total'), lastExecution: Metric.gauge('singleton_last_execution_timestamp'),
			migrationDuration: Metric.gauge('singleton_migration_duration_seconds'), migrationSlaExceeded: Metric.counter('singleton_migration_sla_exceeded_total'),
			stateErrors: Metric.counter('singleton_state_errors_total'), stateOperations: Metric.counter('singleton_state_operations_total'),
		},
		storage: {
			bytes: Metric.counter('storage_bytes_total'), duration: Metric.timerWithBoundaries('storage_operation_duration_seconds', [0.005, 0.025, 0.125, 0.625, 3.125, 15.625, 78.125, 390.625]), errors: Metric.counter('storage_errors_total'),
			multipart: { bytes: Metric.counter('storage_multipart_bytes_total'), parts: Metric.counter('storage_multipart_parts_total'), uploads: Metric.counter('storage_multipart_uploads_total') },
			operations: Metric.counter('storage_operations_total'), stream: { duration: Metric.timerWithBoundaries('storage_stream_duration_seconds', [0.005, 0.025, 0.125, 0.625, 3.125, 15.625, 78.125, 390.625]) },
		},
		stream: { active: Metric.gauge('stream_active'), bytes: Metric.counter('stream_bytes_total'), duration: Metric.timerWithBoundaries('stream_duration_seconds', [0.1, 1, 10, 60, 300]), elements: Metric.counter('stream_elements_total'), errors: Metric.counter('stream_errors_total') },
		transfer: { duration: Metric.timerWithBoundaries('transfer_duration_seconds', [0.1, 0.5, 2.5, 12.5, 62.5, 312.5]), exports: Metric.counter('transfer_exports_total'), imports: Metric.counter('transfer_imports_total'), rows: Metric.counter('transfer_rows_total') },
	}),
}) {
	static readonly errorTag = (err: unknown): string => Match.value(err).pipe(
		Match.when((e: unknown): e is { _tag: string } => typeof e === 'object' && e !== null && '_tag' in e, (t) => t._tag),
		Match.when((e: unknown): e is Error => e instanceof Error, (e) => e.constructor.name),
		Match.orElse(() => 'Unknown'),
	);
	static readonly label = (pairs: Record<string, string | undefined>): HashSet.HashSet<MetricLabel.MetricLabel> =>
		HashSet.fromIterable(
			Object.entries(pairs)
				.filter((entry): entry is [string, string] => entry[1] !== undefined)
				// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars
				.map(([key, value]) => MetricLabel.make(key, ((s) => s.length > 120 ? `${s.slice(0, 120)}...` : s)(value.normalize('NFKC').replaceAll(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff\u00ad]/g, '')))),	// NOSONAR S6324
		);
	static readonly inc = (counter: Metric.Metric.Counter<number>, labels: HashSet.HashSet<MetricLabel.MetricLabel>, value = 1): Effect.Effect<void> => value === 1 ? Metric.increment(Metric.taggedWithLabels(counter, labels)) : Metric.incrementBy(Metric.taggedWithLabels(counter, labels), value);
	static readonly gauge = (gauge: Metric.Metric.Gauge<number>, labels: HashSet.HashSet<MetricLabel.MetricLabel>, delta: number): Effect.Effect<void> => Metric.update(Metric.taggedWithLabels(gauge, labels), delta);
	static readonly trackEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, config: { readonly duration: ReturnType<typeof Metric.timerWithBoundaries>; readonly errors: Metric.Metric.Frequency<string>; readonly labels: HashSet.HashSet<MetricLabel.MetricLabel> }): Effect.Effect<A, E, R> =>
		effect.pipe(
			Metric.trackDuration(Metric.taggedWithLabels(config.duration, config.labels)),
			Metric.trackErrorWith(Metric.taggedWithLabels(config.errors, config.labels), MetricsService.errorTag),
			Metric.trackDefectWith(Metric.taggedWithLabels(config.errors, config.labels), MetricsService.errorTag),
		);
	static readonly trackError = (errors: Metric.Metric.Frequency<string>, labels: HashSet.HashSet<MetricLabel.MetricLabel>, error: unknown): Effect.Effect<void> => Metric.update(Metric.taggedWithLabels(errors, labels), MetricsService.errorTag(error));
	static readonly trackStream = <A, E, R>(stream: Stream.Stream<A, E, R>, counter: Metric.Metric.Counter<number>, labelPairs: Record<string, string | undefined>): Stream.Stream<A, E, R> => {
		const labels = MetricsService.label(labelPairs);
		return Stream.tap(stream, () => Metric.increment(Metric.taggedWithLabels(counter, labels)));
	};
	static readonly trackJob = <A, E extends { readonly reason: string }, R>(config: { readonly operation: 'submit' | 'process' | 'cancel' | 'replay'; readonly jobType: string; readonly priority?: string }) =>
		(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | MetricsService> =>
			Effect.flatMap(MetricsService, (metrics) => {
				const labels = MetricsService.label({ job_type: config.jobType, operation: config.operation, priority: config.priority });
				return effect.pipe(
					Effect.tap(() => ({ cancel: Metric.increment(Metric.taggedWithLabels(metrics.jobs.cancellations, labels)), process: Effect.void, replay: Effect.void, submit: Metric.increment(Metric.taggedWithLabels(metrics.jobs.enqueued, labels)) })[config.operation]),
					Metric.trackDuration(Metric.taggedWithLabels(metrics.jobs.processingSeconds, labels)),
					Effect.tapError((error) => Metric.increment(Metric.taggedWithLabels(metrics.jobs.failures, MetricsService.label({ job_type: config.jobType, reason: error.reason })))),
				);
			});
	static readonly middleware = HttpMiddleware.make((app) =>
		Effect.gen(function* () {
			const metrics = yield* MetricsService;
			const req = yield* HttpServerRequest.HttpServerRequest;
			const path = (req.url.split('?')[0] ?? '/').split('/').map((seg) =>
				seg ? ([
					[/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ':uuid'],
					[/^\d+$/, ':id'],
					[/^[0-9a-f]{6,64}$/i, ':hash'],
					[/^[A-Za-z0-9_-]{16,}={0,2}$/, ':token'],
				] as const).find(([re]) => re.test(seg))?.[1] ?? seg : seg,
			).join('/');
			const tenantId = yield* Context.Request.currentTenantId;
			const baseLabels = MetricsService.label({ method: req.method, path, tenant: tenantId });
			const tenantLabels = MetricsService.label({ tenant: tenantId });
			const activeGauge = Metric.taggedWithLabels(metrics.http.active, tenantLabels);
			yield* Metric.update(activeGauge, 1);
			return yield* app.pipe(
				Metric.trackDuration(Metric.taggedWithLabels(metrics.http.duration, baseLabels)),
				Metric.trackErrorWith(Metric.taggedWithLabels(metrics.errors, tenantLabels), MetricsService.errorTag),
				Effect.tap((res) => Metric.increment(Metric.taggedWithLabels(metrics.http.requests, HashSet.add(baseLabels, MetricLabel.make('status', String(res.status)))))),
				Effect.ensuring(Metric.update(activeGauge, -1)),
			);
		}),
	);
}

// --- [EXPORT] ----------------------------------------------------------------

export { MetricsService };
