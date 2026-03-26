import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- [CONSTANTS] -------------------------------------------------------------

const _HARNESS_ROOT            = fileURLToPath(new URL('..', import.meta.url));
const _PLUGIN_ROOT             = fileURLToPath(new URL('../../plugin', import.meta.url));
const _DIST_ROOT               = join(_HARNESS_ROOT, 'dist');
const _RELEASE_ROOT            = join(_DIST_ROOT, 'release');
const _ASSETS_ROOT             = join(_RELEASE_ROOT, 'assets');
const _SOURCE_ASSETS_ROOT      = join(_HARNESS_ROOT, 'assets');
const _PLUGIN_METADATA         = join(_PLUGIN_ROOT, 'dist/yak/metadata.json');
const _PLUGIN_DIST             = join(_PLUGIN_ROOT, 'dist/yak');
const _RELEASE_METADATA        = join(_SOURCE_ASSETS_ROOT, 'release.json');
const _REPO_PACKAGE            = join(_HARNESS_ROOT, '..', '..', '..', 'package.json');
const _RELEASE_DATABASE_DIGEST = (process.env['KARGADAN_RELEASE_DATABASE_DIGEST'] ?? '').trim();
const _RELEASE_DATABASE_IMAGE  = (process.env['KARGADAN_RELEASE_DATABASE_IMAGE'] ?? '').trim();
const _LAUNCHER = `#!/bin/sh
set -eu
DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/main.js" "$@"
`;

// --- [FUNCTIONS] -------------------------------------------------------------

// BOUNDARY ADAPTER — build script aborts on failed preconditions
function _demand(ok: boolean, msg: string): asserts ok {
    ok || (() => { process.stderr.write(`[FATAL] ${msg}\n`); process.exit(1); })();
}
const _pinComposeImage = (contents: string, image: string) => {
    const base = (image.split('@').at(0) ?? image).replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    const pinned = contents.replace(new RegExp(String.raw`^(\s*image:\s*)${base}\S*$`, 'mu'), `$1${image}`);
    _demand(pinned !== contents, 'Release compose file is missing a Docker image stanza to pin.');
    _demand(!pinned.includes('sha256:pending'), `Release compose file still contains a placeholder digest after pinning: ${image}`);
    return pinned;
};
const _releaseFiles = (root: string, prefix = ''): ReadonlyArray<string> =>
    readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
            ? _releaseFiles(root, join(prefix, entry.name))
            : join(prefix, entry.name),
    );

// --- [ENTRY] -----------------------------------------------------------------

_demand(process.platform === 'darwin', 'Kargadan release packaging must run on macOS because the shipped bundle vendors a macOS Rhino plugin and a macOS Node runtime.');
const _requiredNode = (JSON.parse(readFileSync(_REPO_PACKAGE, 'utf8')) as { engines?: { node?: string } }).engines?.node?.trim() ?? '';
_demand(_requiredNode.length > 0, `Repository package metadata at ${_REPO_PACKAGE} must define engines.node for release packaging.`);
_demand(process.versions.node === _requiredNode, `Kargadan release packaging must run with Node ${_requiredNode}; current runtime is ${process.versions.node}.`);
_demand(_RELEASE_DATABASE_DIGEST.length > 0, 'KARGADAN_RELEASE_DATABASE_DIGEST is required to build the packaged release.');
_demand(_RELEASE_DATABASE_IMAGE.length > 0, 'KARGADAN_RELEASE_DATABASE_IMAGE is required to build the packaged release.');

rmSync(_RELEASE_ROOT, { force: true, recursive: true });
mkdirSync(_ASSETS_ROOT, { recursive: true });
copyFileSync(join(_DIST_ROOT, 'main.js'), join(_RELEASE_ROOT, 'main.js'));
copyFileSync(process.execPath, join(_RELEASE_ROOT, 'node'));
writeFileSync(join(_RELEASE_ROOT, 'kargadan'), _LAUNCHER);
chmodSync(join(_RELEASE_ROOT, 'kargadan'), 0o755);
chmodSync(join(_RELEASE_ROOT, 'node'), 0o755);
await Promise.all(['docker-compose.release.yml', 'release.json'].map((f) => cp(join(_SOURCE_ASSETS_ROOT, f), join(_ASSETS_ROOT, f))));

_demand(existsSync(_PLUGIN_METADATA), `Bundled Yak metadata was not found at ${_PLUGIN_METADATA}. Run the plugin packaging target first.`);
const metadata = JSON.parse(readFileSync(_PLUGIN_METADATA, 'utf8')) as { packageFileName: string; sha256: string; version: string };
const release = JSON.parse(readFileSync(_RELEASE_METADATA, 'utf8')) as {
    database: { composeRelativePath: string; digest: string; image: string; requiredServerVersion: string; requiredVectorVersion: string };
    plugin: { bundleRelativePath: string; packageName: string; rhinoChannel: string; rhinoMajor: number; rhpFileName: string; sha256: string; version: string };
    runtime?: { arch: string; nodeVersion: string; platform: string };
    version: string;
};
_demand(release.database.digest === 'sha256:pending', `Release template digest must stay pending in ${_RELEASE_METADATA}.`);
_demand(release.database.image.includes('sha256:pending'), `Release template image must stay pending in ${_RELEASE_METADATA}.`);

mkdirSync(join(_ASSETS_ROOT, 'plugin'), { recursive: true });
copyFileSync(join(_PLUGIN_DIST, metadata.packageFileName), join(_ASSETS_ROOT, 'plugin', metadata.packageFileName));
const nextRelease = {
    ...release,
    database: { ...release.database, digest: _RELEASE_DATABASE_DIGEST, image: _RELEASE_DATABASE_IMAGE },
    plugin: { ...release.plugin, bundleRelativePath: `plugin/${metadata.packageFileName}`, sha256: metadata.sha256, version: metadata.version },
    runtime: { arch: process.arch, nodeVersion: process.versions.node, platform: process.platform },
    version: metadata.version,
};

_demand(/^sha256:[a-f0-9]{64}$/u.test(nextRelease.database.digest), `Release database digest is not pinned: ${nextRelease.database.digest}`);
_demand(nextRelease.database.image.includes(`@${nextRelease.database.digest}`), `Release database image must be pinned by digest: ${nextRelease.database.image}`);
_demand(nextRelease.plugin.sha256.trim().length > 0, `Release plugin checksum is missing for ${nextRelease.plugin.bundleRelativePath}.`);
_demand(nextRelease.runtime.nodeVersion === process.versions.node, `Release runtime metadata must record the bundled Node version ${process.versions.node}.`);

const _compose = readFileSync(join(_ASSETS_ROOT, basename(release.database.composeRelativePath)), 'utf8');
_demand(!/^\s*build:/mu.test(_compose), `Release compose file ${release.database.composeRelativePath} still contains a local build stanza.`);
writeFileSync(join(_ASSETS_ROOT, basename(release.database.composeRelativePath)), _pinComposeImage(_compose, nextRelease.database.image));
writeFileSync(join(_ASSETS_ROOT, 'release.json'), JSON.stringify(nextRelease, null, 2));
writeFileSync(join(_RELEASE_ROOT, 'SHA256SUMS.txt'), _releaseFiles(_RELEASE_ROOT)
    .filter((path) => path !== 'SHA256SUMS.txt')
    .sort((left, right) => left.localeCompare(right))
    .map((path) => `${createHash('sha256').update(readFileSync(join(_RELEASE_ROOT, path))).digest('hex')}  ${path}`)
    .join('\n')
    .concat('\n'));

process.stdout.write(`${join(_RELEASE_ROOT, 'kargadan')}\n`);
