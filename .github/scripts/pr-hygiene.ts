#!/usr/bin/env tsx
/**
 * PR review hygiene: resolves outdated threads, replies to addressed comments, cleans AI prompts.
 * Uses B.hygiene, B.labels.groups.agent, fn.formatTime, call, md.marker from schema.ts.
 */
import { B, type Core, type Ctx, call, createCtx, fn, type RunParams, type User } from './schema.ts';

// --- Types -------------------------------------------------------------------

type HygieneSpec = { readonly prNumber: number; readonly ownerLogins: ReadonlyArray<string> };
type HygieneResult = {
    readonly resolved: number;
    readonly replied: number;
    readonly deleted: number;
    readonly minimized: number;
};
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
type Action = 'resolve' | 'reply' | 'valuable' | 'skip';

// --- Constants ---------------------------------------------------------------

const H = Object.freeze({
    agentBots: [...B.labels.groups.agent.map((a) => `${a}[bot]`), ...B.dashboard.bots, ...B.hygiene.botAliases],
    agentMentions: B.labels.groups.agent.map((a) => `@${a}`),
    agentSlashCommands: B.labels.groups.agent.flatMap((a) =>
        B.hygiene.slashCommands.map((cmd) => `/${a} ${cmd}`.toLowerCase()),
    ),
    display: B.hygiene.display,
    gql: {
        minimize: `mutation($id:ID!,$c:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$c}){minimizedComment{isMinimized}}}`,
        resolve: `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`,
        threads: `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path comments(first:20){nodes{id databaseId author{login}body createdAt}}}}}}}`,
    },
    marker: 'PR-HYGIENE',
    msg: {
        addressed: (sha: string, f: ReadonlyArray<string>): string => {
            const maxFiles = B.hygiene.display.maxFiles;
            const fileList = f.slice(0, maxFiles).join(', ');
            const overflow = f.length > maxFiles ? ` +${f.length - maxFiles}` : '';
            return `[X] **Addressed** in [\`${sha.slice(0, B.probe.shaLength)}\`](../commit/${sha})\n\n_Files: ${fileList}${overflow}_`;
        },
        outdated: (sha: string | null, path: string | null): string => {
            const pathStr = path ? ` (${path})` : '';
            return sha
                ? `[X] **Code changed** in [\`${sha.slice(0, B.probe.shaLength)}\`](../commit/${sha})${pathStr}`
                : `[X] **Outdated** — code has changed since this comment`;
        },
    },
    valuablePatterns: B.hygiene.valuablePatterns,
} as const);

// --- Pure Functions ----------------------------------------------------------

const isBot = (login: string | undefined): boolean =>
    login ? H.agentBots.some((b) => login.toLowerCase() === b.toLowerCase()) : false;
const isValuable = (body: string): boolean => H.valuablePatterns.some((p) => p.test(body));
const pathMatch = (path: string | null, files: ReadonlyArray<string>): boolean => path !== null && files.includes(path);
const classify = (t: Thread, commits: ReadonlyArray<CommitFile>): Action => {
    if (t.isResolved) {
        return 'skip';
    }
    if (t.isOutdated) {
        return 'resolve';
    }
    if (isValuable(t.comments.nodes.map((c) => c.body).join(' '))) {
        return 'valuable';
    }
    if (commits.some((c) => pathMatch(t.path, c.files))) {
        return 'reply';
    }
    return 'skip';
};

// --- Dispatch Tables ---------------------------------------------------------

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
const minimizeComment = (ctx: Ctx, nodeId: string): Promise<boolean> =>
    ctx.github.graphql(H.gql.minimize, { c: 'OUTDATED', id: nodeId }).then(
        () => true,
        () => false,
    );
const replyToThread = (
    ctx: Ctx,
    n: number,
    commentId: number,
    body: string,
): Promise<{ success: boolean; nodeId: string | null }> =>
    ctx.github.rest.pulls
        .createReplyForReviewComment({
            body,
            comment_id: commentId,
            owner: ctx.owner,
            pull_number: n,
            repo: ctx.repo,
        })
        .then(
            (result) => ({ nodeId: (result.data as { node_id?: string }).node_id ?? null, success: true }),
            () => ({ nodeId: null, success: false }),
        );
const deleteComment = (ctx: Ctx, id: number): Promise<boolean> =>
    ctx.github.rest.issues.deleteComment({ comment_id: id, owner: ctx.owner, repo: ctx.repo }).then(
        () => true,
        () => false,
    );
const reactToComment = (ctx: Ctx, id: number, content: string): Promise<boolean> =>
    call(ctx, 'reaction.createForReviewComment', id, content).then(
        () => true,
        () => false,
    );

// --- Dispatch Tables ---------------------------------------------------------

const minimizeAllComments = (ctx: Ctx, comments: ReadonlyArray<ThreadComment>): Promise<boolean[]> =>
    Promise.all(comments.filter((c) => c.id).map((c) => minimizeComment(ctx, c.id)));
const threadActions: Record<
    Action,
    (
        ctx: Ctx,
        t: Thread,
        commits: ReadonlyArray<CommitFile>,
        n: number,
    ) => Promise<{ resolved: number; replied: number; minimized: number }>
> = {
    reply: async (ctx, t, commits, n) => {
        const match = commits.find((c) => pathMatch(t.path, c.files));
        const first = t.comments.nodes[0];
        const reply =
            match && first?.databaseId
                ? await replyToThread(ctx, n, first.databaseId, H.msg.addressed(match.sha, match.files))
                : { nodeId: null, success: false };
        const resolved = reply.success ? await resolveThread(ctx, t.id) : false;
        const [, threadMinimized, replyMinimized] = await Promise.all([
            reply.success && first?.databaseId ? reactToComment(ctx, first.databaseId, '+1') : Promise.resolve(false),
            resolved ? minimizeAllComments(ctx, t.comments.nodes) : Promise.resolve([]),
            resolved && reply.nodeId ? minimizeComment(ctx, reply.nodeId) : Promise.resolve(false),
        ]);
        const minimizedCount = threadMinimized.filter(Boolean).length + (replyMinimized ? 1 : 0);
        return { minimized: minimizedCount, replied: reply.success ? 1 : 0, resolved: resolved ? 1 : 0 };
    },
    resolve: async (ctx, t, commits, n) => {
        const match = commits.find((c) => pathMatch(t.path, c.files));
        const first = t.comments.nodes[0];
        const reply = first?.databaseId
            ? await replyToThread(ctx, n, first.databaseId, H.msg.outdated(match?.sha ?? null, t.path))
            : { nodeId: null, success: false };
        const resolved = await resolveThread(ctx, t.id);
        const [, threadMinimized, replyMinimized] = await Promise.all([
            resolved && first?.databaseId ? reactToComment(ctx, first.databaseId, '-1') : Promise.resolve(false),
            minimizeAllComments(ctx, t.comments.nodes),
            reply.nodeId ? minimizeComment(ctx, reply.nodeId) : Promise.resolve(false),
        ]);
        const minimizedCount = threadMinimized.filter(Boolean).length + (replyMinimized ? 1 : 0);
        return { minimized: minimizedCount, replied: reply.success ? 1 : 0, resolved: resolved ? 1 : 0 };
    },
    skip: async () => ({ minimized: 0, replied: 0, resolved: 0 }),
    valuable: async (ctx, t) => {
        const first = t.comments.nodes[0];
        await (first?.databaseId ? reactToComment(ctx, first.databaseId, '+1') : Promise.resolve(false));
        return { minimized: 0, replied: 0, resolved: 0 };
    },
};

// --- Effect Pipeline ---------------------------------------------------------

const processThreads = async (
    ctx: Ctx,
    threads: ReadonlyArray<Thread>,
    commits: ReadonlyArray<CommitFile>,
    n: number,
): Promise<{ resolved: number; replied: number; minimized: number }> =>
    (await Promise.all(threads.map((t) => threadActions[classify(t, commits)](ctx, t, commits, n)))).reduce(
        (acc, r) => ({
            minimized: acc.minimized + r.minimized,
            replied: acc.replied + r.replied,
            resolved: acc.resolved + r.resolved,
        }),
        { minimized: 0, replied: 0, resolved: 0 },
    );
const cleanupUserComments = async (ctx: Ctx, comments: ReadonlyArray<IssueComment>): Promise<number> =>
    (await Promise.all(comments.filter((c) => !isBot(c.user?.login)).map((c) => deleteComment(ctx, c.id)))).filter(
        Boolean,
    ).length;

// --- Entry Point -------------------------------------------------------------

const noWorkResult = (core: Core, prNumber: number): HygieneResult => {
    core.info(`[PR-HYGIENE] #${prNumber}: no work`);
    return { deleted: 0, minimized: 0, replied: 0, resolved: 0 };
};
const run = async (params: RunParams & { readonly spec: HygieneSpec }): Promise<HygieneResult> => {
    const ctx = createCtx(params);
    const { prNumber } = params.spec;
    const [threads, comments] = await Promise.all([fetchThreads(ctx, prNumber), fetchComments(ctx, prNumber)]);
    const unresolved = threads.filter((t) => !t.isResolved);
    const hasUserComments = comments.some((c) => !isBot(c.user?.login));
    const hasUnminimizedResolved = threads.some((t) => (t.isResolved || t.isOutdated) && t.comments.nodes.length > 0);
    const noWork = unresolved.length === 0 && !hasUserComments && !hasUnminimizedResolved;
    return noWork
        ? noWorkResult(params.core, prNumber)
        : processHygiene(ctx, params, threads, unresolved, comments, prNumber);
};
const postSummary = async (ctx: Ctx, prNumber: number, result: HygieneResult, core: Core): Promise<HygieneResult> => {
    const { resolved, replied, deleted, minimized } = result;
    const body = `### [/] PR Hygiene\n| Resolved | Replied | Minimized | Deleted |\n|:--:|:--:|:--:|:--:|\n| ${resolved} | ${replied} | ${minimized} | ${deleted} |\n\n_${fn.formatTime(new Date())}_`;
    const { mutate, createCtx: createMutateCtx } = await import('./schema.ts');
    await mutate(
        createMutateCtx({
            context: {
                payload: {
                    action: '',
                    issue: { body: null, created_at: '', labels: [], node_id: '', number: prNumber, title: '' },
                },
                repo: { owner: ctx.owner, repo: ctx.repo },
            },
            core,
            github: ctx.github,
        }),
        {
            body,
            marker: 'PR-MONITOR',
            mode: 'section',
            n: prNumber,
            sectionId: 'pr-hygiene',
            t: 'comment',
        },
    );
    return result;
};
const cleanupResolvedThreads = async (ctx: Ctx, threads: ReadonlyArray<Thread>): Promise<number> => {
    const resolved = threads.filter((t) => t.isResolved || t.isOutdated);
    const allComments = resolved.flatMap((t) => t.comments.nodes);
    const results = await minimizeAllComments(ctx, allComments);
    return results.filter(Boolean).length;
};
const cleanupOutdatedIssueComments = async (ctx: Ctx, comments: ReadonlyArray<IssueComment>): Promise<number> => {
    const ciFailurePattern = /^## CI Failure/;
    const ciComments = comments.filter((c) => isBot(c.user?.login) && ciFailurePattern.test(c.body));
    const outdated = ciComments.length > 1 ? ciComments.slice(0, -1) : [];
    const results = await Promise.all(outdated.map((c) => minimizeComment(ctx, c.node_id)));
    return results.filter(Boolean).length;
};
const processHygiene = async (
    ctx: Ctx,
    params: RunParams,
    allThreads: ReadonlyArray<Thread>,
    unresolved: ReadonlyArray<Thread>,
    comments: ReadonlyArray<IssueComment>,
    prNumber: number,
): Promise<HygieneResult> => {
    const allDates = unresolved.flatMap((t) => t.comments.nodes.map((c) => new Date(c.createdAt).getTime()));
    const since =
        allDates.length > 0
            ? new Date(Math.min(...allDates)).toISOString()
            : new Date(Date.now() - B.time.day).toISOString();
    const commits = await fetchCommitFiles(ctx, prNumber, since);
    const [{ resolved, replied, minimized: threadMinimized }, deleted, resolvedCleanup, issueCleanup] =
        await Promise.all([
            processThreads(ctx, unresolved, commits, prNumber),
            cleanupUserComments(ctx, comments),
            cleanupResolvedThreads(ctx, allThreads),
            cleanupOutdatedIssueComments(ctx, comments),
        ]);
    const minimized = threadMinimized + resolvedCleanup + issueCleanup;
    const result = { deleted, minimized, replied, resolved };
    params.core.info(
        `[PR-HYGIENE] #${prNumber}: resolved=${resolved} replied=${replied} minimized=${minimized} deleted=${deleted}`,
    );
    return resolved + replied + deleted + minimized > 0 ? postSummary(ctx, prNumber, result, params.core) : result;
};

// --- Export ------------------------------------------------------------------

export { run };
export type { HygieneResult, HygieneSpec };
