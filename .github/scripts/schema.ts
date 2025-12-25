#!/usr/bin/env tsx
/**
 * Central schema: define B constant, types, fn utilities, call/mutate dispatch, md formatters.
 * Uses B.labels, B.hygiene, call (issue/pr), mutate (labels/issues/branches), md formatters.
 */

// --- Types -------------------------------------------------------------------

type RestApiResponse = { readonly data: unknown }; // SECURITY: Type guard for REST API responses (runtime validation instead of unsafe assertion)
type User = { readonly login: string };
type Label = { readonly name: string };
type Repo = { readonly owner: string; readonly repo: string };
type ValidateResult =
    | { readonly valid: true; readonly type: TypeKey; readonly breaking: boolean; readonly subject: string }
    | { readonly valid: false; readonly error: string };
type Target = 'title' | 'commit' | 'label' | 'body';
type TypeKey = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'test' | 'chore' | 'perf' | 'ci' | 'build';
type MarkerKey = 'note' | 'tip' | 'important' | 'warning' | 'caution';
type Issue = {
    readonly body: string | null;
    readonly closed_at?: string;
    readonly created_at: string;
    readonly labels: ReadonlyArray<Label>;
    readonly node_id: string;
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
type MetaCat = keyof typeof B.meta.ops;
type MetaCap = keyof typeof B.meta.caps;
type MutateSpec =
    | {
          readonly t: 'comment';
          readonly n: number;
          readonly marker: string;
          readonly body: string;
          readonly mode?: 'replace' | 'append' | 'prepend' | 'section';
          readonly sectionId?: string;
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
type Op = {
    readonly api?: readonly [string, string];
    readonly map: (args: ReadonlyArray<unknown>) => Record<string, unknown>;
    readonly out?: (data: unknown) => unknown;
    readonly query?: string;
    readonly safe?: boolean;
};

// --- Constants ---------------------------------------------------------------

const isRestApiResponse = (value: unknown): value is RestApiResponse =>
    typeof value === 'object' && value !== null && 'data' in value;
const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'perf', 'ci', 'build'] as const;
const MARKERS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

// --- Markdown ----------------------------------------------------------------

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

// --- Constants ---------------------------------------------------------------

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
            // Pattern uses full title to avoid collision with Renovate's "[DASHBOARD] Dependency Dashboard"
            pattern: '[DASHBOARD] Repository Overview',
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
    discussion: {
        gql: {
            addComment: `mutation($id:ID!,$body:String!,$replyTo:ID){addDiscussionComment(input:{discussionId:$id,body:$body,replyToId:$replyTo}){comment{id}}}`,
            addLabels: `mutation($id:ID!,$labelIds:[ID!]!){addLabelsToLabelable(input:{labelableId:$id,labelIds:$labelIds}){labelable{...on Discussion{id}}}}`,
            addReaction: `mutation($id:ID!,$content:ReactionContent!){addReaction(input:{subjectId:$id,content:$content}){reaction{id}}}`,
            close: `mutation($id:ID!,$reason:DiscussionCloseReason){closeDiscussion(input:{discussionId:$id,reason:$reason}){discussion{id}}}`,
            create: `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){discussion{id number}}}`,
            delete: `mutation($id:ID!){deleteDiscussion(input:{id:$id}){discussion{id}}}`,
            deleteComment: `mutation($id:ID!){deleteDiscussionComment(input:{id:$id}){comment{id}}}`,
            lock: `mutation($id:ID!,$reason:LockReason){lockLockable(input:{lockableId:$id,lockReason:$reason}){lockedRecord{...on Discussion{id}}}}`,
            markAnswer: `mutation($id:ID!){markDiscussionCommentAsAnswer(input:{id:$id}){discussion{id}}}`,
            removeLabels: `mutation($id:ID!,$labelIds:[ID!]!){removeLabelsFromLabelable(input:{labelableId:$id,labelIds:$labelIds}){labelable{...on Discussion{id}}}}`,
            reopen: `mutation($id:ID!){reopenDiscussion(input:{discussionId:$id}){discussion{id}}}`,
            unlock: `mutation($id:ID!){unlockLockable(input:{lockableId:$id}){unlockedRecord{...on Discussion{id}}}}`,
            unmarkAnswer: `mutation($id:ID!){unmarkDiscussionCommentAsAnswer(input:{id:$id}){discussion{id}}}`,
            update: `mutation($id:ID!,$title:String,$body:String,$catId:ID){updateDiscussion(input:{discussionId:$id,title:$title,body:$body,categoryId:$catId}){discussion{id}}}`,
            updateComment: `mutation($id:ID!,$body:String!){updateDiscussionComment(input:{commentId:$id,body:$body}){comment{id}}}`,
        } as const,
    } as const,
    helper: {
        commands: {
            duplicate: { label: 'duplicate', requirePermission: 'write', trigger: '/duplicate' } as const,
        } as const,
        inactivity: {
            checkDays: 3,
            closeDays: 7,
            label: 'stale',
            modes: ['comment', 'issue'] as const,
        } as const,
        messages: {
            duplicate: (original: number): string =>
                `Marked as duplicate of #${original}. This issue will be closed automatically.`,
            stale: (): string =>
                `This issue has been automatically marked as stale due to inactivity.\n` +
                `It will be closed in 7 days if there is no further activity.\n` +
                `Comment to keep it open.`,
        } as const,
    } as const,
    hygiene: {
        // Bot aliases not derived from agent labels (actual GitHub bot names)
        botAliases: ['github-actions[bot]', 'gemini-code-assist[bot]', 'chatgpt-codex-connector[bot]'] as const,
        display: { maxFiles: 3 } as const,
        slashCommands: ['review', 'fix', 'explain', 'summarize', 'help', 'ask', 'duplicate'] as const,
        valuablePatterns: [
            /security|vulnerab|exploit|inject|xss|csrf|auth/i,
            /breaking|compat|deprecat|removal/i,
            /design|architect|pattern|approach/i,
            /performance|optim|memory|leak/i,
            /\bP0\b|\bP1\b|critical|urgent|blocker/i,
        ] as const,
    } as const,
    labels: {
        behaviors: {
            pinned: { onAdd: 'pin', onRemove: 'unpin' },
            stale: { onAdd: 'comment', onRemove: null },
        } as const,
        exempt: ['critical', 'implement', 'pinned', 'security'] as const,
        gql: {
            pin: `mutation($issueId:ID!){pinIssue(input:{issueId:$issueId}){issue{id}}}`,
            unpin: `mutation($issueId:ID!){unpinIssue(input:{issueId:$issueId}){issue{id}}}`,
        } as const,
        groups: {
            agent: ['claude', 'codex', 'copilot', 'gemini'] as const,
            phase: [
                '0-foundation',
                '1-planning',
                '2-impl-core',
                '3-impl-extensions',
                '4-hardening',
                '5-release',
            ] as const,
            priority: ['critical', 'high', 'medium', 'low'] as const,
            special: ['breaking', 'dashboard', 'dependencies', 'pinned', 'security', 'stale'] as const,
            status: ['triage', 'implement', 'in-progress', 'review', 'blocked', 'done'] as const,
            type: [
                'fix',
                'feat',
                'docs',
                'style',
                'refactor',
                'test',
                'chore',
                'perf',
                'ci',
                'build',
                'help',
                'task',
                'project',
            ] as const,
        } as const,
        special: {
            dependencies: 'dependencies',
            security: 'security',
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
            projectV2: {
                addItem: 'projectV2.addItem',
                archiveItem: 'projectV2.archiveItem',
                create: 'projectV2.create',
                deleteItem: 'projectV2.deleteItem',
                get: 'projectV2.get',
                list: 'projectV2.list',
                updateField: 'projectV2.updateField',
            },
            release: { create: 'release.create', latest: 'release.latest' },
        } as const,
    } as const,
    patterns: {
        commit: /^(\w+)(!?)(?:\(.+\))?:\s*(.+)$/,
        header: (f: string) => new RegExp(String.raw`###\s*${f}[\s\S]*?(?=###|$)`, 'i'),
        headerStrip: /###\s*[^\n]+\n?/,
        placeholder: /^_?No response_?$/i,
    },
    pr: {
        bash: String.raw`^\[([A-Za-z]+)(!?)\]:[[:space:]]*(.+)$`, // POSIX regex for bash
        pattern: /^\[([A-Z]+)(!?)\]:\s*(.+)$/i, // JS regex (keep in sync with bash)
    } as const,
    probe: {
        bodyTruncate: 500,
        gql: {
            discussion: `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){discussion(number:$n){id body title author{login}createdAt category{name id}labels(first:10){nodes{name}}answer{author{login}body createdAt}reactionGroups{content users{totalCount}}comments(first:100){nodes{id body author{login}createdAt reactionGroups{content users{totalCount}}replies(first:50){nodes{id body author{login}createdAt reactionGroups{content users{totalCount}}}}}}}}}`,
            discussionCategories: `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussionCategories(first:25){nodes{id name emoji description isAnswerable}}}}`,
            discussions: `query($owner:String!,$repo:String!,$first:Int!,$categoryId:ID,$answered:Boolean){repository(owner:$owner,name:$repo){discussions(first:$first,categoryId:$categoryId,answered:$answered){nodes{number title body author{login}category{name id}createdAt updatedAt labels(first:10){nodes{name}}isAnswered locked}pageInfo{hasNextPage endCursor}}}}`,
            pinnedDiscussions: `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){pinnedDiscussions(first:10){nodes{discussion{number title}pinnedBy{login}}}}}`,
            projectV2: `query($owner:String!,$number:Int!){organization(login:$owner){projectV2(number:$number){id title shortDescription public closed url fields(first:50){nodes{...on ProjectV2FieldCommon{id name dataType}...on ProjectV2SingleSelectField{options{id name}}...on ProjectV2IterationField{configuration{iterations{id title startDate}}}}}items(first:100){nodes{id type content{...on Issue{id number title}...on PullRequest{id number title}}fieldValues(first:20){nodes{...on ProjectV2ItemFieldSingleSelectValue{name optionId field{...on ProjectV2FieldCommon{name}}}}}}}}}}`,
            projectV2List: `query($owner:String!,$first:Int!){organization(login:$owner){projectsV2(first:$first){nodes{id number title shortDescription public closed url}}}}`,
        } as const,
        markers: { prReview: 'PR-REVIEW-SUMMARY' } as const,
        shaLength: 7,
        titles: { prReview: 'PR Review Summary' } as const,
    } as const,
    slashDispatch: {
        action: {
            name: 'peter-evans/slash-command-dispatch',
            ref: 'a28ee6cd74d5200f99e247ebc7b365c03ae0ef3c',
            version: '4.0.1',
        } as const,
        commands: {
            gemini: ['review', 'triage', 'architect', 'implement', 'invoke'] as const,
            maintenance: ['duplicate'] as const,
        } as const,
        eventSuffix: '-command' as const,
        permission: 'write' as const,
        reactions: { dispatch: 'rocket', seen: 'eyes' } as const,
    } as const,
    time: { day: 86400000 },
} as const);

// --- Pure Functions ----------------------------------------------------------

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
            list: (section) => {
                const s = section as Extract<Section, { kind: 'list' }>;
                const prefix = (index: number): string => (s.ordered ? `${index + 1}.` : '-');
                return s.items.map((item, index) => `${prefix(index)} ${interpolate(item)}`).join('\n');
            },
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
        filters: ReadonlyArray<{ readonly label: string; readonly display?: string }>,
        staleDays = B.algo.staleDays,
    ): ReadonlyArray<ReadonlyArray<string>> => {
        const now = new Date();
        return [
            ...filters.map(({ label, display }) => [
                display ?? label,
                String(issues.filter((issue) => issue.labels.some((lb) => lb.name === label)).length),
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
        const direction: keyof typeof trends = (() => {
            if (current > previous) {
                return 'pos';
            }
            if (current < previous) {
                return 'neg';
            }
            return 'same';
        })();
        return trends[direction];
    },
    trunc: (text: string | null, limit = B.probe.bodyTruncate): string => (text ?? '').substring(0, limit),
} as const;

// --- Dispatch Tables ---------------------------------------------------------

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
    'changes.compareCommits': {
        api: ['repos', 'compareCommits'],
        map: ([base, head]) => ({ base, head, per_page: B.api.perPage }),
        out: prop('files'),
    },
    'changes.listFiles': {
        api: ['pulls', 'listFiles'],
        map: ([number]) => ({ per_page: B.api.perPage, pull_number: number }),
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
    'discussion.addComment': {
        map: ([id, body, replyTo]) => ({ body, id, replyTo }),
        out: prop('addDiscussionComment', 'comment'),
        query: B.discussion.gql.addComment,
    },
    'discussion.addLabels': {
        map: ([id, labelIds]) => ({ id, labelIds }),
        query: B.discussion.gql.addLabels,
    },
    'discussion.addReaction': {
        map: ([id, content]) => ({ content, id }),
        query: B.discussion.gql.addReaction,
    },
    'discussion.categories': {
        map: () => ({}),
        out: prop('repository', 'discussionCategories', 'nodes'),
        query: B.probe.gql.discussionCategories,
    },
    'discussion.close': {
        map: ([id, reason]) => ({ id, reason }),
        query: B.discussion.gql.close,
    },
    'discussion.create': {
        map: ([repoId, catId, title, body]) => ({ body, catId, repoId, title }),
        out: prop('createDiscussion', 'discussion'),
        query: B.discussion.gql.create,
    },
    'discussion.delete': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.delete,
        safe: true,
    },
    'discussion.deleteComment': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.deleteComment,
        safe: true,
    },
    'discussion.get': {
        map: ([number]) => ({ n: number }),
        out: prop('repository', 'discussion'),
        query: B.probe.gql.discussion,
    },
    'discussion.list': {
        map: ([first, categoryId, answered]) => ({ answered, categoryId, first: first ?? 30 }),
        out: prop('repository', 'discussions', 'nodes'),
        query: B.probe.gql.discussions,
    },
    'discussion.lock': {
        map: ([id, reason]) => ({ id, reason }),
        query: B.discussion.gql.lock,
    },
    'discussion.markAnswer': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.markAnswer,
    },
    'discussion.pinned': {
        map: () => ({}),
        out: prop('repository', 'pinnedDiscussions', 'nodes'),
        query: B.probe.gql.pinnedDiscussions,
    },
    'discussion.removeLabels': {
        map: ([id, labelIds]) => ({ id, labelIds }),
        query: B.discussion.gql.removeLabels,
    },
    'discussion.reopen': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.reopen,
    },
    'discussion.unlock': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.unlock,
    },
    'discussion.unmarkAnswer': {
        map: ([id]) => ({ id }),
        query: B.discussion.gql.unmarkAnswer,
    },
    'discussion.update': {
        map: ([id, title, body, catId]) => ({ body, catId, id, title }),
        out: prop('updateDiscussion', 'discussion'),
        query: B.discussion.gql.update,
    },
    'discussion.updateComment': {
        map: ([id, body]) => ({ body, id }),
        query: B.discussion.gql.updateComment,
    },
    'issue.addLabels': { api: ['issues', 'addLabels'], map: ([number, labels]) => ({ issue_number: number, labels }) },
    'issue.create': { api: ['issues', 'create'], map: ([title, labels, body]) => ({ body, labels, title }) },
    'issue.get': { api: ['issues', 'get'], map: ([number]) => ({ issue_number: number }) },
    'issue.list': {
        api: ['issues', 'listForRepo'],
        map: ([state, labels]) => ({ labels, per_page: B.api.perPage, state }),
    },
    'issue.pin': { map: ([issueId]) => ({ issueId }), query: B.labels.gql.pin, safe: true },
    'issue.removeLabel': {
        api: ['issues', 'removeLabel'],
        map: ([number, name]) => ({ issue_number: number, name }),
        safe: true,
    },
    'issue.unpin': { map: ([issueId]) => ({ issueId }), query: B.labels.gql.unpin, safe: true },
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
    'projectV2.addItem': {
        map: ([projectId, contentId]) => ({ contentId, projectId }),
        out: prop('addProjectV2ItemById', 'item'),
        query: `mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}`,
    },
    'projectV2.archiveItem': {
        map: ([projectId, itemId]) => ({ itemId, projectId }),
        out: prop('archiveProjectV2Item', 'item'),
        query: `mutation($projectId:ID!,$itemId:ID!){archiveProjectV2Item(input:{projectId:$projectId,itemId:$itemId}){item{id isArchived}}}`,
    },
    'projectV2.create': {
        map: ([ownerId, title]) => ({ ownerId, title }),
        out: prop('createProjectV2', 'projectV2'),
        query: `mutation($ownerId:ID!,$title:String!){createProjectV2(input:{ownerId:$ownerId,title:$title}){projectV2{id number title url}}}`,
    },
    'projectV2.deleteItem': {
        map: ([projectId, itemId]) => ({ itemId, projectId }),
        out: prop('deleteProjectV2Item', 'deletedItemId'),
        query: `mutation($projectId:ID!,$itemId:ID!){deleteProjectV2Item(input:{projectId:$projectId,itemId:$itemId}){deletedItemId}}`,
    },
    'projectV2.get': {
        map: ([number]) => ({ number }),
        out: prop('organization', 'projectV2'),
        query: B.probe.gql.projectV2,
    },
    'projectV2.list': {
        map: ([first]) => ({ first: first ?? B.api.perPage }),
        out: prop('organization', 'projectsV2', 'nodes'),
        query: B.probe.gql.projectV2List,
    },
    'projectV2.updateField': {
        map: ([projectId, itemId, fieldId, value]) => ({ fieldId, itemId, projectId, value }),
        out: prop('updateProjectV2ItemFieldValue', 'projectV2Item'),
        query: `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:$value}){projectV2Item{id}}}`,
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
    'reaction.create': {
        api: ['reactions', 'createForIssueComment'],
        map: ([commentId, content]) => ({ comment_id: commentId, content }),
    },
    'reaction.createForReviewComment': {
        api: ['reactions', 'createForPullRequestReviewComment'],
        map: ([commentId, content]) => ({ comment_id: commentId, content }),
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
        // SECURITY: Type guard replaces unsafe type assertion (runtime validation)
        const extractData = (): unknown => {
            if (isGraphQL) {
                return result;
            }
            return isRestApiResponse(result) ? result.data : undefined;
        };
        const data = extractData();
        return data === undefined ? undefined : transform(data);
    };

    return op.safe ? execute().catch(() => undefined) : execute();
};

// --- Dispatch Tables ---------------------------------------------------------

const merge = (
    existing: string | null,
    content: string,
    mode: 'replace' | 'append' | 'prepend' | 'section',
    sectionId?: string,
): string => {
    const prev = existing ?? '';
    if (mode === 'section' && sectionId) {
        const start = `<!-- SECTION-START: ${sectionId} -->`;
        const end = `<!-- SECTION-END: ${sectionId} -->`;
        const section = `${start}\n${content}\n${end}`;
        const pattern = new RegExp(String.raw`${start}[\s\S]*?${end}`);
        return pattern.test(prev) ? prev.replace(pattern, section) : `${prev}\n\n${section}`;
    }
    return {
        append: `${prev}\n\n---\n\n${content}`,
        prepend: `${content}\n\n---\n\n${prev}`,
        replace: content,
        section: content, // Fallback if no sectionId
    }[mode];
};

const mutateHandlers: {
    readonly [K in MutateSpec['t']]: (ctx: Ctx, spec: Extract<MutateSpec, { t: K }>) => Promise<void>;
} = {
    comment: async (ctx, spec) => {
        // Check PR body for marker (preferred location for consolidated reports)
        const pr = (await call(ctx, 'pull.get', spec.n)) as { body: string | null };
        const markerStart = `<!-- ${spec.marker}: START -->`;
        const markerEnd = `<!-- ${spec.marker}: END -->`;
        const hasMarker = pr.body?.includes(spec.marker);

        // Inject marker section into PR body if missing (handles bot PRs without template)
        const bodyWithMarker = hasMarker
            ? pr.body
            : `${pr.body ?? ''}\n\n---\n\n${markerStart}\n<!-- Automated reports injected here -->\n${markerEnd}`;

        // Update PR body with section content
        const updatedBody = merge(bodyWithMarker, spec.body, spec.mode ?? 'replace', spec.sectionId);
        await call(ctx, 'pull.update', spec.n, { body: updatedBody });
    },
    issue: async (ctx, spec) => {
        const issues = (await call(ctx, 'issue.list', B.api.state.open, spec.label)) as ReadonlyArray<Issue>;
        // Exclude Renovate's Dependency Dashboard to prevent collision (both share 'dashboard' label)
        const existing = issues.find(
            (issue) => issue.title.includes(spec.pattern) && !issue.title.includes('Dependency Dashboard'),
        );
        const body = merge(existing?.body ?? null, spec.body, spec.mode ?? 'append');
        const actions = {
            create: async () => {
                const result = await call(ctx, 'issue.create', spec.title, spec.labels, body);
                spec.pin && (await call(ctx, 'issue.pin', (result as { node_id: string }).node_id));
            },
            update: async () => {
                await call(ctx, 'issue.update', existing?.number, body);
                spec.pin && existing && (await call(ctx, 'issue.pin', existing.node_id));
            },
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

// --- Entry Point -------------------------------------------------------------

const createCtx = (params: RunParams): Ctx => ({
    github: params.github,
    owner: params.context.repo.owner,
    repo: params.context.repo.repo,
});

// --- Export ------------------------------------------------------------------

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
