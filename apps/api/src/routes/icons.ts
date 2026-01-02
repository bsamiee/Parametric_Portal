/**
 * Icons group handlers for listing and generating icons via multi-provider AI.
 * Supports Anthropic, OpenAI, and Gemini via @parametric-portal/ai registry.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { EncryptedKey } from '@parametric-portal/server/crypto';
import { InternalError } from '@parametric-portal/server/domain-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AiProvider, UserId } from '@parametric-portal/types/database';
import { type Context, Effect, Option, pipe } from 'effect';
import { Pagination, ParametricApi } from '@parametric-portal/server/api';
import { IconGenerationService, type ServiceInput } from '../services/icons.ts';

// --- [TYPES] -----------------------------------------------------------------

type IconGenerationServiceType = Context.Tag.Service<typeof IconGenerationService>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getUserApiKey = Effect.fn('icons.apiKey.get')(
    (repos: DatabaseServiceShape, userId: typeof UserId.Type, provider: typeof AiProvider.Type) =>
        Effect.gen(function* () {
            const apiKeyOpt = yield* pipe(
                repos.apiKeys.findByUserIdAndProvider({ provider, userId }),
                Effect.tapError((e) =>
                    Effect.logWarning('API key lookup failed, using default key', {
                        error: String(e),
                        provider,
                        userId,
                    }),
                ),
                Effect.catchTags({
                    ParseError: () => Effect.succeed(Option.none()),
                    SqlError: () => Effect.succeed(Option.none()),
                }),
            );
            const keyEncryptedOpt = Option.map(apiKeyOpt, (apiKey) => apiKey.keyEncrypted);
            return yield* Option.match(keyEncryptedOpt, {
                onNone: () => Effect.succeed(Option.none<string>()),
                onSome: (keyEncrypted) =>
                    pipe(
                        EncryptedKey.decryptBytes(keyEncrypted),
                        Effect.map(Option.some),
                        Effect.mapError(() => new InternalError({ message: 'Key decryption failed' })),
                    ),
            });
        }),
);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = Effect.fn('icons.list')((repos: DatabaseServiceShape, params: typeof Pagination.Query.Type) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const assets = yield* pipe(
            repos.assets.findAllByUserId({
                limit: params.limit,
                offset: params.offset,
                userId: session.userId,
            }),
            Effect.mapError(() => new InternalError({ message: 'Asset list retrieval failed' })),
        );
        const { count } = yield* pipe(
            repos.assets.countByUserId(session.userId),
            Effect.mapError(() => new InternalError({ message: 'Asset count failed' })),
        );
        return {
            data: assets.map((a) => ({ id: a.id })),
            limit: params.limit,
            offset: params.offset,
            total: count,
        };
    }),
);
const handleGenerate = Effect.fn('icons.generate')(
    (repos: DatabaseServiceShape, iconService: IconGenerationServiceType, input: ServiceInput) =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            const provider = input.provider ?? 'anthropic';
            const userApiKeyOpt = yield* getUserApiKey(repos, session.userId, provider);
            const generateInput: ServiceInput = Option.match(userApiKeyOpt, {
                onNone: () => ({ ...input, provider }),
                onSome: (apiKey) => ({ ...input, apiKey, provider }),
            });
            const result = yield* pipe(
                iconService.generate(generateInput),
                Effect.filterOrFail(
                    (r) => r.variants.length > 0,
                    () => new InternalError({ message: 'No icon variants generated' }),
                ),
            );
            const insertedAssets = yield* pipe(
                Effect.forEach(
                    result.variants,
                    (variant) =>
                        repos.assets.insert({
                            assetType: 'icon',
                            content: variant.svg,
                            createdAt: undefined,
                            deletedAt: Option.none(),
                            updatedAt: undefined,
                            userId: Option.some(session.userId),
                        }),
                    { concurrency: 'unbounded' },
                ),
                Effect.mapError(() => new InternalError({ message: 'Asset storage failed' })),
            );
            const primaryId = insertedAssets[0]?.id;
            return yield* (primaryId
                ? Effect.succeed({ id: primaryId, variants: result.variants })
                : Effect.fail(new InternalError({ message: 'No assets inserted' })));
        }),
);

// --- [LAYER] -----------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(ParametricApi, 'icons', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        const iconService = yield* IconGenerationService;
        return handlers
            .handle('list', ({ urlParams }) => handleList(repos, urlParams))
            .handle('generate', ({ payload }) => handleGenerate(repos, iconService, payload));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconsLive };
