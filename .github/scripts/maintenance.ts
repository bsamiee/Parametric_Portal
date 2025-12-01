#!/usr/bin/env tsx
/**
 * Repository maintenance operations: branch cleanup, cache/artifact pruning.
 * Runs daily as passive maintenance with configurable thresholds.
 *
 * Leverages schema.ts: B constant (time.day), createCtx, fn, md
 * Pattern: Single M constant → Dispatch tables → Polymorphic pipeline → Entry point
 */

import { B, type Ctx, call, createCtx, fn, md, mutate, type RunParams } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type Branch = {
    readonly commit: { readonly sha: string };
    readonly name: string;
    readonly protected: boolean;
};
type BranchCommit = { readonly commit: { readonly committer: { readonly date: string } } };
type PR = {
    readonly draft: boolean;
    readonly head: { readonly ref: string };
    readonly number: number;
    readonly updated_at: string;
};
type MaintenanceSpec = {
    readonly kind: 'branches' | 'cache' | 'full';
    readonly dryRun?: boolean;
};
type MaintenanceResult = {
    readonly branchesDeleted: number;
    readonly branchesFlagged: number;
    readonly branchErrors: number;
    readonly cacheCleared: boolean;
};
type BranchAnalysis = {
    readonly action: 'delete' | 'warn' | 'skip';
    readonly branch: string;
    readonly reason: string;
};

// --- M Constant (Maintenance Configuration) ---------------------------------

const M = Object.freeze({
    // Messages
    messages: {
        deleted: (count: number): string => `Deleted ${count} stale branch${count !== 1 ? 'es' : ''}`,
        draftWarn: (days: number): string =>
            `[WARN] **Draft PR Cleanup Notice**\n\n` +
            `This draft PR has been inactive for ${days} days.\n` +
            `Draft PRs will be flagged for manual review after extended inactivity.\n\n` +
            `**To prevent flagging:**\n` +
            `- Mark the PR as ready for review, or\n` +
            `- Add activity (push commits or comments)\n\n` +
            `_This is an automated maintenance message._`,
        flagged: (count: number): string => `Flagged ${count} draft PR${count !== 1 ? 's' : ''} for cleanup`,
    } as const,
    // Protected branch patterns (never delete)
    protected: ['main', 'master', 'develop', 'release', 'gh-pages'] as const,
    // Summary report configuration
    report: {
        marker: 'MAINTENANCE-REPORT',
        title: 'Maintenance Summary',
    } as const,
    // Thresholds in days
    thresholds: {
        branchStale: 1, // Delete branches older than 1 day without PR
        cacheRetention: 7, // Clear cache/artifacts older than 7 days
        draftWarn: 3, // Warn draft PRs after 3 days, then auto-cleanup
    } as const,
} as const);

// --- Pure Functions ---------------------------------------------------------

const isProtected = (branch: string): boolean => M.protected.some((p) => branch === p || branch.startsWith(`${p}/`));

const branchAge = (date: string): number => fn.age(date, new Date());

const shouldWarnDraft = (pr: PR): boolean => pr.draft && branchAge(pr.updated_at) >= M.thresholds.draftWarn;

const shouldDeleteBranch = (branch: Branch, prs: ReadonlyArray<PR>, commit: BranchCommit): BranchAnalysis => {
    const prForBranch = prs.find((pr) => pr.head.ref === branch.name);
    const age = branchAge(commit.commit.committer.date);

    // Protected branches never deleted
    const isProtectedBranch = branch.protected || isProtected(branch.name);
    // Active PR means skip
    const hasActivePr = prForBranch !== undefined && !prForBranch.draft;
    // Draft PR gets warning, not deletion
    const hasDraftPr = prForBranch?.draft;
    // Stale means older than threshold
    const isStale = age >= M.thresholds.branchStale;

    return isProtectedBranch
        ? { action: 'skip', branch: branch.name, reason: 'protected' }
        : hasActivePr
          ? { action: 'skip', branch: branch.name, reason: 'has-active-pr' }
          : hasDraftPr
            ? { action: 'warn', branch: branch.name, reason: 'draft-pr' }
            : isStale
              ? { action: 'delete', branch: branch.name, reason: `stale-${age}d` }
              : { action: 'skip', branch: branch.name, reason: 'recent' };
};

// --- API Operations ---------------------------------------------------------

const fetchBranches = async (ctx: Ctx): Promise<ReadonlyArray<Branch>> =>
    (await call(ctx, 'branch.list')) as ReadonlyArray<Branch>;

const fetchOpenPRs = async (ctx: Ctx): Promise<ReadonlyArray<PR>> =>
    (await call(ctx, 'pull.list', B.api.state.open)) as ReadonlyArray<PR>;

const fetchBranchCommit = async (ctx: Ctx, branch: string): Promise<BranchCommit> =>
    (await call(ctx, 'branch.get', branch)) as BranchCommit;

const deleteBranch = async (ctx: Ctx, branch: string): Promise<{ success: boolean; error?: string }> =>
    ctx.github.rest.git
        .deleteRef({ owner: ctx.owner, ref: `heads/${branch}`, repo: ctx.repo })
        .then(() => ({ success: true }))
        .catch((err: Error) => ({ error: err.message || 'Unknown error', success: false }));

const warnDraftPR = async (ctx: Ctx, pr: PR): Promise<void> => {
    const age = branchAge(pr.updated_at);
    await mutate(ctx, {
        body: M.messages.draftWarn(age),
        marker: md.marker('DRAFT-WARN'),
        mode: 'replace',
        n: pr.number,
        t: 'comment',
    });
};

// --- Dispatch Table ---------------------------------------------------------

const handlers = {
    branches: async (ctx: Ctx, dryRun: boolean): Promise<{ deleted: number; errors: number; flagged: number }> => {
        const [branches, prs] = await Promise.all([fetchBranches(ctx), fetchOpenPRs(ctx)]);
        const analyses = await Promise.all(
            branches.map(async (branch): Promise<BranchAnalysis> => {
                const commit = await fetchBranchCommit(ctx, branch.name);
                return shouldDeleteBranch(branch, prs, commit);
            }),
        );

        const toDelete = analyses.filter((a) => a.action === 'delete');
        const toWarn = analyses.filter((a) => a.action === 'warn');
        const draftPRs = prs.filter(shouldWarnDraft);

        // Execute deletions (unless dry run)
        const deleteResults = dryRun
            ? toDelete.map(() => ({ success: true }))
            : await Promise.all(toDelete.map((a) => deleteBranch(ctx, a.branch)));

        // Execute warnings (unless dry run)
        await Promise.all(dryRun ? [] : draftPRs.map((pr) => warnDraftPR(ctx, pr)));

        return {
            deleted: deleteResults.filter((r) => r.success).length,
            errors: deleteResults.filter((r) => !r.success).length,
            flagged: toWarn.length + draftPRs.length,
        };
    },
    cache: async (_ctx: Ctx, _dryRun: boolean): Promise<boolean> =>
        // Cache cleanup handled by external action (viascom/github-maintenance-action)
        // This handler is a no-op placeholder for the polymorphic dispatch
        true,
    full: async (
        ctx: Ctx,
        dryRun: boolean,
    ): Promise<{ cacheCleared: boolean; deleted: number; errors: number; flagged: number }> => {
        const branchResult = await handlers.branches(ctx, dryRun);
        const cacheCleared = await handlers.cache(ctx, dryRun);
        return { ...branchResult, cacheCleared };
    },
} as const;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: MaintenanceSpec }): Promise<MaintenanceResult> => {
    const ctx = createCtx(params);
    const dryRun = params.spec.dryRun ?? false;
    const prefix = dryRun ? '[DRY-RUN] ' : '';

    // Dispatch table for kind-based routing
    const kindHandlers = {
        branches: async (): Promise<MaintenanceResult> => {
            const r = await handlers.branches(ctx, dryRun);
            return { branchErrors: r.errors, branchesDeleted: r.deleted, branchesFlagged: r.flagged, cacheCleared: false };
        },
        cache: async (): Promise<MaintenanceResult> => ({
            branchErrors: 0,
            branchesDeleted: 0,
            branchesFlagged: 0,
            cacheCleared: await handlers.cache(ctx, dryRun),
        }),
        full: async (): Promise<MaintenanceResult> => {
            const r = await handlers.full(ctx, dryRun);
            return { branchErrors: r.errors, branchesDeleted: r.deleted, branchesFlagged: r.flagged, cacheCleared: r.cacheCleared };
        },
    } as const;

    const result = await kindHandlers[params.spec.kind]();

    // Log warnings for failed deletions
    void (result.branchErrors > 0 && params.core.info(`[WARN] ${result.branchErrors} branch deletion(s) failed`));
    params.core.info(
        `${prefix}[MAINTENANCE] ${M.messages.deleted(result.branchesDeleted)}, ${M.messages.flagged(result.branchesFlagged)}`,
    );
    return result;
};

// --- Export -----------------------------------------------------------------

export { M, run };
export type { MaintenanceResult, MaintenanceSpec };
