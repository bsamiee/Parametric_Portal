#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
/// <reference types="node" />
import { Schema as S } from '@effect/schema';
import { Effect, Option, pipe } from 'effect';

import { type Graph, type Project, type ProjectMap, ProjectMapSchema, SCHEMA_DEFAULTS } from './schema.ts';

// --- Type Definitions --------------------------------------------------------

type NxGraph = {
    readonly graph: {
        readonly dependencies: Record<
            string,
            ReadonlyArray<{ readonly source: string; readonly target: string; readonly type: string }>
        >;
        readonly nodes: Record<
            string,
            {
                readonly data: { readonly root: string; readonly sourceRoot?: string };
                readonly name: string;
                readonly type: string;
            }
        >;
    };
};

type PackageJson = {
    readonly exports?: Record<
        string,
        { readonly import?: string; readonly require?: string; readonly types?: string } | string
    >;
    readonly name?: string;
    readonly packageManager?: string;
    readonly version?: string;
};

type TsConfig = {
    readonly compilerOptions?: {
        readonly paths?: Record<string, ReadonlyArray<string>>;
    };
};

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    files: {
        nxGraph: '.nx/graph.json',
        output: 'docs/agent-context/project-map.json',
        packageJson: 'package.json',
        tsconfig: 'tsconfig.base.json',
    },
    nx: {
        command: 'nx graph --file=.nx/graph.json',
        timeout: 60000,
    },
} as const);

// --- Pure Utility Functions --------------------------------------------------

const safeJsonParse = Option.liftThrowable(JSON.parse);

const readJson = <T>(path: string): Option.Option<T> =>
    pipe(
        Option.fromNullable(existsSync(path) ? path : undefined),
        Option.flatMap((p) => pipe(Option.some(readFileSync(p, 'utf-8')), Option.flatMap(safeJsonParse))),
    ) as Option.Option<T>;

const extractExports = (pkgJson: PackageJson): Project['exports'] =>
    pipe(
        Option.fromNullable(pkgJson.exports),
        Option.map((exports) =>
            Object.fromEntries(
                Object.entries(exports).map(([key, value]) => [
                    key,
                    typeof value === 'string'
                        ? { import: value }
                        : { import: value.import, require: value.require, types: value.types },
                ]),
            ),
        ),
        Option.getOrElse(() => SCHEMA_DEFAULTS.defaults.exports),
    );

const extractPublicApi = (exports: Project['exports']): ReadonlyArray<string> =>
    Object.keys(exports).filter((k) => k !== '.' && !k.startsWith('./internal'));

const parseImportAliases = (tsconfig: TsConfig): ReadonlyArray<{ alias: string; path: string }> =>
    pipe(
        Option.fromNullable(tsconfig.compilerOptions?.paths),
        Option.map((paths) =>
            Object.entries(paths).map(([alias, targets]) => ({
                alias: alias.replace('/*', ''),
                path: (targets[0] ?? '').replace('/*', ''),
            })),
        ),
        Option.getOrElse(() => []),
    );

const buildAdjacency = (edges: Graph['edges']): Map<string, ReadonlyArray<string>> =>
    edges.reduce((acc, { source, target }) => {
        acc.set(source, [...(acc.get(source) ?? []), target]);
        return acc;
    }, new Map<string, ReadonlyArray<string>>());

const detectCycles = (edges: Graph['edges']): ReadonlyArray<ReadonlyArray<string>> => {
    const adjacency = buildAdjacency(edges);
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: Array<ReadonlyArray<string>> = [];

    const dfs = (node: string, path: ReadonlyArray<string>): void => {
        visited.add(node);
        recursionStack.add(node);

        const neighbors = adjacency.get(node) ?? [];
        for (const neighbor of neighbors) {
            recursionStack.has(neighbor)
                ? cycles.push([...path.slice(path.indexOf(neighbor)), neighbor])
                : !visited.has(neighbor) && dfs(neighbor, [...path, neighbor]);
        }

        recursionStack.delete(node);
    };

    for (const node of adjacency.keys()) {
        !visited.has(node) && dfs(node, [node]);
    }

    return cycles;
};

// --- Effect Pipeline ---------------------------------------------------------

const generateNxGraph = (): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.try({
            catch: (e) => new Error(`[ERROR] Failed to generate Nx graph: ${String(e)}`),
            try: () => execSync(B.nx.command, { encoding: 'utf-8', timeout: B.nx.timeout }),
        }),
        Effect.as(undefined),
    );

const loadNxGraph = (root: string): Effect.Effect<NxGraph, Error, never> =>
    pipe(
        Effect.try({
            catch: () => new Error(`[ERROR] Nx graph not found at ${B.files.nxGraph}`),
            try: () => readJson<NxGraph>(join(root, B.files.nxGraph)),
        }),
        Effect.flatMap((opt) =>
            pipe(
                opt,
                Option.match({
                    onNone: () => Effect.fail(new Error(`[ERROR] Failed to parse ${B.files.nxGraph}`)),
                    onSome: Effect.succeed,
                }),
            ),
        ),
    );

const loadWorkspaceInfo = (root: string): Effect.Effect<{ nxVersion: string; packageManager: string }, Error, never> =>
    pipe(
        Effect.try({
            catch: () => new Error('[ERROR] Failed to read workspace package.json'),
            try: () => readJson<PackageJson>(join(root, B.files.packageJson)),
        }),
        Effect.flatMap((opt) =>
            pipe(
                opt,
                Option.match({
                    onNone: () => Effect.fail(new Error('[ERROR] package.json not found')),
                    onSome: (pkg) =>
                        Effect.succeed({
                            nxVersion: pipe(
                                readJson<{ installation?: { version?: string } }>(join(root, 'nx.json')),
                                Option.flatMap((nx) => Option.fromNullable(nx.installation?.version)),
                                Option.getOrElse(() => 'unknown'),
                            ),
                            packageManager: pkg.packageManager ?? 'unknown',
                        }),
                }),
            ),
        ),
    );

const loadTsConfig = (root: string): Effect.Effect<TsConfig, Error, never> =>
    pipe(
        Effect.try({
            catch: () => new Error('[ERROR] Failed to read tsconfig.base.json'),
            try: () => readJson<TsConfig>(join(root, B.files.tsconfig)),
        }),
        Effect.map((opt) => Option.getOrElse(opt, () => ({}))),
    );

const buildProjects = (root: string, nxGraph: NxGraph): Record<string, Project> =>
    Object.entries(nxGraph.graph.nodes).reduce(
        (acc, [name, node]) => {
            const projectRoot = join(root, node.data.root);
            const pkgJsonPath = join(projectRoot, 'package.json');

            const pkgJson = pipe(
                readJson<PackageJson>(pkgJsonPath),
                Option.getOrElse(() => ({})),
            );

            const exports = extractExports(pkgJson);
            const dependencies = (nxGraph.graph.dependencies[name] ?? []).map((d) => d.target);

            acc[name] = {
                dependencies,
                exports,
                name,
                publicApi: [...extractPublicApi(exports)],
                root: node.data.root,
                sourceRoot: node.data.sourceRoot ?? join(node.data.root, 'src'),
                type: (node.type === 'app' ? 'app' : 'library') as 'app' | 'library',
            };
            return acc;
        },
        {} as Record<string, Project>,
    );

const buildProjectMap = (
    root: string,
    nxGraph: NxGraph,
    workspaceInfo: { nxVersion: string; packageManager: string },
    tsconfig: TsConfig,
): Effect.Effect<ProjectMap, Error, never> =>
    pipe(
        Effect.try({
            catch: (e) => new Error(`[ERROR] Failed to build project map: ${String(e)}`),
            try: () => {
                const projects = buildProjects(root, nxGraph);

                const edges = Object.entries(nxGraph.graph.dependencies).flatMap(([source, deps]) =>
                    deps.map((dep) => ({
                        source,
                        target: dep.target,
                        type: (dep.type === 'static' ? 'static' : dep.type === 'dynamic' ? 'dynamic' : 'implicit') as
                            | 'static'
                            | 'dynamic'
                            | 'implicit',
                    })),
                );

                const graph: Graph = {
                    cycles: [...detectCycles(edges)],
                    edges,
                    nodes: Object.entries(nxGraph.graph.nodes).map(([name, node]) => ({
                        name,
                        type: (node.type === 'app' ? 'app' : 'library') as 'app' | 'library',
                    })),
                };

                return {
                    generatedAt: new Date().toISOString(),
                    graph,
                    imports: [...parseImportAliases(tsconfig)],
                    projects,
                    version: SCHEMA_DEFAULTS.version,
                    workspace: {
                        nxVersion: workspaceInfo.nxVersion,
                        packageManager: workspaceInfo.packageManager,
                        root,
                    },
                } satisfies ProjectMap;
            },
        }),
    );

const writeProjectMap = (root: string, projectMap: ProjectMap): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.try({
            catch: (e) => new Error(`[ERROR] Failed to validate project map: ${String(e)}`),
            try: () => S.decodeUnknownSync(ProjectMapSchema)(projectMap),
        }),
        Effect.flatMap((validated) =>
            Effect.try({
                catch: (e) => new Error(`[ERROR] Failed to write project map: ${String(e)}`),
                try: () => {
                    const outputPath = join(root, B.files.output);
                    const outputDir = dirname(outputPath);
                    existsSync(outputDir) || execSync(`mkdir -p "${outputDir}"`, { encoding: 'utf-8' });
                    writeFileSync(outputPath, `${JSON.stringify(validated, null, 4)}\n`);
                    execSync(`pnpm biome format --write ${outputPath}`, { encoding: 'utf-8' });
                },
            }),
        ),
    );

const main = (): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.sync(() => resolve(process.cwd())),
        Effect.tap(() => Effect.log('[INFO] Generating Nx project graph...')),
        Effect.tap(() => generateNxGraph()),
        Effect.tap(() => Effect.log('[INFO] Loading project data...')),
        Effect.flatMap((root) =>
            pipe(
                Effect.all({
                    nxGraph: loadNxGraph(root),
                    tsconfig: loadTsConfig(root),
                    workspaceInfo: loadWorkspaceInfo(root),
                }),
                Effect.flatMap(({ nxGraph, tsconfig, workspaceInfo }) =>
                    buildProjectMap(root, nxGraph, workspaceInfo, tsconfig),
                ),
                Effect.tap((projectMap) =>
                    Effect.log(`[INFO] Found ${Object.keys(projectMap.projects).length} projects`),
                ),
                Effect.flatMap((projectMap) => writeProjectMap(root, projectMap)),
            ),
        ),
        Effect.tap(() => Effect.log(`[OK] Project map written to ${B.files.output}`)),
    );

// --- Export ------------------------------------------------------------------

export { B as CONTEXT_CONFIG, main };

// --- CLI Execution -----------------------------------------------------------

Effect.runPromise(main()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
