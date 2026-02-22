/**
 * Bootstraps the Kargadan phase-3 agent harness: composes ServicesLayer, forks transport, and drives AgentLoop.handle to completion.
 * Entry point for local integration runs with runtime-generated identity envelopes.
 */
import { Effect, Layer } from 'effect';
import { HarnessConfig } from './config';
import { CommandDispatch } from './protocol/dispatch';
import { SessionSupervisor } from './protocol/supervisor';
import { AgentLoop, type LoopState } from './runtime/agent-loop';
import { PersistenceTrace } from './runtime/persistence-trace';
import { KargadanSocketClientLive } from './socket';

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.fn('kargadan.harness.main')(() =>
    Effect.gen(function* () {
        const [dispatch, loop, protocolVersion, token] = yield* Effect.all([
            CommandDispatch,
            AgentLoop,
            HarnessConfig.protocolVersion,
            HarnessConfig.sessionToken,
        ]);
        const traceId = crypto.randomUUID().replaceAll('-', '');
        const identityBase = {
            appId:     crypto.randomUUID(),
            protocolVersion,
            runId:     crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
            traceId,
        } as const satisfies LoopState.IdentityBase;
        yield* Effect.forkScoped(dispatch.transport.start());
        const outcome = yield* loop.handle({ identityBase, token });
        yield* Effect.log('Harness phase-3 loop complete', {
            outcome,
            runId: identityBase.runId,
        });
        return outcome;
    }),
);

// --- [LAYERS] ----------------------------------------------------------------

const ServicesLayer = Layer.mergeAll(
    KargadanSocketClientLive, SessionSupervisor.Default, CommandDispatch.Default,
    PersistenceTrace.Default, AgentLoop.Default,
);

// --- [EXPORT] ----------------------------------------------------------------

export { ServicesLayer, main };
