/** Migrate entrypoint tests: env-config wiring, MigratorLive delegation, lifecycle log sequence.
 * Oracle: referential identity (process.env), mock return shape, ordered log contract. */
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const FIXTURE_URL =   'postgres://fixture' as const;
const EXPECTED_LOGS = ['Running migrations...', 'Migrations complete'] as const;
const _capture = vi.hoisted(() => ({
    envArg:      undefined as NodeJS.ProcessEnv | undefined,
    logs:        [] as string[],
    migratorArg: undefined as unknown,
    onComplete:  undefined as (() => void) | undefined,
    ready:       Promise.resolve(),
}));

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('effect', async (importOriginal) => {
    const original = await importOriginal<typeof import('effect')>();
    return {
        ...original,
        Effect: {
            ...original.Effect,
            log: (message: string) => original.Effect.sync(() => {
                _capture.logs.push(String(message));
                String(message) === 'Migrations complete' && _capture.onComplete?.();
            }),
        },
        Layer: { ...original.Layer, launch: () => original.Effect.void },
    };
});
vi.mock('@parametric-portal/server/env', async () => ({
    Env: {
        database: (env: NodeJS.ProcessEnv) => {
            _capture.envArg = env;
            return { url: FIXTURE_URL };
        },
    },
}));
vi.mock('@parametric-portal/database/migrator', async () => {
    const { Layer } = await import('effect');
    return {
        MigratorLive: (config: unknown) => {
            _capture.migratorArg = config;
            return Layer.empty;
        },
    };
});

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('env wiring + MigratorLive delegation + lifecycle logs', () => Effect.gen(function* () {
    _capture.ready = new Promise<void>((resolve) => { _capture.onComplete = resolve; });
    _capture.envArg = undefined;
    _capture.logs.length = 0;
    _capture.migratorArg = undefined;
    vi.resetModules();
    yield* Effect.promise(() => import('../../../apps/api/src/migrate.ts').then(() => undefined));
    yield* Effect.promise(() => _capture.ready).pipe(Effect.timeout('2 seconds'));
    expect(_capture.envArg).toBe(process.env);
    expect(_capture.migratorArg).toEqual({ url: FIXTURE_URL });
    expect(_capture.logs).toEqual([...EXPECTED_LOGS]);
}));
