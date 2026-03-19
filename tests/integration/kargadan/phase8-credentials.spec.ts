import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@effect/vitest';
import { NodeFileSystem } from '@effect/platform-node';
import { AiRegistry } from '../../../packages/ai/src/registry';
import { AiRuntimeProvider } from '../../../packages/ai/src/runtime-provider';
import { ConfigProvider, Effect, Layer, Redacted } from 'effect';
import { expect } from 'vitest';

const _EXPIRED_ISO = '2020-01-01T00:00:00.000Z' as const;
const _geminiKeys = AiRegistry.providers.gemini.credential.configKeys;

const _configLayer = (entries: Record<string, string>) =>
    Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const _withRuntimeProvider = <A, E, R>(effect: Effect.Effect<A, E, R>, entries: Record<string, string>) =>
    effect.pipe(Effect.provide(AiRuntimeProvider.Default), Effect.provide(_configLayer(entries)), Effect.provide(NodeFileSystem.layer));

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
            { [AiRegistry.providers[provider].credential.configKeys.secret]: `${provider}-secret` },
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

it.effect('P8-CFG-AI-03: registry provider vocabulary builds one credential graph per required provider', () =>
    AiRegistry.decodeAppSettings({ ai: { language: {
        fallback: [{ modality: 'language', model: 'claude-sonnet-4-6', provider: 'anthropic' }],
        primary:  { modality: 'language', model: 'gpt-4.1', provider: 'openai' },
    } } }).pipe(
        Effect.tap((settings) => {
            expect(AiRegistry.requiredProviders(settings)).toEqual(['openai', 'anthropic']);
            expect(AiRegistry.layers(settings, {
                anthropic: { kind: 'api-secret', secret: Redacted.make('anthropic-secret') },
                openai:    { kind: 'api-secret', secret: Redacted.make('openai-secret') },
            }).fallbackLanguage).toHaveLength(1);
        }),
    ),
);
