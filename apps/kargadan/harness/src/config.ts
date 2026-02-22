/**
 * Resolves environment-driven HarnessConfig for the Kargadan harness via Effect Config.
 * Parses protocol version, socket URL, capability sets, and loop operations; decodes operations against CommandOperationSchema at boundary.
 */
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Config, Effect, Match, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _pluginHost =              Config.string('KARGADAN_PLUGIN_HOST').pipe(Config.withDefault('127.0.0.1'));
const _pluginPort =              Config.integer('KARGADAN_PLUGIN_PORT').pipe(Config.withDefault(9181));
const _protocolVersion =         Config.string('KARGADAN_PROTOCOL_VERSION').pipe(Config.withDefault('1.0'));
const _commandDeadlineMs =       Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000));
const _retryMaxAttempts =        Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5));
const _correctionCycles =        Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1));
const _loopOperations =          Config.string('KARGADAN_LOOP_OPERATIONS').pipe(Config.withDefault('read.object.metadata,write.object.update'),);
const _sessionToken =            Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token'));
const _heartbeatIntervalMs =     Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000));
const _simulatedPluginRevision = Config.string('KARGADAN_SIMULATED_PLUGIN_REVISION').pipe(Config.withDefault('harness-simulated'),);
const _capabilityRequired =      Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create'),);
const _capabilityOptional =      Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture'));

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
const _resolveSocketUrl = Effect.all([_pluginHost, _pluginPort]).pipe(
    Effect.flatMap(([host, port]) =>
        Effect.try(() => new URL(host.includes('://') ? host : `ws://${host}:${port}`)).pipe(
            Effect.map((parsed) => {
                const protocol = Match.value(parsed.protocol).pipe(
                    Match.when('https:', () => 'wss:'),
                    Match.when('http:', () => 'ws:'),
                    Match.orElse((p) => p),
                );
                const normalized = new URL(parsed.toString());
                normalized.protocol = protocol;
                normalized.port = normalized.port.length === 0
                    ? String(port)
                    : normalized.port;
                const pathname = normalized.pathname === '/'
                    ? ''
                    : normalized.pathname;
                return `${normalized.protocol}//${normalized.host}${pathname}${normalized.search}${normalized.hash}`;
            }),
            Effect.orElseSucceed(() => `ws://${host}:${port}`),
        ),
    ),
);
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
    commandDeadlineMs:       _commandDeadlineMs,
    correctionCycles:        _correctionCycles,
    heartbeatIntervalMs:     _heartbeatIntervalMs,
    protocolVersion:         _resolveProtocolVersion,
    resolveCapabilities:     _resolveCapabilities,
    resolveLoopOperations:   _resolveLoopOperations,
    resolveSocketUrl:        _resolveSocketUrl,
    retryMaxAttempts:        _retryMaxAttempts,
    sessionToken:            _sessionToken,
    simulatedPluginRevision: _simulatedPluginRevision,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessConfig };
