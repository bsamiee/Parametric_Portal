import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const _home = mkdtempSync(join(tmpdir(), 'kargadan-cli-smoke-'));
const _baseEnv = {
    ...process.env,
    KARGADAN_DATABASE_URL: undefined,
    KARGADAN_RHINO_APP_PATH: undefined,
    KARGADAN_YAK_PATH: undefined,
} satisfies NodeJS.ProcessEnv;
const _runCli = (args: ReadonlyArray<string>, input?: { readonly env?: NodeJS.ProcessEnv; readonly home?: string }) =>
    spawnSync(
        'pnpm',
        ['--filter', '@parametric-portal/kargadan-harness', 'exec', 'tsx', 'src/cli.ts', ...args],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ..._baseEnv,
                HOME: input?.home ?? _home,
                ...(input?.env ?? {}),
            },
            stdio: 'pipe',
        },
    );

it('P8-CLI-ROOT-01: bare non-TTY invocation prints action-required readiness', () => {
    const result = _runCli([]);
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('kargadan readiness');
    expect(output).toContain('action=kargadan setup');
});

it('P8-CLI-NTTY-01: non-TTY invocation fails with typed tty_required rail', () => {
    const result = _runCli(['run', '--intent', 'test']);
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('kargadan tty_required');
    expect(output).toContain('failureClass: correctable');
    expect(output).toContain('recovery:');
});

it('P8-CLI-HELP-01: --help output contains the main top-level commands', () => {
    const result = _runCli(['--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('auth');
    expect(output).toContain('plugin');
    expect(output).toContain('setup');
    expect(output).toContain('sessions');
    expect(output).toContain('config');
    expect(output).toContain('diagnostics');
});

it('P8-CLI-HELP-02: setup --help shows first-run options', () => {
    const result = _runCli(['setup', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('--provider');
    expect(output).toContain('--model');
    expect(output).toContain('--launch-rhino');
    expect(output).not.toContain('--database-provider');
    expect(output).not.toContain('--database-url');
});

it('P8-CLI-HELP-03: sessions list --help shows options', () => {
    const result = _runCli(['sessions', 'list', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('--limit');
    expect(output).toContain('--status');
    expect(output).toContain('--cursor');
});

it('P8-CLI-HELP-04: plugin --help shows install surface', () => {
    const result = _runCli(['plugin', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('status');
    expect(output).toContain('install');
    expect(output).toContain('upgrade');
});

it('P8-CLI-HELP-05: diagnostics --help shows description', () => {
    const result = _runCli(['diagnostics', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Diagnostics commands');
});

it('P8-CLI-VAL-01: diagnostics live --prepare reports the deprecation path', () => {
    const result = _runCli(['diagnostics', 'live', '--prepare']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('deprecated');
    expect(output).toContain('kargadan plugin install');
});

it('P8-CLI-STA-01: auth status succeeds without a ready database', () => {
    const result = _runCli(['auth', 'status'], {
        env: { KARGADAN_DATABASE_URL: 'postgresql://127.0.0.1:1/kargadan' },
    });
    expect(result.status).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('auth status');
    expect(output).toContain('databaseProvider=env_override');
    expect(output).toContain('selectionError=database_unreachable');
});

it('P8-CLI-STA-02: ai status succeeds without a ready database', () => {
    const result = _runCli(['ai', 'status'], {
        env: { KARGADAN_DATABASE_URL: 'postgresql://127.0.0.1:1/kargadan' },
    });
    expect(result.status).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('ai status');
    expect(output).toContain('databaseReady=false');
    expect(output).toContain('databaseProvider=env_override');
    expect(output).toContain('selectionError=database_unreachable');
});

it('P8-CLI-STA-03: env override outages surface the active provider instead of pretending the database is uninitialized', () => {
    const result = _runCli(['auth', 'status'], {
        env: { KARGADAN_DATABASE_URL: 'postgresql://127.0.0.1:1/kargadan' },
    });
    expect(result.status).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('databaseProvider=env_override');
    expect(output).toContain('selectionError=database_unreachable');
});

it('P8-CLI-WRN-01: nested legacy config keys are warned with their full path', () => {
    const home = mkdtempSync(join(tmpdir(), 'kargadan-cli-config-'));
    mkdirSync(join(home, '.kargadan'), { recursive: true });
    writeFileSync(join(home, '.kargadan', 'config.json'), JSON.stringify({
        ai: {
            geminiClientPath: '/tmp/client.json',
            openaiSecret: 'legacy-secret',
        },
    }, null, 2));
    const result = _runCli(['config'], { home });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('kargadan.config.unrecognized_keys');
    expect(output).toContain('ai.openaiSecret');
});

it('P8-CLI-VAL-02: plugin status rejects Rhino 8 paths even when they exist', () => {
    const fakeRhino8 = join(mkdtempSync(join(tmpdir(), 'kargadan-rhino-8-')), 'Rhino 8.app');
    mkdirSync(fakeRhino8, { recursive: true });
    const result = _runCli(['plugin', 'status', '--rhino-app', fakeRhino8, '--yak-path', '/missing/yak']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Rhino 9 WIP is required');
});

it('P8-CLI-VAL-03: invalid --format=xml produces validation error', () => {
    const result = _runCli(['sessions', 'export', '--format', 'xml', '--session-id', 'fake', '--output', '/dev/null']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/ndjson|csv|invalid|Expected/i);
});

it('P8-CLI-VAL-04: missing required --session-id on sessions trace produces error', () => {
    const result = _runCli(['sessions', 'trace']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/session-id|missing|required/i);
});
