#!/usr/bin/env tsx
/**
 * PR review hygiene automation for active-qc workflow.
 * Responds to reviewer comments based on commit changes, resolves outdated threads,
 * and cleans up owner/admin prompts (Copilot messages).
 *
 * Leverages schema.ts: B constant (patterns, probe), call (API), fn (trunc, age)
 */

import { type Ctx, call, createCtx, fn, md, type RunParams, type User } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type HygieneSpec = {
    readonly prNumber: number;
    readonly action: 'synchronize';
    readonly ownerLogins: ReadonlyArray<string>;
    readonly botPatterns?: ReadonlyArray<string>;
};

type HygieneResult = {
    readonly resolved: number;
    readonly replied: number;
    readonly deleted: number;
    readonly summary: string;
};

type ReviewThread = {
    readonly id: string;
    readonly isResolved: boolean;
    readonly isOutdated: boolean;
    readonly path: string | null;
    readonly line: number | null;
    readonly comments: {
        readonly nodes: ReadonlyArray<{
            readonly id: string;
            readonly author: User | null;
            readonly body: string;
            readonly createdAt: string;
            readonly outdated: boolean;
        }>;
    };
};

type IssueComment = {
    readonly id: number;
    readonly node_id: string;
    readonly body: string;
    readonly user: User;
    readonly created_at: string;
};

type CommitInfo = {
    readonly sha: string;
    readonly message: string;
    readonly files: ReadonlyArray<string>;
    readonly timestamp: string;
};

type ThreadAnalysis = {
    readonly thread: ReviewThread;
    readonly action: 'resolve' | 'reply' | 'skip';
    readonly reason: string;
};

// --- Constants (B Extension) ------------------------------------------------

const H = Object.freeze({
    gql: {
        minimizeComment: `mutation($id:ID!,$classifier:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$classifier}){minimizedComment{isMinimized}}}`,
        resolveThread: `mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}`,
        reviewThreads: `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:50){nodes{id author{login}body createdAt outdated}}}}}}}`,
    } as const,
    markers: {
        copilotPrompt: ['@claude', '@copilot', '@gemini', '@codex'] as const,
        hygieneResponse: 'PR-HYGIENE-RESPONSE',
    } as const,
    messages: {
        addressed: (sha: string, files: ReadonlyArray<string>): string =>
            `[OK] **Addressed in commit \`${sha.substring(0, 7)}\`**\n\nChanged files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` (+${files.length - 5} more)` : ''}`,
        differentApproach: (sha: string): string =>
            `[INFO] This feedback was considered but a different approach was taken in \`${sha.substring(0, 7)}\`.`,
        resolved: (reason: string): string => `[OK] Thread resolved: ${reason}`,
        stillRelevant: (reason: string): string => `[INFO] Still relevant: ${reason}`,
    } as const,
    responsePatterns: [
        { action: 'addressed' as const, pattern: /fix|resolve|address|implement|apply|use|add|update|change/i },
        { action: 'different' as const, pattern: /different|alternative|instead|rather|chose|decided/i },
        { action: 'skip' as const, pattern: /skip|ignore|wontfix|later|future|defer/i },
    ] as const,
} as const);

// --- Pure Utility Functions -------------------------------------------------

const isCopilotPrompt = (body: string, patterns: ReadonlyArray<string>): boolean =>
    patterns.some((p) => body.toLowerCase().includes(p.toLowerCase()));

const isOwnerComment = (author: string | undefined, owners: ReadonlyArray<string>): boolean =>
    owners.some((o) => o.toLowerCase() === author?.toLowerCase());

const extractFilesFromCommit = (files: ReadonlyArray<{ filename: string }>): ReadonlyArray<string> =>
    files.map((f) => f.filename);

const matchesPath = (path: string | null, files: ReadonlyArray<string>): boolean =>
    path !== null && files.some((f) => f === path || f.startsWith(path.split('/').slice(0, -1).join('/')));

const shouldResolve = (thread: ReviewThread, commits: ReadonlyArray<CommitInfo>): ThreadAnalysis =>
    thread.isResolved
        ? { action: 'skip', reason: 'already resolved', thread }
        : thread.isOutdated
          ? { action: 'resolve', reason: 'marked outdated by GitHub', thread }
          : commits.some((c) => matchesPath(thread.path, c.files))
            ? { action: 'reply', reason: 'file modified in recent commits', thread }
            : { action: 'skip', reason: 'no matching changes', thread };

const formatSummary = (resolved: number, replied: number, deleted: number): string =>
    [
        `## PR Hygiene Summary`,
        '',
        `- **Resolved threads**: ${resolved}`,
        `- **Replied to comments**: ${replied}`,
        `- **Deleted prompts**: ${deleted}`,
        '',
        `_${fn.formatTime(new Date())}_`,
    ].join('\n');

// --- API Operations (GraphQL Extensions) ------------------------------------

const fetchReviewThreads = async (ctx: Ctx, prNumber: number): Promise<ReadonlyArray<ReviewThread>> =>
    ((result) => result?.repository?.pullRequest?.reviewThreads?.nodes ?? [])(
        await ctx.github.graphql<{
            repository: {
                pullRequest: {
                    reviewThreads: { nodes: ReadonlyArray<ReviewThread> };
                };
            };
        }>(H.gql.reviewThreads, { n: prNumber, owner: ctx.owner, repo: ctx.repo }),
    );

const resolveThread = async (ctx: Ctx, threadId: string): Promise<boolean> =>
    ctx.github
        .graphql(H.gql.resolveThread, { threadId })
        .then(() => true)
        .catch(() => false);

const minimizeComment = async (ctx: Ctx, nodeId: string, classifier: string): Promise<boolean> =>
    ctx.github
        .graphql(H.gql.minimizeComment, { classifier, id: nodeId })
        .then(() => true)
        .catch(() => false);

const deleteComment = async (ctx: Ctx, commentId: number): Promise<boolean> =>
    ctx.github.rest.issues
        .deleteComment({ comment_id: commentId, owner: ctx.owner, repo: ctx.repo })
        .then(() => true)
        .catch(() => false);

const fetchCommitsSince = async (ctx: Ctx, prNumber: number, since: string): Promise<ReadonlyArray<CommitInfo>> => {
    type CommitData = ReadonlyArray<{
        sha: string;
        commit: { message: string; author: { date: string } | null };
    }>;
    const commits = ((await call(ctx, 'pull.listCommits', prNumber)) ?? []) as CommitData;
    const recent = commits.filter((c) => new Date(c.commit.author?.date ?? '').getTime() > new Date(since).getTime());
    const withFiles = await Promise.all(
        recent.map(async (c) => {
            const files = (await ctx.github.rest.repos.getCommit({ owner: ctx.owner, ref: c.sha, repo: ctx.repo }))
                .data as { files?: ReadonlyArray<{ filename: string }> };
            return {
                files: extractFilesFromCommit(files.files ?? []),
                message: c.commit.message.split('\n')[0],
                sha: c.sha,
                timestamp: c.commit.author?.date ?? '',
            };
        }),
    );
    return withFiles;
};

const fetchIssueComments = async (ctx: Ctx, prNumber: number): Promise<ReadonlyArray<IssueComment>> =>
    ((await call(ctx, 'comment.list', prNumber)) ?? []) as ReadonlyArray<IssueComment>;

// --- Dispatch Tables --------------------------------------------------------

const threadHandlers = {
    reply: async (
        ctx: Ctx,
        thread: ReviewThread,
        commits: ReadonlyArray<CommitInfo>,
    ): Promise<{ replied: boolean; resolved: boolean }> => {
        const matchingCommit = commits.find((c) => matchesPath(thread.path, c.files));
        const message = matchingCommit
            ? H.messages.addressed(matchingCommit.sha, matchingCommit.files)
            : H.messages.differentApproach(commits[0]?.sha ?? 'unknown');
        const firstCommentId = thread.comments.nodes[0]?.id;
        const replied = firstCommentId
            ? await ctx.github.rest.pulls
                  .createReplyForReviewComment({
                      body: message,
                      comment_id: parseInt(firstCommentId.replace(/\D/g, ''), 10),
                      owner: ctx.owner,
                      pull_number: parseInt(thread.id.replace(/\D/g, ''), 10),
                      repo: ctx.repo,
                  })
                  .then(() => true)
                  .catch(() => false)
            : false;
        const resolved = await resolveThread(ctx, thread.id);
        return { replied, resolved };
    },
    resolve: async (ctx: Ctx, thread: ReviewThread): Promise<{ replied: boolean; resolved: boolean }> => ({
        replied: false,
        resolved: await resolveThread(ctx, thread.id),
    }),
    skip: async (): Promise<{ replied: boolean; resolved: boolean }> => ({ replied: false, resolved: false }),
} as const;

const commentActions = {
    delete: async (ctx: Ctx, comment: IssueComment): Promise<boolean> => deleteComment(ctx, comment.id),
    minimize: async (ctx: Ctx, comment: IssueComment): Promise<boolean> =>
        minimizeComment(ctx, comment.node_id, 'OUTDATED'),
} as const;

// --- Effect Pipeline --------------------------------------------------------

const processThreads = async (
    ctx: Ctx,
    threads: ReadonlyArray<ReviewThread>,
    commits: ReadonlyArray<CommitInfo>,
): Promise<{ resolved: number; replied: number }> => {
    const analyses = threads.map((t) => shouldResolve(t, commits));
    const results = await Promise.all(analyses.map(async (a) => threadHandlers[a.action](ctx, a.thread, commits)));
    return {
        replied: results.filter((r) => r.replied).length,
        resolved: results.filter((r) => r.resolved).length,
    };
};

const cleanupOwnerPrompts = async (
    ctx: Ctx,
    comments: ReadonlyArray<IssueComment>,
    owners: ReadonlyArray<string>,
    botPatterns: ReadonlyArray<string>,
): Promise<number> => {
    const promptComments = comments.filter(
        (c) => isOwnerComment(c.user?.login, owners) && isCopilotPrompt(c.body ?? '', botPatterns),
    );
    const results = await Promise.all(promptComments.map((c) => commentActions.delete(ctx, c)));
    return results.filter(Boolean).length;
};

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: HygieneSpec }): Promise<HygieneResult> => {
    const ctx = createCtx(params);
    const { prNumber, ownerLogins, botPatterns } = params.spec;
    const patterns = botPatterns ?? [...H.markers.copilotPrompt];

    // Fetch all required data in parallel
    const [threads, comments] = await Promise.all([
        fetchReviewThreads(ctx, prNumber),
        fetchIssueComments(ctx, prNumber),
    ]);

    // Find the earliest unresolved thread timestamp for commit filtering
    const unresolvedThreads = threads.filter((t) => !t.isResolved);
    const earliestComment = unresolvedThreads
        .flatMap((t) => t.comments.nodes)
        .reduce(
            (min, c) => (new Date(c.createdAt).getTime() < new Date(min).getTime() ? c.createdAt : min),
            new Date().toISOString(),
        );

    // Fetch commits since earliest unresolved comment
    const commits = await fetchCommitsSince(ctx, prNumber, earliestComment);

    // Process threads and cleanup prompts in parallel
    const [threadResults, deletedCount] = await Promise.all([
        processThreads(ctx, unresolvedThreads, commits),
        cleanupOwnerPrompts(ctx, comments, ownerLogins, patterns),
    ]);

    const summary = formatSummary(threadResults.resolved, threadResults.replied, deletedCount);
    params.core.info(
        `[PR-HYGIENE] PR #${prNumber}: ${threadResults.resolved} resolved, ${threadResults.replied} replied, ${deletedCount} deleted`,
    );

    // Post summary comment if any actions were taken
    const totalActions = threadResults.resolved + threadResults.replied + deletedCount;
    totalActions > 0 &&
        (await call(ctx, 'comment.create', prNumber, `${md.marker(H.markers.hygieneResponse)}\n${summary}`));

    return {
        deleted: deletedCount,
        replied: threadResults.replied,
        resolved: threadResults.resolved,
        summary,
    };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { HygieneResult, HygieneSpec };
