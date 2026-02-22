/**
 * Reads the Kargadan plugin port file from ~/.kargadan/port, validates JSON structure and PID liveness, and returns the dynamic WebSocket port.
 * Stale port files (dead PID) and missing/invalid files surface as typed errors for the reconnection supervisor to handle.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import { Data, Effect, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const PortFileSchema = S.Struct({
    pid:       S.Int,
    port:      S.Int,
    startedAt: S.String,
});

// --- [CONSTANTS] -------------------------------------------------------------

const _portFilePath = join(homedir(), '.kargadan', 'port');

// --- [ERRORS] ----------------------------------------------------------------

class PortFileNotFound extends Data.TaggedError('PortFileNotFound')<{
    readonly path: string;
}> {}

class PortFileStale extends Data.TaggedError('PortFileStale')<{
    readonly pid:  number;
    readonly path: string;
}> {}

class PortFileInvalid extends Data.TaggedError('PortFileInvalid')<{
    readonly path:  string;
    readonly cause: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _decodePortFile = S.decodeUnknown(S.parseJson(PortFileSchema));

const readPortFile = Effect.fn('kargadan.portDiscovery.read')(function* () {
    const fs = yield* FileSystem.FileSystem;

    const content = yield* fs.readFileString(_portFilePath).pipe(
        Effect.mapError(() => new PortFileNotFound({ path: _portFilePath })),
    );

    const parsed = yield* _decodePortFile(content).pipe(
        Effect.mapError((cause) => new PortFileInvalid({ cause, path: _portFilePath })),
    );

    yield* Effect.try(() => process.kill(parsed.pid, 0)).pipe(
        Effect.mapError(() => new PortFileStale({ path: _portFilePath, pid: parsed.pid })),
    );

    return parsed;
});

// --- [EXPORT] ----------------------------------------------------------------

export { PortFileInvalid, PortFileNotFound, PortFileSchema, PortFileStale, readPortFile };
