#!/usr/bin/env tsx
/**
 * Label behavior executor: dispatches pin/unpin/comment actions on label events.
 * Uses B.labels.behaviors, call (issue.pin/unpin), mutate from schema.ts.
 */
import { B, type Ctx, call, createCtx, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type LabelSpec = {
    readonly action: 'labeled' | 'unlabeled';
    readonly label: string;
    readonly nodeId: string;
    readonly number: number;
};
type LabelResult = { readonly executed: boolean; readonly behavior: string | null };

// --- Dispatch Tables ---------------------------------------------------------

type Behavior = 'pin' | 'unpin' | 'comment';

const labelHandlers: Record<Behavior, (ctx: Ctx, spec: LabelSpec) => Promise<void>> = {
    comment: (ctx, spec) =>
        mutate(ctx, {
            body: `Label \`${spec.label}\` applied`,
            marker: `LABEL-${spec.label}`,
            n: spec.number,
            t: 'comment',
        }),
    pin: async (ctx, spec) => {
        await call(ctx, 'issue.pin', spec.nodeId);
    },
    unpin: async (ctx, spec) => {
        await call(ctx, 'issue.unpin', spec.nodeId);
    },
};

// --- Pure Functions ----------------------------------------------------------

const resolveBehavior = (label: string, action: LabelSpec['action']): Behavior | null =>
    (B.labels.behaviors as Record<string, { readonly onAdd: Behavior | null; readonly onRemove: Behavior | null }>)[
        label
    ]?.[action === 'labeled' ? 'onAdd' : 'onRemove'] ?? null;

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: LabelSpec }): Promise<LabelResult> => {
    const ctx = createCtx(params);
    const behavior = resolveBehavior(params.spec.label, params.spec.action);
    behavior && (await labelHandlers[behavior](ctx, params.spec));
    params.core.info(`[LABEL] ${params.spec.label} ${params.spec.action}: ${behavior ?? 'no-op'}`);
    return { behavior, executed: behavior !== null };
};

// --- Export ------------------------------------------------------------------

export { run };
export type { LabelResult, LabelSpec };
