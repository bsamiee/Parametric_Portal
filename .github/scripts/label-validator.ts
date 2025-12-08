#!/usr/bin/env tsx
/**
 * Label validator: enforces orthogonal label invariants via dispatch tables.
 * Uses B.labels.invariants, B.labels.categories, fn.names, mutate from schema.ts.
 */
import { B, type Ctx, createCtx, fn, type Issue, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type ValidationResult = {
    readonly valid: boolean;
    readonly violations: ReadonlyArray<string>;
    readonly fixes: ReadonlyArray<string>;
};

type LabelAxis = keyof typeof B.labels.invariants.maxPerAxis;

// --- Constants ---------------------------------------------------------------

const AXIS_PREFIX: Record<LabelAxis, string> = Object.freeze({
    kind: 'kind:',
    phase: 'phase:',
    priority: 'priority:',
    status: 'status:',
} as const);

const PRIORITY_ORDER: Record<LabelAxis, ReadonlyArray<string>> = Object.freeze({
    kind: B.labels.categories.kind,
    phase: [...B.labels.categories.phase].reverse(),
    priority: B.labels.categories.priority,
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
} as const);

// --- Pure Functions ----------------------------------------------------------

const extractAxis = (label: string): LabelAxis | null =>
    (Object.keys(AXIS_PREFIX) as ReadonlyArray<LabelAxis>).find((axis) => label.startsWith(AXIS_PREFIX[axis])) ?? null;

const groupByAxis = (
    labels: ReadonlyArray<string>,
): Record<LabelAxis, ReadonlyArray<string>> & { readonly other: ReadonlyArray<string> } =>
    labels.reduce(
        (acc, label) => {
            const axis = extractAxis(label) ?? 'other';
            return { ...acc, [axis]: [...acc[axis], label] };
        },
        { kind: [], other: [], phase: [], priority: [], status: [] } as Record<
            LabelAxis | 'other',
            ReadonlyArray<string>
        >,
    ) as Record<LabelAxis, ReadonlyArray<string>> & { readonly other: ReadonlyArray<string> };

const findViolations = (groups: Record<LabelAxis, ReadonlyArray<string>>): ReadonlyArray<string> =>
    (Object.keys(B.labels.invariants.maxPerAxis) as ReadonlyArray<LabelAxis>)
        .filter((axis) => groups[axis].length > B.labels.invariants.maxPerAxis[axis])
        .map((axis) => `Too many ${axis} labels (${groups[axis].length}/${B.labels.invariants.maxPerAxis[axis]}): ${groups[axis].join(', ')}`);

const selectPreferred = (labels: ReadonlyArray<string>, axis: LabelAxis): string =>
    labels.find((label) => PRIORITY_ORDER[axis].includes(label)) ?? labels[0];

const generateFixes = (
    groups: Record<LabelAxis, ReadonlyArray<string>>,
): ReadonlyArray<{ readonly axis: LabelAxis; readonly keep: string; readonly remove: ReadonlyArray<string> }> =>
    (Object.keys(B.labels.invariants.maxPerAxis) as ReadonlyArray<LabelAxis>)
        .filter((axis) => groups[axis].length > B.labels.invariants.maxPerAxis[axis])
        .map((axis) => ({
            axis,
            keep: selectPreferred(groups[axis], axis),
            remove: groups[axis].filter((label) => label !== selectPreferred(groups[axis], axis)),
        }));

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
            return fix.remove.map((label) => mutate(ctx, { action: 'remove', labels: [label], n: issue.number, t: 'label' }));
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

    violations.length > 0 &&
        (params.core.info(`[LABEL-VALIDATOR] Found ${violations.length} violations`),
        violations.forEach((v) => params.core.info(`  - ${v}`)),
        await applyFixes(ctx, issue, fixes, params.core));

    return {
        fixes: fixes.map((f) => `${f.axis}: kept ${f.keep}, removed ${f.remove.join(', ')}`),
        valid: violations.length === 0,
        violations,
    };
};

// --- Export ------------------------------------------------------------------

export { run };
export type { ValidationResult };
