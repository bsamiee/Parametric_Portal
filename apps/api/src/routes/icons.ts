/**
 * Icons group handlers for listing and generating icons via multi-provider AI.
 * Supports Anthropic, OpenAI, and Gemini via @parametric-portal/ai registry.
 * Credential resolution: checks OAuth accounts first, then API keys.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { RequestContext } from '@parametric-portal/server/context';
import { EncryptedKey } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import type { Page } from '@parametric-portal/database/page';
import { Array as A, Config, type Context, Effect, Option, pipe } from 'effect';
import { IconGenerationService, type ServiceInput } from '../services/icons.ts';

// --- [TYPES] (handlers) ------------------------------------------------------

type IconGenerationServiceType = Context.Tag.Service<typeof IconGenerationService>;

// --- [TYPES] (local) ---------------------------------------------------------

type CredentialResult = { readonly credential: string; readonly expiresAt: Date | null; readonly source: 'apikey' | 'oauth' };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/**
 * Unified credential resolver: checks OAuth accounts first, then API keys.
 * Returns the first valid, decryptable credential for the given provider string.
 */
const getCredential = Effect.fn('icons.credential.get')(
    (repos: DatabaseServiceShape, provider: string, prefer: 'any' | 'apikey' | 'oauth' = 'any') =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            // Try OAuth first (unless prefer === 'apikey')
            const oauthResult: Option.Option<CredentialResult> = prefer === 'apikey'
                ? Option.none()
                : yield* repos.oauthAccounts.byUser(session.userId).pipe(
                    Effect.map((accounts) => A.findFirst(accounts, (a) => a.provider === provider)),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.succeed(Option.none<CredentialResult>()),
                        onSome: (account) =>
                            EncryptedKey.decryptBytes(new Uint8Array(account.accessEncrypted)).pipe(
                                Effect.map((credential) => Option.some({
                                    credential,
                                    expiresAt: Option.getOrNull(account.expiresAt),
                                    source: 'oauth' as const,
                                })),
                                Effect.tapError((e) => Effect.logWarning('OAuth token decryption failed', { error: String(e), provider })),
                                Effect.catchAll(() => Effect.succeed(Option.none<CredentialResult>())),
                            ),
                    })),
                    Effect.catchAll(() => Effect.succeed(Option.none<CredentialResult>())),
                );
            // Return OAuth if found, otherwise try API key (unless prefer === 'oauth')
            return Option.isSome(oauthResult) ? oauthResult
                : prefer === 'oauth' ? Option.none<CredentialResult>()
                : yield* repos.apiKeys.byUser(session.userId).pipe(
                    Effect.map((keys) => A.findFirst(keys, (k) => k.name === provider)),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.succeed(Option.none<CredentialResult>()),
                        onSome: (key) =>
                            EncryptedKey.decryptBytes(new Uint8Array(key.encrypted)).pipe(
                                Effect.map((credential) => Option.some({
                                    credential,
                                    expiresAt: Option.getOrNull(key.expiresAt),
                                    source: 'apikey' as const,
                                })),
                                Effect.tapError((e) => Effect.logWarning('API key decryption failed', { error: String(e), provider })),
                                Effect.catchAll(() => Effect.succeed(Option.none<CredentialResult>())),
                            ),
                    })),
                    Effect.catchAll(() => Effect.succeed(Option.none<CredentialResult>())),
                );
        }),
);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = Effect.fn('icons.list')((repos: DatabaseServiceShape, params: Page.Keyset) =>
    Effect.gen(function* () {
        yield* Middleware.requireMfaVerified;
        const session = yield* Middleware.Session;
        const result = yield* repos.assets
            .byUserKeyset(session.userId, params.limit, params.cursor)
            .pipe(Effect.mapError((e) => HttpError.internal('Asset list retrieval failed', e)));
        return { ...result, items: result.items.map((a) => ({ id: a.id })) };
    }),
);
const handleGenerate = Effect.fn('icons.generate')(
    (repos: DatabaseServiceShape, iconService: IconGenerationServiceType, input: ServiceInput, allowEnvKeys: boolean) =>
        Effect.gen(function* () {
            yield* Middleware.requireMfaVerified;
            const provider = input.provider ?? 'anthropic';
            const credentialOpt = yield* getCredential(repos, provider);
            const generateInput: ServiceInput = yield* Option.match(credentialOpt, {
                onNone: () =>
                    allowEnvKeys
                        ? Effect.succeed({ ...input, provider })
                        : Effect.fail(HttpError.internal(`Missing ${provider} credential (OAuth or API key)`)),
                onSome: (cred) => Effect.succeed({ ...input, apiKey: cred.credential, provider }),
            });
            const result = yield* pipe(
                iconService.generate(generateInput),
                Effect.filterOrFail(
                    (r) => r.svgs.length > 0,
                    () => HttpError.internal('No SVGs generated'),
                ),
            );
            const appId = yield* RequestContext.app;
            const session = yield* Middleware.Session;
            const insertedAssets = yield* repos.assets
                .insertMany(
                    result.svgs.map((svg) => ({
                        appId,
                        content: svg,
                        deletedAt: Option.none(),
                        hash: Option.none(),
                        kind: 'icon',
                        name: Option.none(),
                        state: 'active',
                        updatedAt: undefined,
                        userId: Option.some(session.userId),
                    })),
                )
                .pipe(Effect.mapError((e) => HttpError.internal('Asset storage failed', e)));
            yield* Effect.forEach(insertedAssets, (a) =>
                Audit.log(repos.audit, 'Asset', a.id, 'create', { after: { contentLength: a.content.length, kind: a.kind } }),
            );
            return yield* insertedAssets.length > 0
                ? Effect.succeed({
                      assets: insertedAssets.map((a, i) => ({ id: a.id, svg: Option.getOrElse(A.get(result.svgs, i), () => '' as typeof result.svgs[number]) })),
                  })
                : Effect.fail(HttpError.internal('No assets inserted'));
        }),
);

// --- [LAYER] -----------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(ParametricApi, 'icons', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        const iconService = yield* IconGenerationService;
        const allowEnvKeys = yield* Config.string('NODE_ENV').pipe(
            Config.withDefault('development'),
            Config.map((env) => env !== 'production'),
        );
        return handlers
            .handle('list', ({ urlParams }) => handleList(repos, urlParams))
            .handle('generate', ({ payload }) => handleGenerate(repos, iconService, payload, allowEnvKeys));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconsLive };
