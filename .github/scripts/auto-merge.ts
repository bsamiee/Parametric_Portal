#!/usr/bin/env tsx
/**
 * Auto-merge decision engine: classifies bot PRs by version type, merges/blocks accordingly.
 * Uses B.dashboard.bots, B.labels, fn.classify, mutate from schema.ts.
 */

import { B, type Ctx, createCtx, fn, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type MergeSpec = {
    readonly prNumber: number;
    readonly actor: string;
    readonly sha: string;
    readonly labels: ReadonlyArray<string>;
    readonly title: string;
};
type MergeResult = {
    readonly action: 'merge' | 'block' | 'skip';
    readonly reason: ReasonKey;
    readonly eligible: boolean;
};
type ReasonKey = 'security' | 'patch' | 'minor' | 'major' | 'breaking' | 'canary' | 'not-bot' | 'no-decision';
type BotKey = 'dependabot' | 'renovate' | 'unknown';
type Decision = { readonly eligible: boolean; readonly reason: ReasonKey };
type Rule<V> = { readonly pattern: RegExp; readonly value: V };

// --- Constants ---------------------------------------------------------------

const M = Object.freeze({
    bots: {
        dependabot: 'dependabot[bot]',
        renovate: 'renovate[bot]',
    } as const,
    decisions: {
        breaking: { eligible: false, reason: 'breaking' } as Decision,
        // Canary/unstable versions need review
        canary: { eligible: false, reason: 'canary' } as Decision,
        // Default: no auto-decision (fail-safe)
        default: { eligible: false, reason: 'no-decision' } as Decision,
        // Major versions need review
        major: { eligible: false, reason: 'major' } as Decision,
        minor: { eligible: true, reason: 'minor' } as Decision,
        'no-decision': { eligible: false, reason: 'no-decision' } as Decision,
        'not-bot': { eligible: false, reason: 'not-bot' } as Decision,
        patch: { eligible: true, reason: 'patch' } as Decision,
        security: { eligible: true, reason: 'security' } as Decision,
    } as const,
    labels: {
        breaking: B.breaking.label,
        security: B.labels.special.security,
    } as const,
    messages: {
        breaking: '[WARN] **Auto-merge blocked**: Breaking change requires manual review.',
        canary: '[WARN] **Auto-merge blocked**: Canary/unstable version requires manual review.',
        major: '[WARN] **Auto-merge blocked**: Major version update requires manual review.',
    } as const,
    titleRules: [
        { pattern: /canary|beta|rc|alpha|preview|nightly/i, value: 'canary' },
        { pattern: /major/i, value: 'major' },
        { pattern: /minor/i, value: 'minor' },
        { pattern: /patch|digest/i, value: 'patch' },
    ] as ReadonlyArray<Rule<ReasonKey>>,
} as const);

// --- Pure Functions ----------------------------------------------------------

const identifyBot = (actor: string): BotKey =>
    actor === M.bots.dependabot ? 'dependabot' : actor === M.bots.renovate ? 'renovate' : 'unknown';

const hasLabel = (labels: ReadonlyArray<string>, target: string): boolean =>
    labels.some((l) => l.toLowerCase() === target.toLowerCase());

const classifyByLabels = (labels: ReadonlyArray<string>): Decision | null =>
    hasLabel(labels, M.labels.security)
        ? M.decisions.security
        : hasLabel(labels, M.labels.breaking)
          ? M.decisions.breaking
          : null;

const classifyByTitle = (title: string): Decision =>
    ((reason) => M.decisions[reason] ?? M.decisions.default)(
        fn.classify(title, M.titleRules, 'no-decision' as ReasonKey),
    );

// --- Dispatch Tables ---------------------------------------------------------

const botHandlers: Record<BotKey, (spec: MergeSpec) => Decision> = {
    dependabot: (spec) => classifyByLabels(spec.labels) ?? classifyByTitle(spec.title),
    renovate: (spec) => classifyByLabels(spec.labels) ?? classifyByTitle(spec.title),
    unknown: () => ({ eligible: false, reason: 'not-bot' }),
};

// --- Effect Pipeline ---------------------------------------------------------

const decide = (spec: MergeSpec): Decision => botHandlers[identifyBot(spec.actor)](spec);
const execute = async (ctx: Ctx, spec: MergeSpec, decision: Decision): Promise<MergeResult> => {
    const actions = {
        block: async (): Promise<MergeResult> => {
            const message = M.messages[decision.reason as keyof typeof M.messages];
            message &&
                (await mutate(ctx, {
                    body: `${message}\n\nIf this fixes a security vulnerability, add the \`security\` label to enable auto-merge.`,
                    marker: 'AUTO-MERGE-BLOCK',
                    n: spec.prNumber,
                    t: 'comment',
                }));
            return { action: 'block', eligible: false, reason: decision.reason };
        },
        merge: async (): Promise<MergeResult> => {
            await ctx.github.rest.pulls.merge({
                merge_method: 'squash',
                owner: ctx.owner,
                pull_number: spec.prNumber,
                repo: ctx.repo,
            });
            return { action: 'merge', eligible: true, reason: decision.reason };
        },
        skip: async (): Promise<MergeResult> => ({ action: 'skip', eligible: false, reason: decision.reason }),
    };
    const action = decision.eligible ? 'merge' : decision.reason === 'not-bot' ? 'skip' : 'block';
    return actions[action]();
};

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: MergeSpec }): Promise<MergeResult> => {
    const ctx = createCtx(params);
    const decision = decide(params.spec);
    const result = await execute(ctx, params.spec, decision);
    params.core.info(`[AUTO-MERGE] PR #${params.spec.prNumber}: ${result.action} (reason: ${result.reason})`);
    return result;
};

// --- Export ------------------------------------------------------------------

export { run };
export type { MergeResult, MergeSpec };
