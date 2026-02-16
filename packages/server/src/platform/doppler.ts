/** Doppler secrets management: typed, cached, auto-refreshing secret access. */
import { createHash } from 'node:crypto';
import { DopplerSDK } from '@dopplerhq/node-sdk';
import { Data, Duration, Effect, Match, Metric, Option, Redacted, Ref, Schedule, Schema as S } from 'effect';
import { Env } from '../env.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _Operation =  S.Literal('auth', 'download', 'configLogs', 'refresh', 'getRequired');
const _ErrorState = S.Struct({
    _tag:      S.Literal('DopplerError'),
    cause:     S.Unknown,
    operation: _Operation,
});
const _HealthState = S.Struct({
    consecutiveFailures: S.NonNegativeInt,
    lastError:           S.OptionFromSelf(_ErrorState),
    lastRefreshAt:       S.NonNegative,
});

// --- [ERRORS] ----------------------------------------------------------------

class DopplerError extends Data.TaggedError('DopplerError')<{
    readonly operation: typeof _Operation.Type;
    readonly cause: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _hashEntries = (entries: ReadonlyMap<string, string>): string =>
    createHash('sha256')
        .update(JSON.stringify([...entries.entries()].sort(([left], [right]) => left.localeCompare(right))))
        .digest('hex');

// --- [SERVICES] --------------------------------------------------------------

class DopplerService extends Effect.Service<DopplerService>()('server/DopplerService', {
    scoped: Effect.gen(function* () {
        const env = yield* Env.Service;
        const settings = env.doppler;
        const sdk = new DopplerSDK({ accessToken: Redacted.value(settings.token) });
        const metricsOpt = yield* Effect.serviceOption(MetricsService);
        const sdkCall = <A>(operation: typeof _Operation.Type, run: () => Promise<A>): Effect.Effect<A, DopplerError> =>
            Effect.tryPromise({ catch: (cause) => new DopplerError({ cause, operation }), try: run }).pipe(Effect.retry(Resilience.schedule('default')));
        const fetchSecrets = sdkCall('download', () => sdk.secrets.download(settings.project, settings.config, { format: 'json' })).pipe(
            Effect.map((payload) => payload as Record<string, unknown>),
            Effect.map((payload) => new Map(Object.entries(payload).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
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
            lastError:           Option.none(),
            lastRefreshAt:       0,
        });
        const markHealthy = Effect.sync(Date.now).pipe(
            Effect.flatMap((now) =>
                Ref.set(healthState, {
                    consecutiveFailures: 0,
                    lastError:           Option.none(),
                    lastRefreshAt:       now,
                }),
            ),
        );
        const markFailed = (cause: unknown) =>
            Effect.gen(function* () {
                const error = Match.value(cause).pipe(
                    Match.when(Match.instanceOf(DopplerError), (e) => e),
                    Match.orElse((c) => new DopplerError({ cause: c, operation: 'refresh' })),
                );
                yield* Ref.update(healthState, (current) => ({
                    consecutiveFailures: current.consecutiveFailures + 1,
                    lastError:           Option.some(error),
                    lastRefreshAt:       current.lastRefreshAt,
                }));
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
                const logUnchanged = Option.all([storedLogId, currentLogId]).pipe(
                    Option.map(([stored, current]) => stored === current),
                    Option.getOrElse(() => false),
                );
                yield* Effect.when(
                    Effect.log(`Doppler config unchanged (log: ${Option.getOrElse(currentLogId, () => 'none')}), skipping download`),
                    () => logUnchanged,
                );
                const cachedEntries = yield* Ref.get(cache);
                const freshEntries = yield* Effect.when(fetchSecrets, () => !logUnchanged);
                const entries = Option.getOrElse(freshEntries, () => cachedEntries);
                const newHash = _hashEntries(entries);
                const oldHash = yield* Ref.get(secretsHash);
                const hashChanged = Option.isSome(freshEntries) && newHash !== oldHash;
                yield* Effect.when(
                    Effect.all([
                        Ref.set(cache, entries),
                        Ref.set(secretsHash, newHash),
                        Effect.log('Doppler secrets refreshed', { config: settings.config, count: entries.size, project: settings.project }),
                    ], { discard: true }),
                    () => hashChanged,
                );
                yield* Effect.when(
                    Effect.log('Doppler secrets unchanged, skipping cache update'),
                    () => Option.isSome(freshEntries) && !hashChanged,
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
        const refresh = Option.match(metricsOpt, {
            onNone: () => refreshCore(),
            onSome: (metrics) => refreshCore().pipe(Metric.trackDuration(metrics.doppler.refreshDuration)),
        }).pipe(Effect.catchAll(markFailed));
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
