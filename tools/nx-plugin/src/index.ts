/**
 * @parametric/nx-plugin - Workspace Nx Plugin
 * Provides: Local Generators, Project Graph Extensions, Task Lifecycle Hooks
 * @see https://nx.dev/docs/extending-nx/local-generators
 * @see https://nx.dev/docs/extending-nx/project-graph-plugins
 * @see https://nx.dev/docs/extending-nx/task-running-lifecycle
 */
import type {
    CreateDependencies,
    CreateDependenciesContext,
    CreateNodesContextV2,
    CreateNodesResult,
    CreateNodesV2,
    PostTasksExecution,
    PostTasksExecutionContext,
    PreTasksExecution,
    PreTasksExecutionContext,
    RawProjectGraphDependency,
} from '@nx/devkit';

// --- Type Definitions -------------------------------------------------------

type PluginOptions = {
    readonly analytics?: boolean;
    readonly validateEnv?: boolean;
    readonly inferTargets?: boolean;
};

type TaskMetrics = {
    readonly cached: number;
    readonly duration: number;
    readonly failed: number;
    readonly total: number;
};

// --- Constants (Single B - internal only, not exported frozen) --------------

const B = {
    algo: {
        durationPrecision: 2,
        msPerSec: 1000,
    },
    defaults: {
        analytics: false,
        inferTargets: true,
        validateEnv: true,
    } as PluginOptions,
    graph: {
        depType: 'static' as const,
        filePattern: '**/package.json',
        sourceFile: 'package.json',
    },
    lifecycle: {
        envVars: ['NX_CLOUD_ACCESS_TOKEN', 'CI'] as const,
        markers: { post: '[POST]', pre: '[PRE]' } as const,
    },
    targets: {
        check: { command: 'biome ci {projectRoot}', outputs: [] as ReadonlyArray<string> },
        typecheck: { command: 'tsc --project {projectRoot}/tsconfig.json --noEmit', outputs: [] as ReadonlyArray<string> },
    },
} as const;

// --- Pure Utility Functions -------------------------------------------------

const resolveOpts = (o?: PluginOptions): Required<PluginOptions> => ({
    analytics: o?.analytics ?? B.defaults.analytics,
    inferTargets: o?.inferTargets ?? B.defaults.inferTargets,
    validateEnv: o?.validateEnv ?? B.defaults.validateEnv,
});

const computeMetrics = (results: PostTasksExecutionContext['taskResults']): TaskMetrics => {
    const entries = Object.values(results);
    return {
        cached: entries.filter((r) => r.status === 'cache-hit' || r.status === 'remote-cache-hit').length,
        duration: entries.reduce((sum, r) => sum + (r.endTime - r.startTime) / B.algo.msPerSec, 0),
        failed: entries.filter((r) => r.status === 'failure').length,
        total: entries.length,
    };
};

const formatMetrics = (m: TaskMetrics): string =>
    `Tasks: ${m.total} | Cached: ${m.cached} (${((m.cached / Math.max(m.total, 1)) * 100).toFixed(0)}%) | Failed: ${m.failed} | Duration: ${m.duration.toFixed(B.algo.durationPrecision)}s`;

const validateEnvironment = (vars: ReadonlyArray<string>): ReadonlyArray<string> =>
    vars.filter((v) => !process.env[v]);

const inferProjectTargets = (projectRoot: string, opts: Required<PluginOptions>): Record<string, unknown> =>
    opts.inferTargets
        ? Object.fromEntries(
              Object.entries(B.targets).map(([name, cfg]) => [
                  name,
                  { cache: true, command: cfg.command.replace('{projectRoot}', projectRoot), outputs: cfg.outputs },
              ]),
          )
        : {};

// --- createNodesV2 (Project Graph Plugin) -----------------------------------

const createNodesV2: CreateNodesV2<PluginOptions> = [
    B.graph.filePattern,
    async (
        configFiles: ReadonlyArray<string>,
        options: PluginOptions | undefined,
        _context: CreateNodesContextV2,
    ): Promise<ReadonlyArray<readonly [string, CreateNodesResult]>> => {
        const opts = resolveOpts(options);
        return configFiles.map((configFile) => {
            const projectRoot = configFile.replace(`/${B.graph.sourceFile}`, '');
            return [
                configFile,
                {
                    projects: {
                        [projectRoot]: {
                            targets: inferProjectTargets(projectRoot, opts),
                        },
                    },
                },
            ] as const;
        });
    },
];

// --- createDependencies (Project Graph Plugin) ------------------------------

const createDependencies: CreateDependencies<PluginOptions> = async (
    _options: PluginOptions | undefined,
    context: CreateDependenciesContext,
): Promise<ReadonlyArray<RawProjectGraphDependency>> => {
    const deps: RawProjectGraphDependency[] = [];
    const projectNames = Object.keys(context.projects);

    projectNames.forEach((source) => {
        const project = context.projects[source];
        const pkgJsonPath = `${project.root}/package.json`;
        const fileData = context.fileMap.projectFileMap[source]?.find((f) => f.file === pkgJsonPath);

        fileData &&
            (() => {
                const content = context.filesToProcess.projectFileMap[source]?.find((f) => f.file === pkgJsonPath);
                content &&
                    projectNames
                        .filter((target) => target !== source && project.root.includes('packages'))
                        .forEach((target) => {
                            const targetProject = context.projects[target];
                            targetProject.root.includes('packages') &&
                                deps.push({
                                    source,
                                    sourceFile: pkgJsonPath,
                                    target,
                                    type: B.graph.depType,
                                });
                        });
            })();
    });

    return deps;
};

// --- preTasksExecution (Task Lifecycle Hook) --------------------------------

const preTasksExecution: PreTasksExecution<PluginOptions> = async (
    options: PluginOptions | undefined,
    context: PreTasksExecutionContext,
): Promise<void> => {
    const opts = resolveOpts(options);

    opts.validateEnv &&
        (() => {
            const missing = validateEnvironment(B.lifecycle.envVars);
            missing.length > 0 &&
                // biome-ignore lint/suspicious/noConsole: lifecycle hook output
                console.warn(`${B.lifecycle.markers.pre} Missing env vars: ${missing.join(', ')}`);
        })();

    opts.analytics &&
        // biome-ignore lint/suspicious/noConsole: lifecycle hook output
        console.log(`${B.lifecycle.markers.pre} Starting task execution in: ${context.workspaceRoot}`);
};

// --- postTasksExecution (Task Lifecycle Hook) -------------------------------

const postTasksExecution: PostTasksExecution<PluginOptions> = async (
    options: PluginOptions | undefined,
    context: PostTasksExecutionContext,
): Promise<void> => {
    const opts = resolveOpts(options);

    opts.analytics &&
        (() => {
            const metrics = computeMetrics(context.taskResults);
            // biome-ignore lint/suspicious/noConsole: lifecycle hook output
            console.log(`${B.lifecycle.markers.post} ${formatMetrics(metrics)}`);
        })();
};

// --- Export (Note: B is internal only, not frozen for Nx plugin system) -----

export { createDependencies, createNodesV2, postTasksExecution, preTasksExecution };
export type { PluginOptions, TaskMetrics };
