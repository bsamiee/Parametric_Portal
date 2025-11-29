#!/usr/bin/env tsx
/**
 * CLI wrapper for ai-meta.ts - runs in GitHub Actions via tsx.
 * Reads config from environment, outputs to GITHUB_OUTPUT.
 */

import { appendFileSync } from 'node:fs';
import { Octokit } from '@octokit/rest';
import { type FixSpec, run } from './ai-meta.ts';

const env = (k: string) => process.env[k] ?? '';
const [owner, repo] = env('GH_REPO').split('/');

const octokit = new Octokit({ auth: env('GITHUB_TOKEN') });

const github = {
    rest: {
        issues: {
            addLabels: (p: { issue_number: number; labels: string[]; owner: string; repo: string }) =>
                octokit.issues.addLabels(p),
            get: (p: { issue_number: number; owner: string; repo: string }) => octokit.issues.get(p),
            listForRepo: (p: { owner: string; repo: string; state: string }) => octokit.issues.listForRepo(p),
            removeLabel: (p: { issue_number: number; name: string; owner: string; repo: string }) =>
                octokit.issues.removeLabel(p),
            update: (p: { body?: string; issue_number: number; owner: string; repo: string; title?: string }) =>
                octokit.issues.update(p),
        },
        pulls: {
            get: (p: { owner: string; pull_number: number; repo: string }) => octokit.pulls.get(p),
            list: (p: { owner: string; repo: string; state: string }) => octokit.pulls.list(p),
            listCommits: (p: { owner: string; pull_number: number; repo: string }) => octokit.pulls.listCommits(p),
        },
    },
};

const core = {
    info: (msg: string) => console.log(msg),
    setOutput: (name: string, value: string | number) => appendFileSync(env('GITHUB_OUTPUT'), `${name}=${value}\n`),
};

const spec: FixSpec = {
    commits: [],
    limit: parseInt(env('META_LIMIT') || '10', 10),
    n: env('META_NUMBER') ? parseInt(env('META_NUMBER'), 10) : undefined,
    target: (env('META_TARGET') || 'all') as FixSpec['target'],
};

const agentConfig = {
    key: env('ANTHROPIC_API_KEY'),
    token: env('GITHUB_TOKEN'),
};

const context = {
    payload: {
        pull_request: env('GH_PR_NUMBER') ? { number: parseInt(env('GH_PR_NUMBER'), 10) } : undefined,
    },
    repo: { owner, repo },
};

run({ agentConfig, context, core, github, spec } as never)
    .then((result) => {
        core.setOutput('fixed', result.fixed);
        core.setOutput('provider', result.provider);
        core.setOutput('commit_message', result.commitMessage ?? '');
    })
    .catch((err) => {
        console.error('Meta fixer failed:', err);
        process.exit(1);
    });
