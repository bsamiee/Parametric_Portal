import { AiRegistry } from '@parametric-portal/ai/registry';
import { Config, Data, Duration, Effect, Match, Option, Schema as S } from 'effect';
import { Client } from '@parametric-portal/database/client';
import { DEFAULT_LOOP_OPERATIONS, ObjectTypeTag, Operation } from './protocol/schemas';

// --- [ERRORS] ----------------------------------------------------------------

class HarnessConfigError extends Data.TaggedError('HarnessConfigError')<{
    readonly input: string;
}> {
    override get message() {return `HarnessConfig/invalid_protocol_version: '${this.input}'`;}
}

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
    correctionCycles:        Config.integer('KARGADAN_CORRECTION_MAX_CYCLES').pipe(Config.withDefault(1)),
    heartbeatIntervalMs:     Config.integer('KARGADAN_HEARTBEAT_INTERVAL_MS').pipe(Config.withDefault(5_000)),
    heartbeatTimeoutMs:      Config.integer('KARGADAN_HEARTBEAT_TIMEOUT_MS').pipe(Config.withDefault(15_000)),
    pgConnectTimeout:        Config.duration('KARGADAN_PG_CONNECT_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
    pgIdleTimeout:           Config.duration('KARGADAN_PG_IDLE_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30))),
    pgMaxConnections:        Config.integer('KARGADAN_PG_MAX_CONNECTIONS').pipe(Config.withDefault(5)),
    protocolVersion:         Config.string('KARGADAN_PROTOCOL_VERSION').pipe(
        Config.withDefault('1.0'),
        Effect.map((v) => v.trim().split('.')),
        Effect.filterOrFail(
            (parts): parts is [string, string] => parts.length === 2 && parts.every((p) => /^\d+$/.test(p)),
            (parts) => new HarnessConfigError({ input: parts.join('.') }),
        ),
        Effect.map(([major, minor]) => ({ major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) })),
        Effect.orDie,
    ),
    reconnectBackoffBaseMs:  Config.integer('KARGADAN_RECONNECT_BACKOFF_BASE_MS').pipe(Config.withDefault(500)),
    reconnectBackoffMaxMs:   Config.integer('KARGADAN_RECONNECT_BACKOFF_MAX_MS').pipe(Config.withDefault(30_000)),
    reconnectMaxAttempts:    Config.integer('KARGADAN_RECONNECT_MAX_ATTEMPTS').pipe(Config.withDefault(50)),
    resolveCapabilities: Effect.all({
        optional: Config.string('KARGADAN_CAP_OPTIONAL').pipe(Config.withDefault('view.capture'), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean))),
        required: Config.string('KARGADAN_CAP_REQUIRED').pipe(Config.withDefault('read.scene.summary,write.object.create'), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean))),
    }),
    resolveLoopOperations: Config.string('KARGADAN_LOOP_OPERATIONS').pipe(
        Config.withDefault(DEFAULT_LOOP_OPERATIONS.join(',')),
        Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean)),
        Effect.flatMap(S.decodeUnknown(S.Array(Operation))),
    ),
    resolveSessionOverride: Effect.all({
        fallback: Config.string('KARGADAN_AI_LANGUAGE_FALLBACK').pipe(
            Config.withDefault(''),
            Config.map((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)),
        ),
        model: Config.string('KARGADAN_AI_LANGUAGE_MODEL').pipe(
            Config.withDefault(''),
            Config.map((value) => value.trim()),
        ),
        provider: Config.string('KARGADAN_AI_LANGUAGE_PROVIDER').pipe(
            Config.withDefault(''),
            Config.map((value) => value.trim()),
        ),
    }).pipe(
        Effect.flatMap((selection) =>
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
            ),
        ),
    ),
    resolveWriteObjectRef: Effect.all({
        objectId:       Config.string('KARGADAN_WRITE_OBJECT_ID').pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
        sourceRevision: Config.integer('KARGADAN_WRITE_OBJECT_SOURCE_REVISION').pipe(Config.withDefault(0)),
        typeTag:        Config.string('KARGADAN_WRITE_OBJECT_TYPE_TAG').pipe(Config.withDefault('Brep')),
    }).pipe(Effect.flatMap((objectRef) =>
        Effect.all({
            objectId:       S.decodeUnknown(S.UUID)(objectRef.objectId),
            sourceRevision: S.decodeUnknown(S.Int.pipe(S.greaterThanOrEqualTo(0)))(objectRef.sourceRevision),
            typeTag:        S.decodeUnknown(ObjectTypeTag)(objectRef.typeTag),
        }),
    )),
    retryMaxAttempts:   Config.integer('KARGADAN_RETRY_MAX_ATTEMPTS').pipe(Config.withDefault(5)),
    sessionToken:       Config.string('KARGADAN_SESSION_TOKEN').pipe(Config.withDefault('kargadan-local-token')),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessConfig };
