import {AiError as AiSdkError, Chat, EmbeddingModel, LanguageModel, type Response, type Tool } from '@effect/ai';
import { Effect, Match, Option, Stream } from 'effect';
import { AiError } from './errors.ts';
import { AiRegistry } from './registry.ts';
import { AiRuntimeProvider } from './runtime-provider.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _OPS = {
    chat:           'ai.chat',
    embed:          'ai.embed',
    generateObject: 'ai.generateObject',
    generateText:   'ai.generateText',
    streamText:     'ai.streamText',
} as const;
const _TEL = { chat: 'chat', embeddings: 'embeddings' } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _chatAnnotation = (appSettings: AiRuntimeProvider.Settings) => ({
    operation: { name: _TEL.chat },
    request: {
        maxTokens:   appSettings.language.maxTokens,
        model:       appSettings.language.model,
        temperature: appSettings.language.temperature,
        topK:        appSettings.language.topK,
        topP:        appSettings.language.topP,
    },
    system: appSettings.language.provider,
}) as const;

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const provider = yield* AiRuntimeProvider;
        const checkBudget = (operation: string, tenantId: string, policy: AiRuntimeProvider.Settings['policy']) =>
            provider.budget.read(tenantId).pipe(
                Effect.filterOrFail(
                    ({ dailyTokens }) => dailyTokens < policy.maxTokensPerDay,
                    ({ dailyTokens }) => new AiError({ cause: { dailyTokens, limit: policy.maxTokensPerDay, tenantId }, operation, reason: 'budget_exceeded' }),
                ),
                Effect.filterOrFail(
                    ({ rateCount }) => rateCount < policy.maxRequestsPerMinute,
                    ({ rateCount }) => new AiError({ cause: { limit: policy.maxRequestsPerMinute, rateCount, tenantId }, operation, reason: 'rate_exceeded' }),
                ),
                Effect.asVoid,
                Effect.tapError(() => provider.observe.onPolicyDenied(operation, tenantId)),
            );
        const incrementBudget = (tenantId: string, totalTokens: number) =>
            provider.budget.read(tenantId).pipe(
                Effect.flatMap((current) =>
                    provider.budget.write(tenantId, { dailyTokens: current.dailyTokens + totalTokens, rateCount: current.rateCount + 1 }),
                ),
            );
        const resolveContext = (operation: string) =>
            provider.resolve.tenantId.pipe(
                Effect.bindTo('tenantId'),
                Effect.bind('appSettings', ({ tenantId }) => provider.resolve.settings(tenantId)),
                Effect.tap(({ tenantId, appSettings }) => checkBudget(operation, tenantId, appSettings.policy)),
                Effect.mapError(AiError.from(operation)),
            );
        const settings = () => provider.resolve.tenantId.pipe(Effect.flatMap(provider.resolve.settings));
        function embed(input: string): Effect.Effect<readonly number[], AiSdkError.AiError | AiError, never>;
        function embed(input: readonly string[]): Effect.Effect<readonly (readonly number[])[], AiSdkError.AiError | AiError, never>;
        function embed(input: string | readonly string[]): Effect.Effect<readonly number[] | readonly (readonly number[])[], unknown, unknown> {
            return resolveContext(_OPS.embed).pipe(
                Effect.flatMap(({ tenantId, appSettings }) => {
                    const labels = { dimensions: String(appSettings.embedding.dimensions), model: appSettings.embedding.model, operation: _OPS.embed, provider: appSettings.embedding.provider, tenant: tenantId };
                    const layers = AiRegistry.layers(appSettings);
                    const { count, estimatedTokens } = Match.value(input).pipe(
                        Match.when(Match.string, (value) => ({ count: 1, estimatedTokens: Math.ceil(value.length / 4) })),
                        Match.orElse((values) => ({ count: values.length, estimatedTokens: Math.ceil(values.join('').length / 4) })),
                    );
                    return provider.track.effect(
                        _OPS.embed, labels,
                        EmbeddingModel.EmbeddingModel.pipe(
                            Effect.flatMap((model) =>
                                Match.value(input).pipe(
                                    Match.when(Match.string, (value) => model.embed(value)),
                                    Match.orElse((values) => model.embedMany(values)),
                                ),
                            ),
                            Effect.provide(layers.embedding),
                        ),
                    ).pipe(
                        Effect.tap(() => provider.observe.onEmbedding(labels, count)),
                        Effect.tap(() => incrementBudget(tenantId, estimatedTokens)),
                        Effect.tapError((error) => provider.observe.onError(_OPS.embed, labels, error)),
                        Effect.ensuring(provider.observe.annotate({ operation: { name: _TEL.embeddings }, request: { model: appSettings.embedding.model }, system: appSettings.embedding.provider })),
                        Effect.ensuring(provider.observe.onRequest(_OPS.embed, labels)),
                        Effect.mapError(AiError.from(_OPS.embed)),
                    );
                }),
            );
        }
        const runLanguage = <A extends { readonly usage: Response.Usage }, Options, R>(
            operation: string, options: Options,
            run: (opts: Options) => Effect.Effect<A, AiSdkError.AiError, R>,
        ) =>
            resolveContext(operation).pipe(
                Effect.flatMap(({ tenantId, appSettings }) => {
                    const labels = { model: appSettings.language.model, operation, provider: appSettings.language.provider, tenant: tenantId };
                    const layers = AiRegistry.layers(appSettings);
                    return layers.fallbackLanguage.reduce<Effect.Effect<A, unknown, unknown>>(
                        (accumulated, fallbackLayer, index) => {
                            const fallbackProvider = appSettings.language.fallback[index] ?? appSettings.language.provider;
                            return accumulated.pipe(
                                Effect.catchIf(AiSdkError.isAiError, () =>
                                    provider.track.effect(
                                        operation,
                                        { ...labels, provider: fallbackProvider },
                                        run(options).pipe(Effect.provide(fallbackLayer)),
                                    ).pipe(Effect.tap(() => provider.observe.onFallback(operation, fallbackProvider, tenantId))),
                                ),
                            );
                        },
                        provider.track.effect(operation, labels, run(options).pipe(Effect.provide(layers.language))),
                    ).pipe(
                        Effect.tap((response) => provider.observe.onTokens(labels, response.usage)),
                        Effect.tap((response) => provider.observe.annotate({ ..._chatAnnotation(appSettings), usage: response.usage })),
                        Effect.tap((response) => incrementBudget(tenantId, response.usage.totalTokens ?? 0)),
                        Effect.tapError((error) => provider.observe.onError(operation, labels, error)),
                        Effect.ensuring(provider.observe.annotate(_chatAnnotation(appSettings))),
                        Effect.ensuring(provider.observe.onRequest(operation, labels)),
                        Effect.mapError(AiError.from(operation)),
                    );
                }),
            );
        const generateText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            runLanguage(_OPS.generateText, options, LanguageModel.generateText);
        const generateObject = <A, I extends Record<string, unknown>, R, Tools extends Record<string, Tool.Any> = Record<string, never>>(
            options: LanguageModel.GenerateObjectOptions<Tools, A, I, R>,
        ) => runLanguage(_OPS.generateObject, options, LanguageModel.generateObject);
        const streamText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            Stream.unwrap(
                resolveContext(_OPS.streamText).pipe(
                    Effect.map(({ tenantId, appSettings }) => {
                        const labels = { model: appSettings.language.model, operation: _OPS.streamText, provider: appSettings.language.provider, tenant: tenantId };
                        const layers = AiRegistry.layers(appSettings);
                        const annotation = _chatAnnotation(appSettings);
                        const onFinish = (part: Response.StreamPart<Tools>) =>
                            part.type === 'finish'
                                ? Effect.all([
                                    provider.observe.onTokens(labels, part.usage),
                                    provider.observe.annotate({ ...annotation, usage: part.usage }),
                                    incrementBudget(tenantId, part.usage.totalTokens ?? 0),
                                ], { discard: true })
                                : Effect.void;
                        const base = LanguageModel.streamText(options).pipe(Stream.provideLayer(layers.language));
                        return provider.track.stream(
                            _OPS.streamText, labels,
                            Stream.tapError(
                                Stream.mapEffect(
                                    Stream.onStart(base, Effect.all([provider.observe.annotate(annotation), provider.observe.onRequest(_OPS.streamText, labels)], { discard: true })),
                                    (part) => onFinish(part).pipe(Effect.as(part)),
                                ),
                                (error) => provider.observe.onError(_OPS.streamText, labels, error),
                            ),
                        );
                    }),
                    Effect.mapError(AiError.from(_OPS.streamText)),
                ),
            ).pipe(Stream.mapError(AiError.from(_OPS.streamText)));
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            resolveContext(_OPS.chat).pipe(
                Effect.flatMap(({ tenantId, appSettings }) => {
                    const labels = { model: appSettings.language.model, operation: _OPS.chat, provider: appSettings.language.provider, tenant: tenantId };
                    const chatProgram = Option.fromNullable(options?.prompt).pipe(Option.match({ onNone: () => Chat.empty, onSome: Chat.fromPrompt }),);
                    return provider.track.effect(_OPS.chat, labels, chatProgram.pipe(Effect.provide(AiRegistry.layers(appSettings).language))).pipe(
                        Effect.tapError((error) => provider.observe.onError(_OPS.chat, labels, error)),
                        Effect.ensuring(provider.observe.annotate({ operation: { name: _TEL.chat }, request: { model: appSettings.language.model }, system: appSettings.language.provider })),
                        Effect.ensuring(provider.observe.onRequest(_OPS.chat, labels)),
                        Effect.mapError(AiError.from(_OPS.chat)),
                    );
                }),
            );
        return { chat, embed, generateObject, generateText, settings, streamText };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
