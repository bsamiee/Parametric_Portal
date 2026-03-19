import * as FileSystem from '@effect/platform/FileSystem';
import { it } from '@effect/vitest';
import { SessionOverride } from '../../../packages/ai/src/runtime-provider';
import { ConfigProvider, Effect, Layer, Match, Option, Schema as S } from 'effect';
import { ConfigFile, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanHost } from '../../../apps/kargadan/harness/src/config';
import { expect } from 'vitest';

const _configLayer = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const _withHarnessConfig = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(Effect.provide(HarnessConfig.Default.pipe(Layer.provide(_configLayer(entries)))));

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
            expect(cfg.tokenExpiryMinutes).toBe(15);
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

it.effect('P8-CFG-DO-01: decodeOverride with empty primary returns Option.none', () =>
    SessionOverride.decodeFromInput({ fallback: [], primary: '' }).pipe(
        Effect.tap((result) => { expect(Option.isNone(result)).toBe(true); }),
    ),
);

it.effect('P8-CFG-RH-01: rhinoLaunchTimeoutMs respects env override', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.rhinoLaunchTimeoutMs),
        Effect.tap((value) => { expect(value).toBe(60_000); }),
    ), { KARGADAN_RHINO_LAUNCH_TIMEOUT_MS: '60000' }),
);

it.effect('P8-CFG-WR-01: schema-normalized config strips unknown keys', () =>
    S.decodeUnknown(KargadanConfigSchema)({
        ai: { language: { primary: { model: 'gpt-5.4', provider: 'openai' } } },
        unknownKey: 'should-be-stripped',
    }).pipe(Effect.tap((config) => {
        expect(config.ai?.language?.primary.model).toBe('gpt-5.4');
        expect((config as Record<string, unknown>)['unknownKey']).toBeUndefined();
    })),
);

it.effect('P8-CFG-PG-01: Postgres bootstrap fails with typed actionable error when provider unavailable', () =>
    KargadanHost.postgres.bootstrap.pipe(
        Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(false) })),
        Effect.provide(_configLayer({ KARGADAN_POSTGRES_APP_PATH: '/missing/Postgres.app' })),
        Effect.match({
            onFailure: (error) => Match.value(error).pipe(
                Match.when(Match.instanceOf(HarnessHostError), (typed) => {
                    expect(typed.reason).toBe('postgres');
                    expect(typed.message).toContain('KARGADAN_DATABASE_URL');
                }),
                Match.orElse((other) => { expect.unreachable(`Expected HarnessHostError, got ${String(other)}`); })),
            onSuccess: () => expect.unreachable('bootstrap should have failed'),
        }),
    ),
);

it.effect('P8-CFG-SET-01: ConfigFile.set patches nested ai.language.primary', () =>
    ConfigFile.set({} as typeof KargadanConfigSchema.Type, 'ai.language.primary', 'openai:gpt-5.4').pipe(
        Effect.map((config) => ConfigFile.get(config, 'ai.language.primary')),
        Effect.tap((value) => { expect(value).toBe('openai:gpt-5.4'); }),
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
