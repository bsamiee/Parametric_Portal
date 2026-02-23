import * as PgClient from '@effect/sql-pg/PgClient';
import { Config, Effect, Layer, Option } from 'effect';
import { HarnessConfig } from './config';
import { CheckpointService, hashCanonicalState, verifySceneState } from './persistence/checkpoint';
import { CommandDispatch } from './protocol/dispatch';
import { AgentLoop, type LoopState } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.gen(function* () {
    const [dispatch, loop, checkpoint, reconnect, token] = yield* Effect.all([
        CommandDispatch,
        AgentLoop,
        CheckpointService,
        ReconnectionSupervisor,
        HarnessConfig.sessionToken,
    ]);
    const appId =     crypto.randomUUID();
    const runId =     crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const traceId =   crypto.randomUUID().replaceAll('-', '');
    const identityBase = { appId, runId, sessionId, traceId } satisfies LoopState['identityBase'];
    const outcome = yield* reconnect.control.supervise((port) =>
        Effect.gen(function* () {
            yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
            const existing = yield* checkpoint.restore(identityBase.sessionId);
            yield* Option.match(existing, {
                onNone: () => Effect.log('kargadan.harness: no checkpoint found, starting fresh'),
                onSome: (row) => Effect.log('kargadan.harness: checkpoint restored', {
                    diverged: verifySceneState(row.stateHash, hashCanonicalState({ conversationHistory: row.conversationHistory, loopState: row.loopState })).diverged,
                    sequence: row.sequence,
                    stage:    row.loopState.stage,
                }),
            });
            yield* Effect.forkScoped(dispatch.start());
            const result = yield* loop.handle({ identityBase, token });
            yield* checkpoint.save({
                conversationHistory: [],
                loopState: { attemptCount: result.state.attempt, pendingOperations: result.state.operations.length, stage: result.state.status },
                sequence:  result.state.sequence,
                sessionId: identityBase.sessionId,
            });
            yield* Effect.log('Harness loop complete', { outcome: result, runId: identityBase.runId });
            return result;
        }),
    );
    return outcome;
}).pipe(Effect.withSpan('kargadan.harness.main'));

// --- [LAYERS] ----------------------------------------------------------------

const PgClientLayer = PgClient.layerConfig({
    connectTimeout: HarnessConfig.pgConnectTimeout,
    idleTimeout:    HarnessConfig.pgIdleTimeout,
    maxConnections: HarnessConfig.pgMaxConnections,
    url:            HarnessConfig.checkpointDatabaseUrl.pipe(Config.map((urlString) => urlString as never)),
});
const ServicesLayer = Layer.mergeAll(
    KargadanSocketClientLive,
    CommandDispatch.Default,
    AgentLoop.Default,
    ReconnectionSupervisor.Default,
    CheckpointService.Default,
).pipe(Layer.provideMerge(PgClientLayer),);

// --- [EXPORT] ----------------------------------------------------------------

export { ServicesLayer, main };
