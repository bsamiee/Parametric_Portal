/** biome-ignore-all lint/complexity/noBannedTypes: <prompt input> */
import { AiError, Chat, Telemetry as AiTelemetry, EmbeddingModel, LanguageModel, type Response, type Tool } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Data, Duration, Effect, Match, Option, PrimaryKey, Schema as S, Stream } from 'effect';
import { constant } from 'effect/Function';
import { AiRegistry } from './registry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cache: { settings: { capacity: 256, storeId: 'ai:settings', ttlMinutes: 5 } },
    labels: {
        operations: { embed: 'ai.embed', generateObject: 'ai.generateObject', generateText: 'ai.generateText', settings: 'ai.settings', streamText: 'ai.streamText' },
        tokenKinds: ['input', 'output', 'total', 'reasoning', 'cached'] as const,
    },
    telemetry: { operations: { chat: 'chat', embeddings: 'embeddings' } },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

class AiSettingsKey extends S.TaggedRequest<AiSettingsKey>()('AiSettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) { [PrimaryKey.symbol]() { return `ai:settings:${this.tenantId}`; } }

// --- [ERRORS] ----------------------------------------------------------------

class AiRuntimeError extends Data.TaggedError('AiRuntimeError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _wrapError = (operation: string) => (cause: unknown) =>
    Match.value(cause).pipe(
        Match.when(AiError.isAiError, (error: AiError.AiError) => error),
        Match.orElse((error) => error instanceof AiRuntimeError ? error : new AiRuntimeError({ cause: error, operation })),
    );

const _tokenUsageKeys = (usage: Response.Usage) => [
    usage.inputTokens, usage.outputTokens, usage.totalTokens,
    usage.reasoningTokens, usage.cachedInputTokens,
] as const;

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const [db, metrics] = yield* Effect.all([DatabaseService, MetricsService]);
        const mapSettingsError = _wrapError(_CONFIG.labels.operations.settings);
        const annotate = (attributes: AiTelemetry.GenAITelemetryAttributeOptions) =>
            Effect.flatMap(Effect.optionFromOptional(Effect.currentSpan), Option.match({
                onNone: constant(Effect.void),
                onSome: (span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attributes)),
            }));
        const settingsCache = yield* CacheService.cache({
            inMemoryCapacity: _CONFIG.cache.settings.capacity,
            lookup: (key: AiSettingsKey) =>
                db.apps.one([{ field: 'id', value: key.tenantId }]).pipe(
                    Effect.mapError(mapSettingsError),
                    Effect.filterOrFail(Option.isSome, constant(new AiRuntimeError({ cause: { tenantId: key.tenantId }, operation: _CONFIG.labels.operations.settings }))),
                    Effect.map(({ value }) => value),
                    Effect.flatMap((app) => AiRegistry.decodeAppSettings(app.settings ?? {}).pipe(Effect.mapError(mapSettingsError))),
                ),
            storeId: _CONFIG.cache.settings.storeId,
            timeToLive: Duration.minutes(_CONFIG.cache.settings.ttlMinutes),
        });
        const settingsFor = (tenantId: string) =>
            settingsCache.get(new AiSettingsKey({ tenantId })).pipe(Effect.mapError(mapSettingsError));
        const settings = () => Context.Request.currentTenantId.pipe(Effect.flatMap(settingsFor));
        const tokenUsage = (labels: Record<string, string | undefined>, usage: Response.Usage) =>
            Effect.forEach(
                _CONFIG.labels.tokenKinds.flatMap((kind, i) => {
                    const value = _tokenUsageKeys(usage)[i];
                    return value == null ? [] : [[kind, value] as const];
                }),
                ([kind, tokens]) => MetricsService.inc(metrics.ai.tokens, MetricsService.label({ ...labels, kind }), tokens),
                { discard: true },
            );
        const track = <A, E, R>(
            operation: string,
            labels: ReturnType<typeof MetricsService.label>,
            effect: Effect.Effect<A, E, R>,
        ) =>
            Resilience.run(operation, effect).pipe(
                (eff) => MetricsService.trackEffect(eff, { duration: metrics.ai.duration, errors: metrics.ai.errors, labels }),
                Effect.ensuring(MetricsService.inc(metrics.ai.requests, labels, 1)),
            );
        const languageContext = (operation: string) =>
            Context.Request.current.pipe(
                Effect.bindTo('requestContext'),
                Effect.bind('resolved', ({ requestContext }) => Effect.all([settingsFor(requestContext.tenantId), Effect.fiberId])),
                Effect.map(({ requestContext, resolved: [appSettings, fiberId] }) => {
                    const labelPairs = { model: appSettings.language.model, operation, provider: appSettings.language.provider, tenant: requestContext.tenantId };
                    return {
                        appSettings,
                        labelPairs,
                        labels: MetricsService.label(labelPairs),
                        layers: AiRegistry.layers(appSettings),
                        requestAnnotations: annotate({
                            operation: { name: _CONFIG.telemetry.operations.chat },
                            request: { maxTokens: appSettings.language.maxTokens, model: appSettings.language.model, temperature: appSettings.language.temperature, topK: appSettings.language.topK, topP: appSettings.language.topP },
                            system: appSettings.language.provider,
                        }),
                        spanAttrs: Context.Request.toAttrs(requestContext, fiberId),
                    } as const;
                }),
            );
        function embed(input: string): Effect.Effect<readonly number[], AiError.AiError | AiRuntimeError, Resilience.State>;
        function embed(input: readonly string[]): Effect.Effect<readonly (readonly number[])[], AiError.AiError | AiRuntimeError, Resilience.State>;
        // biome-ignore lint/suspicious/noExplicitAny: overloads provide precise types to callers
        function embed(input: string | readonly string[]): any {
            return Context.Request.current.pipe(
                Effect.bindTo('requestContext'),
                Effect.bind('appSettings', ({ requestContext }) => settingsFor(requestContext.tenantId)),
                Effect.flatMap(({ requestContext, appSettings }) => {
                    const labelPairs = { dimensions: String(appSettings.embedding.dimensions), model: appSettings.embedding.model, operation: _CONFIG.labels.operations.embed, provider: appSettings.embedding.provider, tenant: requestContext.tenantId };
                    const labels = MetricsService.label(labelPairs);
                    const layers = AiRegistry.layers(appSettings);
                    const ann = annotate({ operation: { name: _CONFIG.telemetry.operations.embeddings }, request: { model: appSettings.embedding.model }, system: appSettings.embedding.provider });
                    return track(_CONFIG.labels.operations.embed, labels,
                        Effect.gen(function* () {
                            const e = yield* EmbeddingModel.EmbeddingModel;
                            return yield* (Array.isArray(input) ? e.embedMany(input as readonly string[]) : e.embed(input as string));
                        }).pipe(Effect.provide(layers.embedding)),
                    ).pipe(
                        Effect.tap((result) => MetricsService.inc(metrics.ai.embeddings, labels, Array.isArray(input) ? (result as readonly (readonly number[])[]).length : 1)),
                        Effect.ensuring(ann),
                        Telemetry.span(_CONFIG.labels.operations.embed, { kind: 'client', metrics: false }),
                    );
                }),
                Effect.mapError(_wrapError(_CONFIG.labels.operations.embed)),
            );
        }
        const runLanguage = <A extends { readonly usage: Response.Usage }, Options, R>(
            operation: string,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiError.AiError, R>,
        ) =>
            languageContext(operation).pipe(
                Effect.flatMap(({ appSettings, labelPairs, labels, layers, requestAnnotations }) =>
                    track(operation, labels, run(options).pipe(Effect.provide(layers.language))).pipe(
                        Effect.ensuring(requestAnnotations),
                        Effect.tap((resp) => tokenUsage(labelPairs, resp.usage)),
                        Effect.tap((resp) => annotate({ operation: { name: _CONFIG.telemetry.operations.chat }, system: appSettings.language.provider, usage: resp.usage })),
                        Telemetry.span(operation, { kind: 'client', metrics: false }),
                    ),
                ),
                Effect.mapError(_wrapError(operation)),
            );
        const generateText = <Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) => runLanguage(_CONFIG.labels.operations.generateText, options, LanguageModel.generateText);
        const generateObject = <A, I extends Record<string, unknown>, R, Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateObjectOptions<Tools, A, I, R>,
        ) => runLanguage(_CONFIG.labels.operations.generateObject, options, LanguageModel.generateObject);
        const streamText = <Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) =>
            Stream.unwrap(
                languageContext(_CONFIG.labels.operations.streamText).pipe(
                    Effect.map(({ appSettings, labelPairs, labels, layers, requestAnnotations, spanAttrs }) => {
                        const base = LanguageModel.streamText(options).pipe(Stream.provideLayer(layers.language));
                        const onStart = Effect.all([requestAnnotations, MetricsService.inc(metrics.ai.requests, labels, 1)], { discard: true });
                        const onFinish = (part: Response.StreamPart<Tools>) =>
                            part.type === 'finish'
                                ? Effect.all([tokenUsage(labelPairs, part.usage), annotate({ operation: { name: _CONFIG.telemetry.operations.chat }, system: appSettings.language.provider, usage: part.usage })], { discard: true })
                                : Effect.void;
                        return Stream.withSpan(
                            MetricsService.trackStream(
                                Stream.tapError(Stream.mapEffect(Stream.onStart(base, onStart), (part) => onFinish(part).pipe(Effect.as(part))),
                                    (error) => MetricsService.trackError(metrics.ai.errors, labels, error)),
                                metrics.stream.elements,
                                labelPairs,
                            ),
                            _CONFIG.labels.operations.streamText,
                            { attributes: spanAttrs, kind: 'client' },
                        );
                    }),
                    Effect.tapError((error) => Context.Request.currentTenantId.pipe(
                        Effect.flatMap((tenantId) => {
                            const labels = MetricsService.label({ operation: _CONFIG.labels.operations.streamText, tenant: tenantId });
                            return Effect.all([MetricsService.inc(metrics.ai.requests, labels, 1), MetricsService.trackError(metrics.ai.errors, labels, error)], { discard: true });
                        }),
                    )),
                    (eff) => Resilience.run(_CONFIG.labels.operations.streamText, eff),
                ),
            ).pipe(Stream.mapError(_wrapError(_CONFIG.labels.operations.streamText)));
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            settings().pipe(
                Effect.flatMap((appSettings) =>
                    (options?.prompt === undefined ? Chat.empty : Chat.fromPrompt(options.prompt)).pipe(
                        Effect.provide(AiRegistry.layers(appSettings).language),
                    ),
                ),
            );
        return { chat, embed, generateObject, generateText, settings, streamText };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
