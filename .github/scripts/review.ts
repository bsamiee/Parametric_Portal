#!/usr/bin/env tsx
/**
 * Review Script - Universal Content Validation
 * Works for issues, PRs, and discussions
 *
 * @module review
 * @see https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
 */

import { B, call, createCtx, fn, mutate, type Reviewable, type RunParams } from './schema.ts';

// --- Reviewable Extraction (handles issue/PR/discussion uniformly) -----------

const extract = (p: Record<string, unknown>): Reviewable | null =>
    ((t) =>
        t
            ? { body: t.body ?? '', labels: (t.labels ?? []).map((l) => l.name), number: t.number, title: t.title }
            : null)(
        (p.issue ?? p.pull_request ?? p.discussion) as
            | { body?: string | null; labels?: ReadonlyArray<{ name: string }>; number: number; title: string }
            | undefined,
    );

// --- Review Handler ----------------------------------------------------------

const handleReview = async (params: RunParams, target: Reviewable): Promise<void> => {
    const ctx = createCtx(params);
    const R = B.reports.quality;
    const problems = fn.review(target.body, target.title, target.labels);
    const hasLabel = target.labels.includes(R.label);
    const handlers = {
        fixed: async (): Promise<void> => {
            await mutate(ctx, { action: 'remove', labels: [R.label], n: target.number, t: 'label' });
            params.core.info('Fixed, removed needs-info label');
        },
        hasProblems: async (): Promise<void> => {
            await mutate(ctx, { action: 'add', labels: [R.label], n: target.number, t: 'label' });
            params.context.payload.action === 'opened' &&
                (await call(
                    ctx,
                    'comment.create',
                    target.number,
                    fn.body(B.alerts.quality.body, {
                        label: R.label,
                        problems: problems.map((p) => `- ${p}`).join('\n'),
                        title: R.title,
                    }),
                ));
            params.core.info(`Quality issues: ${problems.join('; ')}`);
        },
        passes: (): void => params.core.info('Passes quality review'),
    } as const;
    await (problems.length > 0 ? handlers.hasProblems() : hasLabel ? handlers.fixed() : handlers.passes());
};

// --- Entry Point (Expression-Based) ------------------------------------------

const run = async (params: RunParams): Promise<void> =>
    ((target) => (target ? handleReview(params, target) : void params.core.info('No reviewable target')))(
        extract(params.context.payload as Record<string, unknown>),
    );

// --- Export ------------------------------------------------------------------

export { run };
