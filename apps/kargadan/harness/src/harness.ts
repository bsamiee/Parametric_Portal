import { createHash } from 'node:crypto';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceLayer, AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Layer, Option, Schema as S } from 'effect';
import { HarnessConfig } from './config';
import { CommandDispatch } from './protocol/dispatch';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [CONSTANTS] -------------------------------------------------------------

const _CompletionStatus = {
    Completed: null,
    Failed:    'Loop terminated with Failed status',
    Planning:  'Loop terminated unexpectedly in Planning state',
} as const satisfies Record<string, string | null>;

// --- [SCHEMA] ----------------------------------------------------------------

const _MarkerSchema = S.Struct({ hash: S.String, manifestVersion: S.String });

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.scoped(
    Effect.gen(function* () {
        const [dispatch, loop, persistence, reconnect, token, ai, database] = yield* Effect.all([
            CommandDispatch, AgentLoop, AgentPersistenceService, ReconnectionSupervisor, HarnessConfig.sessionToken,
            AiService, DatabaseService,
        ]);
        const appId = Client.tenant.Id.system;
        const [manifestJson, manifestVersion, manifestEntityType, manifestNamespace, manifestScopeId] = yield* Effect.all([
            HarnessConfig.commandManifestJson,      HarnessConfig.commandManifestVersion, HarnessConfig.commandManifestEntityType,
            HarnessConfig.commandManifestNamespace, HarnessConfig.commandManifestScopeId,
        ]);
        yield* Effect.suspend(() => {
            const scope = Option.getOrElse(manifestScopeId, () => 'global');
            const markerKey = `kargadan:manifest:${manifestNamespace}:${manifestEntityType}:${scope}`;
            const markerValue = { hash: createHash('sha256').update(`${manifestVersion}\n${manifestJson}`).digest('hex'), manifestVersion };
            return Client.tenant.with(appId, database.kvStore.getJson(markerKey, _MarkerSchema)).pipe(
                Effect.map((m) => Option.match(m, { onNone: () => true, onSome: (v) => v.hash !== markerValue.hash || v.manifestVersion !== markerValue.manifestVersion })),
                Effect.flatMap((needsSeed) => Effect.when(
                    ai.seedKnowledge({ entityType: manifestEntityType, manifest: manifestJson, namespace: manifestNamespace, scopeId: Option.getOrNull(manifestScopeId) }).pipe(
                        Effect.zipRight(Client.tenant.with(appId, database.kvStore.setJson(markerKey, markerValue, _MarkerSchema))),
                        Effect.zipRight(Effect.log('kargadan.harness.kb.seed.applied', { manifestHash: markerValue.hash, markerKey })),
                    ), () => needsSeed,
                )),
            );
        }).pipe(Effect.when(() => manifestJson.trim().length > 0));
        const correlationId = crypto.randomUUID().replaceAll('-', '');
        const resumableSessionId = yield* persistence.findResumable(appId);
        const hydration = yield* Option.match(resumableSessionId, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: (sid) => persistence.hydrate(sid).pipe(Effect.map(Option.some)),
        });
        const resume = Option.flatMap(hydration, (r) => r.fresh ? Option.none() : Option.some({ sequence: r.sequence, state: r.state }));
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
        yield* Option.match(resume, {
            onNone: () => persistence.startSession({ appId, correlationId, sessionId }),
            onSome: () => Effect.void,
        });
        const identityBase = { appId, correlationId, sessionId };
        const outcome = yield* reconnect.supervise((port) =>
            Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId }).pipe(
                Effect.zipRight(Effect.forkScoped(dispatch.start())),
                Effect.zipRight(loop.handle({ identityBase, resume, token })),
                Effect.tap((result) => Effect.log('Harness loop complete', { correlationId: identityBase.correlationId, outcome: result })),
            ),
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
