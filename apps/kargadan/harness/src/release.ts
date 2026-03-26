import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as FileSystem from '@effect/platform/FileSystem';
import { Data, Effect, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ReleaseMetadataSchema = S.Struct({
    database: S.Struct({
        composeRelativePath:   S.NonEmptyTrimmedString,
        digest:                S.NonEmptyTrimmedString,
        image:                 S.NonEmptyTrimmedString,
        requiredServerVersion: S.NonEmptyTrimmedString,
        requiredVectorVersion: S.NonEmptyTrimmedString,
    }),
    plugin: S.Struct({
        bundleRelativePath: S.NonEmptyTrimmedString,
        packageName:        S.NonEmptyTrimmedString,
        rhinoChannel:       S.Literal('wip'),
        rhinoMajor:         S.Int.pipe(S.greaterThan(0)),
        rhpFileName:        S.NonEmptyTrimmedString,
        sha256:             S.String,
        version:            S.NonEmptyTrimmedString,
    }),
    runtime: S.optional(S.Struct({
        arch:        S.NonEmptyTrimmedString,
        nodeVersion: S.NonEmptyTrimmedString,
        platform:    S.NonEmptyTrimmedString,
    })),
    version: S.NonEmptyTrimmedString,
});
const _PluginMetadataSchema = S.Struct({
    packageFileName: S.NonEmptyTrimmedString,
});

// --- [TYPES] -----------------------------------------------------------------

type _RuntimePaths = {
    readonly assetsRoot: string;
    readonly mode: 'development' | 'packaged';
    readonly releasePath: string;
    readonly runtimeRoot: string;
};

// --- [ERRORS] ----------------------------------------------------------------

class RuntimeAssetError extends Data.TaggedError('RuntimeAssetError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason: 'invalid_release' | 'missing_asset';
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const _DEVELOPMENT_ROOT = dirname(_MODULE_DIR);
const _DEVELOPMENT_PLUGIN_METADATA = join(_DEVELOPMENT_ROOT, '..', 'plugin', 'dist', 'yak', 'metadata.json');

// --- [FUNCTIONS] -------------------------------------------------------------

const _runtimePaths: Effect.Effect<_RuntimePaths, unknown, FileSystem.FileSystem> = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const packagedReleasePath = join(_MODULE_DIR, 'assets', 'release.json');
    const developmentReleasePath = join(_DEVELOPMENT_ROOT, 'assets', 'release.json');
    const [packagedExists, developmentExists] = yield* Effect.all([
        fs.exists(packagedReleasePath),
        fs.exists(developmentReleasePath),
    ]);
    return packagedExists
        ? {
            assetsRoot:  join(_MODULE_DIR, 'assets'),
            mode:        'packaged',
            releasePath: packagedReleasePath,
            runtimeRoot: _MODULE_DIR,
        } satisfies _RuntimePaths
        : developmentExists
            ? {
                assetsRoot:  join(_DEVELOPMENT_ROOT, 'assets'),
                mode:        'development',
                releasePath: developmentReleasePath,
                runtimeRoot: _DEVELOPMENT_ROOT,
            } satisfies _RuntimePaths
            : yield* Effect.fail(new RuntimeAssetError({
                message: `Kargadan release metadata was not found at ${packagedReleasePath} or ${developmentReleasePath}.`,
                reason:  'missing_asset',
            }))
});
const _readRelease = _runtimePaths.pipe(
    Effect.flatMap(({ releasePath }) =>
        FileSystem.FileSystem.pipe(
            Effect.flatMap((fs) => fs.readFileString(releasePath)),
            Effect.mapError((detail) => new RuntimeAssetError({
                detail,
                message: `Kargadan release metadata could not be read from ${releasePath}.`,
                reason:  'missing_asset',
            })),
            Effect.flatMap(S.decode(S.parseJson(ReleaseMetadataSchema))),
            Effect.mapError((detail) => detail instanceof RuntimeAssetError
                ? detail
                : new RuntimeAssetError({
                    detail,
                    message: `Kargadan release metadata at ${releasePath} is invalid.`,
                    reason:  'invalid_release',
                })),
        )),
);
const _composePath = Effect.gen(function* () {
    const [paths, release] = yield* Effect.all([_runtimePaths, _readRelease]);
    return join(paths.assetsRoot, release.database.composeRelativePath);
});
const _pluginBundlePath = Effect.gen(function* () {
    const [fs, paths, release] = yield* Effect.all([FileSystem.FileSystem, _runtimePaths, _readRelease]);
    return yield* (paths.mode === 'packaged'
        ? Effect.succeed(join(paths.assetsRoot, release.plugin.bundleRelativePath))
        : fs.readFileString(_DEVELOPMENT_PLUGIN_METADATA).pipe(
            Effect.flatMap(S.decode(S.parseJson(_PluginMetadataSchema))),
            Effect.map((metadata) => join(dirname(_DEVELOPMENT_PLUGIN_METADATA), metadata.packageFileName)),
            Effect.catchAll(() => Effect.succeed(join(paths.assetsRoot, release.plugin.bundleRelativePath))),
        ));
});

// --- [OBJECT] ----------------------------------------------------------------

const RuntimeAssets = {
    composePath:      _composePath,
    pluginBundlePath: _pluginBundlePath,
    readRelease:      _readRelease,
    runtimePaths:     _runtimePaths,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { RuntimeAssets };
