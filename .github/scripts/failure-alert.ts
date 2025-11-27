#!/usr/bin/env tsx
/**
 * Failure Alert Script - Config-Driven Issue Alerting
 *
 * @module failure-alert
 */

import { B, createCtx, fn, mutate, type RunParams, type U } from './schema.ts';

// --- Pure Functions ---------------------------------------------------------

const classifyCI = (job: string) => {
    const classification = B.alerts.ci.classification;
    const key = (Object.keys(classification) as Array<keyof typeof classification>).find((k) => job.includes(k));
    return key ? classification[key] : B.alerts.ci.default;
};

const build = (s: U<'alert'>): { body: string; labels: ReadonlyArray<string>; pattern: string; title: string } =>
    s.kind === 'ci'
        ? ((c) => ({
              body: fn.body(B.alerts.ci.body, { job: s.job, runUrl: s.runUrl }),
              labels: c.labels,
              pattern: B.alerts.ci.pattern,
              title: `${c.type} Debt: CI Failure`,
          }))(classifyCI(s.job))
        : {
              body: fn.body(B.alerts.security.body, { runUrl: s.runUrl }),
              labels: [...B.alerts.security.labels],
              pattern: B.alerts.security.pattern,
              title: B.alerts.security.title,
          };

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: U<'alert'> }): Promise<void> => {
    const ctx = createCtx(params);
    const { body, labels, pattern, title } = build(params.spec);
    await mutate(ctx, { body, label: labels[0], labels: [...labels], pattern, t: 'issue', title });
    params.core.info(`${params.spec.kind} alert created/updated`);
};

// --- Export -----------------------------------------------------------------

export { build, classifyCI, run };
