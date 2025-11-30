#!/usr/bin/env tsx
/**
 * Failure alert issue creator for CI and security workflows.
 * Creates or updates issues with failure details and action items.
 */

import { type BodySpec, createCtx, fn, mutate, type RunParams } from './schema.ts';

// --- Domain Config (ALERTS) -------------------------------------------------

type DebtClass = { readonly labels: ReadonlyArray<string>; readonly type: string };
type Rule<V> = { readonly pattern: RegExp; readonly value: V };

const ALERTS = Object.freeze({
    ci: {
        body: [
            { k: 'heading', level: 2, text: 'CI Failure' },
            { k: 'field', l: 'Run', v: '{{runUrl}}' },
            { k: 'field', l: 'Job', v: '{{job}}' },
            { k: 'timestamp' },
            { k: 'heading', level: 3, text: 'Action Required' },
            { content: 'Review the failed CI run and address the issues before merging.', k: 'text' },
        ] as BodySpec,
        default: { labels: ['tech-debt', 'refactor'], type: 'Quality' } as DebtClass,
        pattern: 'Debt:',
        rules: [
            { pattern: /build/i, value: { labels: ['tech-debt', 'performance'], type: 'Performance' } },
            { pattern: /compression/i, value: { labels: ['tech-debt', 'performance'], type: 'Performance' } },
            { pattern: /mutate/i, value: { labels: ['tech-debt', 'testing'], type: 'Mutation' } },
            { pattern: /test/i, value: { labels: ['tech-debt', 'testing'], type: 'Mutation' } },
        ] as ReadonlyArray<Rule<DebtClass>>,
    },
    security: {
        body: [
            { k: 'heading', level: 2, text: 'Security Scan Alert' },
            { k: 'timestamp' },
            { k: 'field', l: 'Run', v: '{{runUrl}}' },
            { k: 'heading', level: 3, text: 'Action Required' },
            { content: 'Security vulnerabilities or compliance issues have been detected.', k: 'text' },
            { k: 'heading', level: 3, text: 'Next Steps' },
            {
                items: ['Review the failed job', 'Address critical issues', 'Update dependencies', 'Re-run scan'],
                k: 'list',
                ordered: true,
            },
        ] as BodySpec,
        labels: ['security', 'priority/critical'] as const,
        pattern: 'Security Scan',
        title: '[SECURITY] Security Scan Alert',
    },
} as const);

// --- Types ------------------------------------------------------------------

type AlertSpec =
    | { readonly kind: 'ci'; readonly job: string; readonly runUrl: string }
    | { readonly kind: 'security'; readonly runUrl: string };

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: AlertSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const spec = params.spec;
    const cfg =
        spec.kind === 'ci'
            ? ((classification) => ({
                  body: fn.body(ALERTS.ci.body, { job: spec.job, runUrl: spec.runUrl }),
                  labels: classification.labels,
                  pattern: ALERTS.ci.pattern,
                  title: `${classification.type} Debt: CI Failure`,
              }))(fn.classify(spec.job, ALERTS.ci.rules, ALERTS.ci.default))
            : {
                  body: fn.body(ALERTS.security.body, { runUrl: spec.runUrl }),
                  labels: [...ALERTS.security.labels],
                  pattern: ALERTS.security.pattern,
                  title: ALERTS.security.title,
              };
    await mutate(ctx, {
        body: cfg.body,
        label: cfg.labels[0],
        labels: [...cfg.labels],
        pattern: cfg.pattern,
        t: 'issue',
        title: cfg.title,
    });
    params.core.info(`${spec.kind} alert created/updated`);
};

// --- Export -----------------------------------------------------------------

export { run };
export type { AlertSpec };
