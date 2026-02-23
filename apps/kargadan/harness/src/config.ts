/**
 * Resolves environment-driven HarnessConfig for the Kargadan harness via Effect Config.
 * Parses protocol version, capability sets, loop operations, reconnection, checkpoint, and heartbeat settings.
 */
import { Config, Duration, Effect, Schema as S } from 'effect';
import { CommandEnvelopeSchema, EnvelopeIdentitySchema } from './protocol/schemas';

// --- [CONSTANTS] -------------------------------------------------------------

const _env = {
    capabilityOptional:        Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture')),
    capabilityRequired:        Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create')),
    checkpointDatabaseUrl:     Config.string('KARGADAN_CHECKPOINT_DATABASE_URL'),
    commandDeadlineMs:         Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000)),
    correctionCycles:          Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1)),
    heartbeatIntervalMs:       Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000)),
    heartbeatTimeoutMs:        Config.integer('KARGADAN_HEARTBEAT_TIMEOUT_MS').pipe(Config.withDefault(15_000)),
    loopOperations:            Config.string('KARGADAN_LOOP_OPERATIONS').pipe(Config.withDefault('read.object.metadata,write.object.update')),
    pgConnectTimeout:          Config.duration('KARGADAN_PG_CONNECT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
    pgIdleTimeout:             Config.duration('KARGADAN_PG_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30))),
    pgMaxConnections:          Config.integer('KARGADAN_PG_MAX_CONNECTIONS').pipe(Config.withDefault(5)),
    protocolVersion:           Config.string('KARGADAN_PROTOCOL_VERSION').pipe(Config.withDefault('1.0')),
    reconnectBackoffBaseMs:    Config.integer('KARGADAN_RECONNECT_BACKOFF_BASE_MS').pipe(Config.withDefault(500)),
    reconnectBackoffMaxMs:     Config.integer('KARGADAN_RECONNECT_BACKOFF_MAX_MS').pipe(Config.withDefault(30_000)),
    reconnectMaxAttempts:      Config.integer('KARGADAN_RECONNECT_MAX_ATTEMPTS').pipe(Config.withDefault(50)),
    retryMaxAttempts:          Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5)),
    sessionToken:              Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token')),
    simulatedPluginRevision:   Config.string('KARGADAN_SIMULATED_PLUGIN_REVISION').pipe(Config.withDefault('harness-simulated')),
    writeObjectId:             Config.string('KARGADAN_WRITE_OBJECT_ID').pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
    writeObjectSourceRevision: Config.integer('KARGADAN_WRITE_OBJECT_SOURCE_REVISION').pipe(Config.withDefault(0)),
    writeObjectTypeTag:        Config.string('KARGADAN_WRITE_OBJECT_TYPE_TAG').pipe(Config.withDefault('Brep')),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _splitCsv = (value: string) =>
    value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

// --- [SCHEMA] ----------------------------------------------------------------

const _resolveProtocolVersion = _env.protocolVersion.pipe(Effect.flatMap(S.decodeUnknown(S.transform(
    S.String.pipe(S.pattern(/^\d+\.\d+$/)),
    EnvelopeIdentitySchema.fields.protocolVersion,
    {
        decode: (value) => {
            const [major = '0', minor = '0'] = value.split('.');
            return { major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) };
        },
        encode: (version) => `${version.major}.${version.minor}`,
        strict: true,
    },
))));
const _resolveCapabilities = Effect.all([_env.capabilityRequired, _env.capabilityOptional]).pipe(
    Effect.map(([required, optional]) => ({
        optional: _splitCsv(optional),
        required: _splitCsv(required),
    })),
);
const _resolveLoopOperations = _env.loopOperations.pipe(
    Effect.map(_splitCsv),
    Effect.flatMap((operations) => S.decodeUnknown(S.Array(CommandEnvelopeSchema.fields.operation))(operations)),
);
const _resolveWriteObjectRef = Effect.all([
    _env.writeObjectId,
    _env.writeObjectSourceRevision,
    _env.writeObjectTypeTag,
]).pipe(
    Effect.flatMap(([objectId, sourceRevision, typeTag]) =>
        Effect.all([
            S.decodeUnknown(S.UUID)(objectId),
            S.decodeUnknown(S.Int.pipe(S.greaterThanOrEqualTo(0)))(sourceRevision),
            S.decodeUnknown(S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail'))(typeTag),
        ]).pipe(
            Effect.map(([validatedObjectId, validatedSourceRevision, validatedTypeTag]) => ({
                objectId: validatedObjectId,
                sourceRevision: validatedSourceRevision,
                typeTag: validatedTypeTag,
            })),
        ),
    ),
);
const HarnessConfig = {
    checkpointDatabaseUrl:   _env.checkpointDatabaseUrl,
    commandDeadlineMs:       _env.commandDeadlineMs,
    correctionCycles:        _env.correctionCycles,
    heartbeatIntervalMs:     _env.heartbeatIntervalMs,
    heartbeatTimeoutMs:      _env.heartbeatTimeoutMs,
    pgConnectTimeout:        _env.pgConnectTimeout,
    pgIdleTimeout:           _env.pgIdleTimeout,
    pgMaxConnections:        _env.pgMaxConnections,
    protocolVersion:         _resolveProtocolVersion,
    reconnectBackoffBaseMs:  _env.reconnectBackoffBaseMs,
    reconnectBackoffMaxMs:   _env.reconnectBackoffMaxMs,
    reconnectMaxAttempts:    _env.reconnectMaxAttempts,
    resolveCapabilities:     _resolveCapabilities,
    resolveLoopOperations:   _resolveLoopOperations,
    resolveWriteObjectRef:   _resolveWriteObjectRef,
    retryMaxAttempts:        _env.retryMaxAttempts,
    sessionToken:            _env.sessionToken,
    simulatedPluginRevision: _env.simulatedPluginRevision,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessConfig };
