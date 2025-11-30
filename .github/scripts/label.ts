#!/usr/bin/env tsx
/**
 * Comprehensive label management with polymorphic dispatch.
 * Handles all label behaviors (pin/unpin/comment), bulk operations, and queries.
 */

import { B, type Ctx, call, createCtx, mutate, type RunParams } from './schema.ts';

// --- Types ------------------------------------------------------------------

type LabelAction = 'labeled' | 'unlabeled';
type Behavior = 'pin' | 'unpin' | 'comment' | null;
type LabelSpec = {
    readonly action: LabelAction;
    readonly label: string;
    readonly nodeId: string;
    readonly number: number;
};
type LabelResult = { readonly executed: boolean; readonly behavior: Behavior };
type LabelOp = 'add' | 'remove' | 'set' | 'behavior';
type BulkSpec = { readonly numbers: ReadonlyArray<number>; readonly labels: ReadonlyArray<string>; readonly op: LabelOp };

// --- Dispatch Tables --------------------------------------------------------

const behaviorHandlers: Record<NonNullable<Behavior>, (ctx: Ctx, spec: LabelSpec) => Promise<void>> = {
    comment: async (ctx, spec) =>
        mutate(ctx, { body: `Label \`${spec.label}\` applied`, marker: `LABEL-${spec.label}`, n: spec.number, t: 'comment' }),
    pin: async (ctx, spec) => { await call(ctx, 'issue.pin', spec.nodeId); },
    unpin: async (ctx, spec) => { await call(ctx, 'issue.unpin', spec.nodeId); },
};

const bulkHandlers: Record<Exclude<LabelOp, 'behavior'>, (ctx: Ctx, n: number, labels: ReadonlyArray<string>) => Promise<void>> = {
    add: async (ctx, n, labels) => { await call(ctx, 'issue.addLabels', n, [...labels]); },
    remove: async (ctx, n, labels) => { for (const label of labels) await call(ctx, 'issue.removeLabel', n, label); },
    set: async (ctx, n, labels) => { await call(ctx, 'issue.updateMeta', n, { labels: [...labels] }); },
};

// --- Pure Functions ---------------------------------------------------------

const resolve = (label: string, action: LabelAction): Behavior => {
    const config = B.labels.behaviors as Record<string, { readonly onAdd: Behavior; readonly onRemove: Behavior }>;
    return config[label]?.[action === 'labeled' ? 'onAdd' : 'onRemove'] ?? null;
};

const hasLabel = (labels: ReadonlyArray<{ readonly name: string }>, name: string): boolean =>
    labels.some((label) => label.name === name);

const filterByLabel = <T extends { readonly labels: ReadonlyArray<{ readonly name: string }> }>(
    items: ReadonlyArray<T>,
    label: string,
    include = true,
): ReadonlyArray<T> => items.filter((item) => hasLabel(item.labels, label) === include);

const isExempt = (labels: ReadonlyArray<{ readonly name: string }>): boolean =>
    B.labels.exempt.some((exempt) => hasLabel(labels, exempt));

const categorize = (labels: ReadonlyArray<{ readonly name: string }>): Record<keyof typeof B.labels.categories, ReadonlyArray<string>> =>
    Object.fromEntries(
        Object.entries(B.labels.categories).map(([cat, values]) => [
            cat,
            labels.filter((label) => (values as readonly string[]).includes(label.name)).map((label) => label.name),
        ]),
    ) as Record<keyof typeof B.labels.categories, ReadonlyArray<string>>;

// --- Entry Points -----------------------------------------------------------

const behavior = async (params: RunParams & { readonly spec: LabelSpec }): Promise<LabelResult> => {
    const ctx = createCtx(params);
    const resolved = resolve(params.spec.label, params.spec.action);
    resolved && (await behaviorHandlers[resolved](ctx, params.spec));
    params.core.info(`[LABEL] ${params.spec.label} ${params.spec.action}: ${resolved ?? 'no-op'}`);
    return { executed: resolved !== null, behavior: resolved };
};

const bulk = async (params: RunParams & { readonly spec: BulkSpec }): Promise<{ readonly processed: number }> => {
    const ctx = createCtx(params);
    const handler = bulkHandlers[params.spec.op as Exclude<LabelOp, 'behavior'>];
    await Promise.all(params.spec.numbers.map((n) => handler(ctx, n, params.spec.labels)));
    params.core.info(`[LABEL] Bulk ${params.spec.op}: ${params.spec.numbers.length} items`);
    return { processed: params.spec.numbers.length };
};

// Legacy alias for backward compatibility
const run = behavior;

// --- Export -----------------------------------------------------------------

export { behavior, bulk, categorize, filterByLabel, hasLabel, isExempt, resolve, run };
export type { Behavior, BulkSpec, LabelAction, LabelOp, LabelResult, LabelSpec };
