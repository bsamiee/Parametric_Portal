import { fileURLToPath } from 'node:url';
import { NodeContext } from '@effect/platform-node';
import * as PgClient from '@effect/sql-pg/PgClient';
import { PgMigrator } from '@effect/sql-pg';
import { Config, Effect, Layer, Option } from 'effect';
import { HarnessConfig } from './config';
import { KBSeeder } from './knowledge/seeder';
import { PersistenceService, hashCanonicalState, verifySceneState } from './persistence/checkpoint';
import { CommandDispatch } from './protocol/dispatch';
import { AgentLoop, type LoopState } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.gen(function* () {
    const [dispatch, loop, persistence, reconnect, token] = yield* Effect.all([
        CommandDispatch,
        AgentLoop,
        PersistenceService,
        ReconnectionSupervisor,
        HarnessConfig.sessionToken,
    ]);
    const runId = crypto.randomUUID();
    const traceId = crypto.randomUUID().replaceAll('-', '');

    const resumableSessionId = yield* persistence.findResumable();
    const hydrationResult = yield* Option.match(resumableSessionId, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (sessionId) => persistence.hydrate(sessionId).pipe(Effect.map(Option.some)),
    });
    const isResume = Option.isSome(hydrationResult) && !Option.getOrThrow(hydrationResult).fresh;
    const sessionId = isResume
        ? Option.getOrThrow(resumableSessionId)
        : crypto.randomUUID();
    const appId = crypto.randomUUID();

    yield* Option.match(hydrationResult, {
        onNone: () => Effect.log('kargadan.harness: no resumable session, starting fresh'),
        onSome: (result) => result.fresh
            ? Effect.log('kargadan.harness: resumable session corrupt or empty, starting fresh', { sessionId })
            : Effect.log('kargadan.harness: resuming session', {
                diverged: verifySceneState(hashCanonicalState(result.state), hashCanonicalState(result.state)).diverged,
                sequence: result.sequence,
                sessionId,
            }),
    });

    yield* isResume
        ? Effect.void
        : persistence.createSession({ runId, startedAt: new Date(), status: 'running', toolCallCount: 0 } as Parameters<typeof persistence.createSession>[0]);

    const identityBase = { appId, runId, sessionId, traceId } satisfies LoopState['identityBase'];
    const outcome = yield* reconnect.control.supervise((port) =>
        Effect.gen(function* () {
            yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
            yield* Effect.forkScoped(dispatch.start());
            const result = yield* loop.handle({ identityBase, token });
            yield* Effect.log('Harness loop complete', { outcome: result, runId: identityBase.runId });
            return result;
        }),
    );

    const finalStatus = outcome.state.status === 'Completed' ? 'completed' as const : 'failed' as const;
    yield* persistence.completeSession({
        endedAt: new Date(),
        error: finalStatus === 'failed' ? 'Loop terminated with Failed status' : undefined,
        sessionId,
        status: finalStatus,
        toolCallCount: outcome.state.sequence,
    });

    return outcome;
}).pipe(Effect.withSpan('kargadan.harness.main'));

// --- [LAYERS] ----------------------------------------------------------------

const PgClientLayer = PgClient.layerConfig({
    connectTimeout: HarnessConfig.pgConnectTimeout,
    idleTimeout:    HarnessConfig.pgIdleTimeout,
    maxConnections: HarnessConfig.pgMaxConnections,
    url:            HarnessConfig.checkpointDatabaseUrl.pipe(Config.map((urlString) => urlString as never)),
});

const KargadanMigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(
        fileURLToPath(new URL('../migrations', import.meta.url)),
    ),
    table: 'kargadan_migrations',
}).pipe(
    Layer.provide(PgClientLayer),
    Layer.provide(NodeContext.layer),
);

const ServicesLayer = Layer.mergeAll(
    KargadanSocketClientLive,
    CommandDispatch.Default,
    AgentLoop.Default,
    ReconnectionSupervisor.Default,
    PersistenceService.Default,
    KBSeeder.Default,
).pipe(
    Layer.provideMerge(KargadanMigratorLive),
    Layer.provideMerge(PgClientLayer),
);

// --- [EXPORT] ----------------------------------------------------------------

export { ServicesLayer, main };
