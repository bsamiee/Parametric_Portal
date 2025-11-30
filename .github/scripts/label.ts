#!/usr/bin/env tsx
/**
 * Label-triggered behavior executor with polymorphic dispatch.
 * Single factory handles add/remove events across all label behaviors.
 */

import { B, type Ctx, call, createCtx, mutate, type RunParams } from './schema.ts';

// --- Types ------------------------------------------------------------------

type LabelAction = 'labeled' | 'unlabeled';
type Behavior = 'pin' | 'unpin' | 'comment' | null;
type LabelSpec = { readonly action: LabelAction; readonly label: string; readonly nodeId: string; readonly n: number };

// --- Dispatch Table ---------------------------------------------------------

const behaviors: Record<NonNullable<Behavior>, (ctx: Ctx, spec: LabelSpec) => Promise<void>> = {
    comment: async (ctx, spec) => {
        await mutate(ctx, { body: `Label \`${spec.label}\` applied`, marker: `LABEL-${spec.label}`, n: spec.n, t: 'comment' });
    },
    pin: async (ctx, spec) => {
        await call(ctx, 'issue.pin', spec.nodeId);
    },
    unpin: async (ctx, spec) => {
        await call(ctx, 'issue.unpin', spec.nodeId);
    },
};

// --- Pure Functions ---------------------------------------------------------

const resolve = (label: string, action: LabelAction): Behavior =>
    (B.labels.behaviors as Record<string, { onAdd: Behavior; onRemove: Behavior }>)[label]?.[
        action === 'labeled' ? 'onAdd' : 'onRemove'
    ] ?? null;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: LabelSpec }): Promise<{ readonly executed: boolean }> => {
    const ctx = createCtx(params);
    const behavior = resolve(params.spec.label, params.spec.action);
    behavior && (await behaviors[behavior](ctx, params.spec));
    params.core.info(`[LABEL] ${params.spec.label} ${params.spec.action}: ${behavior ?? 'no-op'}`);
    return { executed: behavior !== null };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { LabelAction, LabelSpec };
