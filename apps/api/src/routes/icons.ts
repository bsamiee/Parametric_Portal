/**
 * Icons group handlers for listing and generating icons via Anthropic API.
 */
import { makeRepositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder, type PaginationQuery } from '@parametric-portal/server/api';
import { InternalError } from '@parametric-portal/server/errors';
import { SessionContext } from '@parametric-portal/server/middleware';
import { Effect, pipe } from 'effect';
import { AppApi } from '../api.ts';
import { IconGenerationService, type ServiceInput } from '../services/icons.ts';

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleList = (params: PaginationQuery) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const repos = yield* makeRepositories;
            const assets = yield* repos.assets.findAllByUserId({
                limit: params.limit,
                offset: params.offset,
                userId: session.userId,
            });
            const { count: total } = yield* repos.assets.countByUserId(session.userId);

            return {
                data: assets.map((a) => ({ id: String(a.id), prompt: String(a.prompt) })),
                limit: params.limit,
                offset: params.offset,
                total,
            };
        }),
        Effect.orDie,
    );

const handleGenerate = (input: ServiceInput) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const repos = yield* makeRepositories;
            const iconService = yield* IconGenerationService;
            const result = yield* pipe(
                iconService.generate(input),
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
        Effect.orDie,
    );

// --- [LAYER] -----------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(AppApi, 'icons', (handlers) =>
    handlers
        .handle('list', ({ urlParams }) => handleList(urlParams))
        .handle('generate', ({ payload }) => handleGenerate(payload)),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconsLive };
