import { createHash } from 'node:crypto';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceLayer, AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { Effect, FiberRef, Layer, Option, Schema as S } from 'effect';
import { HarnessConfig } from './config';
import { CommandDispatch } from './protocol/dispatch';
import { CatalogEntrySchema } from './protocol/schemas';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [CONSTANTS] -------------------------------------------------------------

const _CompletionStatus = {
    Completed: null,
    Failed:    'Loop terminated with Failed status',
    Planning:  'Loop terminated unexpectedly in Planning state',
} as const satisfies Record<string, string | null>;

// --- [SCHEMA] ----------------------------------------------------------------

const _MarkerSchema   = S.Struct({ hash: S.String, manifestVersion: S.String });
const _ManifestSchema = S.parseJson(S.Array(CatalogEntrySchema));

// --- [FUNCTIONS] -------------------------------------------------------------

const _mergeManifest = (
    base:      ReadonlyArray<typeof CatalogEntrySchema.Type>,
    overrides: Option.Option<ReadonlyArray<typeof CatalogEntrySchema.Type>>,
) =>
    Option.match(overrides, {
        onNone: () => base,
        onSome: (entries) => {
            const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
            return base.map((entry) => {
                const enriched = byId.get(entry.id);
                return enriched === undefined
                    ? entry
                    : {
                        ...entry,
                        aliases:       [...new Set([...entry.aliases, ...enriched.aliases])],
                        category:      enriched.category,
                        description:   enriched.description,
                        examples:      enriched.examples.length === 0 ? entry.examples : enriched.examples,
                        isDestructive: enriched.isDestructive,
                        name:          enriched.name,
                        params:        enriched.params.length === 0 ? entry.params : enriched.params,
                        requirements:  entry.requirements,
                    };
            });
        },
    });

const main = Effect.scoped(
    Effect.gen(function* () {
        const [dispatch, loop, persistence, reconnect, token, appId, ai, database, intent, sessionOverride] = yield* Effect.all([
            CommandDispatch, AgentLoop, AgentPersistenceService, ReconnectionSupervisor, HarnessConfig.sessionToken,
            HarnessConfig.appId, AiService, DatabaseService, HarnessConfig.agentIntent, HarnessConfig.resolveSessionOverride,
        ]);
        const architectOverride = yield* HarnessConfig.resolveArchitectOverride;
        yield* FiberRef.set(AiRegistry.SessionOverrideRef, sessionOverride);
        const [manifestJson, manifestVersion, manifestEntityType, manifestNamespace, manifestScopeId] = yield* Effect.all([
            HarnessConfig.commandManifestJson,      HarnessConfig.commandManifestVersion, HarnessConfig.commandManifestEntityType,
            HarnessConfig.commandManifestNamespace, HarnessConfig.commandManifestScopeId,
        ]);
        const correlationId = crypto.randomUUID().replaceAll('-', '');
        const resumableSessionId = yield* persistence.findResumable(appId);
        const hydration = yield* Option.match(resumableSessionId, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: (sid) => persistence.hydrate(sid).pipe(Effect.map(Option.some)),
        });
        const resume = Option.flatMap(hydration, (r) => r.fresh ? Option.none() : Option.some({ chatJson: r.chatJson, sequence: r.sequence, state: r.state }));
        const sessionId = Option.match(resumableSessionId, {
            onNone: () => crypto.randomUUID(),
            onSome: (id) => Option.isSome(resume) ? id : crypto.randomUUID(),
        });
        yield* Option.match(hydration, {
            onNone: () => Effect.log('kargadan.harness: no resumable session, starting fresh'),
            onSome: (r) => r.fresh
                ? Effect.log('kargadan.harness: resumable session corrupt or empty, starting fresh', { sessionId })
                : Effect.log('kargadan.harness: resuming session', { diverged: r.diverged, sequence: r.sequence, sessionId }),
        });
        yield* Option.isNone(resume) ? persistence.startSession({ appId, correlationId, sessionId }) : Effect.void;
        const identityBase = { appId, correlationId, sessionId };
        const outcome = yield* Context.Request.withinSync(
            appId,
            reconnect.supervise((port) =>
                Effect.gen(function* () {
                    yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
                    yield* Effect.forkScoped(dispatch.start());
                    const ack = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token });
                    const receivedCatalog = yield* dispatch.receiveCatalog();
                    const handshakeCatalog = receivedCatalog.length === 0 ? ack.catalog : receivedCatalog;
                    const envManifest = yield* S.decodeUnknown(_ManifestSchema)(manifestJson).pipe(Effect.option);
                    const mergedManifest = _mergeManifest(handshakeCatalog, envManifest);
                    const seedProjection = mergedManifest.length === 0
                        ? { manifest: manifestJson,   source: 'env' as const,       version: manifestVersion }
                        : { manifest: mergedManifest, source: 'handshake' as const, version: `handshake:${ack.server?.pluginRevision ?? 'unknown'}:${String(mergedManifest.length)}` };
                    const serializedManifest = typeof seedProjection.manifest === 'string' ? seedProjection.manifest : JSON.stringify(seedProjection.manifest);
                    const scope = Option.getOrElse(manifestScopeId, () => 'global');
                    const markerKey = `kargadan:manifest:${manifestNamespace}:${manifestEntityType}:${scope}`;
                    const markerValue = { hash: createHash('sha256').update(`${seedProjection.version}\n${serializedManifest}`).digest('hex'), manifestVersion: seedProjection.version };
                    yield* Effect.suspend(() =>
                        Client.tenant.with(appId, database.kvStore.getJson(markerKey, _MarkerSchema)).pipe(
                            Effect.map((current) =>
                                Option.match(current, {
                                    onNone: () => true,
                                    onSome: (value) => value.hash !== markerValue.hash || value.manifestVersion !== markerValue.manifestVersion,
                                })),
                            Effect.flatMap((needsSeed) => Effect.when(
                                ai.seedKnowledge({
                                    entityType: manifestEntityType,
                                    manifest:   seedProjection.manifest,
                                    namespace:  manifestNamespace,
                                    scopeId:    Option.getOrNull(manifestScopeId),
                                }).pipe(
                                    Effect.zipRight(Client.tenant.with(appId, database.kvStore.setJson(markerKey, markerValue, _MarkerSchema))),
                                    Effect.zipRight(Effect.log('kargadan.harness.kb.seed.applied', { manifestHash: markerValue.hash, markerKey, source: seedProjection.source })),
                                ),
                                () => needsSeed,
                            )),
                        ),
                    ).pipe(Effect.when(() => serializedManifest.trim().length > 0));
                    const runtimeIdentityBase = { appId: ack.appId, correlationId: ack.correlationId, sessionId: ack.sessionId };
                    return yield* loop.handle({
                        architectOverride,
                        capabilities: ack.acceptedCapabilities,
                        catalog:      mergedManifest,
                        identityBase: runtimeIdentityBase,
                        intent,
                        resume,
                    }).pipe(
                        Effect.tap((result) => Effect.log('Harness loop complete', { correlationId: runtimeIdentityBase.correlationId, outcome: result })),
                    );
                }),
            ),
            { requestId: correlationId },
        );
        yield* persistence.completeSession({
            appId, correlationId, error: _CompletionStatus[outcome.state.status], sequence: outcome.state.sequence, sessionId,
            status:        outcome.state.status === 'Completed' ? 'completed' as const : 'failed' as const,
            toolCallCount: outcome.state.sequence,
        });
        return outcome;
    }).pipe(
        Effect.withSpan('kargadan.harness.main'),
        Effect.provide(
            Layer.mergeAll(
                KargadanSocketClientLive,
                CommandDispatch.Default,        AgentLoop.Default,
                ReconnectionSupervisor.Default, AiService.KnowledgeDefault,
            ).pipe(
                Layer.provideMerge(
                    AgentPersistenceLayer({
                        connectTimeout: HarnessConfig.pgConnectTimeout,
                        idleTimeout:    HarnessConfig.pgIdleTimeout,
                        maxConnections: HarnessConfig.pgMaxConnections,
                        url:            HarnessConfig.checkpointDatabaseUrl,
                    }),
                ),
            ),
        ),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { main };
