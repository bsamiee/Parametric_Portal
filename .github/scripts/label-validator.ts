#!/usr/bin/env tsx
/**
 * Label validator: enforces orthogonal label invariants via dispatch tables.
 * Uses B.labels.invariants, B.labels.categories, fn.names, call, mutate from schema.ts.
 */
import { B, type Ctx, call, createCtx, fn, type Issue, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type ValidationResult = {
    readonly valid: boolean;
    readonly violations: ReadonlyArray<string>;
    readonly fixes: ReadonlyArray<string>;
};

type LabelAxis = 'kind' | 'status' | 'phase' | 'priority';

// --- Pure Functions ----------------------------------------------------------

const extractAxis = (label: string): LabelAxis | null =>
    label.startsWith('kind:')
        ? 'kind'
        : label.startsWith('status:')
          ? 'status'
          : label.startsWith('phase:')
            ? 'phase'
            : label.startsWith('priority:')
              ? 'priority'
              : null;

const groupByAxis = (
    labels: ReadonlyArray<string>,
): Record<LabelAxis, ReadonlyArray<string>> & { readonly other: ReadonlyArray<string> } => {
    const groups: Record<LabelAxis | 'other', ReadonlyArray<string>> = {
        kind: [],
        other: [],
        phase: [],
        priority: [],
        status: [],
    };
    labels.forEach((label) => {
        const axis = extractAxis(label);
        groups[axis ?? 'other'] = [...(groups[axis ?? 'other'] ?? []), label];
    });
    return groups as Record<LabelAxis, ReadonlyArray<string>> & { readonly other: ReadonlyArray<string> };
};

const findViolations = (groups: Record<LabelAxis, ReadonlyArray<string>>): ReadonlyArray<string> => {
    const violations: Array<string> = [];
    const axes: ReadonlyArray<LabelAxis> = ['kind', 'status', 'phase', 'priority'];

    axes.forEach((axis) => {
        const count = groups[axis].length;
        const max = B.labels.invariants.maxPerAxis[axis];
        count > max && violations.push(`Too many ${axis} labels (${count}/${max}): ${groups[axis].join(', ')}`);
    });

    return violations;
};

const selectPreferred = (labels: ReadonlyArray<string>, axis: LabelAxis): string => {
    const priority: Record<LabelAxis, ReadonlyArray<string>> = {
        kind: ['kind:project', 'kind:task', 'kind:spike'],
        phase: [
            'phase:5-release',
            'phase:4-hardening',
            'phase:3-impl-extensions',
            'phase:2-impl-core',
            'phase:1-planning',
            'phase:0-foundation',
        ],
        priority: ['priority:critical', 'priority:high', 'priority:medium', 'priority:low'],
        status: [
            'status:done',
            'status:review',
            'status:in-progress',
            'status:implement',
            'status:blocked',
            'status:planning',
            'status:triage',
            'status:idea',
        ],
    };

    const order = priority[axis];
    return labels.find((label) => order.includes(label)) ?? labels[0];
};

const generateFixes = (
    groups: Record<LabelAxis, ReadonlyArray<string>>,
): ReadonlyArray<{ readonly axis: LabelAxis; readonly keep: string; readonly remove: ReadonlyArray<string> }> => {
    const axes: ReadonlyArray<LabelAxis> = ['kind', 'status', 'phase', 'priority'];
    return axes
        .filter((axis) => groups[axis].length > B.labels.invariants.maxPerAxis[axis])
        .map((axis) => ({
            axis,
            keep: selectPreferred(groups[axis], axis),
            remove: groups[axis].filter((label) => label !== selectPreferred(groups[axis], axis)),
        }));
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
        violations.forEach((v) => params.core.info(`  - ${v}`));

        for (const fix of fixes) {
            params.core.info(`[LABEL-VALIDATOR] Fixing ${fix.axis}: keeping ${fix.keep}, removing ${fix.remove.join(', ')}`);
            for (const label of fix.remove) {
                await mutate(ctx, { action: 'remove', labels: [label], n: issue.number, t: 'label' });
            }
        }
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
