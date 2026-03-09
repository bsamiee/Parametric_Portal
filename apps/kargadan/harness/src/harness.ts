import { createHash } from 'node:crypto';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService, ManifestArraySchema, type ManifestEntrySchema } from '@parametric-portal/ai/service';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { Array as A, Effect, FiberRef, HashMap, Layer, Match, Option, Schema as S } from 'effect';
import { HarnessConfig, KargadanHost } from './config';
import { CommandDispatch } from './protocol/dispatch';
import type { Envelope } from './protocol/schemas';
import { AgentLoop } from './runtime/agent-loop';
import { KargadanSocketClientLive, ReconnectionSupervisor } from './socket';

// --- [SCHEMA] ----------------------------------------------------------------

const _MarkerSchema     = S.Struct({ hash: S.String, manifestVersion: S.String });
const _LiveSceneSummary = S.Struct({ objectCount: S.Int.pipe(S.greaterThanOrEqualTo(0)) });

// --- [FUNCTIONS] -------------------------------------------------------------

const _mergeManifest = (
    base:      ReadonlyArray<Envelope.CatalogEntry>,
    overrides: Option.Option<ReadonlyArray<S.Schema.Type<typeof ManifestEntrySchema>>>,
) =>
    Option.match(overrides, {
        onNone: () => base,
        onSome: (entries) => {
            const byId = HashMap.fromIterable(A.map(entries, (entry) => [entry.id, entry] as const));
            return A.map(base, (entry) => Option.match(HashMap.get(byId, entry.id), {
                onNone: () => entry,
                onSome: (enriched) => ({ ...entry,
                    aliases:       A.dedupe(A.appendAll(entry.aliases, enriched.aliases)), category: enriched.category ?? entry.category,
                    description:   enriched.description, examples: enriched.examples.length === 0 ? entry.examples : enriched.examples,
                    isDestructive: enriched.isDestructive ?? entry.isDestructive, name: enriched.name,
                    params:        enriched.params.length === 0 ? entry.params : enriched.params, requirements: entry.requirements,
                }) as typeof entry,
            }));
        },
    });
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
    readonly architectModel?:    string;
    readonly architectProvider?: string;
    readonly hooks?:             Parameters<AgentLoop['handle']>[0]['hooks'];
    readonly intent?:            string;
    readonly resume?:            'auto' | 'off';
    readonly sessionId?:         string;
}) =>
    Effect.scoped(
        Effect.gen(function* () {
            const [dispatch, loop, persistence, reconnect, cfg, ai, database] = yield* Effect.all([
                CommandDispatch, AgentLoop, AgentPersistenceService, ReconnectionSupervisor, HarnessConfig, AiService, DatabaseService,
            ]);
            const architectOverrideInput = yield* AiRegistry.decodeSessionOverrideFromInput({
                fallback: (input?.architectFallback ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0),
                model:    input?.architectModel?.trim() ?? '',
                provider: input?.architectProvider?.trim() ?? '',
            });
            const architectOverride = Option.orElse(architectOverrideInput, () => cfg.resolveArchitectOverride);
            const intent = input?.intent ?? cfg.agentIntent;
            const resumeMode = input?.resume ?? 'auto';
            const requestedSessionId = Option.fromNullable(input?.sessionId);
            yield* FiberRef.set(AiRegistry.SessionOverrideRef, cfg.resolveSessionOverride);
            yield* FiberRef.set(AiRegistry.OnTokenRefreshRef, Option.some(KargadanHost.auth.onTokenRefresh));
            const correlationId = crypto.randomUUID().replaceAll('-', '');
            const resumableSessionId = yield* Match.value(resumeMode).pipe(
                Match.when('off', () => Effect.succeed(Option.none<string>())),
                Match.orElse(() =>
                    Context.Request.withinSync(
                        cfg.appId,
                        Option.match(requestedSessionId, {
                            onNone: () => persistence.findResumable(cfg.appId),
                            onSome: (id) => Effect.succeed(Option.some(id)),
                        }),
                        { requestId: correlationId },
                    )),
            );
            const hydration = yield* Option.match(resumableSessionId, {
                onNone: () => Effect.succeed(Option.none()),
                onSome: (sid) => Context.Request.withinSync(cfg.appId, persistence.hydrate(sid).pipe(Effect.map(Option.some)), { requestId: correlationId }),
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
                Context.Request.withinSync(cfg.appId, persistence.startSession({ appId: cfg.appId, correlationId, sessionId }), { requestId: correlationId }),
                () => Option.isNone(resume));
            const identityBase = { appId: cfg.appId, correlationId, sessionId };
            const outcome = yield* Context.Request.withinSync(
                cfg.appId,
                reconnect.supervise((port) =>
                    Effect.gen(function* () {
                        yield* Effect.log('kargadan.harness: connecting', { port, sessionId: identityBase.sessionId });
                        yield* Effect.forkScoped(dispatch.start());
                        const ack = yield* dispatch.handshake({ ...identityBase, requestId: crypto.randomUUID(), token: cfg.sessionToken });
                        const receivedCatalog = yield* dispatch.receiveCatalog();
                        const handshakeCatalog = receivedCatalog.length === 0 ? ack.catalog : receivedCatalog;
                        const envManifest = yield* S.decodeUnknown(ManifestArraySchema)(cfg.commandManifestJson).pipe(Effect.option);
                        const mergedManifest = _mergeManifest(handshakeCatalog, envManifest);
                        const seedProjection = mergedManifest.length === 0
                            ? { manifest: cfg.commandManifestJson, source: 'env' as const, version: cfg.commandManifestVersion }
                            : { manifest: mergedManifest, source: 'handshake' as const,
                                version: `handshake:${ack.server?.pluginRevision ?? 'unknown'}:${String(mergedManifest.length)}` };
                        const serializedManifest = typeof seedProjection.manifest === 'string' ? seedProjection.manifest : JSON.stringify(seedProjection.manifest);
                        const scope = Option.getOrElse(cfg.commandManifestScopeId, () => 'global');
                        const markerKey = `kargadan:manifest:${cfg.commandManifestNamespace}:${cfg.commandManifestEntityType}:${scope}`;
                        const markerValue = { hash: createHash('sha256').update(`${seedProjection.version}\n${serializedManifest}`).digest('hex'),
                            manifestVersion: seedProjection.version };
                        yield* Client.tenant.with(cfg.appId, database.kvStore.getJson(markerKey, _MarkerSchema)).pipe(
                            Effect.map(Option.match({
                                onNone: () => true,
                                onSome: (stored) => stored.hash !== markerValue.hash || stored.manifestVersion !== markerValue.manifestVersion,
                            })),
                            Effect.flatMap((needs) => Effect.when(
                                ai.seedKnowledge({ entityType: cfg.commandManifestEntityType, manifest: seedProjection.manifest,
                                    namespace: cfg.commandManifestNamespace, scopeId: Option.getOrNull(cfg.commandManifestScopeId) }).pipe(
                                    Effect.zipRight(Client.tenant.with(cfg.appId, database.kvStore.setJson(markerKey, markerValue, _MarkerSchema))),
                                    Effect.zipRight(Effect.log('kargadan.harness.kb.seed.applied', {
                                        manifestHash: markerValue.hash, markerKey, source: seedProjection.source }))),
                                () => needs)),
                            Effect.when(() => serializedManifest.trim().length > 0));
                        const runtimeIdentityBase = { appId: ack.appId, correlationId: ack.correlationId, sessionId: ack.sessionId };
                        return yield* loop.handle({
                            architectOverride, capabilities: ack.acceptedCapabilities, catalog: mergedManifest,
                            identityBase: runtimeIdentityBase, intent, resume,
                            ...(input?.hooks == null ? {} : { hooks: input.hooks }),
                        }).pipe(Effect.tap((result) =>
                            Effect.log('Harness loop complete', { correlationId: runtimeIdentityBase.correlationId, outcome: result })));
                    }),
                ),
                { requestId: correlationId },
            );
            const completionError = Match.value(outcome.state.status).pipe(
                Match.when('Completed', () => Option.none<string>()),
                Match.when('Planning', () => Option.some('Loop terminated unexpectedly in Planning state')),
                Match.orElse(() => Option.some('Loop terminated with Failed status')));
            yield* Context.Request.withinSync(cfg.appId,
                persistence.completeSession({
                    appId:         cfg.appId, correlationId,
                    error:         Option.getOrNull(completionError),
                    sequence:      outcome.state.sequence, sessionId,
                    status:        outcome.state.status === 'Completed' ? 'completed' as const : 'failed' as const,
                    toolCallCount: outcome.state.sequence,
                }), { requestId: correlationId });
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
        const identityBase = { appId: cfg.appId, correlationId: crypto.randomUUID().replaceAll('-', ''), sessionId: crypto.randomUUID() };
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
