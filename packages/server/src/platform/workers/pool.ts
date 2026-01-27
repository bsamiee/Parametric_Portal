/**
 * Worker pool service for managing transfer parsing workers.
 * Uses @effect/platform worker pool with @effect/rpc protocol.
 */
import * as NodeWorker from '@effect/platform-node/NodeWorker';
import * as RpcClient from '@effect/rpc/RpcClient';
import type { RpcClientError } from '@effect/rpc/RpcClientError';
import { Data, Duration, Effect, Layer, Metric, Stream } from 'effect';
import { Worker } from 'node:worker_threads';
import { MetricsService } from '../../observe/metrics.ts';
import {
	TimeoutError,
	TransferRpc,
	type ParseFormatType,
	type ParseProgressType,
	type ParseResultType,
	type WorkerCrashError,
} from './contract.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _Pool = {
	concurrency: 1,
	gracePeriod: Duration.seconds(30),
	size: 4,
	softTimeout: Duration.minutes(5),
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class PoolError extends Data.TaggedError('PoolError')<{
	readonly cause: unknown;
	readonly operation: string;
}> {
	override get message() {
		return `PoolError: ${this.operation} - ${String(this.cause)}`;
	}
}

// --- [SERVICES] --------------------------------------------------------------

class WorkerPoolService extends Effect.Service<WorkerPoolService>()(
	'server/WorkerPoolService',
	{
		dependencies: [],
		scoped: Effect.gen(function* () {
			const workerPath = new URL('./transfer.ts', import.meta.url).pathname;

			yield* Effect.logInfo('WorkerPoolService initialized', {
				concurrency: _Pool.concurrency,
				poolSize: _Pool.size,
				workerPath,
			});

			return {
				_config: _Pool,
				_workerPath: workerPath,
			};
		}),
	},
) {
	// --- [PARSE] -------------------------------------------------------------
	static readonly parse = (presignedUrl: string, format: ParseFormatType) =>
		Effect.gen(function* () {
			const state = yield* WorkerPoolService;
			const metricsOpt = yield* Effect.serviceOption(MetricsService);

			// Create worker protocol layer
			const ProtocolLayer = RpcClient.layerProtocolWorker({
				concurrency: state._config.concurrency,
				size: state._config.size,
			}).pipe(
				Layer.provide(NodeWorker.layer((id) => new Worker(state._workerPath, { workerData: { id } }))),
			);

			// Create RPC client
			const client = yield* RpcClient.make(TransferRpc).pipe(Effect.provide(ProtocolLayer));

			// Track start time for metrics
			const startTime = Date.now();
			const labels = MetricsService.label({ format, operation: 'parse' });

			// Dispatch to worker
			const parseStream = client.ParseTransfer({ format, presignedUrl });

			// Increment active workers gauge
			yield* Effect.transposeMapOption(metricsOpt, (m) => MetricsService.gauge(m.workers.active, labels, 1));

			// Calculate total timeout (soft + grace)
			const totalTimeout = Duration.sum(state._config.softTimeout, state._config.gracePeriod);

			// Return stream with timeout and metrics
			return parseStream.pipe(
				// Add timeout handling
				Stream.timeoutFail(
					() =>
						new TimeoutError({
							elapsedMs: Date.now() - startTime,
							hardLimitMs: Duration.toMillis(totalTimeout),
							softLimitMs: Duration.toMillis(state._config.softTimeout),
						}),
					totalTimeout,
				),

				// Track completion metrics
				Stream.ensuring(
					Effect.gen(function* () {
						const elapsed = Date.now() - startTime;
						yield* Effect.transposeMapOption(metricsOpt, (m) =>
							Effect.all(
								[
									MetricsService.gauge(m.workers.active, labels, -1),
									MetricsService.inc(m.workers.completions, labels),
									Metric.update(Metric.taggedWithLabels(m.workers.duration, labels), Duration.millis(elapsed)),
								],
								{ discard: true },
							),
						);
						yield* Effect.logDebug('Parse completed', { elapsed, format });
					}),
				),
			) as Stream.Stream<ParseProgressType | ParseResultType, TimeoutError | WorkerCrashError | RpcClientError>;
		});

	// --- [HEALTH] ------------------------------------------------------------
	static readonly health = () =>
		Effect.gen(function* () {
			yield* WorkerPoolService;
			return { available: true, poolSize: _Pool.size };
		});

	// --- [LAYER] -------------------------------------------------------------
	static readonly Layer = WorkerPoolService.Default;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WorkerPoolService {
	export type Error = PoolError | TimeoutError | WorkerCrashError;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WorkerPoolService };
