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
    | {
          readonly kind: 'ci';
          readonly job: string;
          readonly runUrl: string;
          readonly prNumber?: number;
          readonly sectionId?: string;
      }
    | { readonly kind: 'security'; readonly runUrl: string; readonly prNumber?: number; readonly sectionId?: string };

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

    // CI Failure Logic
    if (spec.kind === 'ci') {
        const classification = fn.classify(spec.job, alertSpecs.ci.rules, alertSpecs.ci.default);
        const body = fn.body(alertSpecs.ci.body, { job: spec.job, runUrl: spec.runUrl });

        // If PR number provided, update PR comment section
        if (spec.prNumber) {
            await mutate(ctx, {
                body,
                marker: 'PR-MONITOR', // Uses the master marker from PR template
                mode: 'section',
                n: spec.prNumber,
                sectionId: 'ci-failure',
                t: 'comment',
            });
        }
        // Fallback: Create/Update Issue
        else {
            await mutate(ctx, {
                body,
                label: classification.labels[0],
                labels: [...classification.labels],
                pattern: alertSpecs.ci.pattern,
                t: 'issue',
                title: `${classification.type} Debt: CI Failure`,
            });
        }
    }

    // Security Alert Logic
    else {
        const body = fn.body(alertSpecs.security.body, { runUrl: spec.runUrl });
        if (spec.prNumber) {
            await mutate(ctx, {
                body,
                marker: 'PR-MONITOR',
                mode: 'section',
                n: spec.prNumber,
                sectionId: 'security-alert',
                t: 'comment',
            });
        } else {
            await mutate(ctx, {
                body,
                label: alertSpecs.security.labels[0],
                labels: [...alertSpecs.security.labels],
                pattern: alertSpecs.security.pattern,
                t: 'issue',
                title: alertSpecs.security.title,
            });
        }
    }
    params.core.info(`${spec.kind} alert processed`);
};

// --- Export ------------------------------------------------------------------

export { run };
export type { AlertSpec };
