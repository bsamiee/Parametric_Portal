import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import { it } from '@effect/vitest';
import { AiRegistry } from '../../../packages/ai/src/registry';
import { AiRuntimeProvider } from '../../../packages/ai/src/runtime-provider';
import { ConfigProvider, Effect, Layer, Match, Option, Redacted, Schema as S } from 'effect';
import { ConfigFile, decodeOverride, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanHost } from '../../../apps/kargadan/harness/src/config';
import { expect } from 'vitest';

const _configLayer = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const _harnessConfigLayer = (entries: Record<string, string>) =>
    HarnessConfig.Default.pipe(Layer.provide(_configLayer(entries)));
const _runtimeProviderLayer = (entries: Record<string, string>) =>
    AiRuntimeProvider.Default.pipe(Layer.provide(_configLayer(entries)));
const _withHarnessConfig = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(Effect.provide(_harnessConfigLayer(entries)));
const _withRuntimeProvider = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(Effect.provide(_runtimeProviderLayer(entries)));

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
    _withHarnessConfig(HarnessConfig.pipe(Effect.map((cfg) => cfg.protocolVersion)), { KARGADAN_PROTOCOL_VERSION: '1' }).pipe(
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
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.compactionTriggerPercent),
        Effect.tap((value) => { expect(value).toBe(5); }),
    ), { KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '5' }),
);

it.effect('P8-CFG-CT-02: compactionTriggerPercent accepts upper bound 99', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.compactionTriggerPercent),
        Effect.tap((value) => { expect(value).toBe(99); }),
    ), { KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '99' }),
);

it.effect('P8-CFG-CT-03: compactionTriggerPercent rejects 0', () =>
    _withHarnessConfig(HarnessConfig.pipe(Effect.map((cfg) => cfg.compactionTriggerPercent)), { KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '0' }).pipe(
        Effect.match({
            onFailure: (error) => { expect(error).toBeDefined(); },
            onSuccess: () => { expect.unreachable('should have failed'); },
        }),
    ),
);

it.effect('P8-CFG-CT-04: compactionTriggerPercent rejects 100', () =>
    _withHarnessConfig(HarnessConfig.pipe(Effect.map((cfg) => cfg.compactionTriggerPercent)), { KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT: '100' }).pipe(
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

it.effect('P8-CFG-RH-01: rhinoLaunchTimeoutMs respects env override', () =>
    _withHarnessConfig(HarnessConfig.pipe(
        Effect.map((cfg) => cfg.rhinoLaunchTimeoutMs),
        Effect.tap((value) => {
            expect(value).toBe(60_000);
        }),
    ), { KARGADAN_RHINO_LAUNCH_TIMEOUT_MS: '60000' }),
);

it.effect('P8-CFG-WR-01: schema-normalized config strips secret-like legacy keys', () =>
    S.decodeUnknown(KargadanConfigSchema)(
        ConfigFile.set(
            ConfigFile.set(
                ConfigFile.set({ ai: { languageModel: 'gpt-4.1', languageProvider: 'openai' } }, 'ai.geminiAccessToken', 'token'),
                'ai.geminiRefreshToken',
                'refresh',
            ),
            'ai.openaiApiKey',
            'secret',
        ),
    ).pipe(Effect.tap((config) => {
        expect(config.ai?.languageProvider).toBe('openai');
        expect(config.ai?.languageModel).toBe('gpt-4.1');
        expect((config.ai as Record<string, unknown> | undefined)?.['geminiAccessToken']).toBeUndefined();
        expect((config.ai as Record<string, unknown> | undefined)?.['geminiRefreshToken']).toBeUndefined();
        expect((config.ai as Record<string, unknown> | undefined)?.['openaiApiKey']).toBeUndefined();
    })),
);

it.effect('P8-CFG-PG-01: Postgres bootstrap fails with typed actionable error when Postgres.app is missing', () =>
    KargadanHost.postgres.bootstrap.pipe(
        Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(false) })),
        Effect.provide(_configLayer({ KARGADAN_POSTGRES_APP_PATH: '/missing/Postgres.app' })),
        Effect.match({
            onFailure: (error) => Match.value(error).pipe(
                Match.when(Match.instanceOf(HarnessHostError), (hostError) => {
                    expect(hostError.reason).toBe('postgres');
                    expect(hostError.message).toContain('Postgres.app was not found');
                    expect(hostError.message).toContain('KARGADAN_POSTGRES_APP_PATH');
                }),
                Match.orElse((unexpected) => expect.unreachable(`unexpected failure: ${String(unexpected)}`)),
            ),
            onSuccess: () => expect.unreachable('bootstrap should have failed'),
        }),
    ),
);

it.effect('P8-CFG-AI-01: api-secret providers resolve through the shared credential rail', () =>
    Effect.forEach(['anthropic', 'openai'] as const, (provider) =>
        _withRuntimeProvider(
            AiRuntimeProvider.pipe(
                Effect.flatMap((service) => service.resolveCredential(provider)),
                Effect.filterOrFail((credential): credential is Extract<typeof credential, { readonly kind: 'api-secret' }> => credential.kind === 'api-secret'),
                Effect.tap((credential) => {
                    expect(Redacted.value(credential.secret)).toBe(`${provider}-secret`);
                }),
            ),
            { [AiRegistry.providerVocabulary[provider].credential.legacyKey]: `${provider}-secret` },
        ), { discard: true }),
);

it.effect('P8-CFG-AI-02: gemini credential refresh resolves bearer auth from desktop OAuth metadata', () =>
    Effect.gen(function* () {
        const tempRoot = mkdtempSync(join(tmpdir(), 'kargadan-gemini-'));
        const clientPath = join(tempRoot, 'client.json');
        const originalFetch = globalThis.fetch;
        writeFileSync(clientPath, JSON.stringify({
            installed: {
                auth_uri:      'https://accounts.google.com/o/oauth2/auth',
                client_id:     'client-id',
                client_secret: 'client-secret',
                project_id:    'project-id',
                token_uri:     'https://oauth2.googleapis.com/token',
            },
        }));
        globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
            access_token: 'next-access-token',
            expires_in:   3600,
        }), {
            headers: { 'content-type': 'application/json' },
            status:  200,
        }))) as typeof fetch;
        yield* _withRuntimeProvider(
            AiRuntimeProvider.pipe(
                Effect.flatMap((service) => service.resolveCredential('gemini')),
                Effect.filterOrFail((credential): credential is AiRegistry.Credential<'gemini'> => credential.kind === 'oauth-desktop'),
                Effect.tap((credential) => {
                    expect(credential.projectId).toBe('project-id');
                    expect(Redacted.value(credential.accessToken)).toBe('next-access-token');
                }),
            ),
            {
                KARGADAN_AI_GEMINI_ACCESS_TOKEN: 'expired-access-token',
                KARGADAN_AI_GEMINI_CLIENT_PATH:  clientPath,
                KARGADAN_AI_GEMINI_REFRESH_TOKEN:'refresh-token',
                KARGADAN_AI_GEMINI_TOKEN_EXPIRY: new Date(Date.now() - 60_000).toISOString(),
            },
        ).pipe(Effect.ensuring(Effect.sync(() => {
            globalThis.fetch = originalFetch;
            rmSync(tempRoot, { force: true, recursive: true });
        })));
    }),
);

it.effect('P8-CFG-AI-03: registry provider vocabulary builds one credential graph per required provider', () =>
    AiRegistry.decodeAppSettings({ ai: { language: { fallback: ['anthropic'], model: 'gpt-4.1', provider: 'openai' } } }).pipe(
        Effect.tap((settings) => {
            expect(AiRegistry.requiredProviders(settings)).toEqual(['openai', 'anthropic']);
            expect(AiRegistry.layers(settings, {
                anthropic: { kind: 'api-secret', secret: Redacted.make('anthropic-secret') },
                openai:    { kind: 'api-secret', secret: Redacted.make('openai-secret') },
            }).fallbackLanguage).toHaveLength(1);
        }),
    ),
);
