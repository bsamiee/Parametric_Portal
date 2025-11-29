/**
 * @parametric/nx-plugin - Workspace Nx Plugin
 * Provides: Local Generators, Project Graph Extensions, Task Lifecycle Hooks
 * @see https://nx.dev/docs/extending-nx/local-generators
 * @see https://nx.dev/docs/extending-nx/project-graph-plugins
 * @see https://nx.dev/docs/extending-nx/task-running-lifecycle
 */
import type {
    CreateDependencies,
    CreateNodesResult,
    CreateNodesV2,
    PostTasksExecution,
    PostTasksExecutionContext,
    PreTasksExecution,
    RawProjectGraphDependency,
} from '@nx/devkit';

// --- Constants (Single B) ---------------------------------------------------

const B = {
    algo: { msPerSec: 1000, precision: 2 },
    defaults: { analytics: false, inferTargets: true, validateEnv: true },
    graph: { depType: 'static' as const, pattern: '{apps,packages}/*/package.json', src: 'package.json' },
    lifecycle: { vars: ['NX_CLOUD_ACCESS_TOKEN', 'CI'] as const },
} as const;

// --- Pure Utilities ---------------------------------------------------------

const opts = <T extends Record<string, unknown>>(o: T | undefined, d: Required<T>): Required<T> =>
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, o?.[k as keyof T] ?? v])) as Required<T>;

const metrics = (r: PostTasksExecutionContext['taskResults']) => {
    const v = Object.values(r);
    const c = v.filter((x) => x.status.includes('cache')).length;
    const f = v.filter((x) => x.status === 'failure').length;
    const d = v.reduce((s, x) => s + ((x.endTime ?? 0) - (x.startTime ?? 0)) / B.algo.msPerSec, 0);
    return `Tasks: ${v.length} | Cached: ${c} (${((c / Math.max(v.length, 1)) * 100).toFixed(0)}%) | Failed: ${f} | Duration: ${d.toFixed(B.algo.precision)}s`;
};

// --- createNodesV2 ----------------------------------------------------------

const createNodesV2: CreateNodesV2<typeof B.defaults> = [
    B.graph.pattern,
    async (files, options, _ctx): Promise<ReadonlyArray<readonly [string, CreateNodesResult]>> => {
        const o = opts(options, B.defaults);
        return files.map(
            (f) =>
                [
                    f,
                    { projects: { [f.replace(`/${B.graph.src}`, '')]: { targets: o.inferTargets ? {} : {} } } },
                ] as const,
        );
    },
];

// --- createDependencies -----------------------------------------------------

const createDependencies: CreateDependencies<typeof B.defaults> = async (
    _options,
    _ctx,
): Promise<ReadonlyArray<RawProjectGraphDependency>> => {
    // Dependencies are inferred by Nx's built-in analyzers (TypeScript imports, package.json deps)
    // This hook is available for custom dependency detection if needed
    return [];
};

// --- Lifecycle Hooks --------------------------------------------------------

const preTasksExecution: PreTasksExecution<typeof B.defaults> = async (options, ctx): Promise<void> => {
    const o = opts(options, B.defaults);
    const missing = B.lifecycle.vars.filter((v) => !process.env[v]);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook
    o.validateEnv && missing.length > 0 && console.warn(`[PRE] Missing env vars: ${missing.join(', ')}`);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook
    o.analytics && console.log(`[PRE] Starting in: ${ctx.workspaceRoot}`);
};

const postTasksExecution: PostTasksExecution<typeof B.defaults> = async (options, ctx): Promise<void> => {
    const o = opts(options, B.defaults);
    // biome-ignore lint/suspicious/noConsole: lifecycle hook
    o.analytics && console.log(`[POST] ${metrics(ctx.taskResults)}`);
};

// --- Export -----------------------------------------------------------------

export { createDependencies, createNodesV2, postTasksExecution, preTasksExecution };
