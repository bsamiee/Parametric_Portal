import { Config, Duration, Effect, Match, Option, Schema as S } from 'effect';
import { DEFAULT_LOOP_OPERATIONS, ObjectRefSchema, OperationSchema } from './protocol/schemas';

// --- [FUNCTIONS] -------------------------------------------------------------

const _splitCsv = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);

// --- [CONSTANTS] -------------------------------------------------------------

const HarnessConfig = {
    checkpointDatabaseUrl:     Config.redacted('KARGADAN_CHECKPOINT_DATABASE_URL'),
    commandDeadlineMs:         Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000)),
    commandManifestEntityType: Config.string('KARGADAN_COMMAND_MANIFEST_ENTITY_TYPE').pipe(Config.withDefault('command')),
    commandManifestJson:       Config.string('KARGADAN_COMMAND_MANIFEST_JSON').pipe(Config.withDefault('')),
    commandManifestNamespace:  Config.string('KARGADAN_COMMAND_MANIFEST_NAMESPACE').pipe(Config.withDefault('kargadan')),
    commandManifestScopeId:    Config.string('KARGADAN_COMMAND_MANIFEST_SCOPE_ID').pipe(
        Config.withDefault(''),
        Effect.flatMap((value) =>
            Match.value(value.trim()).pipe(
                Match.when('', () => Effect.succeed(Option.none<string>())),
                Match.orElse((scopeId) => S.decodeUnknown(S.UUID)(scopeId).pipe(Effect.map(Option.some))),
            ),
        ),
    ),
    commandManifestVersion:  Config.string('KARGADAN_COMMAND_MANIFEST_VERSION').pipe(Config.withDefault('')),
    correctionCycles:        Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1)),
    heartbeatIntervalMs:     Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000)),
    heartbeatTimeoutMs:      Config.integer('KARGADAN_HEARTBEAT_TIMEOUT_MS').pipe(Config.withDefault(15_000)),
    pgConnectTimeout:        Config.duration('KARGADAN_PG_CONNECT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
    pgIdleTimeout:           Config.duration('KARGADAN_PG_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30))),
    pgMaxConnections:        Config.integer('KARGADAN_PG_MAX_CONNECTIONS').pipe(Config.withDefault(5)),
    protocolVersion:         Config.string('KARGADAN_PROTOCOL_VERSION').pipe(Config.withDefault('1.0'),
        Effect.filterOrFail((v) => /^\d+\.\d+$/.test(v), (v) => new Error(`Invalid KARGADAN_PROTOCOL_VERSION: '${v}'`)),
        Effect.map((v) => { const [major = '0', minor = '0'] = v.split('.'); return { major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) }; })),
    reconnectBackoffBaseMs:  Config.integer('KARGADAN_RECONNECT_BACKOFF_BASE_MS').pipe(Config.withDefault(500)),
    reconnectBackoffMaxMs:   Config.integer('KARGADAN_RECONNECT_BACKOFF_MAX_MS').pipe(Config.withDefault(30_000)),
    reconnectMaxAttempts:    Config.integer('KARGADAN_RECONNECT_MAX_ATTEMPTS').pipe(Config.withDefault(50)),
    resolveCapabilities: Effect.all({
        optional: Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture'), Config.map(_splitCsv)),
        required: Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create'), Config.map(_splitCsv)),
    }),
    resolveLoopOperations: Config.string('KARGADAN_LOOP_OPERATIONS').pipe(
        Config.withDefault(DEFAULT_LOOP_OPERATIONS.join(',')),
        Config.map(_splitCsv),
        Effect.flatMap(S.decodeUnknown(S.Array(OperationSchema))),
    ),
    resolveWriteObjectRef: Effect.all({
        objectId:       Config.string('KARGADAN_WRITE_OBJECT_ID').pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
        sourceRevision: Config.integer('KARGADAN_WRITE_OBJECT_SOURCE_REVISION').pipe(Config.withDefault(0)),
        typeTag:        Config.string('KARGADAN_WRITE_OBJECT_TYPE_TAG').pipe(Config.withDefault('Brep')),}).pipe(Effect.flatMap(S.decodeUnknown(ObjectRefSchema))),
    retryMaxAttempts:   Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5)),
    sessionToken:       Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token')),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessConfig };
