#!/usr/bin/env tsx
/**
 * Commit analyzer and release creator using B.types classification.
 * Groups commits by type, determines bump level, generates changelog via fn.body.
 */

import {
    B,
    type Commit,
    type Ctx,
    call,
    createCtx,
    fn,
    mutate,
    type RunParams,
    type Section,
    type Tag,
} from './schema.ts';

// --- Derived Types ----------------------------------------------------------

type TypeOrder = (typeof B.typeOrder)[number];
type Groups = Readonly<Record<TypeOrder, ReadonlyArray<string>>>;

// --- Pure Functions ---------------------------------------------------------

const firstLine = (c: Commit): string => c.commit.message.split('\n')[0];
const matchesType = (msg: string, patterns: ReadonlyArray<string>): boolean =>
    patterns.some((p) => msg.startsWith(p) || msg.includes(p));
const groupCommits = (commits: ReadonlyArray<Commit>): Groups =>
    Object.fromEntries(
        B.typeOrder.map((k) =>
            ((patterns) => [
                k,
                patterns ? commits.filter((c) => matchesType(c.commit.message, patterns)).map(firstLine) : [],
            ])(B.types[k].p),
        ),
    ) as unknown as Groups;

const changelog = (groups: Groups): string =>
    fn.body(
        B.typeOrder
            .filter((k) => groups[k].length > 0 && B.types[k].t)
            .flatMap(
                (k): ReadonlyArray<Section> => [
                    { k: 'h', l: 2, t: B.types[k].t as string },
                    { i: groups[k], k: 'b' },
                ],
            ),
    );

const bump = (groups: Groups, override?: string): string =>
    override && override !== 'auto'
        ? override
        : ((t) => (t && B.bump[t as keyof typeof B.bump]) ?? B.release.default)(
              B.typeOrder.find((type) => groups[type].length > 0),
          );

const fetchCommits = async (ctx: Ctx): Promise<ReadonlyArray<Commit>> =>
    ((tags) =>
        tags.length > 0
            ? (call(ctx, 'repo.compareCommits', tags[0].name, 'HEAD') as Promise<ReadonlyArray<Commit>>)
            : (call(ctx, 'repo.listCommits') as Promise<ReadonlyArray<Commit>>))(
        (await call(ctx, 'tag.list')) as ReadonlyArray<Tag>,
    );

// --- Entry Points -----------------------------------------------------------

const analyze = async (params: RunParams, releaseType?: string) =>
    ((ctx) =>
        fetchCommits(ctx).then((commits) =>
            ((groups) => ({
                bump: bump(groups, releaseType),
                changelog: changelog(groups) || B.release.emptyChangelog,
                groups,
                hasChanges: commits.length > 0,
            }))(groupCommits(commits)),
        ))(createCtx(params));

const create = async (params: RunParams, tag: string, body: string): Promise<void> =>
    mutate(createCtx(params), { body, name: `Release ${tag}`, t: 'release', tag }).then(() =>
        params.core.info(`Release ${tag} created`),
    );

// --- Export -----------------------------------------------------------------

export { analyze, create };
