import { execFile as _execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// --- [CONSTANTS] -------------------------------------------------------------

const _execFile = promisify(_execFileCallback);
const _PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const _PATHS = {
    buildRoot:         join(_PLUGIN_ROOT, 'bin/Release/net9.0'),
    csproj:            join(_PLUGIN_ROOT, 'ParametricPortal.Kargadan.Plugin.csproj'),
    distRoot:          join(_PLUGIN_ROOT, 'dist/yak'),
    icon:              join(_PLUGIN_ROOT, 'icon.png'),
    license:           join(_PLUGIN_ROOT, '..', '..', '..', 'LICENSE'),
    manifestTemplate:  join(_PLUGIN_ROOT, 'manifest.yml'),
    metadata:          join(_PLUGIN_ROOT, 'dist/yak/metadata.json'),
    readme:            join(_PLUGIN_ROOT, '..', 'README.md'),
    rhpFile:           join(_PLUGIN_ROOT, 'bin/Release/net9.0/ParametricPortal.Kargadan.Plugin.rhp'),
    stageRoot:         join(_PLUGIN_ROOT, 'dist/yak/stage'),
    yak:               process.env['KARGADAN_YAK_PATH']?.trim() || '/Applications/RhinoWIP.app/Contents/Resources/bin/yak',
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _version = (csproj: string) => {
    const match = /<Version>([^<]+)<\/Version>/u.exec(csproj)?.[1]?.trim();
    return match === undefined || match.length === 0
        ? (() => { process.stderr.write(`[FATAL] Could not determine plugin version from ${_PATHS.csproj}.\n`); process.exit(1); return '' as never; })()
        : match;
};

// --- [ENTRY] -----------------------------------------------------------------

const main = async () => {
    const csproj = await readFile(_PATHS.csproj, 'utf8');
    const version = _version(csproj);
    const manifestTemplate = await readFile(_PATHS.manifestTemplate, 'utf8');
    await rm(_PATHS.distRoot, { force: true, recursive: true });
    await mkdir(join(_PATHS.stageRoot, 'net9.0'), { recursive: true });
    await cp(_PATHS.buildRoot, join(_PATHS.stageRoot, 'net9.0'), { recursive: true });
    await cp(_PATHS.readme, join(_PATHS.stageRoot, basename(_PATHS.readme)));
    await cp(_PATHS.license, join(_PATHS.stageRoot, 'LICENSE.txt'));
    await cp(_PATHS.icon, join(_PATHS.stageRoot, basename(_PATHS.icon))).catch(() => undefined);
    await writeFile(join(_PATHS.stageRoot, 'manifest.yml'), manifestTemplate.replace(/^version:\s*.*/mu, `version: ${version}`));
    await _execFile(_PATHS.yak, ['build', '--platform', 'mac', '--version', version], { cwd: _PATHS.stageRoot, encoding: 'utf8' });
    const packageName = (await readdir(_PATHS.stageRoot))
        .filter((entry) => entry.endsWith('.yak'))
        .sort((left, right) => left.localeCompare(right))
        .at(-1);
    const validPackageName = packageName
        ?? (() => { process.stderr.write(`[FATAL] Yak build did not emit a package in ${_PATHS.stageRoot}.\n`); process.exit(1); return '' as never; })();
    const outputPath = join(_PATHS.distRoot, validPackageName);
    await mkdir(_PATHS.distRoot, { recursive: true });
    await cp(join(_PATHS.stageRoot, validPackageName), outputPath);
    const sha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
    const metadata = {
        packageFileName: validPackageName,
        packagePath:     outputPath,
        sha256,
        version,
    } as const;
    await writeFile(_PATHS.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
};

await main();
