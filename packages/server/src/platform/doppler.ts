/** Doppler secrets management: typed, cached, auto-refreshing secret access. */
import { Config, Data, Duration, Effect, Option, Redacted, Ref, Schedule } from 'effect';
import { DopplerSDK } from '@dopplerhq/node-sdk';

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

        const fetchSecrets = Effect.tryPromise({
            catch: (cause) => new DopplerError({ cause, operation: 'download' }),
            try: () => sdk.secrets.download(project, config, { format: 'json' }),
        });

        const toMap = (response: Record<string, unknown>) =>
            new Map(
                Object.entries(response).flatMap(([key, value]) =>
                    typeof value === 'string' ? [[key, value] as const] : [],
                ),
            );

        const cache = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

        // Initial fetch -- MUST succeed or service fails to start
        yield* fetchSecrets.pipe(
            Effect.flatMap((secrets) => Ref.set(cache, toMap(secrets as Record<string, unknown>))),
        );

        // Background refresh on schedule (forked, fail-open)
        const refresh = Effect.gen(function* () {
            const secrets = yield* fetchSecrets;
            const entries = toMap(secrets as Record<string, unknown>);
            yield* Ref.set(cache, entries);
            yield* Effect.log('Doppler secrets refreshed', { config, count: entries.size, project });
        }).pipe(
            Effect.catchAll((error) =>
                Effect.logWarning('Doppler refresh failed, serving stale', { error }),
            ),
        );

        yield* refresh.pipe(
            Effect.schedule(Schedule.fixed(Duration.millis(refreshMs))),
            Effect.forkScoped,
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

        return { get, getAll, getRequired } as const;
    }),
}) {
    static readonly get = (name: string) =>
        DopplerService.pipe(Effect.flatMap((service) => service.get(name)));

    static readonly getRequired = (name: string) =>
        DopplerService.pipe(Effect.flatMap((service) => service.getRequired(name)));

    static readonly getAll = DopplerService.pipe(Effect.flatMap((service) => service.getAll));
}

// --- [EXPORT] ----------------------------------------------------------------

export { DopplerError, DopplerService };
