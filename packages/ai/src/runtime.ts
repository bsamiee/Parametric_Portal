/** biome-ignore-all lint/complexity/noBannedTypes: <prompt input> */
import { AiError, Chat, Telemetry as AiTelemetry, EmbeddingModel, LanguageModel, type Response, type Tool } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Data, Duration, Effect, Match, Option, PrimaryKey, Schema as S, Stream } from 'effect';
import { AiRegistry } from './registry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cache: { settings: { capacity: 256, storeId: 'ai:settings', ttlMinutes: 5 } },
    labels: {
        operations: {embed: 'ai.embed', generateObject: 'ai.generateObject', generateText: 'ai.generateText', settings: 'ai.settings', streamText: 'ai.streamText',},
        tokenKinds: {cached: 'cached', input: 'input', output: 'output', reasoning: 'reasoning', total: 'total',},
    },
    metrics: { unit: 1 },
    telemetry: { operations: { chat: 'chat', embeddings: 'embeddings' } },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

class AiSettingsKey extends S.TaggedRequest<AiSettingsKey>()('AiSettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) {[PrimaryKey.symbol]() {return `ai:settings:${this.tenantId}`;}}

// --- [CLASSES] ---------------------------------------------------------------

class AiRuntimeError extends Data.TaggedError('AiRuntimeError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const [db, metrics] = yield* Effect.all([DatabaseService, MetricsService]);
        const wrapError = (operation: string) => (cause: unknown) =>
            Match.value(cause).pipe(
                Match.when(AiError.isAiError, (error: AiError.AiError) => error),
                Match.orElse((error) => error instanceof AiRuntimeError ? error : new AiRuntimeError({ cause: error, operation }),
                ),
            );
        const mapSettingsError = wrapError(_CONFIG.labels.operations.settings);
        const annotate = (attributes: AiTelemetry.GenAITelemetryAttributeOptions) =>
            Effect.optionFromOptional(Effect.currentSpan).pipe(
                Effect.flatMap(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attributes)),
                    }),
                ),
            );
        const settingsCache = yield* CacheService.cache({
            inMemoryCapacity: _CONFIG.cache.settings.capacity,
            lookup: (key: AiSettingsKey) =>
                db.apps.one([{ field: 'id', value: key.tenantId }]).pipe(
                    Effect.mapError(mapSettingsError),
                    Effect.flatMap(
                        Option.match({
                            onNone: () =>
                                Effect.fail(
                                    new AiRuntimeError({
                                        cause: { tenantId: key.tenantId },
                                        operation: _CONFIG.labels.operations.settings,
                                    }),
                                ),
                            onSome: (app) =>
                                AiRegistry.decodeAppSettings(app.settings ?? {}).pipe(
                                    Effect.mapError(mapSettingsError),
                                ),
                        }),
                    ),
                ),
            storeId: _CONFIG.cache.settings.storeId,
            timeToLive: Duration.minutes(_CONFIG.cache.settings.ttlMinutes),
        });
        const settingsFor = (tenantId: string) =>
            settingsCache
                .get(new AiSettingsKey({ tenantId }))
                .pipe(Effect.mapError(mapSettingsError));
        const settings = () => Context.Request.currentTenantId.pipe(Effect.flatMap(settingsFor));
        const tokenUsage = (labels: Record<string, string | undefined>, usage: Response.Usage) =>
            Effect.forEach(
                [
                    [_CONFIG.labels.tokenKinds.input, usage.inputTokens] as const,
                    [_CONFIG.labels.tokenKinds.output, usage.outputTokens] as const,
                    [_CONFIG.labels.tokenKinds.total, usage.totalTokens] as const,
                    [_CONFIG.labels.tokenKinds.reasoning, usage.reasoningTokens] as const,
                    [_CONFIG.labels.tokenKinds.cached, usage.cachedInputTokens] as const,
                ],
                ([kind, value]) =>
                    Option.fromNullable(value).pipe(
                        Option.match({
                            onNone: () => Effect.void,
                            onSome: (tokens) =>
                                MetricsService.inc(metrics.ai.tokens, MetricsService.label({ ...labels, kind }), tokens),
                        }),
                    ),
                { discard: true },
            );
        const track = <A, E, R>(
            operation: string,
            labels: ReturnType<typeof MetricsService.label>,
            effect: Effect.Effect<A, E, R>,) =>
            effect.pipe(
                (eff) => Resilience.run(operation, eff),
                (eff) =>
                    MetricsService.trackEffect(eff, {
                        duration: metrics.ai.duration,
                        errors: metrics.ai.errors,
                        labels,
                    }),
                Effect.tapBoth({
                    onFailure: () => MetricsService.inc(metrics.ai.requests, labels, _CONFIG.metrics.unit),
                    onSuccess: () => MetricsService.inc(metrics.ai.requests, labels, _CONFIG.metrics.unit),
                }),
            );
        const languageContext = (operation: string) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const [appSettings, fiberId] = yield* Effect.all([settingsFor(ctx.tenantId), Effect.fiberId]);
                const labelPairs = {
                    model: appSettings.language.model,
                    operation,
                    provider: appSettings.language.provider,
                    tenant: ctx.tenantId,
                };
                const labels = MetricsService.label(labelPairs);
                const layers = AiRegistry.layers(appSettings);
                const requestAnnotations = annotate({
                    operation: { name: _CONFIG.telemetry.operations.chat },
                    request: {
                        maxTokens: appSettings.language.maxTokens,
                        model: appSettings.language.model,
                        temperature: appSettings.language.temperature,
                        topK: appSettings.language.topK,
                        topP: appSettings.language.topP,
                    },
                    system: appSettings.language.provider,
                });
                const spanAttrs = Context.Request.toAttrs(ctx, fiberId);
                return { appSettings, labelPairs, labels, layers, requestAnnotations, spanAttrs } as const;
            });
        function embed(input: string,): Effect.Effect<readonly number[], AiError.AiError | AiRuntimeError, Resilience.State>;
        function embed(input: readonly string[],): Effect.Effect<readonly (readonly number[])[], AiError.AiError | AiRuntimeError, Resilience.State>;
        function embed(input: string | readonly string[],): Effect.Effect<readonly number[] | readonly (readonly number[])[],AiError.AiError | AiRuntimeError,Resilience.State> {
            return Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const appSettings = yield* settingsFor(ctx.tenantId);
                const labelPairs = {
                    dimensions: String(appSettings.embedding.dimensions),
                    model: appSettings.embedding.model,
                    operation: _CONFIG.labels.operations.embed,
                    provider: appSettings.embedding.provider,
                    tenant: ctx.tenantId,
                };
                const labels = MetricsService.label(labelPairs);
                const layers = AiRegistry.layers(appSettings);
                const requestAnnotations = annotate({
                    operation: { name: _CONFIG.telemetry.operations.embeddings },
                    request: { model: appSettings.embedding.model },
                    system: appSettings.embedding.provider,
                });
                const run = <A>(
                    effect: Effect.Effect<A, unknown, EmbeddingModel.EmbeddingModel>,
                    count: (value: A) => number,) =>
                    track(_CONFIG.labels.operations.embed, labels, effect.pipe(Effect.provide(layers.embedding))).pipe(
                        Effect.tap((value: A) => MetricsService.inc(metrics.ai.embeddings, labels, count(value))),
                        Effect.tapBoth({
                            onFailure: () => requestAnnotations,
                            onSuccess: () => requestAnnotations,
                        }),
                        Telemetry.span(_CONFIG.labels.operations.embed, { kind: 'client', metrics: false }),
                    );
                return yield* Match.value(input).pipe(
                    Match.when(
                        (value: string | readonly string[]): value is readonly string[] => Array.isArray(value),
                        (items) =>
                            run(
                                Effect.flatMap(EmbeddingModel.EmbeddingModel, (embedding) => embedding.embedMany(items),),
                                (values) => values.length,
                            ),
                    ),
                    Match.orElse((item) =>
                        run(
                            Effect.flatMap(EmbeddingModel.EmbeddingModel, (embedding) => embedding.embed(item)),
                            () => _CONFIG.metrics.unit,
                        ),
                    ),
                );
            }).pipe(Effect.mapError(wrapError(_CONFIG.labels.operations.embed)));
        }
        const runLanguage = <A extends { readonly usage: Response.Usage }, Options, R>(
            operation: string,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiError.AiError, R>,) =>
            Effect.gen(function* () {
                const { appSettings, labelPairs, labels, layers, requestAnnotations } = yield* languageContext(operation,);
                const response = yield* track(
                    operation,
                    labels,
                    run(options).pipe(Effect.provide(layers.language)),
                ).pipe(
                    Effect.tapBoth({
                        onFailure: () => requestAnnotations,
                        onSuccess: () => requestAnnotations,
                    }),
                    Effect.tap((resp) => tokenUsage(labelPairs, resp.usage)),
                    Effect.tap((resp) =>
                        annotate({
                            operation: { name: _CONFIG.telemetry.operations.chat },
                            system: appSettings.language.provider,
                            usage: resp.usage,
                        }),
                    ),
                    Telemetry.span(operation, { kind: 'client', metrics: false }),
                );
                return response;
            }).pipe(Effect.mapError(wrapError(operation)));
        const generateText = <Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) => runLanguage(_CONFIG.labels.operations.generateText, options, LanguageModel.generateText);
        const generateObject = <A, I extends Record<string, unknown>, R, Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateObjectOptions<Tools, A, I, R>,
        ) => runLanguage(_CONFIG.labels.operations.generateObject, options, LanguageModel.generateObject);
        const recordStreamTextPreStartError = (error: unknown) =>
            Context.Request.currentTenantId.pipe(
                Effect.flatMap((tenantId) => {
                    const labels = MetricsService.label({
                        operation: _CONFIG.labels.operations.streamText,
                        tenant: tenantId,
                    });
                    return Effect.all(
                        [
                            MetricsService.inc(metrics.ai.requests, labels, _CONFIG.metrics.unit),
                            MetricsService.trackError(metrics.ai.errors, labels, error),
                        ],
                        { discard: true },
                    );
                }),
            );
        const streamText = <Tools extends Record<string, Tool.Any> = {}>(
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) =>
            Stream.unwrap(
                Effect.gen(function* () {
                    const { appSettings, labelPairs, labels, layers, requestAnnotations, spanAttrs } =
                        yield* languageContext(_CONFIG.labels.operations.streamText);
                    const base = LanguageModel.streamText(options).pipe(Stream.provideLayer(layers.language));
                    const onStart = Effect.all(
                        [
                            requestAnnotations,
                            MetricsService.inc(metrics.ai.requests, labels, _CONFIG.metrics.unit),
                        ],
                        { discard: true },
                    );
                    const onFinish = (part: Response.StreamPart<Tools>) =>
                        Option.match(
                            Option.liftPredicate(
                                (value: Response.StreamPart<Tools>): value is Response.FinishPart =>
                                    value.type === 'finish',
                            )(part),
                            {
                                onNone: () => Effect.void,
                                onSome: (finish) =>
                                    Effect.all(
                                        [
                                            tokenUsage(labelPairs, finish.usage),
                                            annotate({
                                                operation: { name: _CONFIG.telemetry.operations.chat },
                                                system: appSettings.language.provider,
                                                usage: finish.usage,
                                            }),
                                        ],
                                        { discard: true },
                                    ),
                            },
                        );
                    const onError = (error: unknown) => MetricsService.trackError(metrics.ai.errors, labels, error);
                    const withStart = Stream.onStart(base, onStart);
                    const withFinish = Stream.mapEffect(withStart, (part) => onFinish(part).pipe(Effect.as(part)),);
                    const withError = Stream.tapError(withFinish, onError);
                    const withMetrics = MetricsService.trackStream(withError, metrics.stream.elements, labelPairs);
                    return Stream.withSpan(withMetrics, _CONFIG.labels.operations.streamText, { attributes: spanAttrs, kind: 'client' });
                }).pipe(
                    Effect.tapError(recordStreamTextPreStartError),
                    (eff) => Resilience.run(_CONFIG.labels.operations.streamText, eff),
                ),
            ).pipe(Stream.mapError(wrapError(_CONFIG.labels.operations.streamText)));
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            Effect.gen(function* () {
                const appSettings = yield* settings();
                const base = Option.fromNullable(options?.prompt).pipe(
                    Option.match({
                        onNone: () => Chat.empty,
                        onSome: (prompt) => Chat.fromPrompt(prompt),
                    }),
                );
                return yield* base.pipe(Effect.provide(AiRegistry.layers(appSettings).language));
            });
        return { chat, embed, generateObject, generateText, settings, streamText };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
