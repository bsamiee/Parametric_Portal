/**
 * Bootstraps the Kargadan agent harness: composes ServicesLayer with reconnection supervisor, checkpoint persistence, and PgClient.
 * Entry point wraps the connection lifecycle in reconnection supervision; on reconnect, restores from PostgreSQL checkpoint and verifies scene state.
 */
import * as PgClient from '@effect/sql-pg/PgClient';
import { Config, Duration, Effect, Layer, Option } from 'effect';
import { HarnessConfig } from './config';
import { CheckpointService } from './persistence/checkpoint';
import { CommandDispatch, SessionSupervisor } from './protocol/dispatch';
import { AgentLoop, type LoopState } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.gen(function* () {
    const [dispatch, loop, checkpoint, reconnect, protocolVersion, token] = yield* Effect.all([
        CommandDispatch,
        AgentLoop,
        CheckpointService,
        ReconnectionSupervisor,
        HarnessConfig.protocolVersion,
        HarnessConfig.sessionToken,
    ]);
    const [appId, runId, sessionId, traceId] = yield* Effect.all([
        Effect.sync(() => crypto.randomUUID()),
        Effect.sync(() => crypto.randomUUID()),
        Effect.sync(() => crypto.randomUUID()),
        Effect.sync(() => crypto.randomUUID().replaceAll('-', '')),
    ]);
    const identityBase = {
        appId,
        protocolVersion,
        runId,
        sessionId,
        traceId,
    } as const satisfies LoopState['identityBase'];
    const outcome = yield* reconnect.control.supervise((port) =>
        Effect.gen(function* () {
            yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
            const existing = yield* checkpoint.restore(identityBase.sessionId);
            yield* Option.match(existing, {
                onNone: () => Effect.log('kargadan.harness: no checkpoint found, starting fresh'),
                onSome: (row) => Effect.log('kargadan.harness: checkpoint restored', {
                    sequence: row.sequence,
                    stage:    row.loopState.stage,
                }),
            });
            yield* Effect.forkScoped(dispatch.transport.start());
            const result = yield* loop.handle({ identityBase, token });
            yield* checkpoint.save({
                conversationHistory: [],
                loopState: {
                    attemptCount:      result.state.attempt,
                    pendingOperations: result.state.operations.length,
                    stage:             result.state.status,
                },
                sequence:  result.state.sequence,
                sessionId: identityBase.sessionId,
            });
            yield* Effect.log('Harness loop complete', {
                outcome: result,
                runId:   identityBase.runId,
            });
            return result;
        }),
    );
    return outcome;
}).pipe(Effect.withSpan('kargadan.harness.main'));

// --- [LAYERS] ----------------------------------------------------------------

const PgClientLayer = PgClient.layerConfig({
    connectTimeout: Config.succeed(Duration.seconds(10)),
    idleTimeout:    Config.succeed(Duration.seconds(30)),
    maxConnections: Config.succeed(5),
    url:            HarnessConfig.checkpointDatabaseUrl.pipe(Config.map((urlString) => urlString as never)),
});
const ServicesLayer = Layer.mergeAll(
    KargadanSocketClientLive,
    SessionSupervisor.Default,
    CommandDispatch.Default,
    AgentLoop.Default,
    ReconnectionSupervisor.Default,
    CheckpointService.Default,
).pipe(Layer.provideMerge(PgClientLayer),);

// --- [EXPORT] ----------------------------------------------------------------

export { ServicesLayer, main };
