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

const mapReply = (reply: DiscussionReply) => ({
    author: reply.author.login,
    body: fn.trunc(reply.body),
    createdAt: reply.createdAt,
    reactions: fn.reactions(reply.reactionGroups),
});

const handlers = {
    discussion: async (ctx: Ctx, number: number) => {
        const discussion = (await call(ctx, 'discussion.get', number)) as Discussion;
        return {
            comments: discussion.comments.nodes.map((comment) => ({
                ...mapReply(comment),
                replies: comment.replies.nodes.map(mapReply),
            })),
            discussion: {
                answer: discussion.answer
                    ? {
                          author: discussion.answer.author.login,
                          body: fn.trunc(discussion.answer.body),
                          createdAt: discussion.answer.createdAt,
                      }
                    : null,
                author: discussion.author.login,
                body: fn.trunc(discussion.body),
                category: discussion.category.name,
                createdAt: discussion.createdAt,
                labels: fn.names(discussion.labels.nodes),
                number,
                reactions: fn.reactions(discussion.reactionGroups),
                title: discussion.title,
            },
        };
    },

    issue: async (ctx: Ctx, number: number) => {
        type IssueData = {
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
        type CommentData = ReadonlyArray<{ readonly body?: string; readonly created_at: string; readonly user: User }>;
        const [issue, comments] = await Promise.all([
            call(ctx, 'issue.get', number) as Promise<IssueData>,
            call(ctx, 'comment.list', number) as Promise<CommentData>,
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

    pr: async (ctx: Ctx, number: number) => {
        type PrData = {
            readonly assignees: ReadonlyArray<User>;
            readonly body: string | null;
            readonly draft: boolean;
            readonly head: { readonly sha: string };
            readonly labels: ReadonlyArray<Label>;
            readonly number: number;
            readonly title: string;
        };
        type ReviewData = ReadonlyArray<{ readonly body: string | null; readonly state: string; readonly user: User }>;
        type CheckData = ReadonlyArray<{
            readonly conclusion: string | null;
            readonly name: string;
            readonly status: string;
        }>;
        type CommentData = ReadonlyArray<{ readonly body?: string; readonly created_at: string; readonly user: User }>;
        type ReviewCommentData = ReadonlyArray<{
            readonly body: string;
            readonly line?: number;
            readonly path: string;
            readonly user: User;
        }>;
        type FileData = ReadonlyArray<{
            readonly additions: number;
            readonly deletions: number;
            readonly filename: string;
            readonly status: string;
        }>;
        type CommitData = ReadonlyArray<{
            readonly author: User | null;
            readonly commit: { readonly message: string };
            readonly sha: string;
        }>;
        const pr = (await call(ctx, 'pull.get', number)) as PrData;
        const [reviews, checks, comments, reviewComments, files, commits, requestedReviewers] = await Promise.all([
            call(ctx, 'pull.listReviews', number) as Promise<ReviewData>,
            call(ctx, 'check.listForRef', pr.head.sha) as Promise<CheckData>,
            call(ctx, 'comment.list', number) as Promise<CommentData>,
            call(ctx, 'pull.listReviewComments', number) as Promise<ReviewCommentData>,
            call(ctx, 'pull.listFiles', number) as Promise<FileData>,
            call(ctx, 'pull.listCommits', number) as Promise<CommitData>,
            call(ctx, 'pull.listRequestedReviewers', number) as Promise<ReadonlyArray<User>>,
        ]);
        return {
            checks,
            comments: comments.map(fn.comment),
            commits: commits.map((commit) => ({
                author: commit.author?.login ?? 'unknown',
                message: commit.commit.message.split('\n')[0],
                sha: commit.sha.substring(0, B.probe.shaLength),
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
            reviewComments: reviewComments.map((comment) => ({
                author: comment.user.login,
                body: fn.trunc(comment.body),
                line: comment.line,
                path: comment.path,
            })),
            reviews: reviews.map((review) => ({
                author: review.user.login,
                body: fn.trunc(review.body),
                state: review.state,
            })),
        };
    },
} as const;

// --- Entry Point ------------------------------------------------------------

const probe = async <K extends keyof typeof handlers>(params: RunParams, kind: K, number: number) =>
    handlers[kind](createCtx(params), number);

const post = async (params: RunParams, number: number, marker: string, title: string, body: string): Promise<void> =>
    ((formattedMarker) =>
        mutate(createCtx(params), {
            body: `${formattedMarker}\n# ${title}\n\n${body}`,
            marker: formattedMarker,
            mode: 'replace',
            n: number,
            t: 'comment',
        }))(md.marker(marker)).then(() => params.core.info(`Posted ${title} to PR #${number}`));

// --- Derived Types ----------------------------------------------------------

type DiscussionProbe = Awaited<ReturnType<typeof handlers.discussion>>;
type IssueProbe = Awaited<ReturnType<typeof handlers.issue>>;
type PrProbe = Awaited<ReturnType<typeof handlers.pr>>;

// --- Export -----------------------------------------------------------------

export { handlers, post, probe };
export type { DiscussionProbe, IssueProbe, PrProbe };
