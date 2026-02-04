/** biome-ignore-all lint/complexity/noBannedTypes: <prompt input> */
import { AiError, Telemetry as AiTelemetry, EmbeddingModel, LanguageModel, type Response, type Tool } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Data, Duration, Effect, Match, Option, PrimaryKey, Schema as S } from 'effect';
import { AiRegistry } from './registry.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cache: { settings: { capacity: 256, storeId: 'ai:settings', ttlMinutes: 5 } },
    labels: {
        operations: {
            embed: 'ai.embed',
            generateObject: 'ai.generateObject',
            generateText: 'ai.generateText',
            settings: 'ai.settings',
        },
        tokenKinds: {
            cached: 'cached',
            input: 'input',
            output: 'output',
            reasoning: 'reasoning',
            total: 'total',
        },
    },
    metrics: { unit: 1 },
    telemetry: { operations: { chat: 'chat', embeddings: 'embeddings' } },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

class AiSettingsKey extends S.TaggedRequest<AiSettingsKey>()('AiSettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) {
    [PrimaryKey.symbol]() {
        return `ai:settings:${this.tenantId}`;
    }
}

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
                Match.orElse((error) =>
                    error instanceof AiRuntimeError ? error : new AiRuntimeError({ cause: error, operation }),
                ),
            );
        const annotate = (attributes: AiTelemetry.GenAITelemetryAttributeOptions) =>
            Effect.optionFromOptional(Effect.currentSpan).pipe(
                Effect.flatMap(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attributes)),
                    }),
                ),
            );
        const settingsCache = yield* CacheService.cache<AiSettingsKey, never>({
            inMemoryCapacity: _CONFIG.cache.settings.capacity,
            lookup: (key) =>
                db.apps.one([{ field: 'id', value: key.tenantId }]).pipe(
                    Effect.mapError(wrapError(_CONFIG.labels.operations.settings)),
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
                                    Effect.mapError(wrapError(_CONFIG.labels.operations.settings)),
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
                .pipe(Effect.mapError(wrapError(_CONFIG.labels.operations.settings)));
        const settings = () => Context.Request.current.pipe(Effect.flatMap((ctx) => settingsFor(ctx.tenantId)));
        const tokenUsage = (labels: Record<string, string | undefined>, usage: Response.Usage) => {
            const tokenLabels = (kind: string) => MetricsService.label({ ...labels, kind });
            const inc = (kind: string, value: number | undefined) =>
                Option.fromNullable(value).pipe(
                    Option.match({
                        onNone: () => Effect.void,
                        onSome: (tokens) => MetricsService.inc(metrics.ai.tokens, tokenLabels(kind), tokens),
                    }),
                );
            return Effect.all(
                [
                    inc(_CONFIG.labels.tokenKinds.input, usage.inputTokens),
                    inc(_CONFIG.labels.tokenKinds.output, usage.outputTokens),
                    inc(_CONFIG.labels.tokenKinds.total, usage.totalTokens),
                    inc(_CONFIG.labels.tokenKinds.reasoning, usage.reasoningTokens),
                    inc(_CONFIG.labels.tokenKinds.cached, usage.cachedInputTokens),
                ],
                { discard: true },
            );
        };
        const track = <A, E, R>(
            operation: string,
            labels: ReturnType<typeof MetricsService.label>,
            effect: Effect.Effect<A, E, R>,
        ) =>
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
        function embed(
            input: string,
        ): Effect.Effect<readonly number[], AiError.AiError | AiRuntimeError, Resilience.State>;
        function embed(
            input: readonly string[],
        ): Effect.Effect<readonly (readonly number[])[], AiError.AiError | AiRuntimeError, Resilience.State>;
        function embed(
            input: string | readonly string[],
        ): Effect.Effect<
            readonly number[] | readonly (readonly number[])[],
            AiError.AiError | AiRuntimeError,
            Resilience.State
        > {
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
                    count: (value: A) => number,
                ) =>
                    track(_CONFIG.labels.operations.embed, labels, effect.pipe(Effect.provide(layers.embedding))).pipe(
                        Effect.tap((value: A) => MetricsService.inc(metrics.ai.embeddings, labels, count(value))),
                        Effect.tap(() => requestAnnotations),
                        Telemetry.span(_CONFIG.labels.operations.embed, { kind: 'client', metrics: false }),
                    );
                return yield* Match.value(input).pipe(
                    Match.when(
                        (value: string | readonly string[]): value is readonly string[] => Array.isArray(value),
                        (items) =>
                            run(
                                Effect.flatMap(EmbeddingModel.EmbeddingModel, (embedding) =>
                                    embedding.embedMany(items),
                                ),
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
            run: (opts: Options) => Effect.Effect<A, AiError.AiError, R>,
        ) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const appSettings = yield* settingsFor(ctx.tenantId);
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
        return { embed, generateObject, generateText, settings };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
