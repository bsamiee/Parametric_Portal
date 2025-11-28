#!/usr/bin/env tsx
/**
 * Central configuration and type definitions for workflow automation.
 * Contains B constant (config DSL), type registry, API operations, mutation handlers.
 */
import { ENV } from './env.ts';

// --- Base Type Definitions --------------------------------------------------

type User = { readonly login: string };
type Label = { readonly name: string };
type ReactionGroups = ReadonlyArray<{ readonly content: string; readonly users: { readonly totalCount: number } }>;
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
type Tag = Label;
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
type Pkg = { readonly name: string; readonly raw: number; readonly gzip: number; readonly brotli: number };
type Sizes = { readonly packages: ReadonlyArray<Pkg> };
// --- Constants (String Interning) -------------------------------------------

const S = Object.freeze({
    actionRequired: 'Action Required',
    job: '{{job}}',
    runUrl: '{{runUrl}}',
    security: 'security',
    techDebt: 'tech-debt',
} as const);

// --- Constants (Classification Factory) -------------------------------------

const debt = (cat: 'perf' | 'test' | 'quality') =>
    ({
        perf: { labels: [S.techDebt, 'performance'] as const, type: 'Performance' as const },
        quality: { labels: [S.techDebt, 'refactor'] as const, type: 'Quality' as const },
        test: { labels: [S.techDebt, 'testing'] as const, type: 'Mutation' as const },
    })[cat];

// --- Helpers (extracted for DRY) --------------------------------------------

const shieldUrl = (l: string, m: string, c: string, s?: string, g?: string): string =>
    `https://img.shields.io/badge/${encodeURIComponent(l)}-${encodeURIComponent(m)}-${c}${s || g ? '?' : ''}${s ? `style=${s}` : ''}${s && g ? '&' : ''}${g ? `logo=${g}&logoColor=white` : ''}`;
const prop =
    <K extends string>(...keys: readonly K[]) =>
    (x: unknown) =>
        keys.reduce((acc, k) => (acc as Record<K, unknown>)?.[k], x);

// --- Constants (Single B) ---------------------------------------------------

const B = Object.freeze({
    alerts: {
        ci: {
            body: [
                { k: 'h', l: 2, t: 'CI Failure' },
                { k: 'f', l: 'Run', v: S.runUrl },
                { k: 'f', l: 'Job', v: S.job },
                { k: 's' },
                { k: 'h', l: 3, t: S.actionRequired },
                { c: 'Review the failed CI run and address the issues before merging.', k: 't' },
            ] as const,
            default: debt('quality'),
            pattern: 'Debt:',
            rules: [
                { p: /build/i, v: debt('perf') },
                { p: /compression/i, v: debt('perf') },
                { p: /mutate/i, v: debt('test') },
                { p: /test/i, v: debt('test') },
            ] as const,
        },
        security: {
            body: [
                { k: 'h', l: 2, t: 'Security Scan Alert' },
                { k: 's' },
                { k: 'f', l: 'Run', v: S.runUrl },
                { k: 'h', l: 3, t: S.actionRequired },
                { c: 'Security vulnerabilities or compliance issues have been detected.', k: 't' },
                { k: 'h', l: 3, t: 'Next Steps' },
                {
                    i: [
                        'Review the failed job in the CI run',
                        'Address critical and high severity issues',
                        'Update dependencies or fix code issues',
                        'Re-run security scan to verify fixes',
                    ],
                    k: 'n',
                },
            ] as const,
            labels: [S.security, 'priority/critical'] as const,
            pattern: 'Security Scan',
            title: '[SECURITY] Security Scan Alert',
        },
    } as const,
    algo: { closeRatio: 14 / 30, mutationPct: 80, staleDays: 30 },
    api: { perPage: 100, state: { all: 'all', closed: 'closed', open: 'open' } as const },
    bump: { breaking: 'major', feat: 'minor' } as const,
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
    gating: {
        actions: {
            canary: '',
            major: 'Review breaking changes and create migration checklist.',
            mutation: 'Improve test coverage to reach mutation score threshold.',
        } as const,
        body: {
            block: [
                { k: 'h', l: 2, t: '{{title}}' },
                { k: 'f', l: 'Reason', v: '{{reason}}' },
                { k: 's' },
                { k: 'h', l: 3, t: S.actionRequired },
                { c: '{{action}}', k: 't' },
            ],
            migration: [
                { k: 'h', l: 2, t: 'Migration: {{package}}' },
                { k: 'f', l: 'Version', v: 'v{{version}}' },
                { k: 'f', l: 'Source PR', v: '#{{pr}}' },
                { k: 'h', l: 3, t: 'Checklist' },
                {
                    items: [
                        { text: 'Review breaking changes' },
                        { text: 'Update affected code' },
                        { text: 'Run full test suite' },
                    ],
                    k: 'a',
                },
            ],
        } as const,
        default: { eligible: false, reason: 'major' as const },
        defaults: {
            check: 'mutation-score',
            marker: 'GATE-BLOCK',
            migrate: true,
            migrationLabels: ['dependencies', 'migration', 'priority/high'],
            migrationPattern: 'Migration:',
            title: '[BLOCKED] Auto-merge blocked',
        } as const,
        messages: {
            canary: 'Canary/beta/rc version requires manual review.',
            major: 'Major version update requires manual review.',
            mutation: 'Mutation score below threshold.',
        } as const,
        patterns: { package: /update ([\w\-@/]+) to v?(\d+)/i, score: /(\d+)%/ } as const,
        rules: [
            { p: /major/i, v: { eligible: false, reason: 'major' as const } },
            { p: /canary|beta|rc|alpha|preview/i, v: { eligible: false, reason: 'canary' as const } },
            { p: /minor/i, v: { eligible: true, reason: null } },
            { p: /patch/i, v: { eligible: true, reason: null } },
        ] as const,
    } as const,
    gen: {
        alert: (type: 'note' | 'tip' | 'important' | 'warning' | 'caution', content: string): string =>
            `> [!${type.toUpperCase()}]\n> ${content.split('\n').join('\n> ')}`,
        badge: (repo: string, workflow: string): string =>
            `![${workflow}](https://github.com/${repo}/actions/workflows/${workflow}.yml/badge.svg)`,
        code: (lang: string, content: string): string => `\`\`\`${lang}\n${content}\n\`\`\``,
        del: (text: string): string => `<del>${text}</del>`,
        details: (summary: string, content: string, open?: boolean): string =>
            `<details${open ? ' open' : ''}>\n<summary>${summary}</summary>\n\n${content}\n</details>`,
        diff: (content: string): string => `\`\`\`diff\n${content}\n\`\`\``,
        ins: (text: string): string => `<ins>${text}</ins>`,
        kbd: (...keys: ReadonlyArray<string>): string => keys.map((k) => `<kbd>${k}</kbd>`).join('+'),
        link: (text: string, url: string): string => `[${text}](${url})`,
        marker: (n: string): string => `<!-- ${n} -->`,
        math: (expr: string, block?: boolean): string => (block ? `$$\n${expr}\n$$` : `$${expr}$`),
        mermaid: (diagram: string): string => `\`\`\`mermaid\n${diagram}\n\`\`\``,
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
        signs: { [-1]: 'dec', 0: 'same', 1: 'inc' } as const,
        sparkline: (values: ReadonlyArray<number>): string =>
            ((chars, max) => values.map((v) => chars[Math.min(Math.floor((v / max) * 7), 7)]).join(''))(
                ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
                Math.max(...values, 1),
            ),
        status: { dec: '[-]', fail: '[FAIL]', inc: '[+]', pass: '[PASS]', same: '[=]', warn: '[WARN]' } as const,
        sub: (text: string): string => `<sub>${text}</sub>`,
        sup: (text: string): string => `<sup>${text}</sup>`,
        task: (items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }>): string =>
            items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n'),
        trend: (current: number, previous: number): string =>
            B.gen.status[current > previous ? 'inc' : current < previous ? 'dec' : 'same'],
        url: {
            actions: (repo: string): string => `https://github.com/${repo}/actions`,
            artifacts: (repo: string, runId: number): string =>
                `https://github.com/${repo}/actions/runs/${runId}#artifacts`,
            logs: (repo: string, runId: number): string => `https://github.com/${repo}/actions/runs/${runId}`,
            workflow: (repo: string, file: string): string =>
                `https://github.com/${repo}/actions/workflows/${file}.yml`,
        },
    },
    labels: {
        categories: {
            action: ['blocked', 'implement', 'review'] as const,
            agent: ['claude', 'codex', 'copilot', 'gemini'] as const,
            lifecycle: ['pinned', 'stale'] as const,
            priority: ['critical'] as const,
            special: ['dependencies', S.security] as const,
        },
        exempt: ['critical', 'implement', 'pinned', S.security] as const,
    },
    patterns: {
        header: (f: string) => new RegExp(`###\\s*${f}[\\s\\S]*?(?=###|$)`, 'i'),
        headerStrip: /###\s*[^\n]+\n?/,
        placeholder: /^_?No response_?$/i,
    },
    pr: { pattern: /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i } as const,
    probe: {
        bodyTruncate: 500,
        defaults: { unknownAuthor: 'unknown' } as const,
        gql: {
            discussion: `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){discussion(number:$n){body title author{login}createdAt category{name}labels(first:10){nodes{name}}answer{author{login}body createdAt}reactionGroups{content users{totalCount}}comments(first:100){nodes{body author{login}createdAt reactionGroups{content users{totalCount}}replies(first:50){nodes{body author{login}createdAt reactionGroups{content users{totalCount}}}}}}}}}`,
            pinIssue: `mutation($issueId:ID!){pinIssue(input:{issueId:$issueId}){issue{id}}}`,
        } as const,
        markers: { prReview: 'PR-REVIEW-SUMMARY' } as const,
        shaLength: 7,
        titles: { prReview: 'PR Review Summary' } as const,
    } as const,
    release: {
        default: 'patch' as const,
        emptyChangelog: 'No significant changes.' as const,
    } as const,
    thresholds: { bundleKb: ENV.bundleThresholdKb },
    time: { day: 86400000 },
    typeOrder: ['breaking', 'feat', 'fix', 'refactor', 'chore', 'docs', 'style', 'test', 'perf'] as const,
    types: {
        breaking: { p: ['!:', 'BREAKING CHANGE'], t: 'Breaking Changes' },
        chore: { p: ['chore:', 'chore('], t: 'Maintenance' },
        docs: { p: ['docs:', 'docs('], t: 'Documentation' },
        feat: { p: ['feat:', 'feat('], t: 'Features' },
        fix: { p: ['fix:', 'fix('], t: 'Bug Fixes' },
        perf: { p: ['perf:', 'perf('], t: 'Performance' },
        refactor: { p: ['refactor:', 'refactor('], t: 'Refactoring' },
        style: { p: ['style:', 'style('], t: 'Styling' },
        test: { p: ['test:', 'test('], t: 'Testing' },
    } as const,
} as const);

// --- Derived Types ----------------------------------------------------------

type TypeKey = keyof typeof B.types;
type LabelCat = keyof typeof B.labels.categories;
type Mode = 'replace' | 'append' | 'prepend';

// --- Unified Spec System (SpecRegistry) -------------------------------------

type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';
type Section =
    | { readonly k: 'a'; readonly items: ReadonlyArray<{ readonly text: string; readonly done?: boolean }> }
    | { readonly k: 'b'; readonly i: ReadonlyArray<string> | string }
    | { readonly k: 'c'; readonly y: AlertType; readonly c: string }
    | { readonly k: 'd' }
    | { readonly k: 'f'; readonly l: string; readonly v: string }
    | { readonly k: 'h'; readonly l: 2 | 3; readonly t: string }
    | { readonly k: 'm'; readonly e: string; readonly b?: boolean }
    | { readonly k: 'n'; readonly i: ReadonlyArray<string> | string }
    | { readonly k: 'p'; readonly l: string; readonly c: string }
    | { readonly k: 'q'; readonly lines: ReadonlyArray<string> }
    | { readonly k: 's' }
    | { readonly k: 't'; readonly c: string }
    | { readonly k: 'x'; readonly s: string; readonly c: string; readonly o?: boolean };

type BodySpec = ReadonlyArray<Section>;

type SpecRegistry = {
    readonly alert: {
        readonly ci: { readonly kind: 'ci'; readonly job: string; readonly runUrl: string };
        readonly security: { readonly kind: 'security'; readonly runUrl: string };
    };
    readonly dashboard: {
        readonly update: { readonly kind: 'update'; readonly pin?: boolean };
    };
    readonly filter: {
        readonly age: { readonly kind: 'age'; readonly days?: number };
        readonly label: { readonly kind: 'label'; readonly cat: LabelCat; readonly idx?: number };
    };
    readonly source: {
        readonly fetch: { readonly s: 'fetch'; readonly op: string; readonly a?: ReadonlyArray<unknown> };
        readonly params: { readonly s: 'params' };
        readonly payload: { readonly s: 'payload' };
    };
    readonly output: {
        readonly summary: { readonly o: 'summary' };
        readonly comment: { readonly o: 'comment'; readonly m: string };
        readonly issue: {
            readonly o: 'issue';
            readonly p: string;
            readonly l: ReadonlyArray<string>;
            readonly t?: string;
        };
    };
    readonly format: {
        readonly table: {
            readonly f: 'table';
            readonly t: string;
            readonly h: ReadonlyArray<string>;
            readonly w?: string;
        };
        readonly body: { readonly f: 'body'; readonly b: BodySpec };
    };
    readonly mutate: {
        readonly comment: {
            readonly t: 'comment';
            readonly n: number;
            readonly marker: string;
            readonly body: string;
            readonly mode?: Mode;
        };
        readonly issue: {
            readonly t: 'issue';
            readonly label: string;
            readonly pattern: string;
            readonly title: string;
            readonly labels: ReadonlyArray<string>;
            readonly body: string;
            readonly mode?: Mode;
            readonly pin?: boolean;
        };
        readonly label: {
            readonly t: 'label';
            readonly n: number;
            readonly labels: ReadonlyArray<string>;
            readonly action: 'add' | 'remove';
        };
        readonly review: {
            readonly t: 'review';
            readonly pr: number;
            readonly body: string;
            readonly event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
        };
        readonly release: {
            readonly t: 'release';
            readonly tag: string;
            readonly name: string;
            readonly body: string;
            readonly draft?: boolean;
            readonly prerelease?: boolean;
        };
    };
};

type Kind = keyof SpecRegistry;
type U<K extends Kind> = SpecRegistry[K][keyof SpecRegistry[K]];
type G<C> = Readonly<Record<keyof C, ReadonlyArray<string>>>;

type ContentConfig = {
    readonly src: U<'source'>;
    readonly fmt: U<'format'>;
    readonly out: U<'output'>;
    readonly row?: string;
    readonly [k: string]: unknown;
};
type ContentSpec = { readonly kind: string } & Record<string, unknown>;

// --- Dispatch Handlers ------------------------------------------------------

const filterHandlers: {
    readonly [K in U<'filter'>['kind']]: (s: Extract<U<'filter'>, { kind: K }>, i: Issue, now: Date) => boolean;
} = {
    age: (s, i, now) => fn.age(i.created_at, now) > (s.days ?? B.algo.staleDays),
    label: (s, i) => i.labels.some((l) => l.name === B.labels.categories[s.cat][s.idx ?? 0]),
};

// --- Pure Functions (Flattened) ---------------------------------------------

const fn = {
    age: (created: string, now: Date): number => Math.floor((now.getTime() - new Date(created).getTime()) / B.time.day),
    body: (spec: BodySpec, v: Record<string, string> = {}): string => {
        const $ = (s: string): string => Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{{${k}}}`, x), s);
        const list = (items: ReadonlyArray<string> | string, prefix: (i: number) => string): string =>
            (typeof items === 'string' ? (v[items] ?? '').split('|') : items)
                .map((x, i) => `${prefix(i)} ${$(x)}`)
                .join('\n');
        const get = <K extends Section['k']>(s: Section): Extract<Section, { k: K }> => s as Extract<Section, { k: K }>;
        return spec
            .map((s) =>
                ({
                    a: () => B.gen.task(get<'a'>(s).items),
                    b: () => list(get<'b'>(s).i, () => '-'),
                    c: () => B.gen.alert(get<'c'>(s).y, $(get<'c'>(s).c)),
                    d: () => '---',
                    f: () => `- **${get<'f'>(s).l}**: ${$(get<'f'>(s).v)}`,
                    h: () => `${'#'.repeat(get<'h'>(s).l)} ${$(get<'h'>(s).t)}`,
                    m: () => B.gen.math($(get<'m'>(s).e), get<'m'>(s).b),
                    n: () => list(get<'n'>(s).i, (i) => `${i + 1}.`),
                    p: () => B.gen.code(get<'p'>(s).l, $(get<'p'>(s).c)),
                    q: () =>
                        get<'q'>(s)
                            .lines.map((l) => `> ${$(l)}`)
                            .join('\n'),
                    s: () => fn.timestamp(new Date()),
                    t: () => $(get<'t'>(s).c),
                    x: () => B.gen.details($(get<'x'>(s).s), $(get<'x'>(s).c), get<'x'>(s).o),
                })[s.k](),
            )
            .join('\n\n');
    },
    classify: <R>(input: string, rules: ReadonlyArray<{ readonly p: RegExp; readonly v: R }>, def: R): R =>
        rules.find((r) => r.p.test(input))?.v ?? def,
    classifyDebt: (job: string) => fn.classify(job, B.alerts.ci.rules, B.alerts.ci.default),
    classifyGating: (title: string) =>
        fn.classify<{ readonly eligible: boolean; readonly reason: 'canary' | 'major' | null }>(
            title.toLowerCase(),
            B.gating.rules,
            B.gating.default,
        ),
    comment: (c: { readonly body?: string; readonly created_at: string; readonly user: User }) => ({
        author: c.user.login,
        body: fn.trunc(c.body ?? null),
        createdAt: c.created_at,
    }),
    diff: (c: number, p: number): string =>
        p === 0
            ? `+${fn.size(c)}`
            : ((d) => `${d > 0 ? '+' : ''}${fn.size(d)} (${d > 0 ? '+' : ''}${((d / p) * 100).toFixed(1)}%)`)(c - p),
    filter: (spec: U<'filter'>, issue: Issue, now: Date): boolean =>
        filterHandlers[spec.kind](spec as never, issue, now),
    formatTime: (d: Date): string =>
        ((pad) =>
            `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()} ` +
            `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (UTC)`)((n: number) =>
            String(n).padStart(2, '0'),
        ),
    hasLabel: (labels: ReadonlyArray<Label>, target: string): boolean => labels.some((l) => l.name === target),
    logins: (arr: ReadonlyArray<User>): ReadonlyArray<string> => arr.map((x) => x.login),
    names: (arr: ReadonlyArray<Label>): ReadonlyArray<string> => arr.map((x) => x.name),
    reactions: (groups: ReactionGroups): Record<string, number> =>
        Object.fromEntries(groups.map((g) => [g.content, g.users.totalCount])),
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
    resolveType: (input: string | ReadonlyArray<string>, mode: 'label' | 'commit'): TypeKey | undefined =>
        mode === 'label'
            ? (Object.keys(B.types) as ReadonlyArray<TypeKey>).find((k) => (input as ReadonlyArray<string>).includes(k))
            : (Object.entries(B.types) as ReadonlyArray<[TypeKey, (typeof B.types)[TypeKey]]>).find(([_, v]) =>
                  v.p.some((pat) => (input as string).toLowerCase().includes(pat.replace('(', ''))),
              )?.[0],
    rowsCount: (
        issues: ReadonlyArray<Issue>,
        filters: ReadonlyArray<{ readonly l: string; readonly s: Extract<U<'filter'>, { kind: 'label' }> }>,
        staleDays = B.algo.staleDays,
    ): ReadonlyArray<ReadonlyArray<string>> => {
        const now = new Date();
        return [
            ...filters.map(({ l, s }) => [l, String(issues.filter((i) => fn.filter(s, i, now)).length)]),
            [`>${staleDays} days`, String(issues.filter((i) => fn.age(i.created_at, now) > staleDays).length)],
            ['Total Open', String(issues.length)],
        ];
    },
    rowsDiff: <T extends { readonly name: string }>(
        current: ReadonlyArray<T>,
        previous: ReadonlyArray<T>,
        row: (c: T, p: T) => ReadonlyArray<string>,
        defaultVal: T,
    ): ReadonlyArray<ReadonlyArray<string>> =>
        current.map((c) => row(c, previous.find((x) => x.name === c.name) ?? defaultVal)),
    rowsList: (data: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<ReadonlyArray<string>> =>
        data.map((r) => Object.values(r).map(String)),
    size: (b: number): string =>
        b === 0
            ? '0 B'
            : ((i) => `${(b / 1024 ** i).toFixed(2)} ${['B', 'KB', 'MB'][i]}`)(
                  Math.floor(Math.log(b) / Math.log(1024)),
              ),
    status: (d: number, t = B.thresholds.bundleKb * 1024): string =>
        B.gen.status[Math.abs(d) > t ? 'warn' : B.gen.signs[Math.sign(d) as -1 | 0 | 1]],
    target: (value: number, threshold: number, op: 'gt' | 'lt' | 'gte' | 'lte'): 'pass' | 'warn' | 'fail' =>
        ({ gt: value > threshold, gte: value >= threshold, lt: value < threshold, lte: value <= threshold })[op]
            ? 'pass'
            : 'warn',
    timestamp: (d: Date): string => `_Generated: ${d.toISOString()}_`,
    trunc: (s: string | null, n = B.probe.bodyTruncate): string => (s ?? '').substring(0, n),
} as const;

// --- Ops Factory ------------------------------------------------------------

type Op = {
    readonly a?: readonly [string, string];
    readonly m: (x: ReadonlyArray<unknown>) => Record<string, unknown>;
    readonly o?: (d: unknown) => unknown;
    readonly q?: string;
    readonly s?: boolean;
};
const ops: Record<string, Op> = {
    'actions.listWorkflowRuns': {
        a: ['actions', 'listWorkflowRunsForRepo'],
        m: ([workflow, created]) => ({ created, per_page: B.api.perPage, workflow_id: workflow }),
        o: prop('workflow_runs'),
    },
    'actions.listWorkflows': {
        a: ['actions', 'listRepoWorkflows'],
        m: () => ({ per_page: B.api.perPage }),
        o: prop('workflows'),
    },
    'check.listForRef': { a: ['checks', 'listForRef'], m: ([ref]) => ({ ref }), o: prop('check_runs') },
    'comment.create': { a: ['issues', 'createComment'], m: ([n, body]) => ({ body, issue_number: n }) },
    'comment.list': { a: ['issues', 'listComments'], m: ([n]) => ({ issue_number: n }) },
    'comment.update': { a: ['issues', 'updateComment'], m: ([id, body]) => ({ body, comment_id: id }) },
    'discussion.get': {
        m: ([n]) => ({ n }),
        o: prop('repository', 'discussion'),
        q: B.probe.gql.discussion,
    },
    'issue.addLabels': { a: ['issues', 'addLabels'], m: ([n, labels]) => ({ issue_number: n, labels }) },
    'issue.create': { a: ['issues', 'create'], m: ([title, labels, body]) => ({ body, labels, title }) },
    'issue.get': { a: ['issues', 'get'], m: ([n]) => ({ issue_number: n }) },
    'issue.list': {
        a: ['issues', 'listForRepo'],
        m: ([state, labels]) => ({ labels, per_page: B.api.perPage, state }),
    },
    'issue.pin': { m: ([issueId]) => ({ issueId }), q: B.probe.gql.pinIssue, s: true },
    'issue.removeLabel': { a: ['issues', 'removeLabel'], m: ([n, name]) => ({ issue_number: n, name }), s: true },
    'issue.update': { a: ['issues', 'update'], m: ([n, body]) => ({ body, issue_number: n }) },
    'pull.get': { a: ['pulls', 'get'], m: ([n]) => ({ pull_number: n }) },
    'pull.list': {
        a: ['pulls', 'list'],
        m: ([state, sort, direction]) => ({
            direction: direction ?? 'desc',
            per_page: B.api.perPage,
            sort: sort ?? 'updated',
            state,
        }),
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
    'release.create': {
        a: ['repos', 'createRelease'],
        m: ([tag, name, body, draft, prerelease]) => ({ body, draft, name, prerelease, tag_name: tag }),
    },
    'release.latest': { a: ['repos', 'getLatestRelease'], m: () => ({}), o: prop('tag_name'), s: true },
    'repo.compareCommits': {
        a: ['repos', 'compareCommits'],
        m: ([base, head]) => ({ base, head }),
        o: prop('commits'),
    },
    'repo.listCommits': { a: ['repos', 'listCommits'], m: ([since]) => ({ per_page: B.api.perPage, since }) },
    'review.create': { a: ['pulls', 'createReview'], m: ([pr, body, event]) => ({ body, event, pull_number: pr }) },
    'tag.list': { a: ['repos', 'listTags'], m: () => ({ per_page: 1 }) },
} as const;

const call = async (c: Ctx, k: string, ...a: ReadonlyArray<unknown>): Promise<unknown> => {
    const o = ops[k];
    const t = o.o ?? ((x: unknown) => x);
    const run = async () =>
        o.q
            ? t(await c.github.graphql(o.q, { owner: c.owner, repo: c.repo, ...o.m(a) }))
            : ((api) => t((api as { data: unknown }).data))(
                  await c.github.rest[o.a?.[0] ?? ''][o.a?.[1] ?? '']({ owner: c.owner, repo: c.repo, ...o.m(a) }),
              );
    return o.s ? run().catch(() => undefined) : run();
};

const merge = (existing: string | null, content: string, mode: Mode): string =>
    ({
        append: `${existing ?? ''}\n\n---\n\n${content}`,
        prepend: `${content}\n\n---\n\n${existing ?? ''}`,
        replace: content,
    })[mode];

const mutateHandlers: {
    readonly [K in U<'mutate'>['t']]: (c: Ctx, s: Extract<U<'mutate'>, { t: K }>) => Promise<void>;
} = {
    comment: async (c, s) => {
        const xs = (await call(c, 'comment.list', s.n)) as ReadonlyArray<Comment>;
        const e = xs.find((x) => x.body?.includes(s.marker));
        const body = merge(e?.body ?? null, s.body, s.mode ?? 'replace');
        await (e ? call(c, 'comment.update', e.id, body) : call(c, 'comment.create', s.n, body));
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
const mutate = async (c: Ctx, s: U<'mutate'>): Promise<void> => mutateHandlers[s.t](c, s as never);

// --- Entry Point ------------------------------------------------------------

const createCtx = (p: RunParams): Ctx => ({ github: p.github, owner: p.context.repo.owner, repo: p.context.repo.repo });

// --- Export -----------------------------------------------------------------

export { B, S, call, createCtx, fn, mutate };
export type {
    BodySpec,
    Comment,
    Commit,
    ContentConfig,
    ContentSpec,
    Core,
    Ctx,
    G,
    GitHub,
    Issue,
    TypeKey,
    Kind,
    Label,
    LabelCat,
    Mode,
    Pkg,
    PR,
    ReactionGroups,
    Repo,
    RunParams,
    Section,
    Sizes,
    Tag,
    U,
    User,
    WorkflowRun,
};
