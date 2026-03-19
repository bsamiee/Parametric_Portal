import { AiRegistry } from '@parametric-portal/ai/registry';
import { SessionOverride } from '@parametric-portal/ai/runtime-provider';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { Effect, FiberRef, Layer, Match, Option, Schema as S } from 'effect';
import { HarnessConfig, KargadanHost } from './config';
import { CommandDispatch } from './protocol/dispatch';
import type { CorrelationId, Envelope } from './protocol/schemas';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

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
    readonly architectFallback?: ReadonlyArray<string>;
    readonly architectPrimary?:  string;
    readonly continue?:          boolean;
    readonly hooks?:             Parameters<AgentLoop['handle']>[0]['hooks'];
    readonly intent?:            string;
    readonly sessionId?:         string;
}) =>
        Effect.scoped(
        Effect.gen(function* () {
            const [dispatch, loop, reconnect, cfg, ai] = yield* Effect.all([
                CommandDispatch, AgentLoop, ReconnectionSupervisor, HarnessConfig, AiService,
            ]);
            const agentPersistence = yield* AgentPersistenceService;
            const architectOverrideInput = yield* SessionOverride.decodeFromInput({
                fallback: (input?.architectFallback ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0),
                primary:  input?.architectPrimary?.trim() ?? '',
            });
            const architectOverride = Option.orElse(architectOverrideInput, () => cfg.resolveArchitectOverride);
            const intent = input?.intent ?? cfg.agentIntent;
            const requestedSessionId = Option.fromNullable(input?.sessionId);
            const wantsContinue = input?.continue === true;
            yield* FiberRef.set(AiRegistry.SessionOverrideRef, cfg.resolveSessionOverride);
            yield* FiberRef.set(AiRegistry.OnTokenRefreshRef, Option.some(KargadanHost.auth.onTokenRefresh));
            const correlationId = crypto.randomUUID().replaceAll('-', '') as typeof CorrelationId.Type;
            const resumableSessionId = yield* Option.match(requestedSessionId, {
                onNone: () => wantsContinue || input?.intent === undefined
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
                        yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
                        yield* Effect.forkScoped(dispatch.start());
                        const ack = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token: cfg.sessionToken });
                        const receivedCatalog = yield* dispatch.receiveCatalog();
                        const handshakeCatalog = receivedCatalog.length === 0 ? ack.catalog : receivedCatalog;
                        const mergedManifest = [...handshakeCatalog, ...CommandDispatch.templateCatalog];
                        const seedProjection = { manifest: mergedManifest, source: 'handshake' as const,
                            version: `handshake:${ack.server?.pluginRevision ?? 'unknown'}:${String(mergedManifest.length)}` };
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
                        const catalogIds = new Set(mergedManifest.map((e) => e.id));
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
                            architectOverride, capabilities: ack.acceptedCapabilities, catalog: mergedManifest,
                            identityBase: runtimeIdentityBase, intent, resume: validatedResume,
                            ...(input?.hooks == null ? {} : { hooks: input.hooks }),
                        }).pipe(Effect.tap((result) =>
                            Effect.log('Harness loop complete', { correlationId: runtimeIdentityBase.correlationId, outcome: result })));
                    }),
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

const _TransportLayer = CommandDispatch.Default.pipe(
    Layer.provideMerge(KargadanSocketClientLive.pipe(Layer.provideMerge(ReconnectionSupervisor.Default))),
);
const _RuntimeLayer = AgentLoop.Default.pipe(
    Layer.provideMerge(_TransportLayer),
    Layer.provideMerge(AiService.KnowledgeDefault),
    Layer.provideMerge(HarnessConfig.persistenceLayer),
);
const probeLive = Effect.scoped(
    Effect.gen(function* () {
        const [dispatch, cfg, reconnect] = yield* Effect.all([CommandDispatch, HarnessConfig, ReconnectionSupervisor]);
        const identityBase = { appId: cfg.appId, correlationId: crypto.randomUUID().replaceAll('-', '') as typeof CorrelationId.Type, sessionId: crypto.randomUUID() };
        return yield* reconnect.supervise(() => Effect.gen(function* () {
            yield* Effect.forkScoped(dispatch.start()).pipe(Effect.asVoid);
            const handshake = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token: cfg.sessionToken });
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
            return { handshake, summary } as const;
        }));
    }).pipe(Effect.provide(_TransportLayer)),
);

// --- [FUNCTIONS] -------------------------------------------------------------

const HarnessRuntime = { makeInteractiveHooks, probeLive, run } as const;

// --- [EXPORT] ----------------------------------------------------------------

export { HarnessRuntime };
