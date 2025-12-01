#!/usr/bin/env tsx
/**
 * Merge gating: blocks canary/major versions, enforces mutation thresholds, creates migration issues.
 * Uses B.breaking, BodySpec, fn.classify, fn.body, call, mutate, md from schema.ts.
 */
import { B, type BodySpec, call, createCtx, fn, md, mutate, type RunParams } from './schema.ts';

// --- Constants ---------------------------------------------------------------

type ReasonKey = 'canary' | 'major' | 'mutation';
type GateClass = { readonly eligible: boolean; readonly reason?: ReasonKey };
type Rule<V> = { readonly pattern: RegExp; readonly value: V };

const GATING = Object.freeze({
    actions: {
        canary: '',
        major: 'Review breaking changes and create migration checklist.',
        mutation: 'Improve test coverage to reach mutation score threshold.',
    } as const,
    body: {
        block: [
            { kind: 'heading', level: 2, text: '{{title}}' },
            { kind: 'field', label: 'Reason', value: '{{reason}}' },
            { kind: 'timestamp' },
            { kind: 'heading', level: 3, text: 'Action Required' },
            { content: '{{action}}', kind: 'text' },
        ] as BodySpec,
        migration: [
            { kind: 'heading', level: 2, text: 'Migration: {{package}}' },
            { kind: 'field', label: 'Version', value: 'v{{version}}' },
            { kind: 'field', label: 'Source PR', value: '#{{pr}}' },
            { kind: 'heading', level: 3, text: 'Checklist' },
            {
                items: [
                    { text: 'Review breaking changes' },
                    { text: 'Update affected code' },
                    { text: 'Run full test suite' },
                ],
                kind: 'task',
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
        { pattern: /major/i, value: { eligible: false, reason: 'major' } },
        { pattern: /canary|beta|rc|alpha|preview/i, value: { eligible: false, reason: 'canary' } },
        { pattern: /minor/i, value: { eligible: true } },
        { pattern: /patch/i, value: { eligible: true } },
    ] as ReadonlyArray<Rule<GateClass>>,
} as const);

// --- Types -------------------------------------------------------------------

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

// --- Pure Functions ----------------------------------------------------------

const parsePackage = (title: string): { readonly pkg: string; readonly version: string } | null =>
    ((match) => match && { pkg: match[1], version: match[2] })(title.match(GATING.patterns.package)) ?? null;

const extractScore = (runs: ReadonlyArray<CheckRun>, checkName: string): number =>
    parseInt(runs.find((run) => run.name === checkName)?.output?.summary?.match(GATING.patterns.score)?.[1] ?? '0', 10);

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: GateSpec }): Promise<GateResult> => {
    const ctx = createCtx(params);
    const spec = params.spec;
    const classification = fn.classify(spec.title.toLowerCase(), GATING.rules, GATING.default);

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
    classification.reason &&
        (await ops.block(GATING.messages[classification.reason], GATING.actions[classification.reason]));
    const mutationResult = classification.eligible ? await ops.checkMutation() : { passed: true, score: 100 };
    const eligible = classification.eligible && mutationResult.passed;
    !mutationResult.passed &&
        classification.eligible &&
        (await ops.block(
            `${GATING.messages.mutation} (${mutationResult.score}% < ${B.algo.mutationPct}%)`,
            GATING.actions.mutation,
        ));
    classification.reason === 'major' &&
        (spec.migrate ?? true) &&
        (await ((parsed) => (parsed ? ops.migrate(parsed.pkg, parsed.version) : Promise.resolve()))(
            parsePackage(spec.title),
        ));
    params.core.info(`Gate: ${eligible ? 'eligible' : 'blocked'} (${classification.reason ?? 'ok'})`);
    return { eligible };
};

// --- Export ------------------------------------------------------------------

export { run };
export type { GateResult, GateSpec };
