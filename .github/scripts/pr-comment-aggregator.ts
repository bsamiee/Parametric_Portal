#!/usr/bin/env tsx
/**
 * PR Comment Aggregator: Consolidate workflow outputs into single unified PR comment.
 *
 * CONSOLIDATION STRATEGY:
 * 1. Marker-based identification: Uses `<!-- UNIFIED-CI-REPORT -->` marker (B.prComment.marker)
 * 2. Update-or-create: Finds existing comment by marker → updates in-place OR creates new
 * 3. Dispatch table for sections: sectionRenderers maps section type → markdown content
 * 4. Conditional rendering: Only includes sections with data (empty sections filtered out)
 *
 * REPLACES:
 * - Scattered biome auto-repair comments (.github/workflows/ci.yml line 97-107)
 * - Individual change detection outputs (integrated from changed-detection action)
 * - Separate quality gate status comments (integrated from ci.yml quality job)
 *
 * SECTIONS:
 * - changes: Statistics table (added/modified/deleted counts, file list)
 * - affected: Nx affected projects list from change detection
 * - quality: Quality gates status table (lint/typecheck/build/test pass/fail/skip)
 * - biome: Alert if biome auto-repair was applied and committed
 *
 * PATTERN:
 * - B constant (B.prComment) for all config (marker, sections, templates)
 * - Pure utility functions (statsTable, projectList, qualityGateTable, biomeAlert)
 * - Dispatch table (sectionRenderers) maps section type to renderer function
 * - GitHub API operations (findComment, createComment, updateComment)
 * - Single entry point (run) orchestrates: build comment → find existing → update or create
 *
 * NOTE: pr-hygiene workflow remains standalone (not integrated per explicit requirement).
 */

import { B, type Ctx, md, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type SectionType = (typeof B.prComment.sections)[number];

type SectionData = {
    readonly changes?: {
        readonly added: number;
        readonly deleted: number;
        readonly modified: number;
        readonly files: ReadonlyArray<string>;
    };
    readonly affected?: ReadonlyArray<string>;
    readonly quality?: {
        readonly lint: QualityStatus;
        readonly typecheck: QualityStatus;
        readonly build: QualityStatus;
        readonly test: QualityStatus;
    };
    readonly biome?: { readonly repaired: boolean };
};

type QualityStatus = 'pass' | 'fail' | 'skip';

type CommentResult = {
    readonly id: number;
    readonly url: string;
};

// --- Pure Utilities ----------------------------------------------------------

const statsTable = (data: NonNullable<SectionData['changes']>): string => {
    const rows = [
        ['Added', String(data.added)],
        ['Modified', String(data.modified)],
        ['Deleted', String(data.deleted)],
        ['Total Files', String(data.files.length)],
    ];
    return ['| Metric | Count |', '|:-------|------:|', ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
};

const projectList = (projects: ReadonlyArray<string>): string =>
    projects.length === 0 ? '_No affected projects_' : projects.map((p) => `- \`${p}\``).join('\n');

const qualityGateTable = (data: NonNullable<SectionData['quality']>): string => {
    const statusIcon = (status: QualityStatus): string => ({ fail: '❌', pass: '✅', skip: '⏭️' })[status];
    const rows = [
        ['Lint', statusIcon(data.lint)],
        ['Type Check', statusIcon(data.typecheck)],
        ['Build', statusIcon(data.build)],
        ['Test', statusIcon(data.test)],
    ];
    return ['| Target | Status |', '|:-------|:------:|', ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
};

const biomeAlert = (repaired: boolean): string =>
    repaired ? md.alert('note', 'Biome auto-repair applied and committed') : '';

// --- Dispatch Tables ---------------------------------------------------------

const sectionRenderers: Record<SectionType, (data: SectionData) => string> = {
    affected: (data) =>
        data.affected && data.affected.length > 0
            ? md.details('📦 Affected Projects', projectList(data.affected), false)
            : '',
    biome: (data) => (data.biome ? biomeAlert(data.biome.repaired) : ''),
    changes: (data) => (data.changes ? md.details('📊 Changes Detected', statsTable(data.changes), false) : ''),
    quality: (data) => (data.quality ? `### ✓ Quality Gates\n\n${qualityGateTable(data.quality)}` : ''),
};

const buildComment = (data: SectionData): string => {
    const sections = B.prComment.sections
        .map((section) => sectionRenderers[section](data))
        .filter((content) => content !== '');
    const timestamp = new Date().toISOString();
    const footer = B.prComment.templates.footer.replace('{{timestamp}}', timestamp);
    return [md.marker(B.prComment.marker), B.prComment.templates.header, ...sections, footer].join('\n\n');
};

// --- GitHub API Operations ---------------------------------------------------

const findComment = async (ctx: Ctx, prNumber: number): Promise<number | undefined> => {
    // PAGINATION: Recursive fetch to handle PRs with >100 comments
    // SECURITY: Regex-based HTML comment detection (robust against whitespace/formatting variations)
    const markerPattern = new RegExp(`<!--\\s*${B.prComment.marker.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->`);

    const fetchPage = async (page: number): Promise<number | undefined> => {
        const comments = await ctx.github.rest.issues.listComments({
            issue_number: prNumber,
            owner: ctx.owner,
            page,
            per_page: 100,
            repo: ctx.repo,
        });
        const found = comments.data.find((c) => c.body && markerPattern.test(c.body));
        return found?.id ?? (comments.data.length === 100 ? await fetchPage(page + 1) : undefined);
    };

    return await fetchPage(1);
};

const createComment = async (ctx: Ctx, prNumber: number, body: string): Promise<CommentResult> => {
    const result = await ctx.github.rest.issues.createComment({
        body,
        issue_number: prNumber,
        owner: ctx.owner,
        repo: ctx.repo,
    });
    return { id: result.data.id, url: result.data.html_url };
};

const updateComment = async (ctx: Ctx, commentId: number, body: string): Promise<CommentResult> => {
    const result = await ctx.github.rest.issues.updateComment({
        body,
        comment_id: commentId,
        owner: ctx.owner,
        repo: ctx.repo,
    });
    return { id: result.data.id, url: result.data.html_url };
};

// --- Entry Point -------------------------------------------------------------

const createCtx = (params: RunParams): Ctx => ({
    github: params.github,
    owner: params.context.repo.owner,
    repo: params.context.repo.repo,
});

const run = async (
    params: RunParams & { readonly spec: { readonly prNumber: number; readonly data: SectionData } },
): Promise<CommentResult> => {
    const ctx = createCtx(params);
    const body = buildComment(params.spec.data);
    const existingId = await findComment(ctx, params.spec.prNumber);

    // TYPE NARROWING: Use conditional expression instead of dispatch table with type assertion
    const result =
        existingId !== undefined
            ? await updateComment(ctx, existingId, body)
            : await createComment(ctx, params.spec.prNumber, body);

    params.core.info(`[OK] PR comment ${existingId !== undefined ? 'updated' : 'created'}: ${result.url}`);
    return result;
};

// --- Export ------------------------------------------------------------------

export { buildComment, run, sectionRenderers };
export type { CommentResult, QualityStatus, SectionData, SectionType };
