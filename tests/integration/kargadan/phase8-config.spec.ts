import { it } from '@effect/vitest';
import { NodeFileSystem } from '@effect/platform-node';
import { ConfigProvider, Effect, Layer, Option, Schema as S } from 'effect';
import { ConfigFile, HarnessConfig, KargadanConfigSchema } from '../../../apps/kargadan/harness/src/config';
import { KargadanPostgres } from '../../../apps/kargadan/harness/src/postgres';
import { expect } from 'vitest';

const _configLayer = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const _withHarnessConfig = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(Effect.provide(HarnessConfig.Default.pipe(Layer.provide(_configLayer(entries)))));
const _noopKeychainOps = {
    readSecret:  () => Effect.succeed(Option.none<string>()),
    writeSecret: () => Effect.void,
} as const;

it.effect('P8-CFG-PV-01: protocolVersion parses valid major.minor', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.protocolVersion),
        Effect.tap((version) => {
            expect(version.major).toBe(2);
            expect(version.minor).toBe(5);
        }),
    ), { KARGADAN_PROTOCOL_VERSION: '2.5' }),
);

it.effect('P8-CFG-PV-02: protocolVersion rejects non-numeric input', () =>
    _withHarnessConfig(HarnessConfig.pipe(Effect.map((cfg) => cfg.protocolVersion)), { KARGADAN_PROTOCOL_VERSION: 'abc' }).pipe(
        Effect.match({
            onFailure: (error) => { expect(String(error)).toContain('invalid_protocol_version'); },
            onSuccess: () => { expect.unreachable('should have failed'); },
        }),
    ),
);

it.effect('P8-CFG-PV-03: protocolVersion rejects missing minor segment', () =>
    _withHarnessConfig(HarnessConfig.pipe(Effect.map((cfg) => cfg.protocolVersion)), { KARGADAN_PROTOCOL_VERSION: '1' }).pipe(
        Effect.match({
            onFailure: (error) => { expect(String(error)).toContain('invalid_protocol_version'); },
            onSuccess: () => { expect.unreachable('should have failed'); },
        }),
    ),
);

it.effect('P8-CFG-INT-01: internalized constants use correct defaults', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.tap((cfg) => {
            expect(cfg.compactionTriggerPercent).toBe(75);
            expect(cfg.compactionTargetPercent).toBe(40);
            expect(cfg.heartbeatIntervalMs).toBe(5_000);
            expect(cfg.heartbeatTimeoutMs).toBe(15_000);
            expect(cfg.reconnectBackoffBaseMs).toBe(500);
            expect(cfg.reconnectBackoffMaxMs).toBe(30_000);
            expect(cfg.reconnectMaxAttempts).toBe(50);
            expect(cfg.correctionCycles).toBe(1);
            expect(cfg.exportLimit).toBe(10_000);
        }),
    ), {}),
);

it.effect('P8-CFG-INT-02: internalized constants ignore env overrides', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.tap((cfg) => {
            expect(cfg.compactionTriggerPercent).toBe(75);
            expect(cfg.commandDeadlineMs).toBe(5_000);
        }),
    ), { KARGADAN_COMMAND_DEADLINE_MS: '10000', KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '99' }),
);

it.effect('P8-CFG-CAP-01: resolveCapabilities requests grounded Rhino command surface', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.tap((cfg) => {
            expect(cfg.resolveCapabilities.required).toEqual([
                'read.scene.summary',
                'read.object.list',
                'read.object.metadata',
                'read.object.geometry',
                'read.layer.state',
                'read.view.state',
                'read.tolerance.units',
                'write.object.create',
                'write.object.update',
                'write.object.delete',
                'write.selection',
            ]);
            expect(cfg.resolveCapabilities.optional).toEqual(['view.capture']);
        }),
    ), {}),
);

it.effect('P8-CFG-RH-01: rhinoLaunchTimeoutMs respects env override', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.rhinoLaunchTimeoutMs),
        Effect.tap((value) => { expect(value).toBe(60_000); }),
    ), { KARGADAN_RHINO_LAUNCH_TIMEOUT_MS: '60000' }),
);

it.effect('P8-CFG-WR-01: schema-normalized config strips unknown keys and omits postgres config', () =>
    S.decodeUnknown(KargadanConfigSchema)({
        ai: { geminiClientPath: '/tmp/gemini-client.json' },
        postgres: { mode: 'managed-docker' },
        unknownKey: 'should-be-stripped',
    }).pipe(Effect.tap((config) => {
        expect(config.ai?.geminiClientPath).toBe('/tmp/gemini-client.json');
        expect((config as Record<string, unknown>)['postgres']).toBeUndefined();
        expect((config as Record<string, unknown>)['unknownKey']).toBeUndefined();
    })),
);

it.effect('P8-CFG-PG-01: env override wins over the managed docker default during target resolution', () =>
    KargadanPostgres.resolveTarget({
        envOverride: Option.some('postgresql://override'),
    }).pipe(
        Effect.tap((target) => { expect(target).toEqual({ _tag: 'env_override', url: 'postgresql://override' }); }),
    ),
);

it.effect('P8-CFG-PG-02: Docker is the only managed database target when no env override exists', () =>
    KargadanPostgres.resolveTarget({
        envOverride: Option.none(),
    }).pipe(
        Effect.tap((target) => { expect(target).toEqual({ _tag: 'managed-docker' }); }),
    ),
);

it.effect('P8-CFG-PG-03: passive readiness preserves env overrides without healing providers', () =>
    KargadanPostgres.resolveReadyConnection('/tmp/kargadan-test', '/tmp/kargadan-test/postgres', _noopKeychainOps)({
        _tag: 'env_override',
        url:  'postgresql://env-override',
    }).pipe(
        Effect.provide(NodeFileSystem.layer),
        Effect.tap((resolved) => {
            expect(resolved).toEqual(Option.some({ mode: 'env_override', source: 'env', url: 'postgresql://env-override' }));
        }),
    ),
);

it.effect('P8-CFG-SET-01: ConfigFile exposes only greenfield persisted keys', () =>
    Effect.sync(() => {
        expect(ConfigFile.keys).toEqual(['ai.geminiClientPath', 'rhino.appPath', 'rhino.yakPath']);
    }),
);

it.effect('P8-CFG-SET-02: ConfigFile.set patches nested ai.geminiClientPath', () =>
    ConfigFile.set({} as typeof KargadanConfigSchema.Type, 'ai.geminiClientPath', '/tmp/gemini-client.json').pipe(
        Effect.map((config) => ConfigFile.get(config, 'ai.geminiClientPath')),
        Effect.tap((value) => { expect(value).toBe('/tmp/gemini-client.json'); }),
    ),
);

it.effect('P8-CFG-DEF-01: HarnessConfig falls back to defaults when no env vars set', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.tap((cfg) => {
            expect(cfg.protocolVersion).toEqual({ major: 1, minor: 0 });
            expect(cfg.compactionTriggerPercent).toBe(75);
            expect(cfg.compactionTargetPercent).toBe(40);
            expect(cfg.retryMaxAttempts).toBe(5);
            expect(cfg.commandDeadlineMs).toBe(5_000);
        }),
    ), {}),
);
