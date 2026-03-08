import { AiError as AiSdkError, Chat, EmbeddingModel, LanguageModel, Tokenizer, type Response, type Tool } from '@effect/ai';
import { Array as A, Effect, Layer, Match, Stream } from 'effect';
import { AiRegistry } from './registry.ts';
import { AiError, AiRuntimeProvider } from './runtime-provider.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const AI_OPERATIONS = {
    chat:           { id: 'ai.chat',           kind: 'language'  },
    embed:          { id: 'ai.embed',          kind: 'embedding' },
    generateObject: { id: 'ai.generateObject', kind: 'language'  },
    generateText:   { id: 'ai.generateText',   kind: 'language'  },
    streamText:     { id: 'ai.streamText',     kind: 'language'  },
} as const;
type OperationDescriptor = (typeof AI_OPERATIONS)[keyof typeof AI_OPERATIONS];
type OperationContext = { readonly appSettings: AiRegistry.Settings; readonly credentials: AiRegistry.Credentials; readonly tenantId: string };

// --- [FUNCTIONS] -------------------------------------------------------------

const _capMaxTokens =  (s: AiRegistry.Settings): AiRegistry.Settings => ({ ...s, language: { ...s.language, maxTokens: Math.min(s.language.maxTokens, s.policy.maxTokensPerRequest) } });
const _operationMeta = (descriptor: OperationDescriptor, context: OperationContext) =>
    Match.value(descriptor.kind).pipe(
        Match.when('embedding', () => ({
            annotation: { operation: { name: 'embeddings' as const }, request: { model: context.appSettings.embedding.model }, system: context.appSettings.embedding.provider },
            labels:     {
                dimensions: String(context.appSettings.embedding.dimensions),
                model:      context.appSettings.embedding.model,
                operation:  descriptor.id,
                provider:   context.appSettings.embedding.provider,
                tenant:     context.tenantId
            },
        })),
        Match.when('language', () => ({
            annotation: {
                operation: { name: 'chat' as const },
                request:   {
                    maxTokens:   context.appSettings.language.maxTokens,
                    model:       context.appSettings.language.model,
                    temperature: context.appSettings.language.temperature,
                    topK:        context.appSettings.language.topK,
                    topP:        context.appSettings.language.topP
                },
                system:    context.appSettings.language.provider },
            labels:        { model: context.appSettings.language.model, operation: descriptor.id, provider: context.appSettings.language.provider, tenant: context.tenantId },
        })),
        Match.exhaustive,
    );

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const provider = yield* AiRuntimeProvider;
        const enforceRequestTokens = (descriptor: OperationDescriptor, context: OperationContext, source: string, totalTokens: number) =>
            Effect.filterOrFail(
                Effect.succeed(totalTokens),
                (tokens) => tokens <= context.appSettings.policy.maxTokensPerRequest,
                () => new AiError({ cause: { limit: context.appSettings.policy.maxTokensPerRequest, source, tokens: totalTokens }, operation: descriptor.id, reason: 'request_tokens_exceeded' }),
            ).pipe(
                Effect.tapError(() => provider.observePolicyDenied(descriptor.id, context.tenantId)),
                Effect.asVoid,
            );
        const incrementBudget = (tenantId: string, totalTokens: number) =>
            provider.readBudget(tenantId).pipe(
                Effect.flatMap((current) =>
                    provider.writeBudget(tenantId, { dailyTokens: current.dailyTokens + totalTokens, rateCount: current.rateCount + 1 }),
                ),
            );
        const resolveLayers = (appSettings: AiRegistry.Settings) =>
            Effect.forEach(AiRegistry.requiredProviders(appSettings), (name) =>
                provider.resolveCredential(name).pipe(Effect.map((credential) => [name, credential] as const)),
            ).pipe(Effect.map((entries) => AiRegistry.layers(appSettings, Object.fromEntries(entries) as AiRegistry.Credentials)));
        const resolveContext = (descriptor: OperationDescriptor) =>
            provider.resolveTenantId.pipe(
                Effect.bindTo('tenantId'),
                Effect.bind('appSettings', ({ tenantId }) => provider.resolveSettings(tenantId).pipe(Effect.map(_capMaxTokens))),
                Effect.bind('credentials', ({ appSettings }) =>
                    Effect.forEach(AiRegistry.requiredProviders(appSettings), (name) =>
                        provider.resolveCredential(name).pipe(Effect.map((credential) => [name, credential] as const)),
                    ).pipe(Effect.map((entries) => Object.fromEntries(entries) as AiRegistry.Credentials))),
                Effect.tap(({ tenantId, appSettings }) =>
                    provider.readBudget(tenantId).pipe(
                        Effect.filterOrFail(
                            (b) => b.dailyTokens < appSettings.policy.maxTokensPerDay && b.rateCount < appSettings.policy.maxRequestsPerMinute,
                            (b) => new AiError({
                                cause:     { dailyTokens: b.dailyTokens, limits: { daily: appSettings.policy.maxTokensPerDay, rate: appSettings.policy.maxRequestsPerMinute }, rateCount: b.rateCount, tenantId },
                                operation: descriptor.id,
                                reason:    b.dailyTokens >= appSettings.policy.maxTokensPerDay ? 'budget_exceeded' : 'rate_exceeded',
                            }),
                        ),
                        Effect.asVoid,
                        Effect.tapError(() => provider.observePolicyDenied(descriptor.id, tenantId)),
                    ),
                ),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        const runEffectOperation = <A, E, R>(
            descriptor: OperationDescriptor,
            context:    OperationContext,
            effect:     Effect.Effect<A, E, R>,
            onSuccess:  (value: A, meta: ReturnType<typeof _operationMeta>) => Effect.Effect<void, unknown, never> = () => Effect.void,
        ) => {
            const meta = _operationMeta(descriptor, context);
            return provider.trackEffect(descriptor.id, meta.labels, effect).pipe(
                Effect.tap((value) => onSuccess(value, meta)),
                Effect.tapError((error) => provider.observeError(descriptor.id, meta.labels, error)),
                Effect.ensuring(provider.annotate(meta.annotation)),
                Effect.ensuring(provider.observeRequest(descriptor.id, meta.labels)),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        };
        const applyToolPolicy = <Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>>(descriptor: OperationDescriptor, context: OperationContext, options: Options) => {
            const policy = {
                ...context.appSettings.policy.tools,
                names: context.appSettings.policy.tools.names.filter((name) => name !== AiRegistry.toolSearchFlag),
            };
            const toolChoice = options.toolChoice as LanguageModel.ToolChoice<string> | undefined;
            const deny = (meta: {
                readonly policy: typeof policy;
                readonly reason: 'required_without_allowed_tools' | 'tool_not_allowed' | 'required_subset_empty';
                readonly requestedTool?: string;
                readonly requestedTools?: readonly string[];
            }) =>
                provider.observePolicyDenied(descriptor.id, context.tenantId).pipe(
                    Effect.zipRight(Effect.fail(new AiError({ cause: { ...meta, tenantId: context.tenantId }, operation: descriptor.id, reason: 'policy_denied' }))),
                );
            const constrainOneOf = (v: { readonly mode?: 'auto' | 'required'; readonly oneOf: readonly string[] }, allowedNames: readonly string[]): Effect.Effect<LanguageModel.ToolChoice<string> | undefined, AiError, never> =>
                Match.value(v.oneOf.filter((n) => allowedNames.includes(n))).pipe(
                    Match.when((f) => f.length === 0 && v.mode === 'required', () => deny({ policy, reason: 'required_subset_empty', requestedTools: v.oneOf })),
                    Match.when((f) => f.length === 0, () => Effect.succeed('none' as const)),
                    Match.orElse((f) => Effect.succeed({ ...v, oneOf: f } satisfies LanguageModel.ToolChoice<string>)),
                );
            const constrainChoice = (allowedNames: readonly string[]): Effect.Effect<LanguageModel.ToolChoice<string> | undefined, AiError, never> =>
                Match.value(toolChoice).pipe(
                    Match.when('required', () => allowedNames.length > 0 ? Effect.succeed(toolChoice) : deny({ policy, reason: 'required_without_allowed_tools' })),
                    Match.when((v): v is { readonly tool: string } => typeof v === 'object' && v !== null && 'tool' in v, (v) =>
                        allowedNames.includes(v.tool) ? Effect.succeed(toolChoice) : deny({ policy, reason: 'tool_not_allowed', requestedTool: v.tool })),
                    Match.when((v): v is { readonly mode?: 'auto' | 'required'; readonly oneOf: readonly string[] } => typeof v === 'object' && v !== null && 'oneOf' in v, (v) => constrainOneOf(v, allowedNames)),
                    Match.orElse((v) => Effect.succeed(v)),
                );
            const toolkit = options.toolkit;
            return toolkit === undefined
                ? constrainChoice([]).pipe(Effect.map((constrained) => ({ ...options, toolChoice: constrained } as Options)))
                : Effect.gen(function* () {
                    const t = yield* (Effect.isEffect(toolkit) ? toolkit : Effect.succeed(toolkit));
                    const allowed = (tool: Tool.Any) => policy.mode === 'allow' ? !policy.names.length || policy.names.includes(tool.name) : !policy.names.includes(tool.name);
                    const tools = t.tools as Record<string, Tool.Any>;
                    const filtered = Object.fromEntries(Object.entries(tools).filter(([, tool]) => allowed(tool))) as Record<string, Tool.Any>;
                    const constrained = yield* constrainChoice(Object.values(filtered).map((tool) => tool.name));
                    return { ...options, toolChoice: constrained, toolkit: { ...t, tools: filtered as Tools } } as Options;
                });
        };
        const runLanguage = <A extends { readonly usage: Response.Usage }, Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>, R>(
            descriptor: OperationDescriptor,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiSdkError.AiError, R>,
        ) => Effect.gen(function* () {
            const context = yield* resolveContext(descriptor);
            const policyOptions = yield* applyToolPolicy<Tools, Options>(descriptor, context, options);
            const layers = AiRegistry.layers(context.appSettings, context.credentials);
            const fallbackLayers = layers.fallbackLanguage.map((layer, index) => ({ layer, providerName: context.appSettings.language.fallback[index] ?? context.appSettings.language.provider }));
            const runWithLayer = (layer: typeof layers.language) => run(policyOptions).pipe(Effect.provide(layer));
            const primary = runWithLayer(layers.language);
            const withFallback = Effect.catchIf(primary, AiSdkError.isAiError, (sdkError) =>
                A.reduce(fallbackLayers, Effect.fail(sdkError) as typeof primary, (acc, fb) =>
                    Effect.catchAll(acc, () =>
                        runWithLayer(fb.layer).pipe(Effect.tap(() => provider.observeFallback(descriptor.id, fb.providerName, context.tenantId))))));
            const withPolicy = withFallback.pipe(
                Effect.tap((response) => incrementBudget(context.tenantId, response.usage.totalTokens ?? 0).pipe(Effect.ignore)),
                Effect.tap((response) => enforceRequestTokens(descriptor, context, 'usage.totalTokens', response.usage.totalTokens ?? 0)),
            );
            return yield* runEffectOperation(descriptor, context, withPolicy, (response, meta) =>
                Effect.all([provider.observeTokens(meta.labels, response.usage), provider.annotate({ ...meta.annotation, usage: response.usage })], { discard: true }));
        });
        const runLanguageStream = <Tools extends Record<string, Tool.Any> = Record<string, never>>(
            descriptor: OperationDescriptor,
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) => {
            const buildStream = Effect.gen(function* () {
                const context = yield* resolveContext(descriptor);
                const policyOptions = yield* applyToolPolicy<Tools, LanguageModel.GenerateTextOptions<Tools>>(descriptor, context, options);
                const meta = _operationMeta(descriptor, context);
                const layers = AiRegistry.layers(context.appSettings, context.credentials);
                const handleFinish = (finish: { readonly usage: Response.Usage }) =>
                    incrementBudget(context.tenantId, finish.usage.totalTokens ?? 0).pipe(
                        Effect.ignore,
                        Effect.zipRight(enforceRequestTokens(descriptor, context, 'usage.totalTokens', finish.usage.totalTokens ?? 0)),
                        Effect.zipRight(Effect.all([provider.observeTokens(meta.labels, finish.usage), provider.annotate({ ...meta.annotation, usage: finish.usage })], { discard: true })));
                const onFinish = (part: Response.StreamPart<Tools>) => part.type === 'finish' && 'usage' in part ? handleFinish(part) : Effect.void;
                const streamForLayer = (layer: (typeof layers)['language'] | (typeof layers)['fallbackLanguage'][number]): Stream.Stream<Response.StreamPart<Tools>, unknown, unknown> =>
                    LanguageModel.streamText(policyOptions).pipe(Stream.provideLayer(layer)) as Stream.Stream<Response.StreamPart<Tools>, unknown, unknown>;
                const fallbackLayers = layers.fallbackLanguage.map((layer, index) => ({ layer, providerName: context.appSettings.language.fallback[index] ?? context.appSettings.language.provider }));
                const primary = streamForLayer(layers.language);
                const withFallback = Stream.catchAll(primary, (error) =>
                    AiSdkError.isAiError(error)
                        ? A.reduce(fallbackLayers, Stream.fail(error) as typeof primary, (acc, fb) =>
                            Stream.catchAll(acc, () => Stream.onStart(streamForLayer(fb.layer), provider.observeFallback(descriptor.id, fb.providerName, context.tenantId))))
                        : Stream.fail(error));
                const started = Stream.onStart(withFallback, Effect.all([provider.annotate(meta.annotation), provider.observeRequest(descriptor.id, meta.labels)], { discard: true }));
                const withFinish = Stream.mapEffect(started, (part) => onFinish(part).pipe(Effect.as(part)));
                return provider.trackStream(descriptor.id, meta.labels, Stream.tapError(withFinish, (error) => provider.observeError(descriptor.id, meta.labels, error)));
            }).pipe(Effect.mapError(AiError.from(descriptor.id)));
            return Stream.unwrap(buildStream).pipe(Stream.mapError(AiError.from(descriptor.id)));
        };
        const settings = () =>
            provider.resolveTenantId.pipe(
                Effect.flatMap((tenantId) => provider.resolveSettings(tenantId)),
                Effect.map(_capMaxTokens),
            );
        const countTokens = Effect.fn('AiRuntime.countTokens')((input: string) =>
            provider.resolveTenantId.pipe(
                Effect.flatMap((tenantId) => provider.resolveSettings(tenantId).pipe(Effect.map(_capMaxTokens))),
                Effect.mapError(AiError.from(AI_OPERATIONS.chat.id)),
                Effect.flatMap((appSettings) =>
                    resolveLayers(appSettings).pipe(Effect.flatMap((layers) =>
                        Tokenizer.Tokenizer.pipe(
                            Effect.flatMap((tokenizer) => tokenizer.tokenize(input)),
                            Effect.map((tokens) => tokens.length),
                            Effect.provide(layers.language),
                        ))),
                ),
            ),
        );
        function embed(input: string): Effect.Effect<readonly number[], AiSdkError.AiError | AiError, never>;
        function embed(input: readonly string[]): Effect.Effect<readonly (readonly number[])[], AiSdkError.AiError | AiError, never>;
        function embed(input: string | readonly string[]): Effect.Effect<readonly number[] | readonly (readonly number[])[], unknown, unknown> {
            const resolved: {
                readonly count: number;
                readonly estimatedTokens: number;
                readonly run: (model: EmbeddingModel.Service) => Effect.Effect<readonly number[] | readonly (readonly number[])[], AiSdkError.AiError>;
            } = Match.value(input).pipe(
                Match.when(Match.string, (s) => ({ count: 1, estimatedTokens: Math.ceil(s.length / 4), run: (m: EmbeddingModel.Service) => m.embed(s) })),
                Match.orElse((arr) => ({ count: arr.length, estimatedTokens: Math.ceil(arr.join('').length / 4), run: (m: EmbeddingModel.Service) => m.embedMany(arr) })),
            );
            return resolveContext(AI_OPERATIONS.embed).pipe(
                Effect.flatMap((context) => {
                    const layers = AiRegistry.layers(context.appSettings, context.credentials);
                    const embedOp = EmbeddingModel.EmbeddingModel.pipe(Effect.flatMap(resolved.run), Effect.provide(layers.embedding));
                    return enforceRequestTokens(AI_OPERATIONS.embed, context, 'embedding.estimatedTokens', resolved.estimatedTokens).pipe(
                        Effect.zipRight(runEffectOperation(AI_OPERATIONS.embed, context, embedOp, (_result, meta) =>
                            Effect.all([provider.observeEmbedding(meta.labels, resolved.count), incrementBudget(context.tenantId, resolved.estimatedTokens)], { discard: true }))),
                    );
                }),
            );
        }
        const generateText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            runLanguage<LanguageModel.GenerateTextResponse<Tools>, Tools, LanguageModel.GenerateTextOptions<Tools>, unknown>(
                AI_OPERATIONS.generateText,
                options,
                LanguageModel.generateText,
            );
        const generateObject = <A, I extends Record<string, unknown>, R, Tools extends Record<string, Tool.Any> = Record<string, never>>(
            options: LanguageModel.GenerateObjectOptions<Tools, A, I, R>,
        ) => runLanguage<LanguageModel.GenerateObjectResponse<Tools, A>, Tools, LanguageModel.GenerateObjectOptions<Tools, A, I, R>, unknown>(
            AI_OPERATIONS.generateObject,
            options,
            LanguageModel.generateObject,
        );
        const streamText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            runLanguageStream(AI_OPERATIONS.streamText, options);
        const runtimeLanguageLayer = Layer.succeed(LanguageModel.LanguageModel, { generateObject, generateText, streamText } as LanguageModel.Service);
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => {
                    const chatEffect = Match.value(options?.prompt).pipe(
                        Match.when(Match.undefined, () => Chat.empty),
                        Match.orElse((prompt) => Chat.fromPrompt(prompt)),
                    );
                    return runEffectOperation(AI_OPERATIONS.chat, context, chatEffect.pipe(Effect.provide(runtimeLanguageLayer)));
                }),
            );
        const deserializeChat = (chatJson: string) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(AI_OPERATIONS.chat, context,
                    Match.value(chatJson.trim()).pipe(
                        Match.when('', () => Chat.empty),
                        Match.orElse((json) => Chat.fromJson(json)),
                    ).pipe(Effect.provide(runtimeLanguageLayer)),
                )),
            );
        const serializeChat = (chatService: Chat.Service) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(AI_OPERATIONS.chat, context, chatService.exportJson)),
            );
        return { chat, countTokens, deserializeChat, embed, generateObject, generateText, serializeChat, settings, streamText };
    }),
}) {
    static readonly Live = Layer.provide(AiRuntime.Default, AiRuntimeProvider.Server);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
