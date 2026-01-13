/**
 * Icons group handlers for listing and generating icons via multi-provider AI.
 * Supports Anthropic, OpenAI, and Gemini via @parametric-portal/ai registry.
 * Includes audit logging for asset creation.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { type Pagination, ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { getAppId } from '@parametric-portal/server/context';
import { EncryptedKey } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AssetType, type AiProvider, type ApiKey, type UserId } from '@parametric-portal/types/schema';
import { Config, type Context, Effect, Option, pipe } from 'effect';
import { IconGenerationService, type ServiceInput } from '../services/icons.ts';

// --- [TYPES] -----------------------------------------------------------------

type IconGenerationServiceType = Context.Tag.Service<typeof IconGenerationService>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getUserApiKey = Effect.fn('icons.apiKey.get')(
    (repos: DatabaseServiceShape, userId: UserId, provider: AiProvider) =>
        Effect.gen(function* () {
            const apiKeyOpt = yield* repos.apiKeys.findByUserIdAndProvider(userId, provider).pipe(
                Effect.tapError((e) =>
                    Effect.logWarning('API key lookup failed, using default key', {
                        error: e instanceof Error ? { message: e.message, name: e.name } : e,
                        provider,
                        userId,
                    }),
                ),
                Effect.catchAll(() => Effect.succeed(Option.none<ApiKey>())),
            );
            const keyEncryptedOpt = Option.map(apiKeyOpt, (apiKey) => apiKey.keyEncrypted);
            return yield* Option.match(keyEncryptedOpt, {
                onNone: () => Effect.succeed(Option.none<string>()),
                onSome: (keyEncrypted) =>
                    EncryptedKey.decryptBytes(new Uint8Array(keyEncrypted)).pipe(
                        Effect.map(Option.some),
                        Effect.mapError(() => new HttpError.Internal({ message: 'Key decryption failed' })),
                    ),
            });
        }),
);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = Effect.fn('icons.list')((repos: DatabaseServiceShape, params: typeof Pagination.Query.Type) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const assets = yield* repos.assets
            .findAllByUserId(session.userId, params.limit, params.offset)
            .pipe(Effect.mapError(() => new HttpError.Internal({ message: 'Asset list retrieval failed' })));
        const count = yield* repos.assets
            .countByUserId(session.userId)
            .pipe(Effect.mapError(() => new HttpError.Internal({ message: 'Asset count failed' })));
        return { data: assets.map((a) => ({ id: a.id })), limit: params.limit, offset: params.offset, total: count };
    }),
);
const handleGenerate = Effect.fn('icons.generate')(
    (repos: DatabaseServiceShape, iconService: IconGenerationServiceType, input: ServiceInput, allowEnvKeys: boolean) =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            const appId = yield* getAppId;
            const provider = input.provider ?? 'anthropic';
            const userApiKeyOpt = yield* getUserApiKey(repos, session.userId, provider);
            const generateInput: ServiceInput = yield* Option.match(userApiKeyOpt, {
                onNone: () =>
                    allowEnvKeys
                        ? Effect.succeed({ ...input, provider })
                        : Effect.fail(new HttpError.Internal({ message: `Missing ${provider} API key` })),
                onSome: (apiKey) => Effect.succeed({ ...input, apiKey, provider }),
            });
            const result = yield* pipe(
                iconService.generate(generateInput),
                Effect.filterOrFail(
                    (r) => r.variants.length > 0,
                    () => new HttpError.Internal({ message: 'No icon variants generated' }),
                ),
            );
            const insertedAssets = yield* repos.assets
                .insertMany(
                    result.variants.map((variant) => ({
                        appId,
                        assetType: AssetType.decodeSync('icon'),
                        content: variant.svg,
                        userId: session.userId,
                    })),
                )
                .pipe(HttpError.chain(HttpError.Internal, { message: 'Asset storage failed' }));
            yield* Audit.log(repos.audit, { actorId: session.userId, assets: insertedAssets, operation: 'create' });
            const primaryId = insertedAssets[0]?.id;
            return yield* primaryId
                ? Effect.succeed({ id: primaryId, variants: result.variants })
                : Effect.fail(new HttpError.Internal({ message: 'No assets inserted' }));
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
