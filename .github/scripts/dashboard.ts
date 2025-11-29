#!/usr/bin/env tsx
/**
 * Metrics collector and section renderer with dispatch table architecture.
 * Composes parallel API calls, formats via fn.report, outputs via mutate.
 */

import { ENV } from './env.ts';
import {
    B,
    type Commit,
    type Ctx,
    call,
    check,
    createCtx,
    fn,
    type Issue,
    md,
    mutate,
    type PR,
    type RunParams,
    type WorkflowRun,
} from './schema.ts';

// --- Domain Config (DASHBOARD) ----------------------------------------------

const DASHBOARD = Object.freeze({
    actions: [
        { label: '[Actions]', path: 'actions' },
        { label: '[Releases]', path: 'releases' },
        { label: '[Security]', path: 'security' },
        { label: '[Insights]', path: 'pulse' },
    ] as const,
    bots: ['renovate[bot]', 'dependabot[bot]'] as const,
    colors: { error: 'red', info: 'blue', success: 'brightgreen', warning: 'yellow' } as const,
    excludeConclusions: ['skipped', 'cancelled'] as const,
    externalLinks: [
        {
            enabled: () => ENV.nxCloudWorkspaceId !== '',
            label: '[Nx Cloud]',
            url: () => `https://cloud.nx.app/orgs/workspace/${ENV.nxCloudWorkspaceId}`,
        },
    ] as const,
    labels: { feat: 'feat', fix: 'fix' } as const,
    marker: 'dashboard-refresh',
    monitoring: { period: 30, unit: 'days' } as const,
    nxCloud: {
        enabled: ENV.nxCloudWorkspaceId !== '',
        url: (id: string) => (id ? `https://cloud.nx.app/orgs/workspace/${id}` : ''),
    },
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
} as const);

// --- Types ------------------------------------------------------------------

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

// --- Helpers ----------------------------------------------------------------

const { colors, targets } = DASHBOARD;
const since = (days: number): Date => new Date(Date.now() - days * B.time.day);
const isBot = (p: PR): boolean => DASHBOARD.bots.some((b) => p.user.login === b);
const url = (repo: string, path: string, query = ''): string =>
    `https://github.com/${repo}/${path}${query ? `?q=${query}` : ''}`;

// --- Data Collection --------------------------------------------------------

const collect = async (ctx: Ctx): Promise<Metrics> => {
    const sinceDate = since(DASHBOARD.window);
    const monitorSince = new Date(Date.now() - DASHBOARD.monitoring.period * B.time.day).toISOString();
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
    const actualOpenIssues = openIssues.filter((i) => !i.pull_request);
    const actualClosedIssues = closedIssues.filter(
        (i) => !i.pull_request && i.closed_at && new Date(i.closed_at) > sinceDate,
    );
    const merged = closedPrs.filter((p) => p.merged_at && new Date(p.merged_at) > sinceDate);
    const stale = openPrs.filter((p) => fn.age(p.updated_at, new Date()) > DASHBOARD.staleDays);
    const workflowMetrics = await Promise.all(
        (allWorkflows ?? []).map(async (w): Promise<WorkflowMetric | null> => {
            const file = w.path.split('/').pop()?.replace('.yml', '') ?? '';
            const allRuns = (await call(ctx, 'actions.listWorkflowRuns', `${file}.yml`, `>=${monitorSince}`)) as
                | ReadonlyArray<WorkflowRun>
                | undefined;
            const runs =
                allRuns?.filter(
                    (r) =>
                        r.conclusion &&
                        !DASHBOARD.excludeConclusions.includes(
                            r.conclusion as (typeof DASHBOARD.excludeConclusions)[number],
                        ),
                ) ?? [];
            const total = runs.length;
            const passed = runs.filter((r) => r.conclusion === 'success').length;
            const lastRun = runs[0];
            const chunk = Math.ceil(total / DASHBOARD.sparklineWidth);
            const recentRates = Array.from({ length: DASHBOARD.sparklineWidth }, (_, i) =>
                ((slice) =>
                    slice.length > 0
                        ? Math.round((slice.filter((r) => r.conclusion === 'success').length / slice.length) * 100)
                        : 0)(runs.slice(i * chunk, Math.min((i + 1) * chunk, total))),
            ).reverse();
            return total > 0
                ? {
                      failed: total - passed,
                      file,
                      lastRunId: lastRun?.id ?? 0,
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
    const [totalRuns, totalPassed] = activeWorkflows.reduce<[number, number]>(
        ([r, p], w) => [r + w.runs, p + w.passed],
        [0, 0],
    );
    return {
        commits: commits.length,
        contributors: new Set(commits.map((c) => c.author?.login).filter(Boolean)).size,
        depsMerged: merged.filter(isBot).length,
        depsOpen: openPrs.filter(isBot).length,
        issueBugs: actualOpenIssues.filter((i) => check('label', i.labels, DASHBOARD.labels.fix)).length,
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

const sections: Record<string, (m: Metrics, repo: string) => string> = {
    actions: (_, repo) => {
        const internal = DASHBOARD.actions.map((a) => md.link(`\`${a.label}\``, url(repo, a.path)));
        const external = DASHBOARD.externalLinks
            .filter((l) => l.enabled())
            .map((l) => md.link(`\`${l.label}\``, l.url()));
        return [...internal, ...external].join(' · ');
    },
    activity: (m, repo) => {
        const botQuery = DASHBOARD.bots.map((b) => `author%3Aapp%2F${b.replace('[bot]', '')}`).join('+');
        return fn.report(
            'Activity',
            ['Resource', 'Open', `Merged/Closed (${DASHBOARD.window}d)`, 'Attention'],
            [
                [
                    md.link('Pull Requests', url(repo, 'pulls')),
                    String(m.prOpen),
                    `${m.prMerged} merged`,
                    m.prStale > 0 ? `${m.prStale} stale` : '-',
                ],
                [
                    md.link('Issues', url(repo, 'issues')),
                    String(m.issueOpen),
                    `${m.issueClosed} closed`,
                    m.issueBugs > 0 ? `${m.issueBugs} bugs` : '-',
                ],
                [
                    md.link('Dependencies', url(repo, 'pulls', `is%3Apr+${botQuery}`)),
                    String(m.depsOpen),
                    `${m.depsMerged} merged`,
                    '-',
                ],
            ],
            { align: ['l', 'r', 'c', 'c'] },
        );
    },
    badges: (m, repo) => {
        const ciColor =
            m.workflowRate >= targets.workflowSuccess
                ? colors.success
                : m.workflowRate >= targets.workflowWarning
                  ? colors.warning
                  : colors.error;
        const badges = [
            md.shieldLink(
                'CI',
                `${m.workflowRate}%25`,
                ciColor,
                md.url.actions(repo),
                'for-the-badge',
                'githubactions',
            ),
            md.shieldLink(
                'PRs',
                `${m.prOpen}_open`,
                m.prStale > 0 ? colors.warning : colors.info,
                url(repo, 'pulls'),
                'for-the-badge',
                'git',
            ),
            md.shieldLink(
                'Issues',
                `${m.issueOpen}_open`,
                m.issueBugs > 0 ? colors.warning : colors.info,
                url(repo, 'issues'),
                'for-the-badge',
                'target',
            ),
        ];
        DASHBOARD.nxCloud.enabled &&
            badges.push(
                md.shieldLink(
                    'Nx Cloud',
                    'view',
                    colors.info,
                    DASHBOARD.nxCloud.url(ENV.nxCloudWorkspaceId),
                    'for-the-badge',
                    'nx',
                ),
            );
        return badges.join(' ');
    },
    ci: (m, repo) => {
        const statusBadge = (rate: number, file: string): string =>
            md.link(
                rate >= targets.workflowSuccess
                    ? md.shield('', 'OK', colors.success, 'flat-square')
                    : md.shield('', '!', colors.warning, 'flat-square'),
                md.url.workflow(repo, file),
            );
        const trendPct = (rates: ReadonlyArray<number>): string =>
            ((diff) => (diff > 0 ? `+${diff}%` : diff < 0 ? `${diff}%` : '-'))(
                rates.length >= 2 ? rates[rates.length - 1] - rates[0] : 0,
            );
        const rows = m.workflows.map((w) => [
            md.link(w.name, md.url.workflow(repo, w.file)),
            String(w.runs),
            `${w.rate}%`,
            trendPct(w.recentRates),
            w.lastRunId > 0 ? md.link('Logs', md.url.logs(repo, w.lastRunId)) : '-',
            statusBadge(w.rate, w.file),
        ]);
        const progress = m.workflows.length > 0 ? `\n\n**Overall CI Health:** ${md.progress(m.workflowRate)}` : '';
        return rows.length > 0
            ? fn.report('CI Status', ['Workflow', 'Runs', 'Rate', 'Trend', 'Latest', 'Status'], rows, {
                  align: ['l', 'r', 'c', 'c', 'c', 'c'],
              }) + progress
            : fn.report('CI Status', ['Workflow', 'Status'], [['No workflow runs in period', '-']]);
    },
    footer: (_, repo) => {
        const workflowUrl = `https://github.com/${repo}/blob/main/.github/workflows/${DASHBOARD.workflow}`;
        return `- [ ] <!-- ${DASHBOARD.marker} -->Check this box to trigger a dashboard refresh\n\n<p align="center"><sub>Generated by <a href="${workflowUrl}">${DASHBOARD.workflow}</a></sub></p>\n<p align="center"><sub>Updated every ${DASHBOARD.schedule.interval} ${DASHBOARD.schedule.unit}</sub></p>`;
    },
    header: (m) =>
        `> **${m.release}** · ${m.commits} commits (${DASHBOARD.window}d) · ${m.contributors} contributors\n> _Updated: ${fn.formatTime(new Date())}_`,
    health: (m) => {
        const issues = [
            m.prStale > DASHBOARD.targets.stalePrs &&
                `[WARN] **${m.prStale} stale PRs** need review (>${DASHBOARD.staleDays} days without update)`,
            m.workflowRate < DASHBOARD.targets.workflowSuccess &&
                `[WARN] **CI success rate** at ${m.workflowRate}% (target: ${DASHBOARD.targets.workflowSuccess}%)`,
            m.issueBugs > 0 && `[FIX] **${m.issueBugs} open bugs** requiring attention`,
        ].filter(Boolean) as ReadonlyArray<string>;
        return `## Health Check\n\n${issues.length > 0 ? md.alert('warning', issues.join('\n')) : md.alert('tip', '[OK] All health targets met. Repository is in good shape!')}`;
    },
    thresholds: () =>
        md.details(
            'Thresholds & Targets',
            [
                `- **Stale PR**: >${DASHBOARD.staleDays} days without update`,
                `- **CI Target**: >=${DASHBOARD.targets.workflowSuccess}% success rate`,
                `- **Bug Tracking**: Open bugs flagged for attention`,
            ].join('\n'),
        ),
};

const format = (m: Metrics, repo: string): string =>
    [
        `# ${DASHBOARD.output.displayTitle}`,
        sections.badges(m, repo),
        sections.actions(m, repo),
        sections.header(m, repo),
        sections.activity(m, repo),
        sections.ci(m, repo),
        sections.health(m, repo),
        sections.thresholds(m, repo),
        '---',
        sections.footer(m, repo),
    ].join('\n\n');

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: DashboardSpec }): Promise<void> =>
    ((ctx, repo) =>
        collect(ctx).then((m) =>
            mutate(ctx, {
                body: format(m, repo),
                label: DASHBOARD.output.label,
                labels: [...DASHBOARD.output.labels],
                mode: 'replace',
                pattern: DASHBOARD.output.pattern,
                pin: params.spec.pin ?? DASHBOARD.output.pin,
                t: 'issue',
                title: DASHBOARD.output.title,
            }).then(() => params.core.info(`Dashboard updated: ${DASHBOARD.output.title}`)),
        ))(createCtx(params), `${params.context.repo.owner}/${params.context.repo.repo}`);

// --- Export -----------------------------------------------------------------

export { run };
export type { DashboardSpec };
