#!/usr/bin/env tsx
/**
 * Dashboard Script - Config-Driven Repository Dashboards
 * Leverages schema infrastructure for polymorphic metric collection and rendering
 *
 * @module dashboard
 */

import {
    B,
    type Commit,
    type Ctx,
    call,
    createCtx,
    fn,
    type Issue,
    mutate,
    type PR,
    type RunParams,
    type U,
    type WorkflowRun,
} from './schema.ts';

// --- Types ------------------------------------------------------------------

type Workflow = { readonly name: string; readonly path: string };

type WorkflowMetric = {
    readonly failed: number;
    readonly file: string;
    readonly name: string;
    readonly passed: number;
    readonly rate: number;
    readonly runs: number;
};

type Metrics = {
    readonly commits: number;
    readonly contributors: number;
    readonly depsOpen: number;
    readonly depsMerged: number;
    readonly issueBugs: number;
    readonly issueClosed: number;
    readonly issueOpen: number;
    readonly prMerged: number;
    readonly prOpen: number;
    readonly prStale: number;
    readonly release: string;
    readonly workflows: ReadonlyArray<WorkflowMetric>;
    readonly workflowRate: number;
};

// --- Utilities --------------------------------------------------------------

const since = (days: number): Date => new Date(Date.now() - days * B.time.day);
const isBot = (p: PR): boolean => B.dashboard.bots.some((b) => p.user.login === b);

// --- Data Collection --------------------------------------------------------

const collect = async (ctx: Ctx): Promise<Metrics> => {
    const sinceDate = since(B.dashboard.window);
    const monitorSince = new Date(Date.now() - B.dashboard.monitoring.period * B.time.day).toISOString();

    // Parallel fetch all data
    const [commits, openIssues, closedIssues, openPrs, closedPrs, release, allWorkflows] = await Promise.all([
        call(ctx, 'repo.listCommits', sinceDate.toISOString()) as Promise<ReadonlyArray<Commit>>,
        call(ctx, 'issue.list', B.api.state.open) as Promise<ReadonlyArray<Issue & { pull_request?: unknown }>>,
        call(ctx, 'issue.list', B.api.state.closed) as Promise<
            ReadonlyArray<Issue & { pull_request?: unknown; closed_at?: string }>
        >,
        call(ctx, 'pull.list', B.api.state.open) as Promise<ReadonlyArray<PR>>,
        call(ctx, 'pull.list', B.api.state.closed) as Promise<ReadonlyArray<PR>>,
        call(ctx, 'release.latest') as Promise<string | undefined>,
        call(ctx, 'actions.listWorkflows') as Promise<ReadonlyArray<Workflow> | undefined>,
    ]);

    // Filter issues (exclude PRs from issue list)
    const actualOpenIssues = openIssues.filter((i) => !i.pull_request);
    const actualClosedIssues = closedIssues.filter(
        (i) => !i.pull_request && i.closed_at && new Date(i.closed_at) > sinceDate,
    );

    // PR metrics
    const merged = closedPrs.filter((p) => p.merged_at && new Date(p.merged_at) > sinceDate);
    const stale = openPrs.filter((p) => fn.age(p.updated_at, new Date()) > B.dashboard.staleDays);

    // Dependency bot metrics
    const depsOpen = openPrs.filter(isBot).length;
    const depsMerged = merged.filter(isBot).length;

    // Workflow metrics (dynamic discovery, excludes skipped/cancelled from rate calculation)
    const workflows = allWorkflows ?? [];
    const excludedConclusions = ['skipped', 'cancelled'] as const;
    const workflowMetrics = await Promise.all(
        workflows.map(async (w): Promise<WorkflowMetric | null> => {
            const file = w.path.split('/').pop()?.replace('.yml', '') ?? '';
            const allRuns = (await call(
                ctx,
                'actions.listWorkflowRuns',
                `${file}.yml`,
                `>=${monitorSince}`,
            )) as ReadonlyArray<WorkflowRun> | undefined;
            const runs = allRuns?.filter((r) => r.conclusion && !excludedConclusions.includes(r.conclusion as never)) ?? [];
            const total = runs.length;
            const passed = runs.filter((r) => r.conclusion === 'success').length;
            const failed = total - passed;
            return total > 0
                ? { failed, file, name: w.name, passed, rate: Math.round((passed / total) * 100), runs: total }
                : null;
        }),
    );
    const activeWorkflows = workflowMetrics.filter((w): w is WorkflowMetric => w !== null);
    const totalRuns = activeWorkflows.reduce((a, w) => a + w.runs, 0);
    const totalPassed = activeWorkflows.reduce((a, w) => a + w.passed, 0);

    return {
        commits: commits.length,
        contributors: new Set(commits.map((c) => c.author?.login).filter(Boolean)).size,
        depsMerged,
        depsOpen,
        issueBugs: actualOpenIssues.filter((i) => fn.hasLabel(i.labels, B.dashboard.labels.bug)).length,
        issueClosed: actualClosedIssues.length,
        issueOpen: actualOpenIssues.length,
        prMerged: merged.length,
        prOpen: openPrs.length,
        prStale: stale.length,
        release: release ?? 'None',
        workflowRate: totalRuns > 0 ? Math.round((totalPassed / totalRuns) * 100) : 100,
        workflows: activeWorkflows,
    };
};

// --- Section Renderers ------------------------------------------------------

const renderHealthBadges = (m: Metrics, repo: string): string => {
    const { colors, targets } = B.dashboard;
    const ciColor =
        m.workflowRate >= targets.workflowSuccess
            ? colors.success
            : m.workflowRate >= targets.workflowWarning
              ? colors.warning
              : colors.error;
    const prColor = m.prStale > 0 ? colors.warning : colors.info;
    const issueColor = m.issueBugs > 0 ? colors.warning : colors.info;
    const gh = (path: string): string => `https://github.com/${repo}/${path}`;

    return [
        B.gen.link(B.gen.shield('CI', `${m.workflowRate}%25`, ciColor), gh('actions')),
        B.gen.link(B.gen.shield('PRs', `${m.prOpen}_open`, prColor), gh('pulls')),
        B.gen.link(B.gen.shield('Issues', `${m.issueOpen}_open`, issueColor), gh('issues')),
    ].join(' ');
};

const renderHeader = (m: Metrics, now: Date): string =>
    fn.body([
        {
            k: 'q',
            lines: [
                `**${m.release}** · ${m.commits} commits (${B.dashboard.window}d) · ${m.contributors} contributors`,
                `_Updated: ${fn.formatTime(now)}_`,
            ],
        },
    ]);

const renderActivity = (m: Metrics, repo: string): string => {
    const url = (path: string, query = ''): string => `https://github.com/${repo}/${path}${query ? `?q=${query}` : ''}`;
    const botQuery = B.dashboard.bots.map((b) => `author%3Aapp%2F${b.replace('[bot]', '')}`).join('+');

    return fn.report(
        'Activity',
        ['Resource', 'Open', `Merged/Closed (${B.dashboard.window}d)`, 'Attention'],
        [
            [
                B.gen.link('Pull Requests', url('pulls')),
                String(m.prOpen),
                `${m.prMerged} merged`,
                m.prStale > 0 ? `${m.prStale} stale` : '—',
            ],
            [
                B.gen.link('Issues', url('issues')),
                String(m.issueOpen),
                `${m.issueClosed} closed`,
                m.issueBugs > 0 ? `${m.issueBugs} bugs` : '—',
            ],
            [
                B.gen.link('Dependencies', url('pulls', `is%3Apr+${botQuery}`)),
                String(m.depsOpen),
                `${m.depsMerged} merged`,
                '—',
            ],
        ],
        { align: ['l', 'r', 'c', 'c'] },
    );
};

const renderCI = (m: Metrics, repo: string): string => {
    const { colors, targets } = B.dashboard;
    const workflowUrl = (file: string): string => `https://github.com/${repo}/actions/workflows/${file}.yml`;
    const statusBadge = (rate: number, file: string): string =>
        B.gen.link(
            rate >= targets.workflowSuccess
                ? B.gen.shield('', 'pass', colors.success, 'flat-square')
                : B.gen.shield('', 'warn', colors.warning, 'flat-square'),
            workflowUrl(file),
        );

    const rows = m.workflows.map((w) => [
        B.gen.link(w.name, workflowUrl(w.file)),
        String(w.runs),
        `${w.rate}%`,
        statusBadge(w.rate, w.file),
    ]);

    const badges = m.workflows.map((w) => B.gen.badge(repo, w.file)).join(' ');

    const table =
        rows.length > 0
            ? fn.report('CI Status', ['Workflow', 'Runs', 'Pass Rate', 'Status'], rows, {
                  align: ['l', 'r', 'c', 'c'],
              })
            : fn.report('CI Status', ['Workflow', 'Status'], [['No workflow runs in period', '—']]);

    return rows.length > 0 ? `${table}\n\n${B.gen.details('Workflow Badges', badges)}` : table;
};

const renderHealth = (m: Metrics): string => {
    const issues = [
        m.prStale > B.dashboard.targets.stalePrs &&
            `${m.prStale} stale PRs need review (>${B.dashboard.staleDays} days without update)`,
        m.workflowRate < B.dashboard.targets.workflowSuccess &&
            `CI success rate at ${m.workflowRate}% (target: ${B.dashboard.targets.workflowSuccess}%)`,
        m.issueBugs > 0 && `${m.issueBugs} open bugs requiring attention`,
    ].filter(Boolean) as ReadonlyArray<string>;

    return issues.length > 0
        ? fn.body([
              { k: 'h', l: 2, t: 'Health Check' },
              { c: issues.join('\n'), k: 'c', y: 'warning' },
          ])
        : fn.body([
              { k: 'h', l: 2, t: 'Health Check' },
              { c: 'All health targets met.', k: 'c', y: 'note' },
          ]);
};

const renderThresholds = (): string =>
    B.gen.details(
        'Thresholds & Targets',
        [
            `- **Stale PR**: >${B.dashboard.staleDays} days without update`,
            `- **CI Target**: ≥${B.dashboard.targets.workflowSuccess}% success rate`,
            `- **Bug Tracking**: Open bugs flagged for attention`,
        ].join('\n'),
    );

// --- Body Formatter ---------------------------------------------------------

const format = (m: Metrics, repo: string): string =>
    [
        `# ${B.dashboard.output.displayTitle}`,
        renderHealthBadges(m, repo),
        renderHeader(m, new Date()),
        renderActivity(m, repo),
        renderCI(m, repo),
        renderHealth(m),
        renderThresholds(),
        '---',
        `_Generated by ${B.gen.link(B.dashboard.workflow, `https://github.com/${repo}/blob/main/.github/workflows/${B.dashboard.workflow}`)} · Updated every ${B.dashboard.schedule.interval} ${B.dashboard.schedule.unit} · Comment \`${B.dashboard.command}\` to refresh_`,
    ].join('\n\n');

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: U<'dashboard'> }): Promise<void> =>
    ((ctx, repo) =>
        collect(ctx).then((m) =>
            mutate(ctx, {
                body: format(m, repo),
                label: B.dashboard.output.label,
                labels: [...B.dashboard.output.labels],
                mode: 'replace',
                pattern: B.dashboard.output.pattern,
                pin: params.spec.pin ?? true,
                t: 'issue',
                title: B.dashboard.output.title,
            }).then(() => params.core.info(`Dashboard updated: ${B.dashboard.output.title}`)),
        ))(createCtx(params), `${params.context.repo.owner}/${params.context.repo.repo}`);

// --- Export -----------------------------------------------------------------

export { collect, format, run };
