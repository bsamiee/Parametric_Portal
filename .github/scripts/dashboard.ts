#!/usr/bin/env tsx
/**
 * Repository dashboard: collects metrics, renders sections, publishes pinned issue.
 * Uses B.dashboard, fn.report, md utilities, call, mutate from schema.ts.
 */
import { ENV } from './env.ts';
import {
    B,
    type Commit,
    type Ctx,
    call,
    createCtx,
    fn,
    type Issue,
    md,
    mutate,
    type PR,
    type RunParams,
    type WorkflowRun,
} from './schema.ts';

// --- Constants ---------------------------------------------------------------

const externalLinks = [
    {
        enabled: () => ENV.nxCloudWorkspaceId !== '',
        label: '[Nx Cloud]',
        url: () => B.dashboard.nxCloud.url(ENV.nxCloudWorkspaceId),
    },
] as const;

const nxCloudEnabled = ENV.nxCloudWorkspaceId !== '';

// --- Types -------------------------------------------------------------------

type DashboardSpec = { readonly kind: 'update'; readonly pin?: boolean };
type Workflow = { readonly name: string; readonly path: string };
type WorkflowMetric = {
    readonly failed: number;
    readonly file: string;
    readonly lastRunId: number;
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

// --- Pure Functions ----------------------------------------------------------

const { colors, targets } = B.dashboard;
const since = (days: number): Date => new Date(Date.now() - days * B.time.day);
const isBot = (pr: PR): boolean => (B.dashboard.bots as ReadonlyArray<string>).includes(pr.user.login);
const url = (repo: string, path: string, query = ''): string => {
    const q = query ? `?q=${query}` : '';
    return `https://github.com/${repo}/${path}${q}`;
};

// --- Pure Functions ----------------------------------------------------------

const collect = async (ctx: Ctx): Promise<Metrics> => {
    const sinceDate = since(B.dashboard.window);
    const monitorSince = new Date(Date.now() - B.dashboard.monitoring.period * B.time.day).toISOString();
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
    const actualOpenIssues = openIssues.filter((issue) => !issue.pull_request);
    const actualClosedIssues = closedIssues.filter(
        (issue) => !issue.pull_request && issue.closed_at && new Date(issue.closed_at) > sinceDate,
    );
    const merged = closedPrs.filter((pr) => pr.merged_at && new Date(pr.merged_at) > sinceDate);
    const stale = openPrs.filter((pr) => fn.age(pr.updated_at, new Date()) > B.dashboard.staleDays);
    const workflowMetrics = await Promise.all(
        (allWorkflows ?? []).map(async (workflow): Promise<WorkflowMetric | null> => {
            const file = workflow.path.split('/').pop()?.replace('.yml', '') ?? '';
            const allRuns = (await call(ctx, 'actions.listWorkflowRuns', `${file}.yml`, `>=${monitorSince}`)) as
                | ReadonlyArray<WorkflowRun>
                | undefined;
            const runs =
                allRuns?.filter(
                    (run) =>
                        run.conclusion &&
                        !B.dashboard.excludeConclusions.includes(
                            run.conclusion as (typeof B.dashboard.excludeConclusions)[number],
                        ),
                ) ?? [];
            const total = runs.length;
            const passed = runs.filter((run) => run.conclusion === 'success').length;
            const lastRun = runs[0];
            const chunk = Math.ceil(total / B.dashboard.sparklineWidth);
            const calcRate = (slice: ReadonlyArray<WorkflowRun>): number =>
                slice.length > 0
                    ? Math.round((slice.filter((run) => run.conclusion === 'success').length / slice.length) * 100)
                    : 0;
            const recentRates = Array.from({ length: B.dashboard.sparklineWidth }, (_, index) =>
                calcRate(runs.slice(index * chunk, Math.min((index + 1) * chunk, total))),
            ).reverse();
            return total > 0
                ? {
                      failed: total - passed,
                      file,
                      lastRunId: lastRun?.id ?? 0,
                      name: workflow.name,
                      passed,
                      rate: Math.round((passed / total) * 100),
                      recentRates,
                      runs: total,
                  }
                : null;
        }),
    );
    const activeWorkflows = workflowMetrics.filter((wf): wf is WorkflowMetric => wf !== null);
    const [totalRuns, totalPassed] = activeWorkflows.reduce<[number, number]>(
        ([runs, passes], wf) => [runs + wf.runs, passes + wf.passed],
        [0, 0],
    );
    return {
        commits: commits.length,
        contributors: new Set(commits.map((commit) => commit.author?.login).filter(Boolean)).size,
        depsMerged: merged.filter(isBot).length,
        depsOpen: openPrs.filter(isBot).length,
        issueBugs: actualOpenIssues.filter((issue) =>
            issue.labels.some((label) => label.name === B.dashboard.labels.fix),
        ).length,
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

// --- Dispatch Tables ---------------------------------------------------------

const sections: Record<string, (metrics: Metrics, repo: string) => string> = {
    actions: (_, repo) => {
        const internal = B.dashboard.actions.map((action) => md.link(`\`${action.label}\``, url(repo, action.path)));
        const external = externalLinks
            .filter((link) => link.enabled())
            .map((link) => md.link(`\`${link.label}\``, link.url()));
        return [...internal, ...external].join(' · ');
    },
    activity: (metrics, repo) => {
        const botQuery = B.dashboard.bots.map((bot) => `author%3Aapp%2F${bot.replace('[bot]', '')}`).join('+');
        return fn.report(
            'Activity',
            ['Resource', 'Open', `Merged/Closed (${B.dashboard.window}d)`, 'Attention'],
            [
                [
                    md.link('Pull Requests', url(repo, 'pulls')),
                    String(metrics.prOpen),
                    `${metrics.prMerged} merged`,
                    metrics.prStale > 0 ? `${metrics.prStale} stale` : '-',
                ],
                [
                    md.link('Issues', url(repo, 'issues')),
                    String(metrics.issueOpen),
                    `${metrics.issueClosed} closed`,
                    metrics.issueBugs > 0 ? `${metrics.issueBugs} bugs` : '-',
                ],
                [
                    md.link('Dependencies', url(repo, 'pulls', `is%3Apr+${botQuery}`)),
                    String(metrics.depsOpen),
                    `${metrics.depsMerged} merged`,
                    '-',
                ],
            ],
            { align: ['l', 'r', 'c', 'c'] },
        );
    },
    badges: (metrics, repo) => {
        const ciColor = (() => {
            if (metrics.workflowRate >= targets.workflowSuccess) {
                return colors.success;
            }
            if (metrics.workflowRate >= targets.workflowWarning) {
                return colors.warning;
            }
            return colors.error;
        })();
        const badges = [
            md.shieldLink(
                'CI',
                `${metrics.workflowRate}%25`,
                ciColor,
                md.url.actions(repo),
                'for-the-badge',
                'githubactions',
            ),
            md.shieldLink(
                'PRs',
                `${metrics.prOpen}_open`,
                metrics.prStale > 0 ? colors.warning : colors.info,
                url(repo, 'pulls'),
                'for-the-badge',
                'git',
            ),
            md.shieldLink(
                'Issues',
                `${metrics.issueOpen}_open`,
                metrics.issueBugs > 0 ? colors.warning : colors.info,
                url(repo, 'issues'),
                'for-the-badge',
                'target',
            ),
        ];
        nxCloudEnabled &&
            badges.push(
                md.shieldLink(
                    'Nx Cloud',
                    'view',
                    colors.info,
                    B.dashboard.nxCloud.url(ENV.nxCloudWorkspaceId),
                    'for-the-badge',
                    'nx',
                ),
            );
        return badges.join(' ');
    },
    ci: (metrics, repo) => {
        const statusBadge = (rate: number, file: string): string =>
            md.link(
                rate >= targets.workflowSuccess
                    ? md.shield('', 'OK', colors.success, 'flat-square')
                    : md.shield('', '!', colors.warning, 'flat-square'),
                md.url.workflow(repo, file),
            );
        const trendPct = (rates: ReadonlyArray<number>): string => {
            const diff = rates.length >= 2 ? rates[rates.length - 1] - rates[0] : 0;
            const diffStr = (d: number): string => {
                if (d > 0) {
                    return `+${d}%`;
                }
                if (d < 0) {
                    return `${d}%`;
                }
                return '-';
            };
            return diffStr(diff);
        };
        const rows = metrics.workflows.map((wf) => [
            md.link(wf.name, md.url.workflow(repo, wf.file)),
            String(wf.runs),
            `${wf.rate}%`,
            trendPct(wf.recentRates),
            wf.lastRunId > 0 ? md.link('Logs', md.url.logs(repo, wf.lastRunId)) : '-',
            statusBadge(wf.rate, wf.file),
        ]);
        const progress =
            metrics.workflows.length > 0 ? `\n\n**Overall CI Health:** ${md.progress(metrics.workflowRate)}` : '';
        return rows.length > 0
            ? fn.report('CI Status', ['Workflow', 'Runs', 'Rate', 'Trend', 'Latest', 'Status'], rows, {
                  align: ['l', 'r', 'c', 'c', 'c', 'c'],
              }) + progress
            : fn.report('CI Status', ['Workflow', 'Status'], [['No workflow runs in period', '-']]);
    },
    footer: (_, repo) => {
        const workflowUrl = `https://github.com/${repo}/blob/main/.github/workflows/${B.dashboard.workflow}`;
        return `- [ ] <!-- ${B.dashboard.marker} -->Check this box to trigger a dashboard refresh\n\n<sub>Generated by <a href="${workflowUrl}">${B.dashboard.workflow}</a> · Updated every ${B.dashboard.schedule.interval} ${B.dashboard.schedule.unit}</sub>`;
    },
    header: (metrics) =>
        `> **${metrics.release}** · ${metrics.commits} commits (${B.dashboard.window}d) · ${metrics.contributors} contributors\n> _Updated: ${fn.formatTime(new Date())}_`,
    health: (metrics) => {
        const issues = [
            metrics.prStale > targets.stalePrs &&
                `[WARN] **${metrics.prStale} stale PRs** need review (>${B.dashboard.staleDays} days without update)`,
            metrics.workflowRate < targets.workflowSuccess &&
                `[WARN] **CI success rate** at ${metrics.workflowRate}% (target: ${targets.workflowSuccess}%)`,
            metrics.issueBugs > 0 && `[FIX] **${metrics.issueBugs} open bugs** requiring attention`,
        ].filter(Boolean) as ReadonlyArray<string>;
        return `## Health Check\n\n${issues.length > 0 ? md.alert('warning', issues.join('\n')) : md.alert('tip', '[OK] All health targets met. Repository is in good shape!')}`;
    },
    thresholds: () =>
        md.details(
            'Thresholds & Targets',
            [
                `- **Stale PR**: >${B.dashboard.staleDays} days without update`,
                `- **CI Target**: >=${targets.workflowSuccess}% success rate`,
                `- **Bug Tracking**: Open bugs flagged for attention`,
            ].join('\n'),
        ),
};
const format = (metrics: Metrics, repo: string): string =>
    [
        `# ${B.dashboard.output.displayTitle}`,
        sections.badges(metrics, repo),
        sections.actions(metrics, repo),
        sections.header(metrics, repo),
        sections.activity(metrics, repo),
        sections.ci(metrics, repo),
        sections.health(metrics, repo),
        sections.thresholds(metrics, repo),
        '---',
        sections.footer(metrics, repo),
    ].join('\n\n');

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: DashboardSpec }): Promise<void> =>
    ((ctx, repo) =>
        collect(ctx).then((metrics) =>
            mutate(ctx, {
                body: format(metrics, repo),
                label: B.dashboard.output.label,
                labels: [...B.dashboard.output.labels],
                mode: 'replace',
                pattern: B.dashboard.output.pattern,
                pin: params.spec.pin ?? B.dashboard.output.pin,
                t: 'issue',
                title: B.dashboard.output.title,
            }).then(() => params.core.info(`Dashboard updated: ${B.dashboard.output.title}`)),
        ))(createCtx(params), `${params.context.repo.owner}/${params.context.repo.repo}`);

// --- Export ------------------------------------------------------------------

export { run };
export type { DashboardSpec };
