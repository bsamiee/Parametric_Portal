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
            CommandDispatch, AgentLoop, AgentPersistenceService, ReconnectionSupervisor, HarnessConfig.sessionToken,
            AiService, DatabaseService,
        ]);
        const appId = Client.tenant.Id.system;
        const [manifestJson, manifestVersion, manifestEntityType, manifestNamespace, manifestScopeId] = yield* Effect.all([
            HarnessConfig.commandManifestJson,      HarnessConfig.commandManifestVersion, HarnessConfig.commandManifestEntityType,
            HarnessConfig.commandManifestNamespace, HarnessConfig.commandManifestScopeId,
        ]);
        yield* Effect.gen(function* () {
            const markerKey = `kargadan:manifest:${manifestNamespace}:${manifestEntityType}:${Option.getOrElse(manifestScopeId, () => 'global')}`;
            const markerValue = { hash: createHash('sha256').update(`${manifestVersion}\n${manifestJson}`).digest('hex'), manifestVersion };
            const markerOption = yield* Client.tenant.with(appId, database.kvStore.getJson(markerKey, _SeedMarkerSchema));
            const needsSeed = Option.match(markerOption, {
                onNone: () => true,
                onSome: (m) => m.hash !== markerValue.hash || m.manifestVersion !== markerValue.manifestVersion,
            });
            yield* Effect.when(
                ai.seedKnowledge({ entityType: manifestEntityType, manifest: manifestJson, namespace: manifestNamespace, scopeId: Option.getOrNull(manifestScopeId) }).pipe(
                    Effect.zipRight(Client.tenant.with(appId, database.kvStore.setJson(markerKey, markerValue, _SeedMarkerSchema))),
                    Effect.zipRight(Effect.log('kargadan.harness.kb.seed.applied', { manifestHash: markerValue.hash, markerKey })),
                ),
                () => needsSeed,
            );
        }).pipe(Effect.when(() => manifestJson.trim().length > 0));
        const correlationId = crypto.randomUUID().replaceAll('-', '');
        const resumableSessionId = yield* persistence.findResumable(appId);
        const hydrationResult = yield* Option.match(resumableSessionId, {
            onNone: () => Effect.succeed(Option.none()),
            onSome: (sessionId) => persistence.hydrate({ appId, sessionId }).pipe(Effect.map(Option.some)),
        });
        const resume = Option.flatMap(hydrationResult, (result) => result.fresh
            ? Option.none()
            : Option.some({ sequence: result.sequence, state: result.state }));
        const sessionId = Option.match(resumableSessionId, {
            onNone: () => crypto.randomUUID(),
            onSome: (id) => Option.isSome(resume) ? id : crypto.randomUUID(),
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
            onNone: () => persistence.createSession({ appId, correlationId, sessionId, startedAt: new Date(), status: 'running', toolCallCount: 0 }),
            onSome: () => Effect.void,
        });
        const identityBase = { appId, correlationId, sessionId };
        const outcome = yield* reconnect.control.supervise((port) =>
            Effect.gen(function* () {
                yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
                yield* Effect.forkScoped(dispatch.start());
                const result = yield* loop.handle({ identityBase, resume, token });
                yield* Effect.log('Harness loop complete', { correlationId: identityBase.correlationId, outcome: result });
                return result;
            }),
        );
        const completionParams = Match.value(outcome.state.status).pipe(
            Match.when('Completed', () => ({ appId, correlationId, endedAt: new Date(), sessionId, status: 'completed' as const, toolCallCount: outcome.state.sequence })),
            Match.when('Failed',    () => ({ appId, correlationId, endedAt: new Date(), error: 'Loop terminated with Failed status', sessionId, status: 'failed' as const, toolCallCount: outcome.state.sequence })),
            Match.when('Planning',  () => ({ appId, correlationId, endedAt: new Date(), error: 'Loop terminated unexpectedly in Planning state', sessionId, status: 'failed' as const, toolCallCount: outcome.state.sequence })),
            Match.exhaustive,
        );
        yield* persistence.completeSession(completionParams);
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
