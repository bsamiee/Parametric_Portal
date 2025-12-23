/**
 * Icons group handlers for listing and generating icons via Anthropic API.
 */
import { makeRepositories, type Repositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder, type PaginationQuery } from '@parametric-portal/server/api';
import { Crypto } from '@parametric-portal/server/crypto';
import { InternalError, UnauthorizedError } from '@parametric-portal/server/errors';
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
        Effect.flatMap(
            Option.match({
                onNone: () => Effect.succeed(undefined as string | undefined),
                onSome: (apiKey) =>
                    pipe(
                        Option.fromNullable(Option.getOrUndefined(apiKey.keyEncrypted)),
                        Option.match({
                            onNone: () => Effect.succeed(undefined as string | undefined),
                            onSome: (encrypted) =>
                                pipe(
                                    Crypto.decryptFromBytes(encrypted),
                                    Effect.mapError(
                                        (e) => new InternalError({ cause: `Key decryption failed: ${String(e)}` }),
                                    ),
                                ),
                        }),
                    ),
            }),
        ),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = (repos: Repositories, params: PaginationQuery) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const assets = yield* repos.assets.findAllByUserId({
                limit: params.limit,
                offset: params.offset,
                userId: session.userId,
            });
            const { count: total } = yield* repos.assets.countByUserId(session.userId);

            return {
                data: assets.map((a) => ({ id: a.id, prompt: a.prompt })),
                limit: params.limit,
                offset: params.offset,
                total,
            };
        }),
        Effect.catchTags({
            NoSuchElementException: () => Effect.fail(new UnauthorizedError({ reason: 'Session required' })),
            ParseError: () => Effect.fail(new InternalError({ cause: 'Asset data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'Asset list retrieval failed' })),
        }),
    );

const handleGenerate = (repos: Repositories, iconService: IconGenerationServiceType, input: ServiceInput) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const userApiKey = yield* getUserApiKey(repos, session.userId, 'anthropic');
            const result = yield* pipe(
                iconService.generate({ ...input, ...(userApiKey && { apiKey: userApiKey }) }),
                Effect.filterOrFail(
                    (r) => r.variants.length > 0,
                    () => new InternalError({ cause: 'No icon variants generated' }),
                ),
            );
            const asset = yield* repos.assets.insert({
                prompt: input.prompt,
                svg: result.variants[0]?.svg ?? '',
                userId: session.userId,
            });

            return { id: String(asset.id), variants: result.variants };
        }),
        Effect.catchTags({
            InternalError: (err) => Effect.fail(err),
            NoSuchElementException: () => Effect.fail(new InternalError({ cause: 'No icon variants generated' })),
            ParseError: () => Effect.fail(new InternalError({ cause: 'Asset data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'Asset storage failed' })),
        }),
    );

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
