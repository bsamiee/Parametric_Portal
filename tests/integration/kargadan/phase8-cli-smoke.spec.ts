import { spawnSync } from 'node:child_process';
import { it, expect } from 'vitest';

const _runCli = (args: ReadonlyArray<string>) =>
    spawnSync(
        'pnpm',
        ['--filter', '@parametric-portal/kargadan-harness', 'exec', 'tsx', 'src/cli.ts', ...args],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: 'pipe',
        },
    );

it('P8-CLI-NTTY-01: non-TTY invocation fails with typed tty_required rail', () => {
    const result = _runCli(['phase8 smoke']);
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
    expect(output).toContain('init');
    expect(output).toContain('sessions');
    expect(output).toContain('config');
    expect(output).toContain('doctor');
    expect(output).toContain('dev');
});

it('P8-CLI-HELP-02: sessions list --help shows options', () => {
    const result = _runCli(['sessions', 'list', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('--limit');
    expect(output).toContain('--status');
    expect(output).toContain('--cursor');
});

it('P8-CLI-HELP-03: doctor --help shows description', () => {
    const result = _runCli(['doctor', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Validate environment');
});

it('P8-CLI-HELP-04: dev --help shows prepare and launch subcommands', () => {
    const result = _runCli(['dev', '--help']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('prepare');
    expect(output).toContain('launch');
    expect(output).toContain('probe');
    expect(output).toContain('reindex');
});

it('P8-CLI-VAL-01: invalid --format=xml produces validation error', () => {
    const result = _runCli(['sessions', 'export', '--format', 'xml', '--session-id', 'fake', '--output', '/dev/null']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/ndjson|csv|invalid|Expected/i);
});

it('P8-CLI-VAL-02: missing required --session-id on sessions trace produces error', () => {
    const result = _runCli(['sessions', 'trace']);
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toMatch(/session-id|missing|required/i);
});
