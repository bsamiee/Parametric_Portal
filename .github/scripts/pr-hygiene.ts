#!/usr/bin/env tsx
/**
 * PR review hygiene automation for active-qc workflow.
 * Algorithmically analyzes review threads, responds based on commit diff coverage,
 * resolves GitHub-outdated threads, and cleans owner AI agent prompts.
 *
 * Leverages schema.ts: B constant, call (API), fn (formatTime), md (marker)
 * Pattern: Single H constant → Dispatch tables → Polymorphic pipeline → Entry point
 */

import { B, type Ctx, call, createCtx, fn, md, type RunParams, type User } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type HygieneSpec = { readonly prNumber: number; readonly ownerLogins: ReadonlyArray<string> };
type HygieneResult = { readonly resolved: number; readonly replied: number; readonly deleted: number };
type Thread = {
    readonly id: string;
    readonly isResolved: boolean;
    readonly isOutdated: boolean;
    readonly path: string | null;
    readonly comments: { readonly nodes: ReadonlyArray<ThreadComment> };
};
type ThreadComment = {
    readonly id: string;
    readonly databaseId: number;
    readonly author: User | null;
    readonly body: string;
    readonly createdAt: string;
};
type IssueComment = {
    readonly id: number;
    readonly node_id: string;
    readonly body: string;
    readonly user: User;
    readonly created_at: string;
};
type CommitFile = { readonly sha: string; readonly files: ReadonlyArray<string> };
type Action = 'resolve' | 'reply' | 'skip';

// --- H Constant (Hygiene Configuration) -------------------------------------

const H = Object.freeze({
    // Algorithmic: Map schema agent labels to actual bot login patterns
    // Schema: ['claude', 'codex', 'copilot', 'gemini'] → bot logins
    agentBots: [
        ...B.labels.categories.agent.map((a) => `${a}[bot]`), // claude[bot], copilot[bot], etc.
        'github-actions[bot]', // Copilot uses this
        'gemini-code-assist[bot]', // Gemini actual bot name
        'chatgpt-codex-connector[bot]', // Codex actual bot name
    ],
    // Agent mentions for prompt detection
    agentMentions: B.labels.categories.agent.map((a) => `@${a}`),
    gql: {
        resolve: `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`,
        threads: `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path comments(first:20){nodes{id databaseId author{login}body createdAt}}}}}}}`,
    },
    marker: 'PR-HYGIENE',
    // Parametric message templates (sha truncation uses B.probe.shaLength)
    msg: {
        addressed: (sha: string, f: ReadonlyArray<string>): string =>
            `✅ **Addressed** in [\`${sha.slice(0, B.probe.shaLength)}\`](../commit/${sha})\n\n_Files: ${f.slice(0, 3).join(', ')}${f.length > 3 ? ` +${f.length - 3}` : ''}_`,
    },
    // Safety: patterns indicating valuable feedback that should NOT be auto-resolved
    valuablePatterns: [
        /security|vulnerab|exploit|inject|xss|csrf|auth/i,
        /breaking|compat|deprecat|removal/i,
        /design|architect|pattern|approach/i,
        /performance|optim|memory|leak/i,
        /\bP0\b|\bP1\b|critical|urgent|blocker/i,
    ],
} as const);

// --- Pure Functions ---------------------------------------------------------

const isBot = (login: string | undefined): boolean =>
    login ? H.agentBots.some((b) => login.toLowerCase() === b.toLowerCase()) : false;

const isOwner = (login: string | undefined, owners: ReadonlyArray<string>): boolean =>
    owners.some((o) => o.toLowerCase() === login?.toLowerCase());

const isPrompt = (body: string): boolean => H.agentMentions.some((m) => body.includes(m));

const isValuable = (body: string): boolean => H.valuablePatterns.some((p) => p.test(body));

const pathMatch = (path: string | null, files: ReadonlyArray<string>): boolean =>
    path !== null && files.some((f) => f === path);

// Polymorphic action classifier: Thread × Commits → Action
const classify = (t: Thread, commits: ReadonlyArray<CommitFile>): Action =>
    t.isResolved
        ? 'skip'
        : t.isOutdated
          ? 'resolve'
          : isValuable(t.comments.nodes.map((c) => c.body).join(' '))
            ? 'skip' // Never auto-resolve valuable feedback
            : commits.some((c) => pathMatch(t.path, c.files))
              ? 'reply'
              : 'skip';

// --- API Operations ---------------------------------------------------------

const fetchThreads = async (ctx: Ctx, n: number): Promise<ReadonlyArray<Thread>> =>
    ((r) => r?.repository?.pullRequest?.reviewThreads?.nodes ?? [])(
        await ctx.github.graphql<{
            repository: { pullRequest: { reviewThreads: { nodes: ReadonlyArray<Thread> } } };
        }>(H.gql.threads, { n, o: ctx.owner, r: ctx.repo }),
    );

const fetchComments = async (ctx: Ctx, n: number): Promise<ReadonlyArray<IssueComment>> =>
    ((await call(ctx, 'comment.list', n)) ?? []) as ReadonlyArray<IssueComment>;

const fetchCommitFiles = async (ctx: Ctx, n: number, since: string): Promise<ReadonlyArray<CommitFile>> => {
    type Raw = ReadonlyArray<{ sha: string; commit: { author: { date: string } | null } }>;
    const commits = ((await call(ctx, 'pull.listCommits', n)) ?? []) as Raw;
    const sinceDate = new Date(since);
    const recent = commits.filter((c) => {
        const date = c.commit.author?.date;
        return date ? new Date(date) > sinceDate : false;
    });
    return Promise.all(
        recent.map(async (c) => ({
            files: (
                (
                    (await ctx.github.rest.repos.getCommit({ owner: ctx.owner, ref: c.sha, repo: ctx.repo })).data as {
                        files?: ReadonlyArray<{ filename: string }>;
                    }
                ).files ?? []
            ).map((f) => f.filename),
            sha: c.sha,
        })),
    );
};

const resolveThread = (ctx: Ctx, id: string): Promise<boolean> =>
    ctx.github.graphql(H.gql.resolve, { id }).then(
        () => true,
        () => false,
    );

const replyToThread = (ctx: Ctx, n: number, commentId: number, body: string): Promise<boolean> =>
    ctx.github.rest.pulls
        .createReplyForReviewComment({ body, comment_id: commentId, owner: ctx.owner, pull_number: n, repo: ctx.repo })
        .then(
            () => true,
            () => false,
        );

const deleteComment = (ctx: Ctx, id: number): Promise<boolean> =>
    ctx.github.rest.issues.deleteComment({ comment_id: id, owner: ctx.owner, repo: ctx.repo }).then(
        () => true,
        () => false,
    );

// --- Dispatch Tables --------------------------------------------------------

const threadActions: Record<
    Action,
    (
        ctx: Ctx,
        t: Thread,
        commits: ReadonlyArray<CommitFile>,
        n: number,
    ) => Promise<{ resolved: number; replied: number }>
> = {
    reply: async (ctx, t, commits, n) => {
        const match = commits.find((c) => pathMatch(t.path, c.files));
        const first = t.comments.nodes[0];
        const replied =
            match && first?.databaseId
                ? await replyToThread(ctx, n, first.databaseId, H.msg.addressed(match.sha, match.files))
                : false;
        const resolved = replied ? await resolveThread(ctx, t.id) : false;
        return { replied: replied ? 1 : 0, resolved: resolved ? 1 : 0 };
    },
    resolve: async (ctx, t) => ({ replied: 0, resolved: (await resolveThread(ctx, t.id)) ? 1 : 0 }),
    skip: async () => ({ replied: 0, resolved: 0 }),
};

// --- Effect Pipeline --------------------------------------------------------

const processThreads = async (
    ctx: Ctx,
    threads: ReadonlyArray<Thread>,
    commits: ReadonlyArray<CommitFile>,
    n: number,
): Promise<{ resolved: number; replied: number }> =>
    (await Promise.all(threads.map((t) => threadActions[classify(t, commits)](ctx, t, commits, n)))).reduce(
        (acc, r) => ({ replied: acc.replied + r.replied, resolved: acc.resolved + r.resolved }),
        { replied: 0, resolved: 0 },
    );

const cleanupPrompts = async (
    ctx: Ctx,
    comments: ReadonlyArray<IssueComment>,
    owners: ReadonlyArray<string>,
): Promise<number> =>
    (
        await Promise.all(
            comments
                .filter((c) => isOwner(c.user?.login, owners) && isPrompt(c.body) && !isBot(c.user?.login))
                .map((c) => deleteComment(ctx, c.id)),
        )
    ).filter(Boolean).length;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: HygieneSpec }): Promise<HygieneResult> => {
    const ctx = createCtx(params);
    const { prNumber, ownerLogins } = params.spec;

    // Parallel fetch: threads + comments
    const [threads, comments] = await Promise.all([fetchThreads(ctx, prNumber), fetchComments(ctx, prNumber)]);

    // Early return if no work
    const unresolved = threads.filter((t) => !t.isResolved);
    const hasPrompts = comments.some((c) => isOwner(c.user?.login, ownerLogins) && isPrompt(c.body));
    const noWork = unresolved.length === 0 && !hasPrompts;
    noWork && params.core.info(`[PR-HYGIENE] #${prNumber}: no work`);
    return noWork
        ? { deleted: 0, replied: 0, resolved: 0 }
        : processHygiene(ctx, params, unresolved, comments, prNumber, ownerLogins);
};

const processHygiene = async (
    ctx: Ctx,
    params: RunParams,
    unresolved: ReadonlyArray<Thread>,
    comments: ReadonlyArray<IssueComment>,
    prNumber: number,
    ownerLogins: ReadonlyArray<string>,
): Promise<HygieneResult> => {
    // Calculate since timestamp from earliest unresolved comment (or 24h ago if empty)
    const allDates = unresolved.flatMap((t) => t.comments.nodes.map((c) => new Date(c.createdAt).getTime()));
    const since =
        allDates.length > 0
            ? new Date(Math.min(...allDates)).toISOString()
            : new Date(Date.now() - 86400000).toISOString();

    // Fetch commit files and process
    const commits = await fetchCommitFiles(ctx, prNumber, since);
    const [{ resolved, replied }, deleted] = await Promise.all([
        processThreads(ctx, unresolved, commits, prNumber),
        cleanupPrompts(ctx, comments, ownerLogins),
    ]);

    // Log and post summary if actions taken
    params.core.info(`[PR-HYGIENE] #${prNumber}: resolved=${resolved} replied=${replied} deleted=${deleted}`);
    resolved + replied + deleted > 0 &&
        (await call(
            ctx,
            'comment.create',
            prNumber,
            `${md.marker(H.marker)}\n### PR Hygiene\n| Resolved | Replied | Deleted |\n|:--:|:--:|:--:|\n| ${resolved} | ${replied} | ${deleted} |\n\n_${fn.formatTime(new Date())}_`,
        ));

    return { deleted, replied, resolved };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { HygieneResult, HygieneSpec };
