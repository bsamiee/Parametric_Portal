#!/usr/bin/env tsx
/**
 * GitHub entity data extractor with polymorphic handlers.
 * Fetches issues, PRs, or discussions with normalized output shapes.
 */

import { B, type Ctx, call, createCtx, fn, type Label, md, mutate, type RunParams, type User } from './schema.ts';

// --- Types ------------------------------------------------------------------

type ReactionGroups = ReadonlyArray<{ readonly content: string; readonly users: { readonly totalCount: number } }>;

// --- Handlers ---------------------------------------------------------------

type DiscussionReply = {
    readonly author: User;
    readonly body: string;
    readonly createdAt: string;
    readonly reactionGroups: ReactionGroups;
};
type DiscussionComment = DiscussionReply & { readonly replies: { readonly nodes: ReadonlyArray<DiscussionReply> } };
type Discussion = {
    readonly answer: { readonly author: User; readonly body: string; readonly createdAt: string } | null;
    readonly author: User;
    readonly body: string;
    readonly category: Label;
    readonly comments: { readonly nodes: ReadonlyArray<DiscussionComment> };
    readonly createdAt: string;
    readonly labels: { readonly nodes: ReadonlyArray<Label> };
    readonly reactionGroups: ReactionGroups;
    readonly title: string;
};

const mapReply = (r: DiscussionReply) => ({
    author: r.author.login,
    body: fn.trunc(r.body),
    createdAt: r.createdAt,
    reactions: fn.reactions(r.reactionGroups),
});

const handlers = {
    discussion: async (ctx: Ctx, n: number) => {
        const d = (await call(ctx, 'discussion.get', n)) as Discussion;
        return {
            comments: d.comments.nodes.map((c) => ({ ...mapReply(c), replies: c.replies.nodes.map(mapReply) })),
            discussion: {
                answer: d.answer
                    ? { author: d.answer.author.login, body: fn.trunc(d.answer.body), createdAt: d.answer.createdAt }
                    : null,
                author: d.author.login,
                body: fn.trunc(d.body),
                category: d.category.name,
                createdAt: d.createdAt,
                labels: fn.names(d.labels.nodes),
                number: n,
                reactions: fn.reactions(d.reactionGroups),
                title: d.title,
            },
        };
    },

    issue: async (ctx: Ctx, n: number) => {
        type I = {
            readonly assignees: ReadonlyArray<User>;
            readonly body: string | null;
            readonly created_at: string;
            readonly labels: ReadonlyArray<Label>;
            readonly milestone: { readonly title: string } | null;
            readonly number: number;
            readonly state: string;
            readonly title: string;
            readonly user: User;
        };
        type C = ReadonlyArray<{ readonly body?: string; readonly created_at: string; readonly user: User }>;
        const [issue, comments] = await Promise.all([
            call(ctx, 'issue.get', n) as Promise<I>,
            call(ctx, 'comment.list', n) as Promise<C>,
        ]);
        return {
            comments: comments.map(fn.comment),
            issue: {
                assignees: fn.logins(issue.assignees),
                author: issue.user.login,
                body: fn.trunc(issue.body),
                createdAt: issue.created_at,
                labels: fn.names(issue.labels),
                milestone: issue.milestone?.title ?? null,
                number: issue.number,
                state: issue.state,
                title: issue.title,
            },
        };
    },

    pr: async (ctx: Ctx, n: number) => {
        type P = {
            readonly assignees: ReadonlyArray<User>;
            readonly body: string | null;
            readonly draft: boolean;
            readonly head: { readonly sha: string };
            readonly labels: ReadonlyArray<Label>;
            readonly number: number;
            readonly title: string;
        };
        type Rev = ReadonlyArray<{ readonly body: string | null; readonly state: string; readonly user: User }>;
        type Chk = ReadonlyArray<{
            readonly conclusion: string | null;
            readonly name: string;
            readonly status: string;
        }>;
        type Cmt = ReadonlyArray<{ readonly body?: string; readonly created_at: string; readonly user: User }>;
        type RC = ReadonlyArray<{
            readonly body: string;
            readonly line?: number;
            readonly path: string;
            readonly user: User;
        }>;
        type F = ReadonlyArray<{
            readonly additions: number;
            readonly deletions: number;
            readonly filename: string;
            readonly status: string;
        }>;
        type Co = ReadonlyArray<{
            readonly author: User | null;
            readonly commit: { readonly message: string };
            readonly sha: string;
        }>;
        const pr = (await call(ctx, 'pull.get', n)) as P;
        const [reviews, checks, comments, reviewComments, files, commits, requestedReviewers] = await Promise.all([
            call(ctx, 'pull.listReviews', n) as Promise<Rev>,
            call(ctx, 'check.listForRef', pr.head.sha) as Promise<Chk>,
            call(ctx, 'comment.list', n) as Promise<Cmt>,
            call(ctx, 'pull.listReviewComments', n) as Promise<RC>,
            call(ctx, 'pull.listFiles', n) as Promise<F>,
            call(ctx, 'pull.listCommits', n) as Promise<Co>,
            call(ctx, 'pull.listRequestedReviewers', n) as Promise<ReadonlyArray<User>>,
        ]);
        return {
            checks,
            comments: comments.map(fn.comment),
            commits: commits.map((c) => ({
                author: c.author?.login ?? 'unknown',
                message: c.commit.message.split('\n')[0],
                sha: c.sha.substring(0, B.probe.shaLength),
            })),
            files,
            pr: {
                assignees: fn.logins(pr.assignees),
                body: fn.trunc(pr.body),
                draft: pr.draft,
                labels: fn.names(pr.labels),
                number: pr.number,
                sha: pr.head.sha,
                title: pr.title,
            },
            requestedReviewers: fn.logins(requestedReviewers),
            reviewComments: reviewComments.map((c) => ({
                author: c.user.login,
                body: fn.trunc(c.body),
                line: c.line,
                path: c.path,
            })),
            reviews: reviews.map((r) => ({ author: r.user.login, body: fn.trunc(r.body), state: r.state })),
        };
    },
} as const;

// --- Entry Point ------------------------------------------------------------

const probe = async <K extends keyof typeof handlers>(params: RunParams, kind: K, n: number) =>
    handlers[kind](createCtx(params), n);

const post = async (params: RunParams, n: number, marker: string, title: string, body: string): Promise<void> =>
    ((m) =>
        mutate(createCtx(params), {
            body: `${m}\n# ${title}\n\n${body}`,
            marker: m,
            mode: 'replace',
            n,
            t: 'comment',
        }))(md.marker(marker)).then(() => params.core.info(`Posted ${title} to PR #${n}`));

// --- Derived Types ----------------------------------------------------------

type DiscussionProbe = Awaited<ReturnType<typeof handlers.discussion>>;
type IssueProbe = Awaited<ReturnType<typeof handlers.issue>>;
type PrProbe = Awaited<ReturnType<typeof handlers.pr>>;

// --- Export -----------------------------------------------------------------

export { handlers, post, probe };
export type { DiscussionProbe, IssueProbe, PrProbe };
