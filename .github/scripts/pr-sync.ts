#!/usr/bin/env tsx
/**
 * PR synchronization: analyzes commits to update title type, labels, and breaking indicators.
 * Uses B.breaking, B.pr.pattern, B.meta.infer, fn.classify, call, mutate from schema.ts.
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

// --- Types -------------------------------------------------------------------

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

// --- Pure Functions ----------------------------------------------------------

const classifyType = (text: string): TypeKey => fn.classify(text, B.meta.infer, 'chore') as TypeKey;
const stripConventionalPrefix = (text: string): string =>
    text
        .replace(/^\[.*?\]:?\s*/i, '')
        .replace(/^(\w+)(\(.*?\))?:?\s*/i, '')
        .trim();
const hasType = (labels: ReadonlyArray<Label>): boolean => labels.some((l) => TYPES.includes(l.name as TypeKey));
const isBreaking = (commits: ReadonlyArray<Commit>): boolean =>
    commits.some((c) => B.breaking.commitPat.some((p) => p.test(c.commit.message)));
const getDominantType = (commits: ReadonlyArray<Commit>): TypeKey => {
    const types = commits.map((c) => classifyType(c.commit.message));
    const countsMap = new Map<string, number>();
    types.map((type) => countsMap.set(type, (countsMap.get(type) ?? 0) + 1));
    const entries = Array.from(countsMap.entries());
    return (entries.sort(([, a], [, b]) => b - a)[0]?.[0] as TypeKey) ?? 'chore';
};
const titleType = (title: string): TypeKey | null =>
    ((m) => (m ? (m[1].toLowerCase() as TypeKey) : null))(B.pr.pattern.exec(title));
const formatPrTitle = (type: TypeKey, brk: boolean, subject: string): string =>
    `${B.meta.fmt.title(type, brk)} ${subject}`;

// --- Dispatch Tables ---------------------------------------------------------

const analyzePr = (pr: PR, commits: ReadonlyArray<Commit>): Analysis => {
    const commitBrk = isBreaking(commits);
    const titleBrk = B.pr.pattern.exec(pr.title)?.[2] === '!';
    const bodyBrk = B.breaking.bodyPat.test(pr.body ?? '');
    const actualBrk = commitBrk || bodyBrk;
    const commitType = getDominantType(commits);
    const prType = titleType(pr.title);
    const subject = stripConventionalPrefix(pr.title);
    const labels = pr.labels.map((l) => l.name);
    const ops: ReadonlyArray<LabelOp> = (
        [
            !hasType(pr.labels) && commitType ? { name: commitType, op: 'add' as const } : null,
            actualBrk && !labels.includes(B.breaking.label) ? { name: B.breaking.label, op: 'add' as const } : null,
            !actualBrk && labels.includes(B.breaking.label) ? { name: B.breaking.label, op: 'remove' as const } : null,
        ] as ReadonlyArray<LabelOp | null>
    ).filter((op): op is LabelOp => op !== null);
    const needsFix =
        (prType !== commitType && commits.length > 0) || actualBrk !== titleBrk || !B.pr.pattern.test(pr.title);
    return {
        breaking: actualBrk,
        labelOps: ops,
        titleFix: needsFix ? formatPrTitle(commitType, actualBrk, subject) : null,
    };
};

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: SyncSpec }): Promise<SyncResult> => {
    const ctx = createCtx(params);
    const pr = (await call(ctx, 'pull.get', params.spec.prNumber)) as PR;
    const commits = ((await call(ctx, 'pull.listCommits', params.spec.prNumber)) ?? []) as ReadonlyArray<Commit>;
    const { titleFix, labelOps, breaking } = analyzePr(pr, commits);
    const titleChange = titleFix
        ? (await call(ctx, 'pull.update', params.spec.prNumber, { title: titleFix }))
            ? [`title: ${pr.title} → ${titleFix}`]
            : []
        : [];
    const adds = labelOps.filter((o) => o.op === 'add').map((o) => o.name);
    const removes = labelOps.filter((o) => o.op === 'remove').map((o) => o.name);
    const addChanges: ReadonlyArray<string> =
        adds.length > 0
            ? await (async () => {
                  await mutate(ctx, { action: 'add', labels: adds, n: params.spec.prNumber, t: 'label' });
                  return [`labels+: ${adds.join(',')}`];
              })()
            : [];
    const removeChanges =
        removes.length > 0
            ? await Promise.all(
                  removes.map(async (name) => {
                      await call(ctx, 'issue.removeLabel', params.spec.prNumber, name);
                      return `labels-: ${name}`;
                  }),
              )
            : [];
    const changes: ReadonlyArray<string> = [...titleChange, ...addChanges, ...removeChanges];
    params.core.info(
        `[PR-SYNC] PR #${params.spec.prNumber}: ${changes.length > 0 ? changes.join('; ') : 'no changes'} (breaking: ${breaking})`,
    );
    return { changes, updated: changes.length > 0 };
};

// --- Export ------------------------------------------------------------------

export { run };
export type { SyncResult, SyncSpec };
