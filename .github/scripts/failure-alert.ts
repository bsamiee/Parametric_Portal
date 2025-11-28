#!/usr/bin/env tsx
/**
 * Failure alert issue creator for CI and security workflows.
 * Creates or updates issues with failure details and action items.
 */

import { B, createCtx, fn, mutate, type RunParams, type U } from './schema.ts';

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: U<'alert'> }): Promise<void> => {
    const ctx = createCtx(params);
    const s = params.spec;
    const cfg =
        s.kind === 'ci'
            ? ((c) => ({
                  body: fn.body(B.alerts.ci.body, { job: s.job, runUrl: s.runUrl }),
                  labels: c.labels,
                  pattern: B.alerts.ci.pattern,
                  title: `${c.type} Debt: CI Failure`,
              }))(fn.classifyDebt(s.job))
            : {
                  body: fn.body(B.alerts.security.body, { runUrl: s.runUrl }),
                  labels: [...B.alerts.security.labels],
                  pattern: B.alerts.security.pattern,
                  title: B.alerts.security.title,
              };
    await mutate(ctx, {
        body: cfg.body,
        label: cfg.labels[0],
        labels: [...cfg.labels],
        pattern: cfg.pattern,
        t: 'issue',
        title: cfg.title,
    });
    params.core.info(`${s.kind} alert created/updated`);
};

// --- Export -----------------------------------------------------------------

export { run };
