#!/usr/bin/env tsx
/**
 * PR commit synchronization analyzer for active-qc workflow.
 * Analyzes PR commits on synchronize events to ensure title and labels reflect reality.
 * Detects breaking changes, type mismatches, and updates metadata accordingly.
 *
 * Leverages schema.ts: B constant (patterns, breaking), fn (classify), call, mutate
 */

import {
    B,
    type Commit,
    call,
    createCtx,
    fn,
    type Label,
    mutate,
    type RunParams,
    TYPES,
    type TypeKey,
} from './schema.ts';

// --- Types (minimal, no duplication with schema.ts) --------------------------

type SyncSpec = { readonly prNumber: number; readonly action: 'opened' | 'synchronize' | 'edited' };
type SyncResult = { readonly updated: boolean; readonly changes: ReadonlyArray<string> };
type PR = {
    readonly body: string | null;
    readonly labels: ReadonlyArray<Label>;
    readonly number: number;
    readonly title: string;
};
type Analysis = {
    readonly titleFix: string | null;
    readonly labelOps: ReadonlyArray<LabelOp>;
    readonly breaking: boolean;
};
type LabelOp = { readonly op: 'add' | 'remove'; readonly name: string };

// --- Pure Functions (leverage B and fn from schema.ts) -----------------------

const infer = (text: string): TypeKey => fn.classify(text, B.meta.infer, 'chore') as TypeKey;
const strip = (text: string): string =>
    text
        .replace(/^\[.*?\]:?\s*/i, '')
        .replace(/^(\w+)(\(.*?\))?:?\s*/i, '')
        .trim();
const hasType = (labels: ReadonlyArray<Label>): boolean => labels.some((l) => TYPES.includes(l.name as TypeKey));
const isBreaking = (commits: ReadonlyArray<Commit>): boolean =>
    commits.some((c) => B.breaking.commitPat.some((p) => p.test(c.commit.message)));
const dominant = (commits: ReadonlyArray<Commit>): TypeKey => {
    const counts = commits.reduce<Record<string, number>>(
        (acc, c) => ({ ...acc, [infer(c.commit.message)]: (acc[infer(c.commit.message)] ?? 0) + 1 }),
        {},
    );
    return (Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] as TypeKey) ?? 'chore';
};
const titleType = (title: string): TypeKey | null =>
    ((m) => (m ? (m[1].toLowerCase() as TypeKey) : null))(B.pr.pattern.exec(title));
const format = (type: TypeKey, brk: boolean, subject: string): string => `${B.meta.fmt.title(type, brk)} ${subject}`;

// --- Analysis Pipeline (single dispatch, no if/else) -------------------------

const analyze = (pr: PR, commits: ReadonlyArray<Commit>): Analysis => {
    const commitBrk = isBreaking(commits);
    const titleBrk = B.pr.pattern.exec(pr.title)?.[2] === '!';
    const bodyBrk = B.breaking.bodyPat.test(pr.body ?? '');
    const actualBrk = commitBrk || bodyBrk;
    const commitType = dominant(commits);
    const prType = titleType(pr.title);
    const subject = strip(pr.title);
    const labels = pr.labels.map((l) => l.name);
    const ops: Array<LabelOp> = [];
    !hasType(pr.labels) && commitType && ops.push({ name: commitType, op: 'add' });
    actualBrk && !labels.includes(B.breaking.label) && ops.push({ name: B.breaking.label, op: 'add' });
    !actualBrk && labels.includes(B.breaking.label) && ops.push({ name: B.breaking.label, op: 'remove' });
    const needsFix =
        (prType !== commitType && commits.length > 0) || actualBrk !== titleBrk || !B.pr.pattern.test(pr.title);
    return { breaking: actualBrk, labelOps: ops, titleFix: needsFix ? format(commitType, actualBrk, subject) : null };
};

// --- Entry Point (unified pipeline, polymorphic dispatch via mutate) ---------

const run = async (params: RunParams & { readonly spec: SyncSpec }): Promise<SyncResult> => {
    const ctx = createCtx(params);
    const pr = (await call(ctx, 'pull.get', params.spec.prNumber)) as PR;
    const commits = ((await call(ctx, 'pull.listCommits', params.spec.prNumber)) ?? []) as ReadonlyArray<Commit>;
    const { titleFix, labelOps, breaking } = analyze(pr, commits);
    const changes: Array<string> = [];

    // Title update via REST call (direct API, no mutation handler needed)
    titleFix &&
        (await call(ctx, 'pull.update', params.spec.prNumber, { title: titleFix })) &&
        changes.push(`title: ${pr.title} → ${titleFix}`);

    // Label operations via mutate handlers (polymorphic dispatch)
    const adds = labelOps.filter((o) => o.op === 'add').map((o) => o.name);
    const removes = labelOps.filter((o) => o.op === 'remove').map((o) => o.name);
    adds.length > 0 &&
        (await mutate(ctx, { action: 'add', labels: adds, n: params.spec.prNumber, t: 'label' })) &&
        changes.push(`labels+: ${adds.join(',')}`);
    removes.length > 0 &&
        (await Promise.all(
            removes.map(async (name) => {
                await call(ctx, 'issue.removeLabel', params.spec.prNumber, name);
                changes.push(`labels-: ${name}`);
            }),
        ));

    params.core.info(
        `[PR-SYNC] PR #${params.spec.prNumber}: ${changes.length > 0 ? changes.join('; ') : 'no changes'} (breaking: ${breaking})`,
    );
    return { changes, updated: changes.length > 0 };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { SyncResult, SyncSpec };
