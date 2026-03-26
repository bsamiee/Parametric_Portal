import { createHash } from 'node:crypto';
import * as FileSystem from '@effect/platform/FileSystem';
import { Data, Effect, Match, Option } from 'effect';
import { shellExec } from './postgres.ts';
import { RuntimeAssets } from './release.ts';

// --- [TYPES] -----------------------------------------------------------------

type InstalledPackage = {
    readonly name:    string;
    readonly version: string;
};

// --- [ERRORS] ----------------------------------------------------------------

class PluginManagerError extends Data.TaggedError('PluginManagerError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  'checksum' | 'install' | 'not_found';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _parseYakList = (stdout: string): ReadonlyArray<InstalledPackage> =>
    stdout
        .split('\n')
        .map((line) => line.trim())
        .flatMap((line) => {
            const match = /^(.+?) \((.+)\)$/u.exec(line);
            return match === null
                ? []
                : [{ name: match[1]?.trim() ?? '', version: match[2]?.trim() ?? '' } satisfies InstalledPackage];
        })
        .filter((entry) => entry.name.length > 0 && entry.version.length > 0);
const _verifyChecksum = (path: string, expectedSha256: string) =>
    Match.value(expectedSha256.trim().length > 0).pipe(
        Match.when(false, () => Effect.void),
        Match.orElse(() =>
            FileSystem.FileSystem.pipe(
                Effect.flatMap((fs) => fs.readFile(path)),
                Effect.map((bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')),
                Effect.filterOrFail(
                    (actual) => actual === expectedSha256,
                    (actual) => new PluginManagerError({
                        detail: { actual, expected: expectedSha256, path },
                        message: `Bundled Rhino plugin checksum mismatch for ${path}.`,
                        reason:  'checksum',
                    }),
                ),
                Effect.asVoid,
            ),
        ),
    );

// --- [OBJECT] ----------------------------------------------------------------

const PluginManager = {
    install: (yakPath: string) =>
        Effect.gen(function* () {
            const status = yield* PluginManager.status(yakPath);
            const bundlePath = yield* Match.value(status.bundlePath).pipe(
                Match.when({ _tag: 'Some' }, ({ value }) => Effect.succeed(value)),
                Match.orElse(() => Effect.fail(new PluginManagerError({
                    detail:  status,
                    message: `Bundled Rhino plugin was not found for ${status.packageName}@${status.expectedVersion}. Rebuild the release bundle before installing the plugin.`,
                    reason:  'not_found',
                }))),
            );
            yield* Match.value(status.installedVersion).pipe(
                Match.when({ _tag: 'Some' }, () => shellExec(yakPath, ['uninstall', status.packageName])),
                Match.orElse(() => Effect.void),
            ).pipe(
                Effect.zipRight(_verifyChecksum(bundlePath, status.bundleSha256)),
                Effect.zipRight(shellExec(yakPath, ['install', bundlePath])),
                Effect.mapError((detail) => detail instanceof PluginManagerError
                    ? detail
                    : new PluginManagerError({
                        detail,
                        message: `Rhino plugin install failed for bundled package ${status.packageName}@${status.expectedVersion}.`,
                        reason:  'install',
                    })),
            );
            return yield* PluginManager.status(yakPath);
        }),
    status: (yakPath: string) =>
        Effect.gen(function* () {
            const [fs, listOutput, release, bundlePath] = yield* Effect.all([
                FileSystem.FileSystem,
                shellExec(yakPath, ['list']).pipe(Effect.catchAll(() => Effect.succeed({ stderr: '', stdout: '' }))),
                RuntimeAssets.readRelease,
                RuntimeAssets.pluginBundlePath,
            ]);
            const bundleExists = yield* fs.exists(bundlePath);
            const installed = _parseYakList(listOutput.stdout);
            const installedCurrent = installed.find((entry) => entry.name === release.plugin.packageName);
            return {
                bundlePath: Match.value(bundleExists).pipe(
                    Match.when(true, () => Option.some(bundlePath)),
                    Match.orElse(() => Option.none<string>()),
                ),
                bundleSha256: release.plugin.sha256,
                expectedVersion: release.plugin.version,
                installedVersion: Option.fromNullable(installedCurrent?.version),
                packageName: release.plugin.packageName,
                rhpFileName: release.plugin.rhpFileName,
            } as const;
        }),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { PluginManager, PluginManagerError };
