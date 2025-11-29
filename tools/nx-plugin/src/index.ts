/**
 * @parametric/nx-plugin - Workspace Nx Plugin
 * Provides: Task Lifecycle Hooks for environment validation and analytics
 * @see https://nx.dev/docs/extending-nx/task-running-lifecycle
 */
import type { PostTasksExecution, PostTasksExecutionContext, PreTasksExecution } from '@nx/devkit';

// --- Types ------------------------------------------------------------------

type PluginOptions = { readonly analytics: boolean; readonly validateEnv: boolean };

// --- Constants (Single B) ---------------------------------------------------

const B = {
    algo: { msPerSec: 1000, precision: 2 },
    defaults: { analytics: false, validateEnv: true } satisfies PluginOptions,
    lifecycle: { vars: ['NX_CLOUD_ACCESS_TOKEN', 'CI'] as const },
} as const;

// --- Pure Utilities ---------------------------------------------------------

const opts = (o: Partial<PluginOptions> | undefined): PluginOptions => ({ ...B.defaults, ...o });

const metrics = (r: PostTasksExecutionContext['taskResults']) => {
    const v = Object.values(r);
    const cached = v.filter((x) => x.status.includes('cache')).length;
    const failed = v.filter((x) => x.status === 'failure').length;
    const duration = v.reduce((s, x) => s + ((x.endTime ?? 0) - (x.startTime ?? 0)) / B.algo.msPerSec, 0);
    const pct = ((cached / Math.max(v.length, 1)) * 100).toFixed(0);
    return `Tasks: ${v.length} | Cached: ${cached} (${pct}%) | Failed: ${failed} | Duration: ${duration.toFixed(B.algo.precision)}s`;
};

// --- Lifecycle Hooks --------------------------------------------------------

const preTasksExecution: PreTasksExecution<PluginOptions> = async (options, ctx): Promise<void> => {
    const o = opts(options);
    const missing = B.lifecycle.vars.filter((v) => !process.env[v]);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook output
    o.validateEnv && missing.length > 0 && console.warn(`[PRE] Missing env vars: ${missing.join(', ')}`);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook output
    o.analytics && console.log(`[PRE] Starting in: ${ctx.workspaceRoot}`);
};

const postTasksExecution: PostTasksExecution<PluginOptions> = async (options, ctx): Promise<void> => {
    const o = opts(options);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook output
    o.analytics && console.log(`[POST] ${metrics(ctx.taskResults)}`);
};

// --- Export -----------------------------------------------------------------

export { postTasksExecution, preTasksExecution };
