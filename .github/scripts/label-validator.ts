#!/usr/bin/env tsx
/**
 * Label validator: enforces orthogonal label invariants via dispatch tables.
 * Uses B.labels.invariants, B.labels.categories, fn.names, mutate from schema.ts.
 */
import { B as B_schema, type Ctx, createCtx, fn, type Issue, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type ValidationResult = {
    readonly valid: boolean;
    readonly violations: ReadonlyArray<string>;
    readonly fixes: ReadonlyArray<string>;
};

type LabelAxis = keyof typeof B_schema.labels.invariants.maxPerAxis;

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    axisPrefix: {
        kind: 'kind:',
        phase: 'phase:',
        priority: 'priority:',
        status: 'status:',
    } as const,
    priorityOrder: {
        kind: B_schema.labels.categories.kind,
        phase: [...B_schema.labels.categories.phase].reverse(),
        priority: B_schema.labels.categories.priority,
        status: [
            'status:done',
            'status:review',
            'status:in-progress',
            'status:implement',
            'status:blocked',
            'status:planning',
            'status:triage',
            'status:idea',
        ] as const,
    } as const,
} as const);

// --- Pure Functions ----------------------------------------------------------

const extractAxis = (label: string): LabelAxis | null =>
    (Object.keys(B.axisPrefix) as ReadonlyArray<LabelAxis>).find((axis) => label.startsWith(B.axisPrefix[axis])) ??
    null;

const groupByAxis = (
    labels: ReadonlyArray<string>,
): Record<LabelAxis, ReadonlyArray<string>> & { readonly other: ReadonlyArray<string> } => {
    const result: Record<LabelAxis | 'other', string[]> = { kind: [], other: [], phase: [], priority: [], status: [] };
    for (const label of labels) {
        const axis = extractAxis(label) ?? 'other';
        result[axis].push(label);
    }
    return result;
};

const findViolations = (groups: Record<LabelAxis, ReadonlyArray<string>>): ReadonlyArray<string> =>
    (Object.keys(B_schema.labels.invariants.maxPerAxis) as ReadonlyArray<LabelAxis>)
        .filter((axis) => groups[axis].length > B_schema.labels.invariants.maxPerAxis[axis])
        .map(
            (axis) =>
                `Too many ${axis} labels (${groups[axis].length}/${B_schema.labels.invariants.maxPerAxis[axis]}): ${groups[axis].join(', ')}`,
        );

const selectPreferred = (labels: ReadonlyArray<string>, axis: LabelAxis): string =>
    labels.find((label) => (B.priorityOrder[axis] as ReadonlyArray<string>).includes(label)) ?? labels[0];

const generateFixes = (
    groups: Record<LabelAxis, ReadonlyArray<string>>,
): ReadonlyArray<{ readonly axis: LabelAxis; readonly keep: string; readonly remove: ReadonlyArray<string> }> =>
    (Object.keys(B_schema.labels.invariants.maxPerAxis) as ReadonlyArray<LabelAxis>)
        .filter((axis) => groups[axis].length > B_schema.labels.invariants.maxPerAxis[axis])
        .map((axis) => {
            const preferred = selectPreferred(groups[axis], axis);
            return {
                axis,
                keep: preferred,
                remove: groups[axis].filter((label) => label !== preferred),
            };
        });

// --- Effect Pipeline ---------------------------------------------------------

const applyFixes = async (
    ctx: Ctx,
    issue: Issue,
    fixes: ReadonlyArray<{ readonly axis: string; readonly keep: string; readonly remove: ReadonlyArray<string> }>,
    core: RunParams['core'],
): Promise<void> => {
    await Promise.all(
        fixes.flatMap((fix) => {
            core.info(`[LABEL-VALIDATOR] Fixing ${fix.axis}: keeping ${fix.keep}, removing ${fix.remove.join(', ')}`);
            return fix.remove.map((label) =>
                mutate(ctx, { action: 'remove', labels: [label], n: issue.number, t: 'label' }),
            );
        }),
    );
};

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams): Promise<ValidationResult> => {
    const ctx = createCtx(params);
    const issue = params.context.payload.issue as Issue;
    const labels = fn.names(issue.labels);
    const groups = groupByAxis(labels);
    const violations = findViolations(groups);
    const fixes = generateFixes(groups);

    if (violations.length > 0) {
        params.core.info(`[LABEL-VALIDATOR] Found ${violations.length} violations`);
        for (const v of violations) {
            params.core.info(`  - ${v}`);
        }
        await applyFixes(ctx, issue, fixes, params.core);
    }

    return {
        fixes: fixes.map((f) => `${f.axis}: kept ${f.keep}, removed ${f.remove.join(', ')}`),
        valid: violations.length === 0,
        violations,
    };
};

// --- Export ------------------------------------------------------------------

export { run };
export type { ValidationResult };
