#!/usr/bin/env tsx
/**
 * Probe Script - Target-Specific Data Collection
 * Polymorphic data collection via dispatch table for external processing
 *
 * @module probe
 */

import { B, type Ctx, call, createCtx, fn, mutate, type RunParams } from './schema.ts';

// --- Target Handlers (Dispatch Table) ---------------------------------------

const handlers = {
    discussion: async (ctx: Ctx, n: number) => {
        const d = (await call(ctx, 'discussion.get', n)) as {
            readonly answer: {
                readonly author: { readonly login: string };
                readonly body: string;
                readonly createdAt: string;
            } | null;
            readonly author: { readonly login: string };
            readonly body: string;
            readonly category: { readonly name: string };
            readonly comments: {
                readonly nodes: ReadonlyArray<{
                    readonly author: { readonly login: string };
                    readonly body: string;
                    readonly createdAt: string;
                    readonly reactionGroups: ReadonlyArray<{
                        readonly content: string;
                        readonly users: { readonly totalCount: number };
                    }>;
                    readonly replies: {
                        readonly nodes: ReadonlyArray<{
                            readonly author: { readonly login: string };
                            readonly body: string;
                            readonly createdAt: string;
                            readonly reactionGroups: ReadonlyArray<{
                                readonly content: string;
                                readonly users: { readonly totalCount: number };
                            }>;
                        }>;
                    };
                }>;
            };
            readonly createdAt: string;
            readonly labels: { readonly nodes: ReadonlyArray<{ readonly name: string }> };
            readonly reactionGroups: ReadonlyArray<{
                readonly content: string;
                readonly users: { readonly totalCount: number };
            }>;
            readonly title: string;
        };
        return {
            comments: d.comments.nodes.map((c) => ({
                author: c.author.login,
                body: fn.trunc(c.body),
                createdAt: c.createdAt,
                reactions: fn.reactions(c.reactionGroups),
                replies: c.replies.nodes.map((r) => ({
                    author: r.author.login,
                    body: fn.trunc(r.body),
                    createdAt: r.createdAt,
                    reactions: fn.reactions(r.reactionGroups),
                })),
            })),
            discussion: {
                answer: d.answer
                    ? { author: d.answer.author.login, body: fn.trunc(d.answer.body), createdAt: d.answer.createdAt }
                    : null,
                author: d.author.login,
                body: fn.trunc(d.body),
                category: d.category.name,
                createdAt: d.createdAt,
                labels: d.labels.nodes.map((l) => l.name),
                number: n,
                reactions: fn.reactions(d.reactionGroups),
                title: d.title,
            },
        };
    },

    issue: async (ctx: Ctx, n: number) => {
        const [issue, comments] = await Promise.all([
            call(ctx, 'issue.get', n) as Promise<{
                readonly assignees: ReadonlyArray<{ readonly login: string }>;
                readonly body: string | null;
                readonly created_at: string;
                readonly labels: ReadonlyArray<{ readonly name: string }>;
                readonly milestone: { readonly title: string } | null;
                readonly number: number;
                readonly state: string;
                readonly title: string;
                readonly user: { readonly login: string };
            }>,
            call(ctx, 'comment.list', n) as Promise<
                ReadonlyArray<{
                    readonly body?: string;
                    readonly created_at: string;
                    readonly user: { readonly login: string };
                }>
            >,
        ]);
        return {
            comments: comments.map(fn.comment),
            issue: {
                assignees: issue.assignees.map((a) => a.login),
                author: issue.user.login,
                body: fn.trunc(issue.body),
                createdAt: issue.created_at,
                labels: issue.labels.map((l) => l.name),
                milestone: issue.milestone?.title ?? null,
                number: issue.number,
                state: issue.state,
                title: issue.title,
            },
        };
    },

    pr: async (ctx: Ctx, n: number) => {
        const pr = (await call(ctx, 'pull.get', n)) as {
            readonly assignees: ReadonlyArray<{ readonly login: string }>;
            readonly body: string | null;
            readonly draft: boolean;
            readonly head: { readonly sha: string };
            readonly labels: ReadonlyArray<{ readonly name: string }>;
            readonly number: number;
            readonly title: string;
        };
        const [reviews, checks, comments, reviewComments, files, commits, requestedReviewers] = await Promise.all([
            call(ctx, 'pull.listReviews', n) as Promise<
                ReadonlyArray<{
                    readonly body: string | null;
                    readonly state: string;
                    readonly user: { readonly login: string };
                }>
            >,
            call(ctx, 'check.listForRef', pr.head.sha) as Promise<
                ReadonlyArray<{ readonly conclusion: string | null; readonly name: string; readonly status: string }>
            >,
            call(ctx, 'comment.list', n) as Promise<
                ReadonlyArray<{
                    readonly body?: string;
                    readonly created_at: string;
                    readonly user: { readonly login: string };
                }>
            >,
            call(ctx, 'pull.listReviewComments', n) as Promise<
                ReadonlyArray<{
                    readonly body: string;
                    readonly line?: number;
                    readonly path: string;
                    readonly user: { readonly login: string };
                }>
            >,
            call(ctx, 'pull.listFiles', n) as Promise<
                ReadonlyArray<{
                    readonly additions: number;
                    readonly deletions: number;
                    readonly filename: string;
                    readonly status: string;
                }>
            >,
            call(ctx, 'pull.listCommits', n) as Promise<
                ReadonlyArray<{
                    readonly author: { readonly login: string } | null;
                    readonly commit: { readonly message: string };
                    readonly sha: string;
                }>
            >,
            call(ctx, 'pull.listRequestedReviewers', n) as Promise<ReadonlyArray<{ readonly login: string }>>,
        ]);
        return {
            checks: checks.map((c) => ({ conclusion: c.conclusion, name: c.name, status: c.status })),
            comments: comments.map(fn.comment),
            commits: commits.map((c) => ({
                author: c.author?.login ?? B.probe.defaults.unknownAuthor,
                message: c.commit.message.split('\n')[0],
                sha: c.sha.substring(0, B.probe.shaLength),
            })),
            files: files.map((f) => ({
                additions: f.additions,
                deletions: f.deletions,
                filename: f.filename,
                status: f.status,
            })),
            pr: {
                assignees: pr.assignees.map((a) => a.login),
                body: fn.trunc(pr.body),
                draft: pr.draft,
                labels: pr.labels.map((l) => l.name),
                number: pr.number,
                sha: pr.head.sha,
                title: pr.title,
            },
            requestedReviewers: requestedReviewers.map((r) => r.login),
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

// --- Entry Points -----------------------------------------------------------

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
        }))(B.gen.marker(marker)).then(() => params.core.info(`Posted ${title} to PR #${n}`));

// --- Derived Types (Downstream DX) ------------------------------------------

type DiscussionProbe = Awaited<ReturnType<typeof handlers.discussion>>;
type IssueProbe = Awaited<ReturnType<typeof handlers.issue>>;
type PrProbe = Awaited<ReturnType<typeof handlers.pr>>;

// --- Export -----------------------------------------------------------------

export { handlers, post, probe };
export type { DiscussionProbe, IssueProbe, PrProbe };
