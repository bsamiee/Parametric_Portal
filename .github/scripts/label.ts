#!/usr/bin/env tsx
/**
 * Label-triggered behavior executor with polymorphic dispatch.
 * Single entry point handles labeled/unlabeled events across all behaviors.
 */

import { B, type Ctx, call, createCtx, mutate, type RunParams } from './schema.ts';

// --- Types ------------------------------------------------------------------

type LabelSpec = {
    readonly action: 'labeled' | 'unlabeled';
    readonly label: string;
    readonly nodeId: string;
    readonly number: number;
};
type LabelResult = { readonly executed: boolean; readonly behavior: string | null };

// --- Dispatch Table ---------------------------------------------------------

type Behavior = 'pin' | 'unpin' | 'comment';

const handlers: Record<Behavior, (ctx: Ctx, spec: LabelSpec) => Promise<void>> = {
    comment: (ctx, spec) =>
        mutate(ctx, { body: `Label \`${spec.label}\` applied`, marker: `LABEL-${spec.label}`, n: spec.number, t: 'comment' }),
    pin: async (ctx, spec) => { await call(ctx, 'issue.pin', spec.nodeId); },
    unpin: async (ctx, spec) => { await call(ctx, 'issue.unpin', spec.nodeId); },
};

// --- Pure Functions ---------------------------------------------------------

const resolve = (label: string, action: LabelSpec['action']): Behavior | null =>
    (B.labels.behaviors as Record<string, { readonly onAdd: Behavior | null; readonly onRemove: Behavior | null }>)[label]?.[
        action === 'labeled' ? 'onAdd' : 'onRemove'
    ] ?? null;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: LabelSpec }): Promise<LabelResult> => {
    const ctx = createCtx(params);
    const behavior = resolve(params.spec.label, params.spec.action);
    behavior && (await handlers[behavior](ctx, params.spec));
    params.core.info(`[LABEL] ${params.spec.label} ${params.spec.action}: ${behavior ?? 'no-op'}`);
    return { executed: behavior !== null, behavior };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { LabelResult, LabelSpec };
