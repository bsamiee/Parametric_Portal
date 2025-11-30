#!/usr/bin/env tsx
/**
 * Polymorphic fixer for GitHub object metadata with AI fallback.
 * Pipeline: local inference → Claude → GitHub Models.
 */

import {
    cleanTitle,
    formatCommit,
    formatTitle,
    hasTypeLabel,
    inferType,
    isBreaking,
    needsFix,
    parseCommit,
    parseTitle,
    validTypes,
} from './meta-validate.ts';
import {
    B,
    type Ctx,
    call,
    createCtx,
    type Issue,
    type MetaCat,
    mutate,
    type RunParams,
    type Target,
} from './schema.ts';

// --- Types ------------------------------------------------------------------

type CommitInfo = { readonly message: string; readonly sha: string };
type AgentConfig = { readonly key?: string; readonly token: string };
type FixSpec = {
    readonly target: Target | 'all';
    readonly n?: number;
    readonly limit?: number;
    readonly commits?: ReadonlyArray<CommitInfo>;
};
type FixResult = {
    readonly fixed: number;
    readonly provider: 'local' | 'claude' | 'github' | 'none';
    readonly commitMessage?: string;
};
type FixRet = { readonly n: number; readonly provider: string; readonly value?: string };

// --- Helpers ----------------------------------------------------------------

const op = (cat: MetaCat, o: 'list' | 'update'): string | undefined =>
    (B.meta.ops[cat] as Record<string, string | undefined>)?.[o];

const cleanMsg = (msg: string): string =>
    msg
        .replace(/^(\w+)(!?)(\(.+\))?:\s*/i, '')
        .split('\n')[0]
        .trim();

const badCommit = (commits?: ReadonlyArray<CommitInfo>) => commits?.find((c) => !parseCommit(c.message).valid);

// --- AI Providers -----------------------------------------------------------

const providers = {
    claude: (key: string, prompt: string) =>
        fetch('https://api.anthropic.com/v1/messages', {
            body: JSON.stringify({
                max_tokens: 256,
                messages: [{ content: prompt, role: 'user' }],
                model: 'claude-sonnet-4-20250514',
            }),
            headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-api-key': key },
            method: 'POST',
        })
            .then((r) => r.json())
            .then((d) => (d as { content: { text: string }[] }).content[0]?.text ?? null),
    github: (token: string, prompt: string) =>
        fetch('https://models.github.ai/inference/chat/completions', {
            body: JSON.stringify({ messages: [{ content: prompt, role: 'user' }], model: 'openai/gpt-4o' }),
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            method: 'POST',
        })
            .then((r) => r.json())
            .then((d) => (d as { choices: { message: { content: string } }[] }).choices[0]?.message?.content ?? null),
} as const;

const ask = (cfg: AgentConfig, prompt: string): Promise<string | null> =>
    (cfg.key ? providers.claude(cfg.key, prompt) : providers.github(cfg.token, prompt)).catch(() => null);

// --- Dispatch Tables --------------------------------------------------------

const localFix: Record<Target, (i: Issue, commits?: ReadonlyArray<CommitInfo>) => string | null> = {
    body: () => null,
    commit: (_, commits) => {
        const bad = badCommit(commits);
        return bad ? formatCommit(inferType(bad.message), null, cleanMsg(bad.message), false) : null;
    },
    label: (i) => (hasTypeLabel(i.labels) ? null : inferType(i.title)),
    title: (i) =>
        parseTitle(i.title).valid
            ? null
            : formatTitle(inferType(i.title), cleanTitle(i.title), isBreaking(i.title, i.body)),
};

const aiPrompts: Record<Target, (i: Issue) => string> = {
    body: (i) => `Generate concise markdown body for: "${i.title}". Return ONLY the body.`,
    commit: (i) => `Fix commit to conventional: type(scope): desc. Current: "${i.title}". Return ONLY message.`,
    label: (i) => `Classify into ONE type: ${validTypes.join(', ')}. Title: "${i.title}". Return ONLY type.`,
    title: (i) => `Fix to [TYPE]: format. Types: ${validTypes.join(', ')}. Current: "${i.title}". Return ONLY title.`,
};

const applyFix: Record<Target, (ctx: Ctx, n: number, v: string) => Promise<unknown>> = {
    body: (ctx, n, v) => call(ctx, 'issue.updateMeta', n, { body: v }),
    commit: () => Promise.resolve(),
    label: (ctx, n, v) => mutate(ctx, { action: 'add', labels: [v], n, t: 'label' }),
    title: (ctx, n, v) => call(ctx, 'issue.updateMeta', n, { title: v }),
};

const needsFixPred: Record<Target, (i: Issue, commits?: ReadonlyArray<CommitInfo>) => boolean> = {
    body: (i) => !i.body || i.body.trim().length < 20,
    commit: (_, commits) => !!badCommit(commits),
    label: (i) => !hasTypeLabel(i.labels),
    title: (i) => needsFix('title', i.title),
};

// --- Fix Pipeline -----------------------------------------------------------

const aiFix = (cfg: AgentConfig, target: Target, i: Issue): Promise<string | null> =>
    ask(cfg, aiPrompts[target](i)).then((v) => v?.trim().split('\n')[0] ?? null);

const apply = (ctx: Ctx, target: Target, n: number, v: string, provider: string): Promise<FixRet> =>
    (target === 'commit' ? Promise.resolve() : applyFix[target](ctx, n, v)).then(() => ({ n: 1, provider, value: v }));

const fixOne = (
    ctx: Ctx,
    cfg: AgentConfig,
    target: Target,
    i: Issue,
    commits?: ReadonlyArray<CommitInfo>,
): Promise<FixRet> =>
    needsFixPred[target](i, commits)
        ? Promise.resolve(localFix[target](i, commits)).then((local) =>
              local
                  ? apply(ctx, target, i.number, local, 'local')
                  : aiFix(cfg, target, i).then((ai) =>
                        ai
                            ? apply(ctx, target, i.number, ai, cfg.key ? 'claude' : 'github')
                            : { n: 0, provider: 'none' },
                    ),
          )
        : Promise.resolve({ n: 0, provider: 'none' });

const syncBreaking = async (ctx: Ctx, n: number, i: Issue): Promise<FixRet> => {
    const titleBrk = B.pr.pattern.exec(i.title)?.[2] === '!';
    const bodyBrk = B.breaking.bodyPat.test(i.body ?? '');
    const hasLbl = i.labels.some((l) => l.name === B.breaking.label);
    const isBrk = titleBrk || bodyBrk;
    const m = i.title.match(B.pr.pattern);
    const changed =
        ((isBrk && !hasLbl && (await mutate(ctx, { action: 'add', labels: [B.breaking.label], n, t: 'label' }))) ||
            (!isBrk &&
                hasLbl &&
                (await mutate(ctx, { action: 'remove', labels: [B.breaking.label], n, t: 'label' }))) ||
            (isBrk &&
                !titleBrk &&
                m &&
                (await call(ctx, 'issue.updateMeta', n, {
                    title: formatTitle(m[1].toLowerCase() as never, m[3], true),
                })))) ??
        false;
    return { n: changed ? 1 : 0, provider: 'local' };
};

const processCat = async (
    ctx: Ctx,
    cfg: AgentConfig,
    target: Target,
    lim: number,
    cat: MetaCat,
): Promise<ReadonlyArray<FixRet>> => {
    const items = (await call(ctx, op(cat, 'list') ?? '', 'open', '')) as ReadonlyArray<Issue>;
    const filtered = cat === 'issue' ? items.filter((i) => !(i as { pull_request?: unknown }).pull_request) : items;
    const toFix = filtered.filter((i) => needsFixPred[target](i)).slice(0, lim);
    return Promise.all([
        ...toFix.map((i) => fixOne(ctx, cfg, target, i)),
        ...toFix.map((i) => syncBreaking(ctx, i.number, i)),
    ]);
};

const fixTarget = (
    ctx: Ctx,
    cfg: AgentConfig,
    target: Target,
    lim: number,
    commits?: ReadonlyArray<CommitInfo>,
): Promise<ReadonlyArray<FixRet>> =>
    target === 'commit'
        ? commits?.length
            ? fixOne(ctx, cfg, target, {} as Issue, commits).then((r) => [r])
            : Promise.resolve([])
        : Promise.all(
              (['issue', 'pr'] as const)
                  .filter((c) => !!op(c, 'list'))
                  .map((c) => processCat(ctx, cfg, target, lim, c)),
          ).then((r) => r.flat());

// --- Entry Point ------------------------------------------------------------

const run = async (p: RunParams & { spec: FixSpec; agentConfig: AgentConfig }): Promise<FixResult> => {
    const ctx = createCtx(p);
    const { spec, agentConfig } = p;
    const hasCommits = (spec.commits?.length ?? 0) > 0;
    const baseTargets: ReadonlyArray<Target> = ['title', 'label', 'body'];
    const targets: ReadonlyArray<Target> =
        spec.target === 'all' ? (hasCommits ? [...baseTargets, 'commit'] : baseTargets) : [spec.target];
    const limit = spec.limit ?? 10;

    const allResults: ReadonlyArray<FixRet> =
        spec.n !== undefined
            ? await call(ctx, 'issue.get', spec.n)
                  .catch(() => call(ctx, 'pull.get', spec.n))
                  .then((i) => Promise.all(targets.map((t) => fixOne(ctx, agentConfig, t, i as Issue, spec.commits))))
                  .catch(() => [{ n: 0, provider: 'none' }])
            : (await Promise.all(targets.map((t) => fixTarget(ctx, agentConfig, t, limit, spec.commits)))).flat();

    const fixed = allResults.reduce((a, r) => a + r.n, 0);
    const commitResult = allResults.find((r) => r.value && targets.includes('commit'));
    const provider = (allResults.find((r) => r.provider !== 'none')?.provider as FixResult['provider']) ?? 'none';

    p.core.info(`[META] ${provider}: fixed ${fixed} items`);
    return { commitMessage: commitResult?.value, fixed, provider };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { AgentConfig, FixResult, FixSpec };
