import { Client } from '@parametric-portal/database/client';
import { AgentPersistenceLayer, AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Effect, Layer, Option } from 'effect';
import { HarnessConfig } from './config';
import { CommandDispatch } from './protocol/dispatch';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [FUNCTIONS] -------------------------------------------------------------

const main = Effect.gen(function* () {
    const [dispatch, loop, persistence, reconnect, token] = yield* Effect.all([
        CommandDispatch,
        AgentLoop,
        AgentPersistenceService,
        ReconnectionSupervisor,
        HarnessConfig.sessionToken,
    ]);
    const runId = crypto.randomUUID();
    const traceId = crypto.randomUUID().replaceAll('-', '');
    const appId = Client.tenant.Id.system;
    const resumableSessionId = yield* persistence.findResumable(appId);
    const hydrationResult = yield* Option.match(resumableSessionId, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (sessionId) => persistence.hydrate({ appId, sessionId }).pipe(Effect.map(Option.some)),
    });
    const isResume = Option.match(hydrationResult, {
        onNone: () => false,
        onSome: (result) => !result.fresh,
    });
    const sessionId = Option.match(resumableSessionId, {
        onNone: () => crypto.randomUUID(),
        onSome: (id) => isResume ? id : crypto.randomUUID(),
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
    yield* isResume
        ? Effect.void
        : persistence.createSession({ appId, runId, startedAt: new Date(), status: 'running', toolCallCount: 0 });
    const identityBase = { appId, runId, sessionId, traceId } satisfies AgentLoop.IdentityBase;
    const resume = Option.match(hydrationResult, {
        onNone: () => Option.none<AgentLoop.ResumeState>(),
        onSome: (result) => result.fresh
            ? Option.none<AgentLoop.ResumeState>()
            : Option.some({ sequence: result.sequence, state: result.state } satisfies AgentLoop.ResumeState),
    });
    const outcome = yield* reconnect.control.supervise((port) =>
        Effect.gen(function* () {
            yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
            yield* Effect.forkScoped(dispatch.start());
            const result = yield* loop.handle({ identityBase, resume, token });
            yield* Effect.log('Harness loop complete', { outcome: result, runId: identityBase.runId });
            return result;
        }),
    );
    const finalStatus = outcome.state.status === 'Completed' ? 'completed' as const : 'failed' as const;
    yield* persistence.completeSession({
        appId,
        endedAt: new Date(),
        error: finalStatus === 'failed' ? 'Loop terminated with Failed status' : undefined,
        sessionId,
        status: finalStatus,
        toolCallCount: outcome.state.sequence,
    });
    return outcome;
}).pipe(Effect.withSpan('kargadan.harness.main'));

// --- [LAYERS] ----------------------------------------------------------------

const _AgentPersistenceLayer = AgentPersistenceLayer({
    connectTimeout: HarnessConfig.pgConnectTimeout,
    idleTimeout:    HarnessConfig.pgIdleTimeout,
    maxConnections: HarnessConfig.pgMaxConnections,
    url:            HarnessConfig.checkpointDatabaseUrl,
});
const ServicesLayer = Layer.mergeAll(
    KargadanSocketClientLive,
    CommandDispatch.Default,
    AgentLoop.Default,
    ReconnectionSupervisor.Default,
).pipe(
    Layer.provideMerge(_AgentPersistenceLayer),
);

// --- [EXPORT] ----------------------------------------------------------------

export { ServicesLayer, main };
