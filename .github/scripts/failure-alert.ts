#!/usr/bin/env tsx
/**
 * Failure alerting: creates/updates issues for CI failures and security scan results.
 * Uses BodySpec, fn.classify, fn.body, mutate from schema.ts.
 */
import { type BodySpec, createCtx, fn, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type DebtClassification = { readonly labels: ReadonlyArray<string>; readonly type: string };
type Rule<V> = { readonly pattern: RegExp; readonly value: V };
type AlertSpec =
    | { readonly kind: 'ci'; readonly job: string; readonly runUrl: string }
    | { readonly kind: 'security'; readonly runUrl: string };

// --- Constants ---------------------------------------------------------------

const alertSpecs = Object.freeze({
    ci: {
        body: [
            { kind: 'heading', level: 2, text: 'CI Failure' },
            { kind: 'field', label: 'Run', value: '{{runUrl}}' },
            { kind: 'field', label: 'Job', value: '{{job}}' },
            { kind: 'timestamp' },
            { kind: 'heading', level: 3, text: 'Action Required' },
            { content: 'Review the failed CI run and address the issues before merging.', kind: 'text' },
        ] as BodySpec,
        default: { labels: ['tech-debt', 'refactor'], type: 'Quality' } as DebtClassification,
        pattern: 'Debt:',
        rules: [
            { pattern: /build/i, value: { labels: ['tech-debt', 'performance'], type: 'Performance' } },
            { pattern: /compression/i, value: { labels: ['tech-debt', 'performance'], type: 'Performance' } },
            { pattern: /mutate/i, value: { labels: ['tech-debt', 'testing'], type: 'Mutation' } },
            { pattern: /test/i, value: { labels: ['tech-debt', 'testing'], type: 'Mutation' } },
        ] as ReadonlyArray<Rule<DebtClassification>>,
    },
    security: {
        body: [
            { kind: 'heading', level: 2, text: 'Security Scan Alert' },
            { kind: 'timestamp' },
            { kind: 'field', label: 'Run', value: '{{runUrl}}' },
            { kind: 'heading', level: 3, text: 'Action Required' },
            { content: 'Security vulnerabilities or compliance issues have been detected.', kind: 'text' },
            { kind: 'heading', level: 3, text: 'Next Steps' },
            {
                items: ['Review the failed job', 'Address critical issues', 'Update dependencies', 'Re-run scan'],
                kind: 'list',
                ordered: true,
            },
        ] as BodySpec,
        labels: ['security', 'critical'] as const,
        pattern: 'Security Scan',
        title: '[SECURITY] Security Scan Alert',
    },
} as const);

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: AlertSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const spec = params.spec;
    const cfg =
        spec.kind === 'ci'
            ? ((classification) => ({
                  body: fn.body(alertSpecs.ci.body, { job: spec.job, runUrl: spec.runUrl }),
                  labels: classification.labels,
                  pattern: alertSpecs.ci.pattern,
                  title: `${classification.type} Debt: CI Failure`,
              }))(fn.classify(spec.job, alertSpecs.ci.rules, alertSpecs.ci.default))
            : {
                  body: fn.body(alertSpecs.security.body, { runUrl: spec.runUrl }),
                  labels: [...alertSpecs.security.labels],
                  pattern: alertSpecs.security.pattern,
                  title: alertSpecs.security.title,
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

// --- Export ------------------------------------------------------------------

export { run };
export type { AlertSpec };
