import { createHash } from 'node:crypto';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceLayer, AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Effect, Layer, Match, Option, Schema as S } from 'effect';
import { HarnessConfig } from './config';
import { CommandDispatch } from './protocol/dispatch';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [SCHEMA] ----------------------------------------------------------------

const _SeedMarkerSchema = S.Struct({
    hash:            S.String,
    manifestVersion: S.String,
});

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.scoped(
    Effect.gen(function* () {
        const [dispatch, loop, persistence, reconnect, token, ai, database] = yield* Effect.all([
            CommandDispatch,
            AgentLoop,
            AgentPersistenceService,
            ReconnectionSupervisor,
            HarnessConfig.sessionToken,
            AiService,
            DatabaseService,
        ]);
        const appId = Client.tenant.Id.system;
        const [manifestJson, manifestVersion, manifestEntityType, manifestNamespace, manifestScopeId] = yield* Effect.all([
            HarnessConfig.commandManifestJson,
            HarnessConfig.commandManifestVersion,
            HarnessConfig.commandManifestEntityType,
            HarnessConfig.commandManifestNamespace,
            HarnessConfig.commandManifestScopeId,
        ]);
        yield* Match.value(manifestJson.trim().length === 0).pipe(
            Match.when(true, () => Effect.logDebug('kargadan.harness.kb.seed.skip', { reason: 'manifest_empty' })),
            Match.orElse(() => {
                const markerKey = `kargadan:manifest:${manifestNamespace}:${manifestEntityType}:${Option.getOrElse(manifestScopeId, () => 'global')}`;
                const markerValue = {
                    hash: createHash('sha256').update(`${manifestVersion}\n${manifestJson}`).digest('hex'),
                    manifestVersion,
                } as const satisfies typeof _SeedMarkerSchema.Type;
                const seedKnowledge = ai.seedKnowledgeJson({
                    entityType: manifestEntityType,
                    manifestJson,
                    namespace: manifestNamespace,
                    scopeId: Option.getOrNull(manifestScopeId),
                }).pipe(
                    Effect.zipRight(database.kvStore.setJson(markerKey, markerValue, _SeedMarkerSchema)),
                    Effect.zipRight(Effect.log('kargadan.harness.kb.seed.applied', { manifestHash: markerValue.hash, markerKey })),
                );
                return Client.tenant.with(
                    appId,
                    database.kvStore.getJson(markerKey, _SeedMarkerSchema).pipe(
                        Effect.flatMap((markerOption) =>
                            Match.value(
                                Option.match(markerOption, {
                                    onNone: () => false,
                                    onSome: (marker) => marker.hash === markerValue.hash && marker.manifestVersion === markerValue.manifestVersion,
                                }),
                            ).pipe(
                                Match.when(true, () => Effect.logDebug('kargadan.harness.kb.seed.skip', { markerKey, reason: 'unchanged' })),
                                Match.orElse(() => seedKnowledge),
                            )),
                    ),
                );
            }),
        );
        const runId = crypto.randomUUID();
        const traceId = crypto.randomUUID().replaceAll('-', '');
        const resumableSessionId = yield* persistence.findResumable(appId);
        const hydrationResult = yield* Option.match(resumableSessionId, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: (sessionId: string) => persistence.hydrate({ appId, sessionId }).pipe(Effect.map(Option.some)),
        });
        const resume = Option.flatMap(hydrationResult, (result) => result.fresh
            ? Option.none<AgentLoop.ResumeState>()
            : Option.some({ sequence: result.sequence, state: result.state } satisfies AgentLoop.ResumeState));
        const sessionId = Option.match(resumableSessionId, {
            onNone: () => crypto.randomUUID(),
            onSome: (id: string) => Option.isSome(resume) ? id : crypto.randomUUID(),
        });
        yield* Option.match(hydrationResult, {
            onNone: () => Effect.log('kargadan.harness: no resumable session, starting fresh'),
            onSome: (result) => result.fresh
                ? Effect.log('kargadan.harness: resumable session corrupt or empty, starting fresh', { sessionId })
                : Effect.log('kargadan.harness: resuming session', {
                    diverged: result.diverged,
                    sequence: result.sequence,
                    sessionId,
                }),
        });
        yield* Option.match(resume, {
            onNone: () => persistence.createSession({ appId, runId, sessionId, startedAt: new Date(), status: 'running', toolCallCount: 0 }),
            onSome: () => Effect.void,
        });
        const identityBase = { appId, runId, sessionId, traceId } satisfies AgentLoop.IdentityBase;
        const outcome = yield* reconnect.control.supervise((port: number) =>
            Effect.gen(function* () {
                yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
                yield* Effect.forkScoped(dispatch.start());
                const result = yield* loop.handle({ identityBase, resume, token });
                yield* Effect.log('Harness loop complete', { outcome: result, runId: identityBase.runId });
                return result;
            }),
        );
        const { error, status: finalStatus } = Match.value(outcome.state.status).pipe(
            Match.when('Completed', () => ({ error: undefined,                                        status: 'completed' as const })),
            Match.when('Failed',    () => ({ error: 'Loop terminated with Failed status',             status: 'failed' as const    })),
            Match.when('Planning',  () => ({ error: 'Loop terminated unexpectedly in Planning state', status: 'failed' as const    })),
            Match.exhaustive,
        );
        yield* persistence.completeSession({
            appId,
            endedAt: new Date(),
            error,
            runId,
            sessionId,
            status: finalStatus,
            toolCallCount: outcome.state.sequence,
        });
        return outcome;
    }).pipe(
        Effect.withSpan('kargadan.harness.main'),
        Effect.provide(
            Layer.mergeAll(
                KargadanSocketClientLive,
                CommandDispatch.Default,
                AgentLoop.Default,
                ReconnectionSupervisor.Default,
                AiService.KnowledgeDefault,
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
