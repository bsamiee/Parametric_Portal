/**
 * Icons group handlers for listing and generating icons via Anthropic API.
 */
import { makeRepositories, type Repositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder, type PaginationQuery } from '@parametric-portal/server/api';
import { Crypto } from '@parametric-portal/server/crypto';
import { InternalError } from '@parametric-portal/server/errors';
import { SessionContext } from '@parametric-portal/server/middleware';
import type { AiProvider, UserId } from '@parametric-portal/types/database';
import { type Context, Effect, Option, pipe } from 'effect';
import { AppApi } from '../api.ts';
import { IconGenerationService, type ServiceInput } from '../services/icons.ts';

// --- [TYPES] -----------------------------------------------------------------

type IconGenerationServiceType = Context.Tag.Service<typeof IconGenerationService>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getUserApiKey = (repos: Repositories, userId: UserId, provider: AiProvider) =>
    pipe(
        repos.apiKeys.findByUserIdAndProvider({ provider, userId }),
        Effect.map(Option.flatMap((apiKey) => apiKey.keyEncrypted)),
        Effect.flatMap(
            Option.match({
                onNone: () => Effect.succeed(Option.none<string>()),
                onSome: (keyEncrypted) =>
                    pipe(
                        Crypto.decryptFromBytes(keyEncrypted),
                        Effect.map(Option.some),
                        Effect.mapError((e) => new InternalError({ cause: `Key decryption failed: ${String(e)}` })),
                    ),
            }),
        ),
        Effect.catchAll(() => Effect.succeed(Option.none<string>())),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = (repos: Repositories, params: PaginationQuery) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const assets = yield* pipe(
            repos.assets.findAllByUserId({
                limit: params.limit,
                offset: params.offset,
                userId: session.userId,
            }),
            Effect.mapError(() => new InternalError({ cause: 'Asset list retrieval failed' })),
        );
        const { count } = yield* pipe(
            repos.assets.countByUserId(session.userId),
            Effect.mapError(() => new InternalError({ cause: 'Asset count failed' })),
        );

        return {
            data: assets.map((a) => ({ id: a.id, prompt: a.prompt })),
            limit: params.limit,
            offset: params.offset,
            total: count,
        };
    });

const handleGenerate = (repos: Repositories, iconService: IconGenerationServiceType, input: ServiceInput) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const userApiKeyOpt = yield* getUserApiKey(repos, session.userId, 'anthropic');
        const generateInput: ServiceInput = Option.match(userApiKeyOpt, {
            onNone: () => input,
            onSome: (apiKey) => ({ ...input, apiKey }),
        });
        const result = yield* pipe(
            iconService.generate(generateInput),
            Effect.filterOrFail(
                (r) => r.variants.length > 0,
                () => new InternalError({ cause: 'No icon variants generated' }),
            ),
        );
        const asset = yield* pipe(
            repos.assets.insert({
                prompt: input.prompt,
                svg: result.variants[0]?.svg ?? '',
                userId: session.userId,
            }),
            Effect.mapError(() => new InternalError({ cause: 'Asset storage failed' })),
        );

        return { id: String(asset.id), variants: result.variants };
    });

// --- [LAYER] -----------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(AppApi, 'icons', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* makeRepositories;
        const iconService = yield* IconGenerationService;
        return handlers
            .handle('list', ({ urlParams }) => handleList(repos, urlParams))
            .handle('generate', ({ payload }) => handleGenerate(repos, iconService, payload));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconsLive };
