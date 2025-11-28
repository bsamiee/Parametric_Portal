#!/usr/bin/env tsx
/**
 * PR merge eligibility checker with mutation score verification.
 * Classifies PRs by version type, blocks ineligible merges, creates migration issues.
 */

import { B, type BodySpec, call, createCtx, fn, mutate, type RunParams } from './schema.ts';

// --- Types ------------------------------------------------------------------

type CheckRun = { readonly name: string; readonly output?: { readonly summary?: string } };
type GateSpec = {
    readonly number: number;
    readonly sha: string;
    readonly title: string;
    readonly label: string;
    readonly check?: string;
    readonly blockTitle?: string;
    readonly migrate?: boolean;
};
type GateResult = { readonly eligible: boolean };

// --- Pure Functions ---------------------------------------------------------

const parsePackage = (title: string): { readonly pkg: string; readonly version: string } | null =>
    ((m) => m && { pkg: m[1], version: m[2] })(title.match(B.gating.patterns.package)) ?? null;

const extractScore = (runs: ReadonlyArray<CheckRun>, checkName: string): number =>
    parseInt(runs.find((r) => r.name === checkName)?.output?.summary?.match(B.gating.patterns.score)?.[1] ?? '0', 10);

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: GateSpec }): Promise<GateResult> => {
    const ctx = createCtx(params);
    const spec = params.spec;
    const c = fn.classifyGating(spec.title);

    const ops = {
        block: async (reason: string, action: string): Promise<void> => {
            await mutate(ctx, { action: 'add', labels: [spec.label], n: spec.number, t: 'label' });
            await mutate(ctx, {
                body: fn.body(B.gating.body.block as BodySpec, {
                    action,
                    reason,
                    title: spec.blockTitle ?? B.gating.defaults.title,
                }),
                marker: B.gen.marker(B.gating.defaults.marker),
                mode: 'replace',
                n: spec.number,
                t: 'comment',
            });
        },
        checkMutation: async (): Promise<{ readonly passed: boolean; readonly score: number }> =>
            ((runs) =>
                ((score) => ({ passed: score >= B.algo.mutationPct, score }))(
                    extractScore(runs, spec.check ?? B.gating.defaults.check),
                ))(((await call(ctx, 'check.listForRef', spec.sha)) ?? []) as ReadonlyArray<CheckRun>),
        migrate: async (pkg: string, version: string): Promise<void> =>
            mutate(ctx, {
                body: fn.body(B.gating.body.migration as BodySpec, { package: pkg, pr: String(spec.number), version }),
                label: B.gating.defaults.migrationLabels[0],
                labels: [...B.gating.defaults.migrationLabels],
                mode: 'append',
                pattern: `${B.gating.defaults.migrationPattern} ${pkg}`,
                t: 'issue',
                title: `${B.gating.defaults.migrationPattern} ${pkg} v${version}`,
            }),
    };
    c.reason && (await ops.block(B.gating.messages[c.reason], B.gating.actions[c.reason]));
    const mutationResult = c.eligible ? await ops.checkMutation() : { passed: true, score: 100 };
    const eligible = c.eligible && mutationResult.passed;
    !mutationResult.passed &&
        c.eligible &&
        (await ops.block(
            `${B.gating.messages.mutation} (${mutationResult.score}% < ${B.algo.mutationPct}%)`,
            B.gating.actions.mutation,
        ));
    c.reason === 'major' &&
        (spec.migrate ?? B.gating.defaults.migrate) &&
        (await ((p) => (p ? ops.migrate(p.pkg, p.version) : Promise.resolve()))(parsePackage(spec.title)));
    params.core.info(`Gate: ${eligible ? 'eligible' : 'blocked'} (${c.reason ?? 'ok'})`);
    return { eligible };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { GateResult, GateSpec };
