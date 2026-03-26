import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- [CONSTANTS] -------------------------------------------------------------

const _HARNESS_ROOT = fileURLToPath(new URL('..', import.meta.url));
const _RELEASE_ROOT = join(_HARNESS_ROOT, 'dist', 'release');
const _REQUIRED_FILES = ['SHA256SUMS.txt', 'kargadan', 'main.js', 'node'] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

function _demand(ok: boolean, message: string): asserts ok {
    ok || (() => { process.stderr.write(`[FATAL] ${message}\n`); process.exit(1); })();
}
const _releasePath = (...segments: ReadonlyArray<string>) => join(_RELEASE_ROOT, ...segments);
const _run = (args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    spawnSync(_releasePath('kargadan'), [...args], {
        cwd: _RELEASE_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
const _assertRun = (label: string, args: ReadonlyArray<string>, expectedStatus: number, env?: NodeJS.ProcessEnv) => {
    const result = _run(args, env);
    _demand(result.status === expectedStatus, `${label} exited with ${String(result.status)}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return `${result.stdout}\n${result.stderr}`;
};

// --- [ENTRY] -----------------------------------------------------------------

_REQUIRED_FILES.forEach((path) => {
    _demand(existsSync(_releasePath(path)), `Missing packaged release file: ${path}`);
});
accessSync(_releasePath('kargadan'), constants.X_OK);
accessSync(_releasePath('node'), constants.X_OK);

const _releaseMetadata = JSON.parse(readFileSync(_releasePath('assets', 'release.json'), 'utf8')) as {
    database: { digest: string; image: string };
    plugin: { bundleRelativePath: string; sha256: string };
    runtime: { arch: string; nodeVersion: string; platform: string };
};
const _compose = readFileSync(_releasePath('assets', 'docker-compose.release.yml'), 'utf8');
const _checksums = readFileSync(_releasePath('SHA256SUMS.txt'), 'utf8');

_demand(_releaseMetadata.database.digest !== 'sha256:pending', 'Packaged release still contains placeholder database digest.');
_demand(_releaseMetadata.database.image.includes(`@${_releaseMetadata.database.digest}`), `Packaged release image is not pinned by digest: ${_releaseMetadata.database.image}`);
_demand(_releaseMetadata.plugin.sha256.trim().length > 0, 'Packaged release plugin checksum is empty.');
_demand(_releaseMetadata.runtime.platform === 'darwin' && _releaseMetadata.runtime.arch.length > 0 && _releaseMetadata.runtime.nodeVersion.length > 0, 'Packaged release metadata is missing runtime provenance.');
_demand(!_compose.includes('sha256:pending'), 'Packaged compose file still contains placeholder digest.');
_demand(!/^\s*build:/mu.exec(_compose), 'Packaged compose file still contains a local build stanza.');
_demand(existsSync(_releasePath('assets', _releaseMetadata.plugin.bundleRelativePath)), `Packaged release plugin bundle is missing: ${_releaseMetadata.plugin.bundleRelativePath}`);
_demand(
    _checksums.includes('  kargadan\n')
    && _checksums.includes('  main.js\n')
    && _checksums.includes('  node\n')
    && _checksums.includes('  assets/release.json\n')
    && _checksums.includes('  assets/docker-compose.release.yml\n')
    && _checksums.includes(`  assets/${_releaseMetadata.plugin.bundleRelativePath}\n`),
    'SHA256SUMS.txt is missing required packaged entries.',
);

const _helpOutput = _assertRun('packaged --help', ['--help'], 0);
_demand(_helpOutput.includes('setup') && _helpOutput.includes('plugin') && _helpOutput.includes('diagnostics'), 'Packaged --help output is missing expected top-level commands.');

const _pluginHelpOutput = _assertRun('packaged plugin --help', ['plugin', '--help'], 0);
_demand(_pluginHelpOutput.includes('install') && _pluginHelpOutput.includes('upgrade') && _pluginHelpOutput.includes('status'), 'Packaged plugin --help output is missing expected commands.');

const _home = mkdtempSync(join(tmpdir(), 'kargadan-release-smoke-'));
const _readinessOutput = _assertRun('packaged bare invocation', [], 1, {
    HOME: _home,
});
_demand(_readinessOutput.includes('kargadan readiness') && _readinessOutput.includes('action=kargadan setup'), 'Packaged bare invocation did not emit the expected readiness guidance.');

process.stdout.write(`${_RELEASE_ROOT}\n`);
