import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { NodeFileSystem } from '@effect/platform-node';
import { SqlClient } from '@effect/sql';
import { DatabaseService, PersistenceService } from '../../../packages/database/src/repos';
import { AiRegistry } from '../../../packages/ai/src/registry';
import { AiRuntimeProvider } from '../../../packages/ai/src/runtime-provider';
import { ConfigProvider, Effect, Layer, Option, Redacted } from 'effect';
import { expect } from 'vitest';

const _EXPIRED_ISO = '2020-01-01T00:00:00.000Z' as const;
const _geminiKeys = AiRegistry.providers.gemini.credential.configKeys;

const _configLayer = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const _sql = {} as never;
const _runtimeDeps = Layer.mergeAll(
    Layer.succeed(DatabaseService, {
        apps: {
            readSettings: () => Effect.succeed(Option.none()),
        },
    } as never),
    Layer.succeed(PersistenceService, {
        kv: {
            getJson: () => Effect.succeed(Option.none()),
            setJson: () => Effect.void,
        },
    } as never),
    Layer.succeed(SqlClient.SqlClient, _sql),
);
const _withRuntimeProvider = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(
        Effect.provide(AiRuntimeProvider.Default),
        Effect.provide(_runtimeDeps),
        Effect.provide(_configLayer(entries)),
        Effect.provide(NodeFileSystem.layer),
    );

it.effect('P8-CFG-AI-01: openai resolves through the shared api-secret credential rail', () =>
    _withRuntimeProvider(
        AiRuntimeProvider.pipe(
            Effect.flatMap((service) => service.resolveCredential('openai')),
            Effect.filterOrFail((credential): credential is Extract<typeof credential, { readonly kind: 'api-secret' }> => credential.kind === 'api-secret'),
            Effect.tap((credential) => {
                expect(Redacted.value(credential.secret)).toBe('openai-secret');
            }),
        ),
        { [AiRegistry.providers.openai.credential.configKeys.secret]: 'openai-secret' },
    ),
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
                [_geminiKeys.accessToken]:  'expired-access-token',
                [_geminiKeys.clientPath]:   clientPath,
                [_geminiKeys.refreshToken]: 'refresh-token',
                [_geminiKeys.expiry]:       _EXPIRED_ISO,
            },
        ).pipe(Effect.ensuring(Effect.sync(() => {
            globalThis.fetch = originalFetch;
            rmSync(tempRoot, { force: true, recursive: true });
        })));
    }),
);

it.effect('P8-CFG-AI-03: registry derives one provider-owned embedding profile from the flat selected language model', () =>
    AiRegistry.decodeAppSettings({ ai: { model: 'gpt-4.1', provider: 'openai' } }).pipe(
        Effect.tap((settings) => {
            expect(settings.provider).toBe('openai');
            expect(settings.embedding).toEqual({
                dimensions: 1536,
                model: 'text-embedding-3-large',
                provider: 'openai',
            });
            expect(AiRegistry.persistable(settings)).toEqual({
                maxOutputTokens: settings.maxOutputTokens,
                model: settings.model,
                provider: settings.provider,
                temperature: settings.temperature,
                topP: settings.topP,
            });
        }),
    ),
);

it.effect('P8-CFG-AI-04: provider metadata declares enrollment requirements for the harness', () =>
    Effect.sync(() => {
        expect(AiRegistry.providers.gemini.requiresBrowser).toBe(true);
        expect(AiRegistry.providers.gemini.requiresClientPath).toBe(true);
        expect(AiRegistry.providers.gemini.supportsHeadlessEnrollment).toBe(false);
        expect(AiRegistry.providers.openai.requiresBrowser).toBe(false);
        expect(AiRegistry.providers.openai.requiresClientPath).toBe(false);
        expect(AiRegistry.providers.openai.supportsHeadlessEnrollment).toBe(true);
        expect(AiRegistry.providers.openai.secretEnvKey).toBe('AI_OPENAI_API_SECRET');
    }),
);

it.effect('P8-CFG-AI-05: OpenAI live model listing filters out non-chat surfaces', () =>
    Effect.gen(function* () {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
            data: [
                { id: 'gpt-4.1' },
                { id: 'o4-mini' },
                { id: 'text-embedding-3-large' },
                { id: 'omni-moderation-latest' },
                { id: 'whisper-1' },
            ],
        }), {
            headers: { 'content-type': 'application/json' },
            status:  200,
        }))) as typeof fetch;
        yield* AiRegistry.listLanguageModels('openai', {
            openai: { kind: 'api-secret', secret: Redacted.make('openai-secret') },
        }).pipe(
            Effect.tap((models) => {
                expect(models.map((model) => model.id)).toEqual(['gpt-4.1', 'o4-mini']);
            }),
            Effect.ensuring(Effect.sync(() => {
                globalThis.fetch = originalFetch;
            })),
        );
    }),
);
