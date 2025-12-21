/**
 * Icons group handlers for listing and generating icons via Anthropic API.
 */
import { makeRepositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder, type PaginationQuery } from '@parametric-portal/server/api';
import { SessionContext } from '@parametric-portal/server/middleware';
import { Effect, pipe, Schema as S } from 'effect';

import { AnthropicService } from '../anthropic.ts';
import { AppApi } from '../api.ts';

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

const handleGenerate = (prompt: string) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const repos = yield* makeRepositories;
            const anthropic = yield* AnthropicService;
            const svg = yield* anthropic.generateSvg(prompt);
            const asset = yield* repos.assets.insert({
                prompt: S.decodeSync(S.NonEmptyTrimmedString)(prompt),
                svg,
                userId: session.userId,
            });

            return { id: String(asset.id), svg: asset.svg };
        }),
        Effect.orDie,
    );

// --- [LAYER] -----------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(AppApi, 'icons', (handlers) =>
    handlers
        .handle('list', ({ urlParams }) => handleList(urlParams))
        .handle('generate', ({ payload: { prompt } }) => handleGenerate(prompt)),
);

// --- [EXPORT] ----------------------------------------------------------------

export { IconsLive };
