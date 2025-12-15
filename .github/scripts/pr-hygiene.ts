#!/usr/bin/env tsx
/**
 * PR review hygiene: resolves outdated threads, replies to addressed comments, cleans AI prompts.
 * Uses B.hygiene, B.labels.groups.agent, fn.formatTime, call, md.marker from schema.ts.
 */
import { B, type Core, type Ctx, call, createCtx, fn, type RunParams, type User } from './schema.ts';

// --- Types -------------------------------------------------------------------

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

const isOwner = (login: string | undefined, owners: ReadonlyArray<string>): boolean =>
    owners.some((o) => o.toLowerCase() === login?.toLowerCase());

const isPrompt = (body: string): boolean => {
    const lower = body.toLowerCase();
    return (
        H.agentMentions.some((m) => lower.includes(m.toLowerCase())) ||
        H.agentSlashCommands.some((cmd) => lower.includes(cmd)) ||
        B.hygiene.slashCommands.some((cmd) => lower.includes(`/${cmd}`))
    );
};

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

const reactToComment = (ctx: Ctx, id: number, content: string): Promise<boolean> =>
    call(ctx, 'reaction.createForReviewComment', id, content).then(
        () => true,
        () => false,
    );

// --- Dispatch Tables ---------------------------------------------------------

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
        await Promise.all([
            replied && first?.databaseId ? reactToComment(ctx, first.databaseId, '+1') : Promise.resolve(false),
            resolved && first?.id ? minimizeComment(ctx, first.id) : Promise.resolve(false),
        ]);
        return { replied: replied ? 1 : 0, resolved: resolved ? 1 : 0 };
    },
    resolve: async (ctx, t, commits, n) => {
        const match = commits.find((c) => pathMatch(t.path, c.files));
        const first = t.comments.nodes[0];
        const replied = first?.databaseId
            ? await replyToThread(ctx, n, first.databaseId, H.msg.outdated(match?.sha ?? null, t.path))
            : false;
        const resolved = await resolveThread(ctx, t.id);
        await Promise.all([
            resolved && first?.databaseId ? reactToComment(ctx, first.databaseId, '-1') : Promise.resolve(false),
            first?.id ? minimizeComment(ctx, first.id) : Promise.resolve(false),
        ]);
        return { replied: replied ? 1 : 0, resolved: resolved ? 1 : 0 };
    },
    skip: async () => ({ replied: 0, resolved: 0 }),
    valuable: async (ctx, t) => {
        const first = t.comments.nodes[0];
        await (first?.databaseId ? reactToComment(ctx, first.databaseId, '+1') : Promise.resolve(false));
        return { replied: 0, resolved: 0 };
    },
};

// --- Effect Pipeline ---------------------------------------------------------

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
                .filter((c) => isPrompt(c.body) && !isBot(c.user?.login) && isOwner(c.user?.login, owners))
                .map((c) => deleteComment(ctx, c.id)),
        )
    ).filter(Boolean).length;

// --- Entry Point -------------------------------------------------------------

const noWorkResult = (core: Core, prNumber: number): HygieneResult => {
    core.info(`[PR-HYGIENE] #${prNumber}: no work`);
    return { deleted: 0, replied: 0, resolved: 0 };
};

const run = async (params: RunParams & { readonly spec: HygieneSpec }): Promise<HygieneResult> => {
    const ctx = createCtx(params);
    const { prNumber, ownerLogins } = params.spec;
    const [threads, comments] = await Promise.all([fetchThreads(ctx, prNumber), fetchComments(ctx, prNumber)]);
    const unresolved = threads.filter((t) => !t.isResolved);
    const hasPrompts = comments.some((c) => isPrompt(c.body) && !isBot(c.user?.login));
    const noWork = unresolved.length === 0 && !hasPrompts;
    return noWork
        ? noWorkResult(params.core, prNumber)
        : processHygiene(ctx, params, unresolved, comments, prNumber, ownerLogins);
};

const postSummary = async (ctx: Ctx, prNumber: number, result: HygieneResult, core: Core): Promise<HygieneResult> => {
    const { resolved, replied, deleted } = result;
    const body = `### [/] PR Hygiene\n| Resolved | Replied | Deleted |\n|:--:|:--:|:--:|\n| ${resolved} | ${replied} | ${deleted} |\n\n_${fn.formatTime(new Date())}_`;
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

const processHygiene = async (
    ctx: Ctx,
    params: RunParams,
    unresolved: ReadonlyArray<Thread>,
    comments: ReadonlyArray<IssueComment>,
    prNumber: number,
    ownerLogins: ReadonlyArray<string>,
): Promise<HygieneResult> => {
    const allDates = unresolved.flatMap((t) => t.comments.nodes.map((c) => new Date(c.createdAt).getTime()));
    const since =
        allDates.length > 0
            ? new Date(Math.min(...allDates)).toISOString()
            : new Date(Date.now() - B.time.day).toISOString();

    const commits = await fetchCommitFiles(ctx, prNumber, since);
    const [{ resolved, replied }, deleted] = await Promise.all([
        processThreads(ctx, unresolved, commits, prNumber),
        cleanupPrompts(ctx, comments, ownerLogins),
    ]);

    const result = { deleted, replied, resolved };
    params.core.info(`[PR-HYGIENE] #${prNumber}: resolved=${resolved} replied=${replied} deleted=${deleted}`);
    return resolved + replied + deleted > 0 ? postSummary(ctx, prNumber, result, params.core) : result;
};

// --- Export ------------------------------------------------------------------

export { run };
export type { HygieneResult, HygieneSpec };
