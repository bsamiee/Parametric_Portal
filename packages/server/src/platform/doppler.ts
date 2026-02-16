/** Doppler secrets management: typed, cached, auto-refreshing secret access. */
import { createHash } from 'node:crypto';
import { DopplerSDK } from '@dopplerhq/node-sdk';
import { Config, Data, Duration, Effect, Match, Metric, Option, Redacted, Ref, Schedule, Schema as S } from 'effect';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _Operation = S.Literal('auth', 'download', 'configLogs', 'refresh', 'getRequired');
const _ErrorState = S.Struct({
    _tag: S.Literal('DopplerError'),
    cause: S.Unknown,
    operation: _Operation,
});
const _HealthState = S.Struct({
    consecutiveFailures: S.NonNegativeInt,
    lastError: S.OptionFromSelf(_ErrorState),
    lastRefreshAt: S.NonNegative,
});

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = { refreshMs: 300_000 } as const;

// --- [ERRORS] ----------------------------------------------------------------

class DopplerError extends Data.TaggedError('DopplerError')<{
    readonly operation: typeof _Operation.Type;
    readonly cause: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _toSecretMap = (payload: Record<string, unknown>): ReadonlyMap<string, string> =>
    new Map(Object.entries(payload).flatMap(([key, value]) => typeof value === 'string' ? [[key, value] as const] : []));
const _hashEntries = (entries: ReadonlyMap<string, string>): string =>
    createHash('sha256')
        .update(JSON.stringify([...entries.entries()].sort(([left], [right]) => left.localeCompare(right))))
        .digest('hex');
const _network = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect.pipe(Effect.retry(Resilience.schedule('default')));
const _trackRefreshDuration = <A, E, R>(metricsOpt: Option.Option<MetricsService>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Option.match(metricsOpt, {
        onNone: () => effect,
        onSome: (metrics) => effect.pipe(Metric.trackDuration(metrics.doppler.refreshDuration)),
    });

// --- [SERVICES] --------------------------------------------------------------

class DopplerService extends Effect.Service<DopplerService>()('server/DopplerService', {
    scoped: Effect.gen(function* () {
        const settings = yield* Config.all({
            config: Config.string('DOPPLER_CONFIG'),
            project: Config.string('DOPPLER_PROJECT'),
            refreshMs: Config.integer('DOPPLER_REFRESH_MS').pipe(Config.withDefault(_CONFIG.refreshMs)),
            token: Config.redacted('DOPPLER_TOKEN'),
        });
        const sdk = new DopplerSDK({ accessToken: Redacted.value(settings.token) });
        const metricsOpt = yield* Effect.serviceOption(MetricsService);
        const sdkCall = <A>(operation: typeof _Operation.Type, run: () => Promise<A>): Effect.Effect<A, DopplerError> =>
            _network(Effect.tryPromise({ catch: (cause) => new DopplerError({ cause, operation }), try: run }));
        const fetchSecrets = sdkCall('download', () => sdk.secrets.download(settings.project, settings.config, { format: 'json' })).pipe(
            Effect.map((payload) => payload as Record<string, unknown>),
            Effect.map(_toSecretMap),
        );
        const fetchLatestLogId = sdkCall('configLogs', () => sdk.configLogs.list(settings.project, settings.config, { perPage: 1 })).pipe(
            Effect.map((response) => Option.fromNullable(response.logs?.[0]?.id)),
            Effect.catchAll(() => Effect.succeed(Option.none<string>())),
        );
        yield* sdkCall('auth', () => sdk.auth.me()).pipe(
            Effect.flatMap((authInfo) =>
                Effect.log('Doppler token validated', {
                    tokenType: authInfo.type_ ?? 'unknown',
                    workspace: authInfo.workplace?.name ?? 'unknown',
                }),
            ),
        );
        const cache = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const secretsHash = yield* Ref.make('');
        const lastLogId = yield* Ref.make(Option.none<string>());
        const healthState = yield* Ref.make<typeof _HealthState.Type>({
            consecutiveFailures: 0,
            lastError: Option.none(),
            lastRefreshAt: 0,
        });
        const markHealthy = Effect.sync(Date.now).pipe(
            Effect.flatMap((now) =>
                Ref.set(healthState, {
                    consecutiveFailures: 0,
                    lastError: Option.none(),
                    lastRefreshAt: now,
                }),
            ),
        );
        const markFailed = (cause: unknown) =>
            Effect.gen(function* () {
                const current = yield* Ref.get(healthState);
                const error = cause instanceof DopplerError ? cause : new DopplerError({ cause, operation: 'refresh' });
                yield* Ref.set(healthState, {
                    consecutiveFailures: current.consecutiveFailures + 1,
                    lastError: Option.some(error),
                    lastRefreshAt: current.lastRefreshAt,
                });
                yield* Effect.logWarning('Doppler refresh failed, serving stale', { error });
                yield* Option.match(metricsOpt, {
                    onNone: () => Effect.void,
                    onSome: (metrics) => Effect.all([
                        Metric.increment(metrics.doppler.refreshes),
                        Metric.increment(metrics.doppler.refreshFailures),
                    ], { discard: true }),
                });
            });
        const initialEntries = yield* fetchSecrets;
        yield* Ref.set(cache, initialEntries);
        yield* Ref.set(secretsHash, _hashEntries(initialEntries));
        yield* Ref.set(lastLogId, yield* fetchLatestLogId);
        yield* markHealthy;
        yield* Option.match(metricsOpt, {
            onNone: () => Effect.void,
            onSome: (metrics) => Metric.set(metrics.doppler.cacheSize, initialEntries.size),
        });
        const refreshCore = Effect.fn('DopplerService.refresh')(function* () {
                const [storedLogId, currentLogId] = yield* Effect.all([Ref.get(lastLogId), fetchLatestLogId], { concurrency: 'unbounded' });
                yield* Ref.set(lastLogId, currentLogId);
                const logUnchanged = Option.match(storedLogId, {
                    onNone: () => false,
                    onSome: (stored) => Option.match(currentLogId, {
                        onNone: () => false,
                        onSome: (current) => stored === current,
                    }),
                });
                yield* Match.value(logUnchanged).pipe(
                    Match.when(true, () => Effect.log(`Doppler config unchanged (log: ${Option.getOrElse(currentLogId, () => 'none')}), skipping download`)),
                    Match.when(false, () => Effect.void),
                    Match.exhaustive,
                );
                const entries = yield* Match.value(logUnchanged).pipe(
                    Match.when(true, () => Ref.get(cache)),
                    Match.when(false, () => fetchSecrets.pipe(
                        Effect.flatMap((nextEntries) =>
                            Effect.all([Ref.get(secretsHash), Effect.succeed(_hashEntries(nextEntries))], { concurrency: 'unbounded' }).pipe(
                                Effect.flatMap(([oldHash, newHash]) => Match.value(newHash === oldHash).pipe(
                                    Match.when(true, () => Effect.log('Doppler secrets unchanged, skipping cache update')),
                                    Match.when(false, () => Effect.all([
                                        Ref.set(cache, nextEntries),
                                        Ref.set(secretsHash, newHash),
                                        Effect.log('Doppler secrets refreshed', { config: settings.config, count: nextEntries.size, project: settings.project }),
                                    ], { discard: true })),
                                    Match.exhaustive,
                                )),
                                Effect.as(nextEntries),
                            ),
                        ),
                    )),
                    Match.exhaustive,
                );
                yield* markHealthy;
                yield* Option.match(metricsOpt, {
                    onNone: () => Effect.void,
                    onSome: (metrics) => Effect.all([
                        Metric.set(metrics.doppler.cacheSize, entries.size),
                        Metric.increment(metrics.doppler.refreshes),
                    ], { discard: true }),
                });
            });
        const refresh = _trackRefreshDuration(metricsOpt, refreshCore()).pipe(Effect.catchAll(markFailed));
        yield* refresh.pipe(
            Effect.schedule(Schedule.fixed(Duration.millis(settings.refreshMs))),
            Effect.forkScoped,
        );
        yield* Effect.addFinalizer(() =>
            Ref.get(cache).pipe(
                Effect.flatMap((secrets) =>
                    Effect.log('DopplerService shutting down', {
                        cacheSize: secrets.size,
                        config: settings.config,
                        project: settings.project,
                    }),
                ),
            ),
        );
        yield* Effect.log('DopplerService initialized', {
            config: settings.config,
            project: settings.project,
            refreshMs: settings.refreshMs,
        });
        const get = (name: string) => Ref.get(cache).pipe(Effect.map((secrets) => Option.fromNullable(secrets.get(name))));
        const getRequired = (name: string) => get(name).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new DopplerError({ cause: `Secret "${name}" not found`, operation: 'getRequired' })),
                onSome: Effect.succeed,
            })),
        );
        const getAll = Ref.get(cache);
        const health = () => Ref.get(healthState);
        return { get, getAll, getRequired, health } as const;
    }),
}) {
    static readonly get = (name: string) => DopplerService.pipe(Effect.flatMap((service) => service.get(name)));
    static readonly getRequired = (name: string) => DopplerService.pipe(Effect.flatMap((service) => service.getRequired(name)));
    static readonly getAll = DopplerService.pipe(Effect.flatMap((service) => service.getAll));
    static readonly health = () => DopplerService.pipe(Effect.flatMap((service) => service.health()));
}

// --- [EXPORT] ----------------------------------------------------------------

export { DopplerError, DopplerService };
