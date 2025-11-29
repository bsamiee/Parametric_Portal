#!/usr/bin/env tsx
/**
 * Central configuration and type definitions for workflow automation.
 * Single B constant (config DSL), polymorphic ops, unified check/classify.
 */

// --- Base Types -------------------------------------------------------------

type User = { readonly login: string };
type Label = { readonly name: string };
type Repo = { readonly owner: string; readonly repo: string };
type Issue = {
    readonly body: string | null;
    readonly closed_at?: string;
    readonly created_at: string;
    readonly labels: ReadonlyArray<Label>;
    readonly number: number;
    readonly title: string;
};
type Comment = { readonly body?: string; readonly id: number };
type Commit = { readonly commit: { readonly message: string }; readonly author?: User | null };
type PR = {
    readonly merged_at: string | null;
    readonly number: number;
    readonly updated_at: string;
    readonly user: User;
};
type WorkflowRun = {
    readonly conclusion: string | null;
    readonly html_url: string;
    readonly id: number;
    readonly run_started_at: string | null;
    readonly status: string;
    readonly updated_at: string;
};
type GitHub = {
    readonly graphql: <T>(query: string, vars?: Record<string, unknown>) => Promise<T>;
    readonly rest: {
        readonly [ns: string]: {
            readonly [m: string]: (p: Record<string, unknown>) => Promise<{ readonly data: unknown }>;
        };
    };
};
type Core = {
    readonly info: (m: string) => void;
    readonly summary: { readonly addRaw: (c: string) => { readonly write: () => void } };
};
type Ctx = Repo & { readonly github: GitHub };
type RunParams = {
    readonly context: { readonly payload: { readonly action: string; readonly issue: Issue }; readonly repo: Repo };
    readonly core: Core;
    readonly github: GitHub;
};

// --- Markdown Generators ----------------------------------------------------

const shieldUrl = (l: string, m: string, c: string, s?: string, g?: string): string =>
    `https://img.shields.io/badge/${encodeURIComponent(l)}-${encodeURIComponent(m)}-${c}${s || g ? '?' : ''}${s ? `style=${s}` : ''}${s && g ? '&' : ''}${g ? `logo=${g}&logoColor=white` : ''}`;

const md = Object.freeze({
    alert: (type: 'note' | 'tip' | 'important' | 'warning' | 'caution', content: string): string =>
        `> [!${type.toUpperCase()}]\n> ${content.split('\n').join('\n> ')}`,
    badge: (repo: string, workflow: string): string =>
        `![${workflow}](https://github.com/${repo}/actions/workflows/${workflow}.yml/badge.svg)`,
    code: (lang: string, content: string): string => `\`\`\`${lang}\n${content}\n\`\`\``,
    details: (summary: string, content: string, open?: boolean): string =>
        `<details${open ? ' open' : ''}>\n<summary>${summary}</summary>\n\n${content}\n</details>`,
    link: (text: string, url: string): string => `[${text}](${url})`,
    marker: (n: string): string => `<!-- ${n} -->`,
    progress: (value: number, max = 100, width = 20): string =>
        ((filled) => `\`[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]\` ${value}%`)(
            Math.round((value / max) * width),
        ),
    shield: (
        l: string,
        m: string,
        c: string,
        s?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge',
        g?: string,
    ): string => `![${l}](${shieldUrl(l, m, c, s, g)})`,
    shieldLink: (
        l: string,
        m: string,
        c: string,
        u: string,
        s?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge',
        g?: string,
    ): string => `[![${l}](${shieldUrl(l, m, c, s, g)})](${u})`,
    sparkline: (values: ReadonlyArray<number>): string =>
        ((chars, max) => values.map((v) => chars[Math.min(Math.floor((v / max) * 7), 7)]).join(''))(
            ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
            Math.max(...values, 1),
        ),
    task: (items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }>): string =>
        items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n'),
    url: {
        actions: (repo: string): string => `https://github.com/${repo}/actions`,
        artifacts: (repo: string, runId: number): string =>
            `https://github.com/${repo}/actions/runs/${runId}#artifacts`,
        logs: (repo: string, runId: number): string => `https://github.com/${repo}/actions/runs/${runId}`,
        workflow: (repo: string, file: string): string => `https://github.com/${repo}/actions/workflows/${file}.yml`,
    },
} as const);

// --- Section Types ----------------------------------------------------------

type Section =
    | { readonly k: 'list'; readonly items: ReadonlyArray<string>; readonly ordered?: boolean }
    | { readonly k: 'task'; readonly items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }> }
    | { readonly k: 'field'; readonly l: string; readonly v: string }
    | { readonly k: 'heading'; readonly level: 2 | 3; readonly text: string }
    | { readonly k: 'text'; readonly content: string }
    | { readonly k: 'code'; readonly lang: string; readonly content: string }
    | { readonly k: 'details'; readonly summary: string; readonly content: string; readonly open?: boolean }
    | {
          readonly k: 'alert';
          readonly type: 'note' | 'tip' | 'important' | 'warning' | 'caution';
          readonly content: string;
      }
    | { readonly k: 'divider' }
    | { readonly k: 'timestamp' };

type BodySpec = ReadonlyArray<Section>;

// --- Validation Types -------------------------------------------------------

type ValidateResult =
    | { readonly valid: true; readonly type: TypeKey; readonly breaking: boolean; readonly subject: string }
    | { readonly valid: false; readonly error: string };
type Target = 'title' | 'commit' | 'label' | 'body';
type TypeKey = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'test' | 'chore' | 'perf' | 'ci' | 'build';
type MarkerKey = 'note' | 'tip' | 'important' | 'warning' | 'caution';

// --- Core Arrays (algorithmic source) ---------------------------------------

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'build'] as const;
const MARKERS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

// --- Format Functions -------------------------------------------------------

const fmt = Object.freeze({
    commit: (t: TypeKey, brk: boolean): string => `${t}${brk ? '!' : ''}:`,
    marker: (m: string): string => `[!${m}]`,
    title: (t: TypeKey, brk: boolean): string => `[${t.toUpperCase()}${brk ? '!' : ''}]:`,
} as const);

const alerts = Object.freeze(
    Object.fromEntries(MARKERS.map((m) => [m.toLowerCase(), fmt.marker(m)])) as Record<MarkerKey, string>,
);

// --- Constants (B) ----------------------------------------------------------

const B = Object.freeze({
    algo: { closeRatio: 14 / 30, mutationPct: 80, staleDays: 30 },
    api: { perPage: 100, state: { all: 'all', closed: 'closed', open: 'open' } as const },
    breaking: {
        bodyPat: /###\s*Breaking Change\s*\n+\s*yes/i,
        commitPat: [/^\w+!:/, /^BREAKING[\s-]CHANGE:/im] as const,
        label: 'breaking' as const,
    } as const,
    labels: {
        categories: {
            action: ['blocked', 'implement', 'review'] as const,
            agent: ['claude', 'codex', 'copilot', 'gemini'] as const,
            lifecycle: ['pinned', 'stale'] as const,
            priority: ['critical'] as const,
            special: ['dependencies', 'security'] as const,
        },
        exempt: ['critical', 'implement', 'pinned', 'security'] as const,
    },
    meta: {
        caps: {
            assigned: ['issue', 'pr'] as const,
            labeled: ['issue', 'pr', 'discussion'] as const,
            messaged: ['commit'] as const,
            milestoned: ['issue', 'pr'] as const,
            noted: ['release'] as const,
            projectable: ['issue', 'pr'] as const,
            reviewable: ['pr'] as const,
            titled: ['issue', 'pr', 'discussion'] as const,
        } as const,
        infer: [
            { p: /fix|bug|patch|resolve|correct/i, v: 'fix' },
            { p: /feat|add|new|implement|introduce/i, v: 'feat' },
            { p: /doc|readme|comment/i, v: 'docs' },
            { p: /refactor|clean|reorganize/i, v: 'refactor' },
            { p: /test|spec|coverage/i, v: 'test' },
            { p: /style|format|lint/i, v: 'style' },
            { p: /perf|optim|speed/i, v: 'perf' },
            { p: /build|depend|bump|upgrade/i, v: 'build' },
            { p: /ci|workflow|action|pipeline/i, v: 'ci' },
        ] as const,
        ops: {
            commit: { list: 'pull.listCommits' },
            discussion: { get: 'discussion.get' },
            issue: { get: 'issue.get', labels: 'issue.addLabels', list: 'issue.list', update: 'issue.updateMeta' },
            milestone: { list: 'milestone.list', update: 'milestone.update' },
            pr: { get: 'pull.get', labels: 'issue.addLabels', list: 'pull.list', update: 'pull.update' },
            project: { add: 'project.addItem', list: 'project.list' },
            release: { create: 'release.create', latest: 'release.latest' },
        } as const,
    } as const,
    patterns: {
        header: (f: string) => new RegExp(`###\\s*${f}[\\s\\S]*?(?=###|$)`, 'i'),
        headerStrip: /###\s*[^\n]+\n?/,
        placeholder: /^_?No response_?$/i,
    },
    pr: { pattern: /^\[([A-Z]+)(!?)\]:\s*(.+)$/i } as const,
    probe: {
        bodyTruncate: 500,
        gql: {
            discussion: `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){discussion(number:$n){body title author{login}createdAt category{name}labels(first:10){nodes{name}}answer{author{login}body createdAt}reactionGroups{content users{totalCount}}comments(first:100){nodes{body author{login}createdAt reactionGroups{content users{totalCount}}replies(first:50){nodes{body author{login}createdAt reactionGroups{content users{totalCount}}}}}}}}}`,
            pinIssue: `mutation($issueId:ID!){pinIssue(input:{issueId:$issueId}){issue{id}}}`,
        } as const,
        markers: { prReview: 'PR-REVIEW-SUMMARY' } as const,
        shaLength: 7,
        titles: { prReview: 'PR Review Summary' } as const,
    } as const,
    time: { day: 86400000 },
} as const);

// --- Derived Types ----------------------------------------------------------

type LabelCat = keyof typeof B.labels.categories;
type MetaCat = keyof typeof B.meta.ops;
type MetaCap = keyof typeof B.meta.caps;

// --- Spec Types -------------------------------------------------------------

type MutateSpec =
    | {
          readonly t: 'comment';
          readonly n: number;
          readonly marker: string;
          readonly body: string;
          readonly mode?: 'replace' | 'append' | 'prepend';
      }
    | {
          readonly t: 'issue';
          readonly label: string;
          readonly pattern: string;
          readonly title: string;
          readonly labels: ReadonlyArray<string>;
          readonly body: string;
          readonly mode?: 'replace' | 'append' | 'prepend';
          readonly pin?: boolean;
      }
    | {
          readonly t: 'label';
          readonly n: number;
          readonly labels: ReadonlyArray<string>;
          readonly action: 'add' | 'remove';
      }
    | {
          readonly t: 'review';
          readonly pr: number;
          readonly body: string;
          readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      }
    | {
          readonly t: 'release';
          readonly tag: string;
          readonly name: string;
          readonly body: string;
          readonly draft?: boolean;
          readonly prerelease?: boolean;
      };

// --- Polymorphic Check ------------------------------------------------------

type CheckKind = 'label' | 'cap' | 'breaking.body' | 'breaking.commit' | 'age';

const checks: { readonly [K in CheckKind]: (...args: ReadonlyArray<unknown>) => boolean } = {
    age: (created: unknown, now: unknown, days: unknown) =>
        typeof created === 'string' &&
        now instanceof Date &&
        typeof days === 'number' &&
        Math.floor((now.getTime() - new Date(created).getTime()) / B.time.day) > days,
    'breaking.body': (body: unknown) => typeof body === 'string' && B.breaking.bodyPat.test(body),
    'breaking.commit': (commits: unknown) =>
        Array.isArray(commits) &&
        commits.some((c) => B.breaking.commitPat.some((p) => p.test(c?.commit?.message ?? ''))),
    cap: (cat: unknown, cap: unknown) =>
        typeof cat === 'string' &&
        typeof cap === 'string' &&
        cap in B.meta.caps &&
        (B.meta.caps[cap as MetaCap] as ReadonlyArray<string>).includes(cat),
    label: (labels: unknown, target: unknown) =>
        Array.isArray(labels) && typeof target === 'string' && labels.some((l) => l?.name === target),
};

const check = <K extends CheckKind>(kind: K, ...args: ReadonlyArray<unknown>): boolean => checks[kind](...args);

// --- Pure Functions ---------------------------------------------------------

const fn = {
    age: (created: string, now: Date): number => Math.floor((now.getTime() - new Date(created).getTime()) / B.time.day),
    body: (spec: BodySpec, v: Record<string, string> = {}): string => {
        const $ = (s: string): string => Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{{${k}}}`, x), s);
        const render: Record<Section['k'], (s: Section) => string> = {
            alert: (s) =>
                md.alert(
                    (s as Extract<Section, { k: 'alert' }>).type,
                    $((s as Extract<Section, { k: 'alert' }>).content),
                ),
            code: (s) =>
                md.code((s as Extract<Section, { k: 'code' }>).lang, $((s as Extract<Section, { k: 'code' }>).content)),
            details: (s) =>
                md.details(
                    $((s as Extract<Section, { k: 'details' }>).summary),
                    $((s as Extract<Section, { k: 'details' }>).content),
                    (s as Extract<Section, { k: 'details' }>).open,
                ),
            divider: () => '---',
            field: (s) =>
                `- **${(s as Extract<Section, { k: 'field' }>).l}**: ${$((s as Extract<Section, { k: 'field' }>).v)}`,
            heading: (s) =>
                `${'#'.repeat((s as Extract<Section, { k: 'heading' }>).level)} ${$((s as Extract<Section, { k: 'heading' }>).text)}`,
            list: (s) =>
                (s as Extract<Section, { k: 'list' }>).items
                    .map((x, i) => `${(s as Extract<Section, { k: 'list' }>).ordered ? `${i + 1}.` : '-'} ${$(x)}`)
                    .join('\n'),
            task: (s) => md.task((s as Extract<Section, { k: 'task' }>).items),
            text: (s) => $((s as Extract<Section, { k: 'text' }>).content),
            timestamp: () => `_Generated: ${new Date().toISOString()}_`,
        };
        return spec.map((s) => render[s.k](s)).join('\n\n');
    },
    classify: <R>(input: string, rules: ReadonlyArray<{ readonly p: RegExp; readonly v: R }>, def: R): R =>
        rules.find((r) => r.p.test(input))?.v ?? def,
    comment: (c: { readonly body?: string; readonly created_at: string; readonly user: User }) => ({
        author: c.user.login,
        body: (c.body ?? '').substring(0, B.probe.bodyTruncate),
        createdAt: c.created_at,
    }),
    formatTime: (d: Date): string =>
        ((pad) =>
            `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (UTC)`)(
            (n: number) => String(n).padStart(2, '0'),
        ),
    hasLabel: (labels: ReadonlyArray<Label>, target: string): boolean => labels.some((l) => l.name === target),
    logins: (arr: ReadonlyArray<User>): ReadonlyArray<string> => arr.map((x) => x.login),
    names: (arr: ReadonlyArray<Label>): ReadonlyArray<string> => arr.map((x) => x.name),
    reactions: (
        groups: ReadonlyArray<{ readonly content: string; readonly users: { readonly totalCount: number } }>,
    ): Record<string, number> => Object.fromEntries(groups.map((g) => [g.content, g.users.totalCount])),
    report: (
        title: string,
        headers: ReadonlyArray<string>,
        rows: ReadonlyArray<ReadonlyArray<string>>,
        opts?: { readonly align?: ReadonlyArray<'l' | 'c' | 'r'>; readonly footer?: string },
    ): string =>
        ((o) =>
            ((sep) =>
                [
                    `## ${title}`,
                    '',
                    `| ${headers.join(' | ')} |`,
                    `|${sep.join('|')}|`,
                    ...rows.map((r) => `| ${r.join(' | ')} |`),
                    o.footer ? `\n${o.footer}` : '',
                ].join('\n'))(
                headers.map((_, i) => ({ c: ':------:', l: ':------', r: '------:' })[(o.align ?? [])[i] ?? 'l']),
            ))(opts ?? {}),
    rowsCount: (
        issues: ReadonlyArray<Issue>,
        filters: ReadonlyArray<{ readonly l: string; readonly cat: LabelCat; readonly idx?: number }>,
        staleDays = B.algo.staleDays,
    ): ReadonlyArray<ReadonlyArray<string>> => {
        const now = new Date();
        return [
            ...filters.map(({ l, cat, idx }) => [
                l,
                String(
                    issues.filter((i) => i.labels.some((lb) => lb.name === B.labels.categories[cat][idx ?? 0])).length,
                ),
            ]),
            [`>${staleDays} days`, String(issues.filter((i) => fn.age(i.created_at, now) > staleDays).length)],
            ['Total Open', String(issues.length)],
        ];
    },
    target: (value: number, threshold: number, op: 'gt' | 'lt' | 'gte' | 'lte'): 'pass' | 'warn' | 'fail' =>
        ({ gt: value > threshold, gte: value >= threshold, lt: value < threshold, lte: value <= threshold })[op]
            ? 'pass'
            : 'warn',
    timestamp: (d: Date): string => `_Generated: ${d.toISOString()}_`,
    trend: (current: number, previous: number): string =>
        current > previous ? '[+]' : current < previous ? '[-]' : '[=]',
    trunc: (s: string | null, n = B.probe.bodyTruncate): string => (s ?? '').substring(0, n),
} as const;

// --- API Operations (Direct Dispatch Table) ---------------------------------

type Op = {
    readonly a?: readonly [string, string];
    readonly m: (x: ReadonlyArray<unknown>) => Record<string, unknown>;
    readonly o?: (d: unknown) => unknown;
    readonly q?: string;
    readonly s?: boolean;
};

const prop =
    <K extends string>(...keys: readonly K[]) =>
    (x: unknown) =>
        keys.reduce((acc, k) => (acc as Record<K, unknown>)?.[k], x);

const ops: Record<string, Op> = {
    // Actions
    'actions.listWorkflowRuns': {
        a: ['actions', 'listWorkflowRunsForRepo'],
        m: ([w, c]) => ({ created: c, per_page: B.api.perPage, workflow_id: w }),
        o: prop('workflow_runs'),
    },
    'actions.listWorkflows': {
        a: ['actions', 'listRepoWorkflows'],
        m: () => ({ per_page: B.api.perPage }),
        o: prop('workflows'),
    },
    // Branch (NEW)
    'branch.get': { a: ['repos', 'getBranch'], m: ([b]) => ({ branch: b }) },
    'branch.getProtection': { a: ['repos', 'getBranchProtection'], m: ([b]) => ({ branch: b }), s: true },
    'branch.list': { a: ['repos', 'listBranches'], m: () => ({ per_page: B.api.perPage }) },
    'branch.updateProtection': {
        a: ['repos', 'updateBranchProtection'],
        m: ([b, d]) => ({ branch: b, ...(d as object) }),
    },
    // Check (NEW)
    'check.create': {
        a: ['checks', 'create'],
        m: ([n, sha, st, c, o]) => ({ conclusion: c, head_sha: sha, name: n, output: o, status: st }),
    },
    'check.listForRef': { a: ['checks', 'listForRef'], m: ([r]) => ({ ref: r }), o: prop('check_runs') },
    'check.update': { a: ['checks', 'update'], m: ([id, d]) => ({ check_run_id: id, ...(d as object) }) },
    // Comment
    'comment.create': { a: ['issues', 'createComment'], m: ([n, b]) => ({ body: b, issue_number: n }) },
    'comment.list': { a: ['issues', 'listComments'], m: ([n]) => ({ issue_number: n }) },
    'comment.update': { a: ['issues', 'updateComment'], m: ([id, b]) => ({ body: b, comment_id: id }) },
    // Discussion (GraphQL)
    'discussion.get': { m: ([n]) => ({ n }), o: prop('repository', 'discussion'), q: B.probe.gql.discussion },
    // Issue
    'issue.addLabels': { a: ['issues', 'addLabels'], m: ([n, l]) => ({ issue_number: n, labels: l }) },
    'issue.create': { a: ['issues', 'create'], m: ([t, l, b]) => ({ body: b, labels: l, title: t }) },
    'issue.get': { a: ['issues', 'get'], m: ([n]) => ({ issue_number: n }) },
    'issue.list': { a: ['issues', 'listForRepo'], m: ([s, l]) => ({ labels: l, per_page: B.api.perPage, state: s }) },
    'issue.pin': { m: ([id]) => ({ issueId: id }), q: B.probe.gql.pinIssue, s: true },
    'issue.removeLabel': { a: ['issues', 'removeLabel'], m: ([n, name]) => ({ issue_number: n, name }), s: true },
    'issue.update': { a: ['issues', 'update'], m: ([n, b]) => ({ body: b, issue_number: n }) },
    'issue.updateMeta': { a: ['issues', 'update'], m: ([n, m]) => ({ issue_number: n, ...(m as object) }) },
    // Milestone
    'milestone.list': { a: ['issues', 'listMilestones'], m: ([s]) => ({ per_page: B.api.perPage, state: s }) },
    'milestone.update': {
        a: ['issues', 'updateMilestone'],
        m: ([n, d]) => ({ milestone_number: n, ...(d as object) }),
    },
    // Project
    'project.addItem': { a: ['projects', 'createCard'], m: ([c, id]) => ({ column_id: c, content_id: id }), s: true },
    'project.list': { a: ['projects', 'listForRepo'], m: ([s]) => ({ per_page: B.api.perPage, state: s }), s: true },
    // Pull Request
    'pull.get': { a: ['pulls', 'get'], m: ([n]) => ({ pull_number: n }) },
    'pull.list': {
        a: ['pulls', 'list'],
        m: ([s, so, d]) => ({ direction: d ?? 'desc', per_page: B.api.perPage, sort: so ?? 'updated', state: s }),
    },
    'pull.listCommits': { a: ['pulls', 'listCommits'], m: ([n]) => ({ per_page: B.api.perPage, pull_number: n }) },
    'pull.listFiles': { a: ['pulls', 'listFiles'], m: ([n]) => ({ per_page: B.api.perPage, pull_number: n }) },
    'pull.listRequestedReviewers': {
        a: ['pulls', 'listRequestedReviewers'],
        m: ([n]) => ({ pull_number: n }),
        o: (x) => [...((x as { users: unknown[] }).users ?? []), ...((x as { teams: unknown[] }).teams ?? [])],
    },
    'pull.listReviewComments': {
        a: ['pulls', 'listReviewComments'],
        m: ([n]) => ({ per_page: B.api.perPage, pull_number: n }),
    },
    'pull.listReviews': { a: ['pulls', 'listReviews'], m: ([n]) => ({ pull_number: n }) },
    'pull.update': { a: ['pulls', 'update'], m: ([n, m]) => ({ pull_number: n, ...(m as object) }) },
    // Release
    'release.create': {
        a: ['repos', 'createRelease'],
        m: ([t, n, b, d, p]) => ({ body: b, draft: d, name: n, prerelease: p, tag_name: t }),
    },
    'release.latest': { a: ['repos', 'getLatestRelease'], m: () => ({}), o: prop('tag_name'), s: true },
    // Repo
    'repo.compareCommits': {
        a: ['repos', 'compareCommits'],
        m: ([b, h]) => ({ base: b, head: h }),
        o: prop('commits'),
    },
    'repo.listCommits': { a: ['repos', 'listCommits'], m: ([s]) => ({ per_page: B.api.perPage, since: s }) },
    // Review
    'review.create': { a: ['pulls', 'createReview'], m: ([p, b, e]) => ({ body: b, event: e, pull_number: p }) },
    // Tag
    'tag.list': { a: ['repos', 'listTags'], m: () => ({ per_page: 1 }) },
    // Team (NEW)
    'team.addRepo': {
        a: ['teams', 'addOrUpdateRepoPermissionsInOrg'],
        m: ([t, r, p]) => ({ permission: p, repo: r, team_slug: t }),
    },
    'team.list': { a: ['teams', 'list'], m: () => ({ per_page: B.api.perPage }) },
    'team.listMembers': { a: ['teams', 'listMembersInOrg'], m: ([t]) => ({ team_slug: t }) },
} as const;

const call = async (c: Ctx, k: string, ...a: ReadonlyArray<unknown>): Promise<unknown> => {
    const o = ops[k],
        t = o.o ?? ((x: unknown) => x);
    const run = async () =>
        o.q
            ? t(await c.github.graphql(o.q, { owner: c.owner, repo: c.repo, ...o.m(a) }))
            : ((api) => t((api as { data: unknown }).data))(
                  await c.github.rest[o.a?.[0] ?? ''][o.a?.[1] ?? '']({ owner: c.owner, repo: c.repo, ...o.m(a) }),
              );
    return o.s ? run().catch(() => undefined) : run();
};

// --- Mutation Handlers ------------------------------------------------------

const merge = (existing: string | null, content: string, mode: 'replace' | 'append' | 'prepend'): string =>
    ({
        append: `${existing ?? ''}\n\n---\n\n${content}`,
        prepend: `${content}\n\n---\n\n${existing ?? ''}`,
        replace: content,
    })[mode];

const mutateHandlers: { readonly [K in MutateSpec['t']]: (c: Ctx, s: Extract<MutateSpec, { t: K }>) => Promise<void> } =
    {
        comment: async (c, s) => {
            const xs = (await call(c, 'comment.list', s.n)) as ReadonlyArray<Comment>;
            const e = xs.find((x) => x.body?.includes(s.marker));
            await (e
                ? call(c, 'comment.update', e.id, merge(e.body ?? null, s.body, s.mode ?? 'replace'))
                : call(c, 'comment.create', s.n, s.body));
        },
        issue: async (c, s) => {
            const xs = (await call(c, 'issue.list', B.api.state.open, s.label)) as ReadonlyArray<Issue>;
            const e = xs.find((i) => i.title.includes(s.pattern));
            const body = merge(e?.body ?? null, s.body, s.mode ?? 'append');
            e
                ? await call(c, 'issue.update', e.number, body)
                : await call(c, 'issue.create', s.title, s.labels, body).then(
                      (r) => s.pin && call(c, 'issue.pin', (r as { node_id: string }).node_id),
                  );
        },
        label: async (c, s) => {
            await (s.action === 'add'
                ? call(c, 'issue.addLabels', s.n, s.labels)
                : call(c, 'issue.removeLabel', s.n, s.labels[0]));
        },
        release: async (c, s) => {
            await call(c, 'release.create', s.tag, s.name, s.body, s.draft ?? false, s.prerelease ?? false);
        },
        review: async (c, s) => {
            await call(c, 'review.create', s.pr, s.body, s.event);
        },
    };

const mutate = async (c: Ctx, s: MutateSpec): Promise<void> => mutateHandlers[s.t](c, s as never);

// --- Entry Point ------------------------------------------------------------

const createCtx = (p: RunParams): Ctx => ({ github: p.github, owner: p.context.repo.owner, repo: p.context.repo.repo });

// --- Export -----------------------------------------------------------------

export { alerts, B, call, check, createCtx, fmt, fn, MARKERS, md, mutate, TYPES };
export type {
    BodySpec,
    Comment,
    Commit,
    Core,
    Ctx,
    GitHub,
    Issue,
    Label,
    LabelCat,
    MarkerKey,
    MetaCap,
    MetaCat,
    MutateSpec,
    PR,
    Repo,
    RunParams,
    Section,
    Target,
    TypeKey,
    User,
    ValidateResult,
    WorkflowRun,
};
