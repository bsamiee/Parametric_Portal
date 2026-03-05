import { it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer, Option } from 'effect';
import { decodeOverride, HarnessConfig } from '../../../apps/kargadan/harness/src/config';
import { expect } from 'vitest';

const _withEnv = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));

it.effect('P8-CFG-PV-01: protocolVersion parses valid major.minor', () =>
    HarnessConfig.protocolVersion.pipe(
        Effect.provide(_withEnv({ KARGADAN_PROTOCOL_VERSION: '2.5' })),
        Effect.tap((version) => {
            expect(version.major).toBe(2);
            expect(version.minor).toBe(5);
        }),
    ),
);

it.effect('P8-CFG-PV-02: protocolVersion rejects non-numeric input', () =>
    HarnessConfig.protocolVersion.pipe(
        Effect.provide(_withEnv({ KARGADAN_PROTOCOL_VERSION: 'abc' })),
        Effect.match({
            onFailure: (error) => {
                expect(error).toBeDefined();
            },
            onSuccess: () => {
                expect.unreachable('should have failed');
            },
        }),
    ),
);

it.effect('P8-CFG-PV-03: protocolVersion rejects missing minor segment', () =>
    HarnessConfig.protocolVersion.pipe(
        Effect.provide(_withEnv({ KARGADAN_PROTOCOL_VERSION: '1' })),
        Effect.match({
            onFailure: (error) => {
                expect(error).toBeDefined();
            },
            onSuccess: () => {
                expect.unreachable('should have failed');
            },
        }),
    ),
);

it.effect('P8-CFG-CT-01: compactionTriggerPercent accepts lower bound 5', () =>
    HarnessConfig.compactionTriggerPercent.pipe(
        Effect.provide(_withEnv({ KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '5' })),
        Effect.tap((value) => { expect(value).toBe(5); }),
    ),
);

it.effect('P8-CFG-CT-02: compactionTriggerPercent accepts upper bound 99', () =>
    HarnessConfig.compactionTriggerPercent.pipe(
        Effect.provide(_withEnv({ KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '99' })),
        Effect.tap((value) => { expect(value).toBe(99); }),
    ),
);

it.effect('P8-CFG-CT-03: compactionTriggerPercent rejects 0', () =>
    HarnessConfig.compactionTriggerPercent.pipe(
        Effect.provide(_withEnv({ KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '0' })),
        Effect.match({
            onFailure: (error) => { expect(error).toBeDefined(); },
            onSuccess: () => { expect.unreachable('should have failed'); },
        }),
    ),
);

it.effect('P8-CFG-CT-04: compactionTriggerPercent rejects 100', () =>
    HarnessConfig.compactionTriggerPercent.pipe(
        Effect.provide(_withEnv({ KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '100' })),
        Effect.match({
            onFailure: (error) => { expect(error).toBeDefined(); },
            onSuccess: () => { expect.unreachable('should have failed'); },
        }),
    ),
);

it.effect('P8-CFG-DO-01: decodeOverride with empty model+provider returns Option.none', () =>
    decodeOverride({ fallback: [], model: '', provider: '' }).pipe(
        Effect.tap((result) => { expect(Option.isNone(result)).toBe(true); }),
    ),
);
