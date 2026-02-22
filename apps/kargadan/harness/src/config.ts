/**
 * Resolves environment-driven HarnessConfig for the Kargadan harness via Effect Config.
 * Parses protocol version, capability sets, loop operations, reconnection, checkpoint, and heartbeat settings.
 */
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Config, Duration, Effect, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _protocolVersion =         Config.string('KARGADAN_PROTOCOL_VERSION').pipe(Config.withDefault('1.0'));
const _commandDeadlineMs =       Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000));
const _retryMaxAttempts =        Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5));
const _correctionCycles =        Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1));
const _loopOperations =          Config.string('KARGADAN_LOOP_OPERATIONS').pipe(Config.withDefault('read.object.metadata,write.object.update'));
const _sessionToken =            Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token'));
const _heartbeatIntervalMs =     Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000));
const _heartbeatTimeoutMs =      Config.integer('KARGADAN_HEARTBEAT_TIMEOUT_MS').pipe(Config.withDefault(15_000));
const _simulatedPluginRevision = Config.string('KARGADAN_SIMULATED_PLUGIN_REVISION').pipe(Config.withDefault('harness-simulated'));
const _capabilityRequired =      Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create'));
const _capabilityOptional =      Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture'));
const _reconnectMaxAttempts =    Config.integer('KARGADAN_RECONNECT_MAX_ATTEMPTS').pipe(Config.withDefault(50));
const _checkpointDatabaseUrl =   Config.string('KARGADAN_CHECKPOINT_DATABASE_URL');
const _pgMaxConnections =        Config.integer('KARGADAN_PG_MAX_CONNECTIONS').pipe(Config.withDefault(5));
const _pgIdleTimeout =           Config.duration('KARGADAN_PG_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30)));
const _pgConnectTimeout =        Config.duration('KARGADAN_PG_CONNECT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10)));

// --- [SCHEMA] ----------------------------------------------------------------

const _resolveProtocolVersion = _protocolVersion.pipe(Effect.flatMap(S.decodeUnknown(S.transform(
    S.String.pipe(S.pattern(/^\d+\.\d+$/)),
    Kargadan.ProtocolVersionSchema,
    {
        decode: (value) => {
            const [major = '0', minor = '0'] = value.split('.');
            return { major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) };
        },
        encode: (version) => `${version.major}.${version.minor}`,
        strict: true,
    },
))));
const _resolveCapabilities = Effect.all([_capabilityRequired, _capabilityOptional]).pipe(
    Effect.map(([required, optional]) => ({
        optional: optional
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        required: required
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    })),
);
const _resolveLoopOperations = _loopOperations.pipe(
    Effect.map((csv) =>
        csv
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    ),
    Effect.flatMap((operations) => S.decodeUnknown(S.Array(Kargadan.CommandOperationSchema))(operations)),
);
const HarnessConfig = {
    checkpointDatabaseUrl:   _checkpointDatabaseUrl,
    commandDeadlineMs:       _commandDeadlineMs,
    correctionCycles:        _correctionCycles,
    heartbeatIntervalMs:     _heartbeatIntervalMs,
    heartbeatTimeoutMs:      _heartbeatTimeoutMs,
    pgConnectTimeout:        _pgConnectTimeout,
    pgIdleTimeout:           _pgIdleTimeout,
    pgMaxConnections:        _pgMaxConnections,
    protocolVersion:         _resolveProtocolVersion,
    reconnectMaxAttempts:    _reconnectMaxAttempts,
    resolveCapabilities:     _resolveCapabilities,
    resolveLoopOperations:   _resolveLoopOperations,
    retryMaxAttempts:        _retryMaxAttempts,
    sessionToken:            _sessionToken,
    simulatedPluginRevision: _simulatedPluginRevision,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessConfig };
