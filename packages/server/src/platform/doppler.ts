/** Doppler secrets management: typed, cached, auto-refreshing secret access. */
import { createHash } from 'node:crypto';
import { Config, Data, Duration, Effect, Metric, Option, Redacted, Ref, Schedule } from 'effect';
import { DopplerSDK } from '@dopplerhq/node-sdk';
import { MetricsService } from '../observe/metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type HealthState = {
    readonly consecutiveFailures: number;
    readonly lastError: Option.Option<DopplerError>;
    readonly lastRefreshAt: number;
};

// --- [ERRORS] ----------------------------------------------------------------

class DopplerError extends Data.TaggedError('DopplerError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class DopplerService extends Effect.Service<DopplerService>()('server/DopplerService', {
    scoped: Effect.gen(function* () {
        const token = yield* Config.redacted('DOPPLER_TOKEN');
        const project = yield* Config.string('DOPPLER_PROJECT');
        const config = yield* Config.string('DOPPLER_CONFIG');
        const refreshMs = yield* Config.integer('DOPPLER_REFRESH_MS').pipe(Config.withDefault(300_000));

        const sdk = new DopplerSDK({ accessToken: Redacted.value(token) });

        // [Task 7] Validate token before first download — clear startup diagnostics
        const authInfo = yield* Effect.tryPromise({
            catch: (cause) => new DopplerError({ cause, operation: 'auth' }),
            try: () => sdk.auth.me(),
        });
        yield* Effect.log('Doppler token validated', {
            tokenType: authInfo.type_ ?? 'unknown',
            workspace: authInfo.workplace?.name ?? 'unknown',
        });

        const fetchSecrets = Effect.tryPromise({
            catch: (cause) => new DopplerError({ cause, operation: 'download' }),
            try: () => sdk.secrets.download(project, config, { format: 'json' }),
        });

        const fetchLatestLogId = Effect.tryPromise({
            catch: (cause) => new DopplerError({ cause, operation: 'configLogs' }),
            try: () => sdk.configLogs.list(project, config, { perPage: 1 }),
        }).pipe(
            Effect.map((response) => Option.fromNullable(response.logs?.[0]?.id)),
            // Fall back gracefully — optimization must not break the refresh
            Effect.orElseSucceed(() => Option.none<string>()),
        );

        const toMap = (response: Record<string, unknown>) =>
            new Map(
                Object.entries(response).flatMap(([key, value]) =>
                    typeof value === 'string' ? [[key, value] as const] : [],
                ),
            );

        const computeHash = (secrets: Record<string, unknown>) =>
            Effect.sync(() => createHash('sha256').update(JSON.stringify(secrets)).digest('hex'));

        const cache = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const secretsHash = yield* Ref.make('');
        const lastLogId = yield* Ref.make<Option.Option<string>>(Option.none());
        const healthState = yield* Ref.make<HealthState>({
            consecutiveFailures: 0,
            lastError: Option.none(),
            lastRefreshAt: 0,
        });

        // Initial fetch — MUST succeed or service fails to start
        const initialSecrets = yield* fetchSecrets;
        const initialMap = toMap(initialSecrets as Record<string, unknown>);
        const initialHash = yield* computeHash(initialSecrets as Record<string, unknown>);
        yield* Ref.set(cache, initialMap);
        yield* Ref.set(secretsHash, initialHash);
        yield* Ref.set(healthState, { consecutiveFailures: 0, lastError: Option.none(), lastRefreshAt: Date.now() });

        // Seed the configLogs baseline
        const initialLogId = yield* fetchLatestLogId;
        yield* Ref.set(lastLogId, initialLogId);

        // Background refresh on schedule (forked, fail-open)
        const _refreshCore = Effect.fn('DopplerService.refresh')(function* () {
            const metricsOpt = yield* Effect.serviceOption(MetricsService);

            // [Task 6] Check configLogs for changes before full download
            const storedLogId = yield* Ref.get(lastLogId);
            const currentLogId = yield* fetchLatestLogId;
            const logUnchanged = Option.isSome(storedLogId)
                && Option.isSome(currentLogId)
                && storedLogId.value === currentLogId.value;

            yield* Effect.when(
                Effect.log(`Doppler config unchanged (log: ${Option.getOrElse(currentLogId, () => 'none')}), skipping download`),
                () => logUnchanged,
            );

            // Update stored log ID regardless
            yield* Ref.set(lastLogId, currentLogId);

            yield* Effect.unless(Effect.gen(function* () {
                const secrets = yield* fetchSecrets;
                const entries = toMap(secrets as Record<string, unknown>);
                const newHash = yield* computeHash(secrets as Record<string, unknown>);
                const oldHash = yield* Ref.get(secretsHash);

                // [Task 5] Skip cache update when secrets unchanged
                const hashUnchanged = newHash === oldHash;
                yield* Effect.when(
                    Effect.log('Doppler secrets unchanged, skipping cache update'),
                    () => hashUnchanged,
                );

                yield* Effect.unless(Effect.gen(function* () {
                    yield* Ref.set(cache, entries);
                    yield* Ref.set(secretsHash, newHash);
                    yield* Effect.log('Doppler secrets refreshed', { config, count: entries.size, project });
                }), () => hashUnchanged);

                // Update metrics gauge with current cache size
                yield* Option.match(metricsOpt, {
                    onNone: () => Effect.void,
                    onSome: (metrics) => Metric.set(metrics.doppler.cacheSize, entries.size),
                });
            }), () => logUnchanged);

            // Mark success
            yield* Ref.set(healthState, { consecutiveFailures: 0, lastError: Option.none(), lastRefreshAt: Date.now() });

            // Increment refresh counter
            yield* Option.match(metricsOpt, {
                onNone: () => Effect.void,
                onSome: (metrics) => Metric.increment(metrics.doppler.refreshes),
            });
        });

        const refresh = _refreshCore().pipe(
            Effect.catchAll((error) =>
                Effect.gen(function* () {
                    yield* Effect.logWarning('Doppler refresh failed, serving stale', { error });
                    const current = yield* Ref.get(healthState);
                    yield* Ref.set(healthState, {
                        consecutiveFailures: current.consecutiveFailures + 1,
                        lastError: Option.some(error instanceof DopplerError ? error : new DopplerError({ cause: error, operation: 'refresh' })),
                        lastRefreshAt: current.lastRefreshAt,
                    });
                    const metricsOpt = yield* Effect.serviceOption(MetricsService);
                    yield* Option.match(metricsOpt, {
                        onNone: () => Effect.void,
                        onSome: (metrics) => Effect.all([
                            Metric.increment(metrics.doppler.refreshes),
                            Metric.increment(metrics.doppler.refreshFailures),
                        ], { discard: true }),
                    });
                }),
            ),
        );

        yield* refresh.pipe(
            Effect.schedule(Schedule.fixed(Duration.millis(refreshMs))),
            Effect.forkScoped,
        );

        // [Task 4] Log on shutdown — placed after forkScoped so finalizer runs before fiber cancel
        yield* Effect.addFinalizer(() =>
            Ref.get(cache).pipe(
                Effect.flatMap((secrets) =>
                    Effect.log('DopplerService shutting down', { cacheSize: secrets.size, config, project }),
                ),
            ),
        );

        yield* Effect.log('DopplerService initialized', { config, project, refreshMs });

        // Instance methods (R=never)
        const get = (name: string) =>
            Ref.get(cache).pipe(Effect.map((secrets) => Option.fromNullable(secrets.get(name))));

        const getRequired = (name: string) =>
            Ref.get(cache).pipe(
                Effect.map((secrets) => secrets.get(name)),
                Effect.flatMap((value) =>
                    value !== undefined
                        ? Effect.succeed(value)
                        : Effect.fail(new DopplerError({ cause: `Secret "${name}" not found`, operation: 'getRequired' })),
                ),
            );

        const getAll = Ref.get(cache);

        const health = () => Ref.get(healthState);

        return { get, getAll, getRequired, health } as const;
    }),
}) {
    static readonly get = (name: string) =>
        DopplerService.pipe(Effect.flatMap((service) => service.get(name)));

    static readonly getRequired = (name: string) =>
        DopplerService.pipe(Effect.flatMap((service) => service.getRequired(name)));

    static readonly getAll = DopplerService.pipe(Effect.flatMap((service) => service.getAll));

    static readonly health = () =>
        DopplerService.pipe(Effect.flatMap((service) => service.health()));
}

// --- [EXPORT] ----------------------------------------------------------------

export { DopplerError, DopplerService };
