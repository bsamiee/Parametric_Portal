#!/usr/bin/env tsx
/**
 * Changed Detection Script: Nx 22 Crystal-integrated change detection with three modes.
 * Uses B.changes constant, dispatch tables (detectionStrategies), and Effect pipelines.
 */

import { spawnSync } from 'node:child_process';
import { B, fn } from './schema.ts';

// --- Types -------------------------------------------------------------------

type DetectionMode = (typeof B.changes.detection.modes)[number];

type ChangeStats = {
    readonly added: number;
    readonly modified: number;
    readonly deleted: number;
};

type DetectionResult = {
    readonly affectedProjects: ReadonlyArray<string>;
    readonly changedFiles: ReadonlyArray<string>;
    readonly hasChanges: boolean;
    readonly matrix: MatrixConfig | null;
    readonly mode: DetectionMode;
    readonly stats: ChangeStats;
};

type MatrixConfig = {
    readonly include: ReadonlyArray<{
        readonly project: string;
        readonly target: string;
    }>;
};

type Env = {
    readonly baseSha: string;
    readonly changedFiles: string;
    readonly globsPattern: string;
    readonly headSha: string;
    readonly mode: string;
};

type RunParams = {
    readonly context: {
        readonly payload: unknown;
        readonly repo: { owner: string; repo: string };
        readonly sha: string;
    };
    readonly core: { readonly info: (m: string) => void };
    readonly env: Env;
    readonly github: unknown;
};

// --- Utilities ---------------------------------------------------------------

const execCmd = (cmd: string): string => {
    const result = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return result.status === 0 ? result.stdout.trim() : '';
};

const parseJson = <T>(str: string, fallback: T): T => (str ? (JSON.parse(str) as T) : fallback);

const filterByGlobs = (files: ReadonlyArray<string>, patterns: ReadonlyArray<string>): ReadonlyArray<string> =>
    patterns.length === 0 ? files : files.filter((f) => fn.globMatch(f, patterns));

const getNxBaseSha = (): string => {
    const nxBase = execCmd('pnpm exec nx show projects --affected --base=HEAD^ --json 2>/dev/null');
    return nxBase ? 'HEAD^' : execCmd('git merge-base origin/main HEAD 2>/dev/null || echo HEAD^');
};

const getNxAffectedProjects = (baseSha: string): ReadonlyArray<string> => {
    const cmd = `pnpm exec nx show projects --affected --base=${baseSha} --json 2>/dev/null`;
    const output = execCmd(cmd);
    return output ? parseJson<ReadonlyArray<string>>(output, []) : [];
};

const computeStats = (files: ReadonlyArray<string>): ChangeStats => {
    const statusMap = Object.fromEntries(
        files.map((f) => {
            const status = execCmd(`git diff --name-status HEAD^ HEAD -- "${f}" 2>/dev/null`).split('\t')[0];
            return [f, status];
        }),
    );

    return {
        added: files.filter((f) => statusMap[f] === 'A').length,
        deleted: files.filter((f) => statusMap[f] === 'D').length,
        modified: files.filter((f) => statusMap[f] === 'M').length,
    };
};

// --- Dispatch Tables ---------------------------------------------------------

const detectionHandlers: {
    readonly [K in DetectionMode]: (
        files: ReadonlyArray<string>,
        globs: ReadonlyArray<string>,
        baseSha: string,
    ) => DetectionResult;
} = {
    comprehensive: (files, globs, baseSha) => {
        const filtered = filterByGlobs(files, globs);
        const affected = getNxAffectedProjects(baseSha);
        const stats = computeStats(filtered);

        // Comprehensive mode: include dependency analysis
        const depAnalysis = affected.map((proj) => {
            const deps = execCmd(`pnpm exec nx show project ${proj} --json 2>/dev/null`);
            return deps ? parseJson<{ implicitDependencies?: ReadonlyArray<string> }>(deps, {}) : {};
        });

        // Flatten implicit dependencies (avoid spread in reduce)
        const implicitDeps: Array<string> = [];
        for (const d of depAnalysis) {
            const deps = d.implicitDependencies ?? [];
            for (const dep of deps) {
                implicitDeps.push(dep);
            }
        }

        // Deduplicate using object keys (avoid forEach)
        const allAffectedMap: Record<string, true> = {};
        for (const proj of [...affected, ...implicitDeps]) {
            allAffectedMap[proj] = true;
        }
        const allAffected = Object.keys(allAffectedMap);

        return {
            affectedProjects: allAffected,
            changedFiles: filtered,
            hasChanges: filtered.length > 0,
            matrix: null,
            mode: 'comprehensive',
            stats,
        };
    },
    fast: (files, globs, baseSha) => {
        const filtered = filterByGlobs(files, globs);
        const affected = getNxAffectedProjects(baseSha);
        const stats = computeStats(filtered);

        return {
            affectedProjects: affected,
            changedFiles: filtered,
            hasChanges: filtered.length > 0,
            matrix: null,
            mode: 'fast',
            stats,
        };
    },
    matrix: (files, globs, baseSha) => {
        const filtered = filterByGlobs(files, globs);
        const affected = getNxAffectedProjects(baseSha);
        const stats = computeStats(filtered);

        // Matrix mode: generate matrix config for parallel execution
        const targets = ['build', 'test', 'lint', 'typecheck'] as const;
        const include: Array<{ project: string; target: string }> = [];
        for (const project of affected) {
            for (const target of targets) {
                include.push({ project, target });
            }
        }

        const matrix: MatrixConfig = { include };

        return {
            affectedProjects: affected,
            changedFiles: filtered,
            hasChanges: filtered.length > 0,
            matrix,
            mode: 'matrix',
            stats,
        };
    },
} as const;

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams): Promise<DetectionResult> => {
    const { core, env } = params;

    // Parse inputs
    const isModeValid = B.changes.detection.modes.some((m) => m === env.mode);
    const mode = (isModeValid ? env.mode : B.changes.detection.modes[0]) as DetectionMode;

    const changedFiles = parseJson<ReadonlyArray<string>>(env.changedFiles, []);
    const globs = env.globsPattern
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    // Determine base SHA (priority: input > nx-set-shas > fallback)
    const baseSha = env.baseSha || getNxBaseSha();

    core.info(`[Changed Detection] Mode: ${mode}, Base SHA: ${baseSha}`);
    core.info(`[Changed Detection] Files: ${changedFiles.length}, Globs: ${globs.length}`);

    // Dispatch to appropriate handler
    const result = detectionHandlers[mode](changedFiles, globs, baseSha);

    core.info(`[Changed Detection] ✓ Affected projects: ${result.affectedProjects.length}`);
    core.info(`[Changed Detection] ✓ Stats: +${result.stats.added} ~${result.stats.modified} -${result.stats.deleted}`);

    return result;
};

// --- Export ------------------------------------------------------------------

export { run };
export type { DetectionResult, DetectionMode, RunParams };
