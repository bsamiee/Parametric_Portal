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

const shieldUrl = (label: string, message: string, color: string, style?: string, logo?: string): string => {
    const base = `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(message)}-${color}`;
    const params = [style && `style=${style}`, logo && `logo=${logo}&logoColor=white`].filter(Boolean).join('&');
    return params ? `${base}?${params}` : base;
};

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
    progress: (value: number, max = 100, width = 20): string => {
        const filled = Math.round((value / max) * width);
        return `\`[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]\` ${value}%`;
    },
    shield: (
        label: string,
        message: string,
        color: string,
        style?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge',
        logo?: string,
    ): string => `![${label}](${shieldUrl(label, message, color, style, logo)})`,
    shieldLink: (
        label: string,
        message: string,
        color: string,
        url: string,
        style?: 'flat' | 'flat-square' | 'plastic' | 'for-the-badge',
        logo?: string,
    ): string => `[![${label}](${shieldUrl(label, message, color, style, logo)})](${url})`,
    sparkline: (values: ReadonlyArray<number>): string => {
        const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
        const max = Math.max(...values, 1);
        return values.map((value) => chars[Math.min(Math.floor((value / max) * 7), 7)]).join('');
    },
    task: (items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }>): string =>
        items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n'),
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
    | { readonly kind: 'list'; readonly items: ReadonlyArray<string>; readonly ordered?: boolean }
    | { readonly kind: 'task'; readonly items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }> }
    | { readonly kind: 'field'; readonly label: string; readonly value: string }
    | { readonly kind: 'heading'; readonly level: 2 | 3; readonly text: string }
    | { readonly kind: 'text'; readonly content: string }
    | { readonly kind: 'code'; readonly lang: string; readonly content: string }
    | { readonly kind: 'details'; readonly summary: string; readonly content: string; readonly open?: boolean }
    | {
          readonly kind: 'alert';
          readonly type: 'note' | 'tip' | 'important' | 'warning' | 'caution';
          readonly content: string;
      }
    | { readonly kind: 'divider' }
    | { readonly kind: 'timestamp' };

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

// --- Constants (B) ----------------------------------------------------------

const B = Object.freeze({
    algo: { closeRatio: 14 / 30, mutationPct: 80, staleDays: 30 },
    api: { perPage: 100, state: { all: 'all', closed: 'closed', open: 'open' } as const },
    breaking: {
        bodyPat: /###\s*Breaking Change\s*\n+\s*yes/i,
        commitPat: [/^\w+!:/, /^BREAKING[\s-]CHANGE:/im] as const,
        label: 'breaking' as const,
    } as const,
    dashboard: {
        actions: [
            { label: '[Actions]', path: 'actions' },
            { label: '[Releases]', path: 'releases' },
            { label: '[Security]', path: 'security' },
            { label: '[Insights]', path: 'pulse' },
        ] as const,
        bots: ['renovate[bot]', 'dependabot[bot]'] as const,
        colors: { error: 'red', info: 'blue', success: 'brightgreen', warning: 'yellow' } as const,
        excludeConclusions: ['skipped', 'cancelled'] as const,
        labels: { feat: 'feat', fix: 'fix' } as const,
        marker: 'dashboard-refresh',
        monitoring: { period: 30, unit: 'days' } as const,
        nxCloud: { url: (id: string) => (id ? `https://cloud.nx.app/orgs/workspace/${id}` : '') },
        output: {
            displayTitle: 'Repository Overview',
            label: 'dashboard',
            labels: ['dashboard', 'pinned'] as const,
            pattern: '[DASHBOARD]',
            pin: true,
            title: '[DASHBOARD] Repository Overview',
        },
        schedule: { interval: 6, unit: 'hours' } as const,
        sparklineWidth: 5,
        staleDays: 14,
        targets: { stalePrs: 0, workflowSuccess: 90, workflowWarning: 70 } as const,
        window: 7,
        workflow: 'dashboard.yml',
    } as const,
    labels: {
        behaviors: {
            pinned: { onAdd: 'pin', onRemove: 'unpin' },
            stale: { onAdd: 'comment', onRemove: null },
        } as const,
        categories: {
            action: ['blocked', 'implement', 'review'] as const,
            agent: ['claude', 'codex', 'copilot', 'gemini'] as const,
            lifecycle: ['pinned', 'stale'] as const,
            priority: ['critical'] as const,
            special: ['dependencies', 'security'] as const,
        },
        exempt: ['critical', 'implement', 'pinned', 'security'] as const,
        gql: {
            pin: `mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{id}}}`,
            unpin: `mutation($id:ID!){unpinIssue(input:{issueId:$id}){issue{id}}}`,
        } as const,
    },
    meta: {
        alerts: Object.freeze(
            Object.fromEntries(MARKERS.map((m) => [m.toLowerCase(), `[!${m}]`])) as Record<MarkerKey, string>,
        ),
        caps: {
            assigned: ['issue', 'pr'] as const,
            committable: ['commit'] as const,
            labeled: ['issue', 'pr', 'discussion'] as const,
            milestoned: ['issue', 'pr'] as const,
            noted: ['release'] as const,
            projectable: ['issue', 'pr'] as const,
            reviewable: ['pr'] as const,
            titled: ['issue', 'pr', 'discussion'] as const,
        } as const,
        fmt: Object.freeze({
            commit: (t: TypeKey, brk: boolean): string => `${t}${brk ? '!' : ''}:`,
            marker: (m: string): string => `[!${m}]`,
            title: (t: TypeKey, brk: boolean): string => `[${t.toUpperCase()}${brk ? '!' : ''}]:`,
        } as const),
        infer: [
            { pattern: /fix|bug|patch|resolve|correct/i, value: 'fix' },
            { pattern: /feat|add|new|implement|introduce/i, value: 'feat' },
            { pattern: /doc|readme|comment/i, value: 'docs' },
            { pattern: /refactor|clean|reorganize/i, value: 'refactor' },
            { pattern: /test|spec|coverage/i, value: 'test' },
            { pattern: /style|format|lint/i, value: 'style' },
            { pattern: /perf|optim|speed/i, value: 'perf' },
            { pattern: /build|depend|bump|upgrade/i, value: 'build' },
            { pattern: /ci|workflow|action|pipeline/i, value: 'ci' },
        ] as const,
        models: { claude: 'claude-sonnet-4-20250514', fallback: 'openai/gpt-4o' } as const,
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
        commit: /^(\w+)(!?)(?:\(.+\))?:\s*(.+)$/,
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

// --- Pure Functions ---------------------------------------------------------

const fn = {
    age: (created: string, now: Date): number => Math.floor((now.getTime() - new Date(created).getTime()) / B.time.day),
    body: (spec: BodySpec, vars: Record<string, string> = {}): string => {
        const interpolate = (text: string): string =>
            Object.entries(vars).reduce((acc, [key, val]) => acc.replaceAll(`{{${key}}}`, val), text);
        const render: Record<Section['kind'], (section: Section) => string> = {
            alert: (section) =>
                md.alert(
                    (section as Extract<Section, { kind: 'alert' }>).type,
                    interpolate((section as Extract<Section, { kind: 'alert' }>).content),
                ),
            code: (section) =>
                md.code(
                    (section as Extract<Section, { kind: 'code' }>).lang,
                    interpolate((section as Extract<Section, { kind: 'code' }>).content),
                ),
            details: (section) =>
                md.details(
                    interpolate((section as Extract<Section, { kind: 'details' }>).summary),
                    interpolate((section as Extract<Section, { kind: 'details' }>).content),
                    (section as Extract<Section, { kind: 'details' }>).open,
                ),
            divider: () => '---',
            field: (section) =>
                `- **${(section as Extract<Section, { kind: 'field' }>).label}**: ${interpolate((section as Extract<Section, { kind: 'field' }>).value)}`,
            heading: (section) =>
                `${'#'.repeat((section as Extract<Section, { kind: 'heading' }>).level)} ${interpolate((section as Extract<Section, { kind: 'heading' }>).text)}`,
            list: (section) =>
                (section as Extract<Section, { kind: 'list' }>).items
                    .map(
                        (item, index) =>
                            `${(section as Extract<Section, { kind: 'list' }>).ordered ? `${index + 1}.` : '-'} ${interpolate(item)}`,
                    )
                    .join('\n'),
            task: (section) => md.task((section as Extract<Section, { kind: 'task' }>).items),
            text: (section) => interpolate((section as Extract<Section, { kind: 'text' }>).content),
            timestamp: () => `_Generated: ${new Date().toISOString()}_`,
        };
        return spec.map((section) => render[section.kind](section)).join('\n\n');
    },
    classify: <R>(
        input: string,
        rules: ReadonlyArray<{ readonly pattern: RegExp; readonly value: R }>,
        defaultValue: R,
    ): R => rules.find((rule) => rule.pattern.test(input))?.value ?? defaultValue,
    comment: (comment: { readonly body?: string; readonly created_at: string; readonly user: User }) => ({
        author: comment.user.login,
        body: (comment.body ?? '').substring(0, B.probe.bodyTruncate),
        createdAt: comment.created_at,
    }),
    formatTime: (date: Date): string => {
        const pad = (num: number): string => String(num).padStart(2, '0');
        const dateStr = `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
        const timeStr = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
        return `${dateStr} ${timeStr} (UTC)`;
    },
    logins: (users: ReadonlyArray<User>): ReadonlyArray<string> => users.map((user) => user.login),
    names: (labels: ReadonlyArray<Label>): ReadonlyArray<string> => labels.map((label) => label.name),
    reactions: (
        groups: ReadonlyArray<{ readonly content: string; readonly users: { readonly totalCount: number } }>,
    ): Record<string, number> => Object.fromEntries(groups.map((group) => [group.content, group.users.totalCount])),
    report: (
        title: string,
        headers: ReadonlyArray<string>,
        rows: ReadonlyArray<ReadonlyArray<string>>,
        options?: { readonly align?: ReadonlyArray<'l' | 'c' | 'r'>; readonly footer?: string },
    ): string => {
        const alignMap = { c: ':------:', l: ':------', r: '------:' } as const;
        const opts = options ?? {};
        const sep = headers.map((_, index) => alignMap[(opts.align ?? [])[index] ?? 'l']);
        const lines = [
            `## ${title}`,
            '',
            `| ${headers.join(' | ')} |`,
            `|${sep.join('|')}|`,
            ...rows.map((row) => `| ${row.join(' | ')} |`),
        ];
        return opts.footer ? [...lines, '', opts.footer].join('\n') : lines.join('\n');
    },
    rowsCount: (
        issues: ReadonlyArray<Issue>,
        filters: ReadonlyArray<{ readonly label: string; readonly cat: LabelCat; readonly idx?: number }>,
        staleDays = B.algo.staleDays,
    ): ReadonlyArray<ReadonlyArray<string>> => {
        const now = new Date();
        return [
            ...filters.map(({ label, cat, idx }) => [
                label,
                String(
                    issues.filter((issue) => issue.labels.some((lb) => lb.name === B.labels.categories[cat][idx ?? 0]))
                        .length,
                ),
            ]),
            [`>${staleDays} days`, String(issues.filter((issue) => fn.age(issue.created_at, now) > staleDays).length)],
            ['Total Open', String(issues.length)],
        ];
    },
    target: (value: number, threshold: number, operator: 'gt' | 'lt' | 'gte' | 'lte'): 'pass' | 'warn' | 'fail' =>
        ({ gt: value > threshold, gte: value >= threshold, lt: value < threshold, lte: value <= threshold })[operator]
            ? 'pass'
            : 'warn',
    timestamp: (date: Date): string => `_Generated: ${date.toISOString()}_`,
    trend: (current: number, previous: number): string => {
        const trends = { neg: '[-]', pos: '[+]', same: '[=]' } as const;
        const direction = current > previous ? 'pos' : current < previous ? 'neg' : 'same';
        return trends[direction];
    },
    trunc: (text: string | null, limit = B.probe.bodyTruncate): string => (text ?? '').substring(0, limit),
} as const;

// --- API Operations (Direct Dispatch Table) ---------------------------------

type Op = {
    readonly api?: readonly [string, string];
    readonly map: (args: ReadonlyArray<unknown>) => Record<string, unknown>;
    readonly out?: (data: unknown) => unknown;
    readonly query?: string;
    readonly safe?: boolean;
};

const prop =
    <K extends string>(...keys: readonly K[]) =>
    (x: unknown) =>
        keys.reduce((acc, k) => (acc as Record<K, unknown>)?.[k], x);

const ops: Record<string, Op> = {
    'actions.listWorkflowRuns': {
        api: ['actions', 'listWorkflowRunsForRepo'],
        map: ([workflow, created]) => ({ created, per_page: B.api.perPage, workflow_id: workflow }),
        out: prop('workflow_runs'),
    },
    'actions.listWorkflows': {
        api: ['actions', 'listRepoWorkflows'],
        map: () => ({ per_page: B.api.perPage }),
        out: prop('workflows'),
    },
    'branch.get': { api: ['repos', 'getBranch'], map: ([branch]) => ({ branch }) },
    'branch.getProtection': { api: ['repos', 'getBranchProtection'], map: ([branch]) => ({ branch }), safe: true },
    'branch.list': { api: ['repos', 'listBranches'], map: () => ({ per_page: B.api.perPage }) },
    'branch.updateProtection': {
        api: ['repos', 'updateBranchProtection'],
        map: ([branch, data]) => ({ branch, ...(data as object) }),
    },
    'check.create': {
        api: ['checks', 'create'],
        map: ([name, sha, status, conclusion, output]) => ({ conclusion, head_sha: sha, name, output, status }),
    },
    'check.listForRef': { api: ['checks', 'listForRef'], map: ([ref]) => ({ ref }), out: prop('check_runs') },
    'check.update': { api: ['checks', 'update'], map: ([id, data]) => ({ check_run_id: id, ...(data as object) }) },
    'comment.create': { api: ['issues', 'createComment'], map: ([number, body]) => ({ body, issue_number: number }) },
    'comment.list': { api: ['issues', 'listComments'], map: ([number]) => ({ issue_number: number }) },
    'comment.update': { api: ['issues', 'updateComment'], map: ([id, body]) => ({ body, comment_id: id }) },
    'discussion.get': {
        map: ([number]) => ({ n: number }),
        out: prop('repository', 'discussion'),
        query: B.probe.gql.discussion,
    },
    'issue.addLabels': { api: ['issues', 'addLabels'], map: ([number, labels]) => ({ issue_number: number, labels }) },
    'issue.create': { api: ['issues', 'create'], map: ([title, labels, body]) => ({ body, labels, title }) },
    'issue.get': { api: ['issues', 'get'], map: ([number]) => ({ issue_number: number }) },
    'issue.list': {
        api: ['issues', 'listForRepo'],
        map: ([state, labels]) => ({ labels, per_page: B.api.perPage, state }),
    },
    'issue.pin': { map: ([issueId]) => ({ issueId }), query: B.probe.gql.pinIssue, safe: true },
    'issue.unpin': { map: ([id]) => ({ id }), query: B.labels.gql.unpin, safe: true },
    'issue.removeLabel': {
        api: ['issues', 'removeLabel'],
        map: ([number, name]) => ({ issue_number: number, name }),
        safe: true,
    },
    'issue.update': { api: ['issues', 'update'], map: ([number, body]) => ({ body, issue_number: number }) },
    'issue.updateMeta': {
        api: ['issues', 'update'],
        map: ([number, meta]) => ({ issue_number: number, ...(meta as object) }),
    },
    'milestone.list': { api: ['issues', 'listMilestones'], map: ([state]) => ({ per_page: B.api.perPage, state }) },
    'milestone.update': {
        api: ['issues', 'updateMilestone'],
        map: ([number, data]) => ({ milestone_number: number, ...(data as object) }),
    },
    'project.addItem': {
        api: ['projects', 'createCard'],
        map: ([column, contentId]) => ({ column_id: column, content_id: contentId }),
        safe: true,
    },
    'project.list': {
        api: ['projects', 'listForRepo'],
        map: ([state]) => ({ per_page: B.api.perPage, state }),
        safe: true,
    },
    'pull.get': { api: ['pulls', 'get'], map: ([number]) => ({ pull_number: number }) },
    'pull.list': {
        api: ['pulls', 'list'],
        map: ([state, sort, direction]) => ({
            direction: direction ?? 'desc',
            per_page: B.api.perPage,
            sort: sort ?? 'updated',
            state,
        }),
    },
    'pull.listCommits': {
        api: ['pulls', 'listCommits'],
        map: ([number]) => ({ per_page: B.api.perPage, pull_number: number }),
    },
    'pull.listFiles': {
        api: ['pulls', 'listFiles'],
        map: ([number]) => ({ per_page: B.api.perPage, pull_number: number }),
    },
    'pull.listRequestedReviewers': {
        api: ['pulls', 'listRequestedReviewers'],
        map: ([number]) => ({ pull_number: number }),
        out: (data) => [
            ...((data as { users: unknown[] }).users ?? []),
            ...((data as { teams: unknown[] }).teams ?? []),
        ],
    },
    'pull.listReviewComments': {
        api: ['pulls', 'listReviewComments'],
        map: ([number]) => ({ per_page: B.api.perPage, pull_number: number }),
    },
    'pull.listReviews': { api: ['pulls', 'listReviews'], map: ([number]) => ({ pull_number: number }) },
    'pull.update': {
        api: ['pulls', 'update'],
        map: ([number, meta]) => ({ pull_number: number, ...(meta as object) }),
    },
    'release.create': {
        api: ['repos', 'createRelease'],
        map: ([tag, name, body, draft, prerelease]) => ({ body, draft, name, prerelease, tag_name: tag }),
    },
    'release.latest': { api: ['repos', 'getLatestRelease'], map: () => ({}), out: prop('tag_name'), safe: true },
    'repo.compareCommits': {
        api: ['repos', 'compareCommits'],
        map: ([base, head]) => ({ base, head }),
        out: prop('commits'),
    },
    'repo.listCommits': { api: ['repos', 'listCommits'], map: ([since]) => ({ per_page: B.api.perPage, since }) },
    'review.create': {
        api: ['pulls', 'createReview'],
        map: ([pullNumber, body, event]) => ({ body, event, pull_number: pullNumber }),
    },
    'tag.list': { api: ['repos', 'listTags'], map: () => ({ per_page: 1 }) },
    'team.addRepo': {
        api: ['teams', 'addOrUpdateRepoPermissionsInOrg'],
        map: ([teamSlug, repo, permission]) => ({ permission, repo, team_slug: teamSlug }),
    },
    'team.list': { api: ['teams', 'list'], map: () => ({ per_page: B.api.perPage }) },
    'team.listMembers': { api: ['teams', 'listMembersInOrg'], map: ([teamSlug]) => ({ team_slug: teamSlug }) },
} as const;

const call = async (ctx: Ctx, key: string, ...args: ReadonlyArray<unknown>): Promise<unknown> => {
    const op = ops[key];
    const transform = op.out ?? ((data: unknown) => data);
    const params = { owner: ctx.owner, repo: ctx.repo, ...op.map(args) };
    const execute = async (): Promise<unknown> => {
        const isGraphQL = !!op.query;
        const result = isGraphQL
            ? await ctx.github.graphql(op.query as string, params)
            : await ctx.github.rest[op.api?.[0] ?? ''][op.api?.[1] ?? ''](params);
        return transform(isGraphQL ? result : (result as { data: unknown }).data);
    };

    return op.safe ? execute().catch(() => undefined) : execute();
};

// --- Mutation Handlers ------------------------------------------------------

const merge = (existing: string | null, content: string, mode: 'replace' | 'append' | 'prepend'): string =>
    ({
        append: `${existing ?? ''}\n\n---\n\n${content}`,
        prepend: `${content}\n\n---\n\n${existing ?? ''}`,
        replace: content,
    })[mode];

const mutateHandlers: {
    readonly [K in MutateSpec['t']]: (ctx: Ctx, spec: Extract<MutateSpec, { t: K }>) => Promise<void>;
} = {
    comment: async (ctx, spec) => {
        const comments = (await call(ctx, 'comment.list', spec.n)) as ReadonlyArray<Comment>;
        const existing = comments.find((comment) => comment.body?.includes(spec.marker));
        const actions = {
            create: () => call(ctx, 'comment.create', spec.n, spec.body),
            update: () =>
                call(
                    ctx,
                    'comment.update',
                    existing?.id,
                    merge(existing?.body ?? null, spec.body, spec.mode ?? 'replace'),
                ),
        };
        await actions[existing ? 'update' : 'create']();
    },
    issue: async (ctx, spec) => {
        const issues = (await call(ctx, 'issue.list', B.api.state.open, spec.label)) as ReadonlyArray<Issue>;
        const existing = issues.find((issue) => issue.title.includes(spec.pattern));
        const body = merge(existing?.body ?? null, spec.body, spec.mode ?? 'append');
        const actions = {
            create: async () => {
                const result = await call(ctx, 'issue.create', spec.title, spec.labels, body);
                spec.pin && (await call(ctx, 'issue.pin', (result as { node_id: string }).node_id));
            },
            update: () => call(ctx, 'issue.update', existing?.number, body),
        };
        await actions[existing ? 'update' : 'create']();
    },
    label: async (ctx, spec) => {
        const actions = {
            add: () => call(ctx, 'issue.addLabels', spec.n, spec.labels),
            remove: () => call(ctx, 'issue.removeLabel', spec.n, spec.labels[0]),
        };
        await actions[spec.action]();
    },
    release: async (ctx, spec) => {
        await call(
            ctx,
            'release.create',
            spec.tag,
            spec.name,
            spec.body,
            spec.draft ?? false,
            spec.prerelease ?? false,
        );
    },
    review: async (ctx, spec) => {
        await call(ctx, 'review.create', spec.pr, spec.body, spec.event);
    },
};

const mutate = async (ctx: Ctx, spec: MutateSpec): Promise<void> => mutateHandlers[spec.t](ctx, spec as never);

// --- Entry Point ------------------------------------------------------------

const createCtx = (params: RunParams): Ctx => ({
    github: params.github,
    owner: params.context.repo.owner,
    repo: params.context.repo.repo,
});

// --- Export -----------------------------------------------------------------

export { B, call, createCtx, fn, MARKERS, md, mutate, TYPES };
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
