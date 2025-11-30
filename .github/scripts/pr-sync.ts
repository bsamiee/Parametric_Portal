#!/usr/bin/env tsx
/**
 * PR commit synchronization analyzer for active-qc workflow.
 * Analyzes PR commits on synchronize events to ensure title and labels reflect reality.
 * Detects breaking changes, type mismatches, and updates metadata accordingly.
 */

import {
    B,
    type Commit,
    type Ctx,
    call,
    createCtx,
    fn,
    type Label,
    mutate,
    type RunParams,
    TYPES,
    type TypeKey,
} from './schema.ts';

// --- Types ------------------------------------------------------------------

type SyncSpec = {
    readonly prNumber: number;
    readonly action: 'opened' | 'synchronize' | 'edited';
};

type SyncResult = {
    readonly updated: boolean;
    readonly changes: ReadonlyArray<string>;
};

type PR = {
    readonly body: string | null;
    readonly labels: ReadonlyArray<Label>;
    readonly number: number;
    readonly title: string;
};

// --- Pure Utility Functions -------------------------------------------------

const infer = (text: string): TypeKey => fn.classify(text, B.meta.infer, 'chore') as TypeKey;

const strip = (text: string): string =>
    text
        .replace(/^\[.*?\]:?\s*/i, '')
        .replace(/^(\w+)(\(.*?\))?:?\s*/i, '')
        .trim();

const hasType = (labels: ReadonlyArray<Label>): boolean =>
    labels.some((label) => (TYPES as ReadonlyArray<string>).includes(label.name));

const isBreaking = (commits: ReadonlyArray<Commit>): boolean =>
    commits.some((commit) => B.breaking.commitPat.some((pattern) => pattern.test(commit.commit.message)));

const inferTypeFromCommits = (commits: ReadonlyArray<Commit>): TypeKey => {
    const typeCounts = commits.reduce(
        (acc, commit) => {
            const type = infer(commit.commit.message);
            acc[type] = (acc[type] ?? 0) + 1;
            return acc;
        },
        {} as Record<TypeKey, number>,
    );
    const dominantType = (Object.entries(typeCounts) as ReadonlyArray<[TypeKey, number]>)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
    return dominantType ?? 'chore';
};

const extractTitleType = (title: string): TypeKey | null => {
    const match = B.pr.pattern.exec(title);
    return match ? (match[1].toLowerCase() as TypeKey) : null;
};

const formatTitle = (type: TypeKey, breaking: boolean, subject: string): string =>
    `${B.meta.fmt.title(type, breaking)} ${subject}`;

// --- Effect Pipeline --------------------------------------------------------

const analyze = async (
    ctx: Ctx,
    pr: PR,
    commits: ReadonlyArray<Commit>,
): Promise<{ readonly titleFix: string | null; readonly labelFixes: ReadonlyArray<string>; readonly breaking: boolean }> => {
    const commitBreaking = isBreaking(commits);
    const titleBreaking = B.pr.pattern.exec(pr.title)?.[2] === '!';
    const bodyBreaking = B.breaking.bodyPat.test(pr.body ?? '');
    const actualBreaking = commitBreaking || bodyBreaking;
    const commitType = inferTypeFromCommits(commits);
    const titleType = extractTitleType(pr.title);
    const subject = strip(pr.title);
    const labelFixes: string[] = [];
    const currentLabels = pr.labels.map((label) => label.name);
    const hasTypeLabel = hasType(pr.labels);
    const hasBreakingLabel = currentLabels.includes(B.breaking.label);
    !hasTypeLabel && commitType && labelFixes.push(commitType);
    actualBreaking && !hasBreakingLabel && labelFixes.push(B.breaking.label);
    !actualBreaking && hasBreakingLabel && labelFixes.push(`-${B.breaking.label}`);
    const needsTitleFix =
        (titleType !== commitType && commits.length > 0) ||
        (actualBreaking !== titleBreaking) ||
        !B.pr.pattern.test(pr.title);
    return {
        breaking: actualBreaking,
        labelFixes,
        titleFix: needsTitleFix ? formatTitle(commitType, actualBreaking, subject) : null,
    };
};

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: SyncSpec }): Promise<SyncResult> => {
    const ctx = createCtx(params);
    const changes: string[] = [];
    const pr = (await call(ctx, 'pull.get', params.spec.prNumber)) as PR;
    const commits = ((await call(ctx, 'pull.listCommits', params.spec.prNumber)) ?? []) as ReadonlyArray<Commit>;
    const { titleFix, labelFixes, breaking } = await analyze(ctx, pr, commits);
    titleFix &&
        (await call(ctx, 'pull.update', params.spec.prNumber, { title: titleFix })) &&
        changes.push(`title: ${pr.title} → ${titleFix}`);
    const addLabels = labelFixes.filter((label) => !label.startsWith('-'));
    const removeLabels = labelFixes.filter((label) => label.startsWith('-')).map((label) => label.slice(1));
    addLabels.length > 0 &&
        (await mutate(ctx, { action: 'add', labels: addLabels, n: params.spec.prNumber, t: 'label' })) &&
        changes.push(`labels added: ${addLabels.join(', ')}`);
    await Promise.all(
        removeLabels.map(async (label) => {
            await call(ctx, 'issue.removeLabel', params.spec.prNumber, label);
            changes.push(`label removed: ${label}`);
        }),
    );
    params.core.info(
        `[PR-SYNC] PR #${params.spec.prNumber}: ${changes.length > 0 ? changes.join('; ') : 'no changes needed'} (breaking: ${breaking})`,
    );
    return { changes, updated: changes.length > 0 };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { SyncResult, SyncSpec };
