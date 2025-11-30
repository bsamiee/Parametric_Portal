#!/usr/bin/env tsx
/**
 * Universal GitHub metadata fixer. Validates titles, labels, bodies, commits.
 * Three-tier: local inference → Claude → GitHub Models.
 */

import {
    B,
    type Ctx,
    call,
    createCtx,
    fmt,
    fn,
    type Issue,
    type Label,
    mutate,
    type RunParams,
    type Target,
    TYPES,
    type TypeKey,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type Config = { readonly key?: string; readonly token: string };
type Spec = { readonly targets?: ReadonlyArray<Target>; readonly limit?: number };
type Commit = { readonly message: string; readonly sha: string };

// --- Pure Utility Functions -------------------------------------------------

const infer = (text: string): TypeKey => fn.classify(text, B.meta.infer, 'chore') as TypeKey;
const strip = (text: string): string =>
    text
        .replace(/^\[.*?\]:?\s*/i, '')
        .replace(/^(\w+)(\(.*?\))?:?\s*/i, '')
        .trim();
const hasType = (labels: ReadonlyArray<Label>): boolean =>
    labels.some((label) => (TYPES as ReadonlyArray<string>).includes(label.name));
const isDashboard = (labels: ReadonlyArray<Label>): boolean => labels.some((label) => label.name === 'dashboard');
const isBreak = (title: string, body: string | null): boolean =>
    B.pr.pattern.exec(title)?.[2] === '!' || B.breaking.bodyPat.test(body ?? '');

// --- Dispatch Tables --------------------------------------------------------

const RULES: Record<
    Target,
    {
        readonly ok: (issue: Issue, commits?: ReadonlyArray<Commit>) => boolean;
        readonly fix: (issue: Issue, commits?: ReadonlyArray<Commit>) => string | null;
        readonly write: (ctx: Ctx, number: number, value: string) => Promise<unknown>;
        readonly prompt: (issue: Issue) => string;
    }
> = {
    body: {
        fix: () => null,
        ok: (issue) => (issue.body?.trim().length ?? 0) >= 20,
        prompt: (issue) => `Generate markdown body for: "${issue.title}". Return ONLY body.`,
        write: (ctx, number, value) => call(ctx, 'issue.updateMeta', number, { body: value }),
    },
    commit: {
        fix: (_, commits) =>
            ((bad) =>
                bad ? `${infer(bad.message)}${isBreak(bad.message, null) ? '!' : ''}: ${strip(bad.message)}` : null)(
                commits?.find((commit) => !B.patterns.commit.test(commit.message)),
            ),
        ok: (_, commits) => commits?.every((commit) => B.patterns.commit.test(commit.message)) ?? true,
        prompt: (issue) => `Fix commit to conventional: type: desc. Current: "${issue.title}". Return ONLY message.`,
        write: () => Promise.resolve(),
    },
    label: {
        fix: (issue) => infer(issue.title),
        ok: (issue) => hasType(issue.labels),
        prompt: (issue) => `Classify: ${TYPES.join(',')}. Title: "${issue.title}". Return ONE type.`,
        write: (ctx, number, value) => mutate(ctx, { action: 'add', labels: [value], n: number, t: 'label' }),
    },
    title: {
        fix: (issue) => `${fmt.title(infer(issue.title), isBreak(issue.title, issue.body))} ${strip(issue.title)}`,
        ok: (issue) => B.pr.pattern.test(issue.title),
        prompt: (issue) =>
            `Fix to [TYPE]: format. Types: ${TYPES.join(',')}. Current: "${issue.title}". Return ONLY title.`,
        write: (ctx, number, value) => call(ctx, 'issue.updateMeta', number, { title: value }),
    },
};

// --- AI Providers -----------------------------------------------------------

const ai = (config: Config, prompt: string): Promise<string | null> =>
    fetch(
        config.key ? 'https://api.anthropic.com/v1/messages' : 'https://models.github.ai/inference/chat/completions',
        {
            body: JSON.stringify(
                config.key
                    ? {
                          max_tokens: 256,
                          messages: [{ content: prompt, role: 'user' }],
                          model: 'claude-sonnet-4-20250514',
                      }
                    : { messages: [{ content: prompt, role: 'user' }], model: 'openai/gpt-4o' },
            ),
            headers: config.key
                ? { 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-api-key': config.key }
                : { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
            method: 'POST',
        },
    )
        .then((response) => response.json())
        .then(
            (data) =>
                (data as { content?: ReadonlyArray<{ text: string }> }).content?.[0]?.text ??
                (data as { choices?: ReadonlyArray<{ message: { content: string } }> }).choices?.[0]?.message
                    ?.content ??
                null,
        )
        .catch(() => null);

// --- Effect Pipeline --------------------------------------------------------

const fix = (ctx: Ctx, config: Config, target: Target, issue: Issue): Promise<number> =>
    RULES[target].ok(issue)
        ? Promise.resolve(0)
        : ((local) =>
              (local ? Promise.resolve(local) : ai(config, RULES[target].prompt(issue))).then((value) =>
                  value ? RULES[target].write(ctx, issue.number, value.trim().split('\n')[0]).then(() => 1) : 0,
              ))(RULES[target].fix(issue));

const sync = (ctx: Ctx, issue: Issue): Promise<number> =>
    ((breaking, hasLabel) =>
        breaking !== hasLabel
            ? mutate(ctx, {
                  action: breaking ? 'add' : 'remove',
                  labels: [B.breaking.label],
                  n: issue.number,
                  t: 'label',
              }).then(() => 1)
            : Promise.resolve(0))(
        isBreak(issue.title, issue.body),
        issue.labels.some((label) => label.name === B.breaking.label),
    );

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { spec: Spec; cfg: Config }): Promise<{ fixed: number; provider: string }> => {
    const ctx = createCtx(params);
    const targets = (params.spec.targets ?? ['title', 'label', 'body']).filter(
        (target): target is Exclude<Target, 'commit'> => target !== 'commit',
    );
    const items = await Promise.all(
        (['issue', 'pr'] as const).map((category) =>
            call(ctx, B.meta.ops[category].list, 'open', '').then((result) =>
                (result as ReadonlyArray<Issue & { pull_request?: unknown }>).filter(
                    (issue) => (category === 'issue' ? !issue.pull_request : true) && !isDashboard(issue.labels),
                ),
            ),
        ),
    ).then((results) => results.flat().slice(0, params.spec.limit ?? 10));
    const results = await Promise.all([
        ...items.flatMap((issue) => targets.map((target) => fix(ctx, params.cfg, target, issue))),
        ...items.map((issue) => sync(ctx, issue)),
    ]);
    const fixed = results.reduce((acc, count) => acc + count, 0);
    params.core.info(`[META] fixed ${fixed} items`);
    return { fixed, provider: fixed > 0 ? 'mixed' : 'none' };
};

// --- Export -----------------------------------------------------------------

export { run };
export type { Commit, Config, Spec };
