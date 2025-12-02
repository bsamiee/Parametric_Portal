#!/usr/bin/env tsx
/**
 * Issue Helper orchestration: compose Issue Helper operations with schema-driven dispatch.
 * Uses B (API constants), fn (utilities), call (GitHub API) from schema.ts.
 * Note: B.helper config values should be passed as spec parameters from calling workflows.
 */
import { B, type Ctx, call, createCtx, fn, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type IssueOpsSpec =
    | {
          readonly t: 'find-stale';
          readonly days: number;
          readonly excludeLabels: ReadonlyArray<string>;
      }
    | {
          readonly t: 'report-inactive';
          readonly days: number;
      };

type IssueOpsResult = {
    readonly issues?: ReadonlyArray<{ readonly number: number; readonly title: string; readonly age: number }>;
    readonly count: number;
    readonly message: string;
};

// --- Pure Functions ----------------------------------------------------------

const isStale = (
    issue: { readonly created_at: string; readonly labels: ReadonlyArray<{ readonly name: string }> },
    days: number,
    excludeLabels: ReadonlyArray<string>,
): boolean => {
    const age = fn.age(issue.created_at, new Date());
    const hasExemptLabel = issue.labels.some((label) => excludeLabels.includes(label.name));
    return age >= days && !hasExemptLabel;
};

// --- Dispatch Tables ---------------------------------------------------------

const opsHandlers: {
    readonly [K in IssueOpsSpec['t']]: (ctx: Ctx, spec: Extract<IssueOpsSpec, { t: K }>) => Promise<IssueOpsResult>;
} = {
    'find-stale': async (ctx, spec) => {
        const allIssues = (await call(ctx, 'issue.list', B.api.state.open)) as ReadonlyArray<{
            readonly created_at: string;
            readonly labels: ReadonlyArray<{ readonly name: string }>;
            readonly number: number;
            readonly title: string;
        }>;
        const staleIssues = allIssues
            .filter((issue) => isStale(issue, spec.days, spec.excludeLabels))
            .map((issue) => ({
                age: fn.age(issue.created_at, new Date()),
                number: issue.number,
                title: issue.title,
            }));
        return {
            count: staleIssues.length,
            issues: staleIssues,
            message: `Found ${staleIssues.length} stale issue${staleIssues.length !== 1 ? 's' : ''}`,
        };
    },
    'report-inactive': async (ctx, spec) => {
        const allIssues = (await call(ctx, 'issue.list', B.api.state.open)) as ReadonlyArray<{
            readonly created_at: string;
            readonly labels: ReadonlyArray<{ readonly name: string }>;
            readonly number: number;
            readonly title: string;
            readonly updated_at: string;
        }>;
        const inactiveIssues = allIssues
            .filter((issue) => {
                const age = fn.age(issue.updated_at, new Date());
                return age >= spec.days;
            })
            .map((issue) => ({
                age: fn.age(issue.updated_at, new Date()),
                number: issue.number,
                title: issue.title,
            }))
            .sort((a, b) => b.age - a.age);
        return {
            count: inactiveIssues.length,
            issues: inactiveIssues,
            message: `Found ${inactiveIssues.length} inactive issue${inactiveIssues.length !== 1 ? 's' : ''}`,
        };
    },
};

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: IssueOpsSpec }): Promise<IssueOpsResult> => {
    const ctx = createCtx(params);
    const result = await opsHandlers[params.spec.t](ctx, params.spec as never);
    params.core.info(`[ISSUE-OPS] ${params.spec.t}: ${result.message}`);
    return result;
};

// --- Export ------------------------------------------------------------------

export { run };
export type { IssueOpsResult, IssueOpsSpec };
