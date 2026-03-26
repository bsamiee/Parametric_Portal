import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService } from '@parametric-portal/ai/service';
import { WorkflowEngine } from '@effect/workflow';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { Effect, Fiber, FiberRef, Layer, Match, Option, Schema as S } from 'effect';
import { HarnessConfig, KargadanHost } from './config';
import { CommandDispatch } from './protocol/dispatch';
import type { CorrelationId, Envelope } from './protocol/schemas';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLayer, ReconnectionSupervisor } from './socket';

// --- [SCHEMA] ----------------------------------------------------------------

const _LiveSceneSummary      = S.Struct({ objectCount: S.Int.pipe(S.greaterThanOrEqualTo(0)) });
const _ResumedOpsCompat      = S.Struct({ operations: S.Array(S.String), workflowExecution: S.optional(S.Struct({ commandId: S.String })) });
const _MANIFEST_ENTITY_TYPE  = 'command' as const;
const _MANIFEST_NAMESPACE    = 'kargadan' as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const makeInteractiveHooks = (
    emit:    (kind: 'error' | 'code', tag: string, content: string) => Effect.Effect<void>,
    compact: (value: unknown) => string,
) => ({
    onFailure: (e) => emit('error', `[${e.failureClass}]`, `${e.commandId}: ${e.message} | ${e.advice}`),
    onStage:   (e) => emit('code', `[${e.stage}]`, `${e.phase} seq=${e.sequence} attempt=${e.attempt} status=${e.status}`),
    onTool:    (e) => {
        const suffix = e.phase === 'start' ? compact(e.command.args)
            : Option.match(e.result, { onNone: () => 'result:missing',
                onSome: (r) => r.status === 'ok' ? compact(r.result)
                    : [r.error?.failureClass ?? 'fatal', r.error?.message ?? 'unknown error'].join(': ') });
        return emit('code', `[tool:${e.source}]`, `${e.phase} ${e.command.commandId} (${e.durationMs}ms) ${suffix}`);
    },
}) satisfies Pick<NonNullable<Parameters<AgentLoop['handle']>[0]['hooks']>, 'onFailure' | 'onStage' | 'onTool'>;
const run = Effect.fn('kargadan.harness.runHarness')((input?: {
    readonly hooks?:             Parameters<AgentLoop['handle']>[0]['hooks'];
    readonly intent?:            string;
    readonly resume?:            'auto' | 'off';
    readonly sessionId?:         string;
}) =>
        Effect.scoped(
        Effect.gen(function* () {
            const [reconnect, cfg, ai] = yield* Effect.all([
                ReconnectionSupervisor, HarnessConfig, AiService,
            ]);
            const agentPersistence = yield* AgentPersistenceService;
            const intent = input?.intent ?? cfg.agentIntent;
            const requestedSessionId = Option.fromNullable(input?.sessionId);
            const resumeMode = input?.resume ?? 'auto';
            yield* FiberRef.set(AiRegistry.OnTokenRefreshRef, Option.some(KargadanHost.auth.onTokenRefresh));
            const correlationId = crypto.randomUUID().replaceAll('-', '') as typeof CorrelationId.Type;
            const resumableSessionId = yield* Option.match(requestedSessionId, {
                onNone: () => resumeMode === 'auto'
                    ? Client.tenant.with(cfg.appId, agentPersistence.findResumable(cfg.appId))
                    : Effect.succeed(Option.none<string>()),
                onSome: (id) => Effect.succeed(Option.some(id)),
            });
            const hydration = yield* Option.match(resumableSessionId, {
                onNone: () => Effect.succeed(Option.none()),
                onSome: (sid) => Client.tenant.with(cfg.appId, agentPersistence.hydrate(sid).pipe(Effect.map(Option.some))),
            });
            const resume = Option.flatMap(hydration, (r) => r.fresh ? Option.none() : Option.some({ chatJson: r.chatJson, sequence: r.sequence, state: r.state }));
            const sessionId = Option.isSome(resume) ? resumableSessionId.pipe(Option.getOrElse(() => crypto.randomUUID()))
                : Option.getOrElse(requestedSessionId, () => crypto.randomUUID());
            yield* Option.match(hydration, {
                onNone: () => Effect.log('kargadan.harness: no resumable session, starting fresh'),
                onSome: (r) => r.fresh
                    ? Effect.log('kargadan.harness: resumable session corrupt or empty, starting fresh', { sessionId })
                    : Effect.log('kargadan.harness: resuming session', { diverged: r.diverged, sequence: r.sequence, sessionId }),
            });
            yield* Effect.when(
                Client.tenant.with(cfg.appId, agentPersistence.startSession({ appId: cfg.appId, correlationId, sessionId })),
                () => Option.isNone(resume));
            const identityBase = { appId: cfg.appId, correlationId, sessionId };
            const outcome = yield* Client.tenant.with(
                cfg.appId,
                reconnect.supervise((port) =>
                    Effect.gen(function* () {
                        const [dispatch, loop] = yield* Effect.all([CommandDispatch, AgentLoop]);
                        yield* Effect.log('kargadan.harness: connecting', { port: port.port, sessionId: identityBase.sessionId });
                        const dispatchFiber = yield* Effect.forkDaemon(dispatch.start());
                        const ack = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token: port.sessionToken });
                        const receivedCatalog = yield* dispatch.receiveCatalog();
                        const handshakeCatalog = receivedCatalog.length === 0 ? ack.catalog : receivedCatalog;
                        const seedProjection = { manifest: handshakeCatalog, source: 'handshake' as const,
                            version: `handshake:${ack.server?.pluginRevision ?? 'unknown'}:${String(handshakeCatalog.length)}` };
                        const prepared = yield* Client.tenant.with(cfg.appId, ai.prepareKnowledge({
                            entityType: _MANIFEST_ENTITY_TYPE,
                            manifest:   seedProjection.manifest,
                            namespace:  _MANIFEST_NAMESPACE,
                            version:    seedProjection.version,
                        }));
                        yield* Effect.log('kargadan.harness.kb.prepare', {
                            knowledgeHash: prepared.state.hash,
                            knowledgeKey:  prepared.key,
                            prepared:      prepared.prepared,
                            source:        seedProjection.source,
                        });
                        const catalogIds = new Set(handshakeCatalog.map((e) => e.id));
                        const validatedResume = yield* Option.match(resume, {
                            onNone: () => Effect.succeed(resume),
                            onSome: (r) => S.decodeUnknown(_ResumedOpsCompat)(r.state).pipe(
                                Effect.map((decoded) => decoded.operations.some((op) => !catalogIds.has(op))
                                    || (decoded.workflowExecution?.commandId !== undefined && !catalogIds.has(decoded.workflowExecution.commandId))),
                                Effect.flatMap((incompatible) => incompatible
                                    ? Effect.log('kargadan.harness: catalog incompatible with resumed state, forcing fresh session').pipe(Effect.as(Option.none()))
                                    : Effect.succeed(resume)),
                                Effect.catchAll(() => Effect.succeed(resume))),
                        });
                        const runtimeIdentityBase = { appId: ack.appId, correlationId: ack.correlationId, sessionId: ack.sessionId };
                        return yield* loop.handle({
                            capabilities: ack.acceptedCapabilities, catalog: handshakeCatalog,
                            identityBase: runtimeIdentityBase,
                            intent,
                            knowledge: { entityType: _MANIFEST_ENTITY_TYPE, namespace: _MANIFEST_NAMESPACE },
                            resume: validatedResume,
                            ...(input?.hooks == null ? {} : { hooks: input.hooks }),
                        }).pipe(
                            Effect.tap((result) => Effect.log('Harness loop complete', { correlationId: runtimeIdentityBase.correlationId, outcome: result })),
                            Effect.ensuring(dispatch.close.pipe(Effect.zipRight(Fiber.interruptFork(dispatchFiber)))),
                        );
                    }).pipe(Effect.provide(_AttemptLayer(port.port))),
                ),
            );
            const completionError = Match.value(outcome.state.status).pipe(
                Match.when('Completed', () => Option.none<string>()),
                Match.when('Planning', () => Option.some('Loop terminated unexpectedly in Planning state')),
                Match.orElse(() => Option.some('Loop terminated with Failed status')));
            yield* Client.tenant.with(cfg.appId,
                agentPersistence.completeSession({
                    appId:         cfg.appId, correlationId,
                    error:         Option.getOrNull(completionError),
                    sequence:      outcome.state.sequence, sessionId,
                    status:        outcome.state.status === 'Completed' ? 'completed' as const : 'failed' as const,
                    toolCallCount: outcome.state.sequence,
                }));
            return outcome;
        }).pipe(
            Effect.withSpan('kargadan.harness.main'),
            Effect.provide(_RuntimeLayer),
        ),
    ),
);

// --- [LAYERS] ----------------------------------------------------------------

const _DispatchLayer = (port: number) => CommandDispatch.Default.pipe(
    Layer.provideMerge(KargadanSocketClientLayer(port)),
);
const _AttemptLayer = (port: number) => AgentLoop.Default.pipe(
    Layer.provideMerge(WorkflowEngine.layerMemory),
    Layer.provideMerge(_DispatchLayer(port)),
);
const _ProbeLayer = Layer.mergeAll(
    HarnessConfig.Default,
    ReconnectionSupervisor.Default,
);
const _RuntimeLayer = Layer.mergeAll(
    _ProbeLayer,
    HarnessConfig.persistenceLayer,
    WorkflowEngine.layerMemory,
    HarnessConfig.aiLayer,
);
const probeLive = Effect.scoped(
    Effect.gen(function* () {
        const [cfg, reconnect] = yield* Effect.all([HarnessConfig, ReconnectionSupervisor]);
        const identityBase = { appId: cfg.appId, correlationId: crypto.randomUUID().replaceAll('-', '') as typeof CorrelationId.Type, sessionId: crypto.randomUUID() };
        return yield* reconnect.supervise((port) => Effect.gen(function* () {
            const dispatch = yield* CommandDispatch;
            const dispatchFiber = yield* Effect.forkDaemon(dispatch.start());
            const handshake = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token: port.sessionToken });
            const result = (yield* dispatch.execute(dispatch.buildCommand(identityBase, 'read.scene.summary', {}, {
                operationTag: 'diagnostics.live.scene.summary',
            }))) as Envelope.Result;
            const summary = yield* Match.value(result.status).pipe(
                Match.when('ok', () => Option.fromNullable(result.result).pipe(Option.match({
                    onNone: () => Effect.fail({ _tag: 'HarnessRuntimeError' as const, message: 'read.scene.summary returned no payload.' }),
                    onSome: (payload) => S.decodeUnknown(_LiveSceneSummary)(payload),
                }))),
                Match.orElse(() => Effect.fail({
                    _tag:    'HarnessRuntimeError' as const,
                    detail:  result.error,
                    message: result.error?.message ?? 'read.scene.summary failed.',
                })),
            );
            return yield* Effect.succeed({ handshake, summary } as const).pipe(
                Effect.ensuring(dispatch.close.pipe(Effect.zipRight(Fiber.interruptFork(dispatchFiber)))),
            );
        }).pipe(Effect.provide(_DispatchLayer(port.port))));
    }).pipe(Effect.provide(_ProbeLayer)),
);

// --- [FUNCTIONS] -------------------------------------------------------------

const HarnessRuntime = { makeInteractiveHooks, probeLive, run } as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessRuntime };
