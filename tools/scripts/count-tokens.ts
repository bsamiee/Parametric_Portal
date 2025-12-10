#!/usr/bin/env tsx
/**
 * Token counter for Claude context estimation.
 * [~] ±5% variance for Claude 3+ models.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { countTokens } from '@anthropic-ai/tokenizer';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    bar: { empty: '·', fill: '━', width: 24 },
    exts: ['.md', '.ts', '.tsx', '.json'] as const,
    pad: { name: 20, num: 7 },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const bar = (ratio: number): string =>
    B.bar.fill.repeat(Math.round(ratio * B.bar.width)).padEnd(B.bar.width, B.bar.empty);

const pct = (n: number, t: number): string => (t ? `${Math.round((n / t) * 100)}%` : '—').padStart(4);

const resolve = (arg: string): readonly string[] => {
    const path = arg.startsWith('/') ? arg : join(process.cwd(), arg);
    const stat = statSync(path);
    return stat.isDirectory()
        ? readdirSync(path)
              .filter((f: string) => B.exts.some((e) => f.endsWith(e)))
              .map((f: string) => join(path, f))
              .filter((p: string) => statSync(p).isFile())
        : [path];
};

const header = (args: readonly string[], fileCount: number): string => {
    const paths = args.length;
    const label = args.length === 1 ? args[0] : `${paths} paths`;
    return fileCount === 1 ? `[TOKENS] ${args[0]}` : `[TOKENS] ${label} → ${fileCount} files`;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const run = (): void => {
    const args = process.argv.slice(2);

    if (!args.length) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log('\n  usage: uv run .claude/skills/nx-tools/scripts/nx.py tokens --path <file|dir>\n');
        return;
    }

    const files = args.flatMap(resolve);
    const results = files
        .map((file: string) => ({ file, tokens: countTokens(readFileSync(file, 'utf-8')) }))
        .sort((a: { file: string; tokens: number }, b: { file: string; tokens: number }) => b.tokens - a.tokens);
    const total = results.reduce((sum: number, r: { file: string; tokens: number }) => sum + r.tokens, 0);

    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(
        [
            '',
            header(args, results.length),
            '',
            ...results.map(
                (r: { file: string; tokens: number }) =>
                    `  ${r.tokens.toLocaleString().padStart(B.pad.num)}  ${basename(r.file).padEnd(B.pad.name)}  ${bar(r.tokens / (total || 1))}  ${pct(r.tokens, total)}`,
            ),
            `  ${'─'.repeat(B.pad.num + B.pad.name + B.bar.width + 10)}`,
            `  ${total.toLocaleString().padStart(B.pad.num)}  ${'total'.padEnd(B.pad.name)}  ${B.bar.fill.repeat(B.bar.width)}  [~] ±5%`,
            '',
        ].join('\n'),
    );
};

run();
