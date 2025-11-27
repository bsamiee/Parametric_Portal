#!/usr/bin/env tsx
/**
 * Release Script - Config-Driven Changelog & Release Creation
 *
 * @module release
 */

import {
    B,
    type Commit,
    type Ctx,
    call,
    createCtx,
    fn,
    type G,
    mutate,
    type RunParams,
    type Section,
    type Tag,
} from './schema.ts';

// --- Derived Types ----------------------------------------------------------

type Groups = G<typeof B.release.conventional>;

// --- Pure Functions ---------------------------------------------------------

const classify = (commits: ReadonlyArray<Commit>, patterns: ReadonlyArray<string>): ReadonlyArray<string> =>
    commits
        .filter((c) => patterns.some((p) => c.commit.message.startsWith(p) || c.commit.message.includes(p)))
        .map((c) => c.commit.message.split('\n')[0]);

const changelog = (groups: Groups): string =>
    fn.body(
        B.release.order
            .filter((k) => groups[k].length > 0)
            .flatMap(
                (k): ReadonlyArray<Section> => [
                    { k: 'h', l: 2, t: B.release.conventional[k].t },
                    { i: groups[k], k: 'b' },
                ],
            ),
    );

const bump = (groups: Groups, override?: string): string =>
    override && override !== 'auto'
        ? override
        : (Object.entries(B.release.bump).find(([k]) => groups[k as keyof Groups].length > 0)?.[1] ??
          B.release.default);

const groupCommits = (commits: ReadonlyArray<Commit>): Groups =>
    Object.fromEntries(B.release.order.map((k) => [k, classify(commits, B.release.conventional[k].p)])) as Groups;

// --- Fetch Commits ----------------------------------------------------------

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
                changelog: changelog(groups) || 'No significant changes.',
                groups,
                hasChanges: commits.length > 0,
            }))(groupCommits(commits)),
        ))(createCtx(params));

const create = async (params: RunParams, tag: string, body: string): Promise<void> =>
    mutate(createCtx(params), { body, name: `Release ${tag}`, t: 'release', tag }).then(() =>
        params.core.info(`Release ${tag} created`),
    );

// --- Export -----------------------------------------------------------------

export { analyze, bump, changelog, classify, create, groupCommits };
