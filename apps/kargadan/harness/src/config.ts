import { AiRegistry } from '@parametric-portal/ai/registry';
import { AgentPersistenceLayer } from '@parametric-portal/database/agent-persistence';
import { Config, Duration, Effect, Match, Option, Schema as S } from 'effect';
import { Client } from '@parametric-portal/database/client';
import { DEFAULT_LOOP_OPERATIONS, NonNegInt, ObjectTypeTag, Operation } from './protocol/schemas';

// --- [FUNCTIONS] -------------------------------------------------------------

const decodeOverride = (selection: {
    readonly fallback: ReadonlyArray<string>;
    readonly model:    string;
    readonly provider: string;
}) =>
    Match.value(selection).pipe(
        Match.when(
            (value) => value.model === '' && value.provider === '',
            () => Effect.succeed(Option.none<AiRegistry.SessionOverride>()),
        ),
        Match.orElse((value) =>
            AiRegistry.decodeSessionOverride({
                language: {
                    fallback: value.fallback,
                    model:    value.model,
                    provider: value.provider,
                },
            }).pipe(Effect.map(Option.some)),
        ),
    );

const _resolveSessionOverride = (config: {
    readonly fallbackKey: string;
    readonly modelKey: string;
    readonly providerKey: string;
}) =>
    Effect.all({
        fallback: Config.string(config.fallbackKey).pipe(
            Config.withDefault(''),
            Config.map((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)),
        ),
        model: Config.string(config.modelKey).pipe(
            Config.withDefault(''),
            Config.map((value) => value.trim()),
        ),
        provider: Config.string(config.providerKey).pipe(
            Config.withDefault(''),
            Config.map((value) => value.trim()),
        ),
    }).pipe(Effect.flatMap(decodeOverride));

// --- [CONSTANTS] -------------------------------------------------------------

const HarnessConfig = {
    agentIntent:               Config.string('KARGADAN_AGENT_INTENT').pipe(Config.withDefault('Summarize the active scene and apply the requested change.')),
    appId:                     Config.string('KARGADAN_APP_ID').pipe(Config.withDefault(Client.tenant.Id.system), Effect.flatMap(S.decodeUnknown(S.UUID))),
    checkpointDatabaseUrl:     Config.redacted('KARGADAN_CHECKPOINT_DATABASE_URL'),
    commandDeadlineMs:         Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000)),
    commandManifestEntityType: Config.string('KARGADAN_COMMAND_MANIFEST_ENTITY_TYPE').pipe(Config.withDefault('command')),
    commandManifestJson:       Config.string('KARGADAN_COMMAND_MANIFEST_JSON').pipe(Config.withDefault('')),
    commandManifestNamespace:  Config.string('KARGADAN_COMMAND_MANIFEST_NAMESPACE').pipe(Config.withDefault('kargadan')),
    commandManifestScopeId:    Config.string('KARGADAN_COMMAND_MANIFEST_SCOPE_ID').pipe(
        Config.withDefault(''),
        Config.map((v) => v.trim()),
        Effect.flatMap((v) =>
            v === '' ? Effect.succeed(Option.none()) : S.decodeUnknown(S.UUID)(v).pipe(Effect.map(Option.some)),
        ),
    ),
    commandManifestVersion:  Config.string('KARGADAN_COMMAND_MANIFEST_VERSION').pipe(Config.withDefault('')),
    compactionTargetPercent: Config.integer('KARGADAN_CONTEXT_COMPACTION_TARGET_PERCENT').pipe(
        Config.withDefault(40),
        Effect.flatMap(S.decodeUnknown(S.Int.pipe(S.between(1, 95)))),
    ),
    compactionTriggerPercent: Config.integer('KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT').pipe(
        Config.withDefault(75),
        Effect.flatMap(S.decodeUnknown(S.Int.pipe(S.between(5, 99)))),
    ),
    correctionCycles:        Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1)),
    heartbeatIntervalMs:     Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000)),
    heartbeatTimeoutMs:      Config.integer('KARGADAN_HEARTBEAT_TIMEOUT_MS').pipe(Config.withDefault(15_000)),
    persistenceLayer: AgentPersistenceLayer({
        connectTimeout: Config.duration('KARGADAN_PG_CONNECT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
        idleTimeout:    Config.duration('KARGADAN_PG_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30))),
        maxConnections: Config.integer('KARGADAN_PG_MAX_CONNECTIONS').pipe(Config.withDefault(5)),
        url:            Config.redacted('KARGADAN_CHECKPOINT_DATABASE_URL'),
    }),
    protocolVersion:         Config.string('KARGADAN_PROTOCOL_VERSION').pipe(
        Config.withDefault('1.0'),
        Effect.map((v) => v.trim().split('.')),
        Effect.filterOrFail(
            (parts): parts is [string, string] => parts.length === 2 && parts.every((p) => /^\d+$/.test(p)),
            (parts) => new Error(`HarnessConfig/invalid_protocol_version: '${parts.join('.')}'`),
        ),
        Effect.map(([major, minor]) => ({ major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) })),
        Effect.orDie,
    ),
    reconnectBackoffBaseMs:  Config.integer('KARGADAN_RECONNECT_BACKOFF_BASE_MS').pipe(Config.withDefault(500)),
    reconnectBackoffMaxMs:   Config.integer('KARGADAN_RECONNECT_BACKOFF_MAX_MS').pipe(Config.withDefault(30_000)),
    reconnectMaxAttempts:    Config.integer('KARGADAN_RECONNECT_MAX_ATTEMPTS').pipe(Config.withDefault(50)),
    resolveArchitectOverride: _resolveSessionOverride({
        fallbackKey: 'KARGADAN_AI_ARCHITECT_FALLBACK',
        modelKey:    'KARGADAN_AI_ARCHITECT_MODEL',
        providerKey: 'KARGADAN_AI_ARCHITECT_PROVIDER',
    }),
    resolveCapabilities: Effect.all({
        optional: Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture'), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean))),
        required: Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create'), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean))),
    }),
    resolveLoopOperations: Config.string('KARGADAN_LOOP_OPERATIONS').pipe(
        Config.withDefault(DEFAULT_LOOP_OPERATIONS.join(',')),
        Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean)),
        Effect.flatMap(S.decodeUnknown(S.Array(Operation))),
    ),
    resolveSessionOverride: _resolveSessionOverride({
        fallbackKey: 'KARGADAN_AI_LANGUAGE_FALLBACK',
        modelKey:    'KARGADAN_AI_LANGUAGE_MODEL',
        providerKey: 'KARGADAN_AI_LANGUAGE_PROVIDER',
    }),
    resolveWriteObjectRef: Effect.all({
        objectId:       Config.string('KARGADAN_WRITE_OBJECT_ID').pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
        sourceRevision: Config.integer('KARGADAN_WRITE_OBJECT_SOURCE_REVISION').pipe(Config.withDefault(0)),
        typeTag:        Config.string('KARGADAN_WRITE_OBJECT_TYPE_TAG').pipe(Config.withDefault('Brep')),
    }).pipe(Effect.flatMap(S.decodeUnknown(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag })))),
    retryMaxAttempts:   Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5)),
    sessionToken:       Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token')),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { decodeOverride, HarnessConfig };
