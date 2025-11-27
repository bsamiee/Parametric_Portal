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
    readonly lastRunId: number;
    readonly lastRunUrl: string;
    readonly name: string;
    readonly passed: number;
    readonly rate: number;
    readonly recentRates: ReadonlyArray<number>;
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
            const lastRun = runs[0];
            // Calculate rolling 7-day windows for sparkline (newest to oldest, reversed for display)
            const windowSize = 5;
            const recentRates = Array.from({ length: windowSize }, (_, i) => {
                const start = i * Math.ceil(total / windowSize);
                const end = Math.min(start + Math.ceil(total / windowSize), total);
                const slice = runs.slice(start, end);
                return slice.length > 0
                    ? Math.round((slice.filter((r) => r.conclusion === 'success').length / slice.length) * 100)
                    : 0;
            }).reverse();
            return total > 0
                ? {
                      failed,
                      file,
                      lastRunId: lastRun?.id ?? 0,
                      lastRunUrl: lastRun?.html_url ?? '',
                      name: w.name,
                      passed,
                      rate: Math.round((passed / total) * 100),
                      recentRates,
                      runs: total,
                  }
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

    return [
        B.gen.shieldLink('CI', `${m.workflowRate}%25`, ciColor, B.gen.url.actions(repo), 'for-the-badge', 'githubactions'),
        B.gen.shieldLink('PRs', `${m.prOpen}_open`, prColor, `https://github.com/${repo}/pulls`, 'for-the-badge', 'git'),
        B.gen.shieldLink('Issues', `${m.issueOpen}_open`, issueColor, `https://github.com/${repo}/issues`, 'for-the-badge', 'target'),
    ].join(' ');
};

const renderQuickActions = (repo: string): string => {
    const actions = [
        { label: '🔍 Actions', url: B.gen.url.actions(repo) },
        { label: '📦 Releases', url: `https://github.com/${repo}/releases` },
        { label: '🔒 Security', url: `https://github.com/${repo}/security` },
        { label: '📊 Insights', url: `https://github.com/${repo}/pulse` },
    ];
    return actions.map(({ label, url }) => B.gen.link(`\`${label}\``, url)).join(' · ');
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
    const statusBadge = (rate: number, file: string): string =>
        B.gen.link(
            rate >= targets.workflowSuccess
                ? B.gen.shield('', '✓', colors.success, 'flat-square')
                : B.gen.shield('', '!', colors.warning, 'flat-square'),
            B.gen.url.workflow(repo, file),
        );

    const rows = m.workflows.map((w) => [
        B.gen.link(w.name, B.gen.url.workflow(repo, w.file)),
        String(w.runs),
        `${w.rate}%`,
        B.gen.sparkline(w.recentRates),
        w.lastRunId > 0 ? B.gen.link('📋', B.gen.url.logs(repo, w.lastRunId)) : '—',
        statusBadge(w.rate, w.file),
    ]);

    const progressSection = m.workflows.length > 0
        ? `\n\n**Overall CI Health:** ${B.gen.progress(m.workflowRate)}`
        : '';

    return rows.length > 0
        ? fn.report('CI Status', ['Workflow', 'Runs', 'Rate', 'Trend', 'Logs', 'Status'], rows, {
              align: ['l', 'r', 'c', 'c', 'c', 'c'],
          }) + progressSection
        : fn.report('CI Status', ['Workflow', 'Status'], [['No workflow runs in period', '—']]);
};

const renderHealth = (m: Metrics): string => {
    const issues = [
        m.prStale > B.dashboard.targets.stalePrs &&
            `[WARN] **${m.prStale} stale PRs** need review (>${B.dashboard.staleDays} days without update)`,
        m.workflowRate < B.dashboard.targets.workflowSuccess &&
            `[WARN] **CI success rate** at ${m.workflowRate}% (target: ${B.dashboard.targets.workflowSuccess}%)`,
        m.issueBugs > 0 && `[BUG] **${m.issueBugs} open bugs** requiring attention`,
    ].filter(Boolean) as ReadonlyArray<string>;

    const header = '## Health Check\n\n';
    return issues.length > 0
        ? header + B.gen.alert('warning', issues.join('\n'))
        : header + B.gen.alert('tip', '[OK] All health targets met. Repository is in good shape!');
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

const renderFooter = (repo: string): string => {
    const workflowUrl = `https://github.com/${repo}/blob/main/.github/workflows/${B.dashboard.workflow}`;
    const checkbox = `- [ ] <!-- ${B.dashboard.marker} -->Check this box to trigger a dashboard refresh`;
    const generated = `<p align="center">${B.gen.sub(`Generated by ${B.gen.link(B.dashboard.workflow, workflowUrl)} · Updated every ${B.dashboard.schedule.interval} ${B.dashboard.schedule.unit}`)}</p>`;
    return `${checkbox}\n\n${generated}`;
};

const format = (m: Metrics, repo: string): string =>
    [
        `# ${B.dashboard.output.displayTitle}`,
        renderHealthBadges(m, repo),
        renderQuickActions(repo),
        renderHeader(m, new Date()),
        renderActivity(m, repo),
        renderCI(m, repo),
        renderHealth(m),
        renderThresholds(),
        '---',
        renderFooter(repo),
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
