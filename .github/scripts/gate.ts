#!/usr/bin/env tsx
/**
 * PR merge eligibility checker with mutation score verification.
 * Classifies PRs by version type, blocks ineligible merges, creates migration issues.
 */

import { B, type BodySpec, call, createCtx, fn, md, mutate, type RunParams } from './schema.ts';

// --- Domain Config (GATING) -------------------------------------------------

type ReasonKey = 'canary' | 'major' | 'mutation';
type GateClass = { readonly eligible: boolean; readonly reason?: ReasonKey };
type Rule<V> = { readonly p: RegExp; readonly v: V };

const GATING = Object.freeze({
    actions: {
        canary: '',
        major: 'Review breaking changes and create migration checklist.',
        mutation: 'Improve test coverage to reach mutation score threshold.',
    } as const,
    body: {
        block: [
            { k: 'heading', level: 2, text: '{{title}}' },
            { k: 'field', l: 'Reason', v: '{{reason}}' },
            { k: 'timestamp' },
            { k: 'heading', level: 3, text: 'Action Required' },
            { content: '{{action}}', k: 'text' },
        ] as BodySpec,
        migration: [
            { k: 'heading', level: 2, text: 'Migration: {{package}}' },
            { k: 'field', l: 'Version', v: 'v{{version}}' },
            { k: 'field', l: 'Source PR', v: '#{{pr}}' },
            { k: 'heading', level: 3, text: 'Checklist' },
            {
                items: [
                    { text: 'Review breaking changes' },
                    { text: 'Update affected code' },
                    { text: 'Run full test suite' },
                ],
                k: 'task',
            },
        ] as BodySpec,
    } as const,
    default: { eligible: false, reason: 'major' } as GateClass,
    messages: {
        canary: 'Canary/beta/rc version requires manual review.',
        major: 'Major version update requires manual review.',
        mutation: 'Mutation score below threshold.',
    } as const,
    patterns: { package: /update ([\w\-@/]+) to v?(\d+)/i, score: /(\d+)%/ } as const,
    rules: [
        { p: /major/i, v: { eligible: false, reason: 'major' } },
        { p: /canary|beta|rc|alpha|preview/i, v: { eligible: false, reason: 'canary' } },
        { p: /minor/i, v: { eligible: true } },
        { p: /patch/i, v: { eligible: true } },
    ] as ReadonlyArray<Rule<GateClass>>,
} as const);

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

// --- Helpers ----------------------------------------------------------------

const parsePackage = (title: string): { readonly pkg: string; readonly version: string } | null =>
    ((m) => m && { pkg: m[1], version: m[2] })(title.match(GATING.patterns.package)) ?? null;

const extractScore = (runs: ReadonlyArray<CheckRun>, checkName: string): number =>
    parseInt(runs.find((r) => r.name === checkName)?.output?.summary?.match(GATING.patterns.score)?.[1] ?? '0', 10);

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: GateSpec }): Promise<GateResult> => {
    const ctx = createCtx(params);
    const spec = params.spec;
    const c = fn.classify(spec.title.toLowerCase(), GATING.rules, GATING.default);

    const ops = {
        block: async (reason: string, action: string): Promise<void> => {
            await mutate(ctx, { action: 'add', labels: [spec.label], n: spec.number, t: 'label' });
            await mutate(ctx, {
                body: fn.body(GATING.body.block as BodySpec, {
                    action,
                    reason,
                    title: spec.blockTitle ?? '[BLOCKED] Auto-merge blocked',
                }),
                marker: md.marker('GATE-BLOCK'),
                mode: 'replace',
                n: spec.number,
                t: 'comment',
            });
        },
        checkMutation: async (): Promise<{ readonly passed: boolean; readonly score: number }> =>
            ((runs) =>
                ((score) => ({ passed: score >= B.algo.mutationPct, score }))(
                    extractScore(runs, spec.check ?? 'mutation-score'),
                ))(((await call(ctx, 'check.listForRef', spec.sha)) ?? []) as ReadonlyArray<CheckRun>),
        migrate: async (pkg: string, version: string): Promise<void> =>
            mutate(ctx, {
                body: fn.body(GATING.body.migration as BodySpec, { package: pkg, pr: String(spec.number), version }),
                label: 'dependencies',
                labels: ['dependencies', 'migration', 'priority/high'],
                mode: 'append',
                pattern: `Migration: ${pkg}`,
                t: 'issue',
                title: `Migration: ${pkg} v${version}`,
            }),
    };
    c.reason && (await ops.block(GATING.messages[c.reason], GATING.actions[c.reason]));
    const mutationResult = c.eligible ? await ops.checkMutation() : { passed: true, score: 100 };
    const eligible = c.eligible && mutationResult.passed;
    !mutationResult.passed &&
        c.eligible &&
        (await ops.block(
            `${GATING.messages.mutation} (${mutationResult.score}% < ${B.algo.mutationPct}%)`,
            GATING.actions.mutation,
        ));
    c.reason === 'major' &&
        (spec.migrate ?? true) &&
        (await ((p) => (p ? ops.migrate(p.pkg, p.version) : Promise.resolve()))(parsePackage(spec.title)));
    params.core.info(`Gate: ${eligible ? 'eligible' : 'blocked'} (${c.reason ?? 'ok'})`);
    return { eligible };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { GateResult, GateSpec };
