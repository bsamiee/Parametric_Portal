import { type AiError as AiSdkError, Chat, EmbeddingModel, LanguageModel, Tokenizer, type Response, type Tool } from '@effect/ai';
import { Effect, ExecutionPlan, Layer, Match, Option, Stream } from 'effect';
import { AiRegistry } from './registry.ts';
import { AiError, AiRuntimeProvider } from './runtime-provider.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const AI_OPERATIONS = {
    chat:           { id: 'ai.chat', rail: 'language' },
    compactChat:    { id: 'ai.chat.compact', rail: 'language' },
    countTokens:    { id: 'ai.tokens.count', rail: 'language' },
    embed:          { id: 'ai.embed', rail: 'embedding' },
    embedMany:      { id: 'ai.embedMany', rail: 'embedding' },
    generateObject: { id: 'ai.generateObject', rail: 'language' },
    generateText:   { id: 'ai.generateText', rail: 'language' },
    streamText:     { id: 'ai.streamText', rail: 'language' },
} as const;
type OperationDescriptor = (typeof AI_OPERATIONS)[keyof typeof AI_OPERATIONS];
type OperationContext = { readonly appSettings: AiRegistry.Settings; readonly credentials: AiRegistry.Credentials; readonly tenantId: string };

// --- [FUNCTIONS] -------------------------------------------------------------

const _capMaxTokens = (settings: AiRegistry.Settings): AiRegistry.Settings => ({
    ...settings,
    language: {
        ...settings.language,
        maxTokens: Math.min(settings.language.maxTokens, settings.policy.maxTokensPerRequest),
    },
});
const _languageMeta = (descriptor: OperationDescriptor, context: OperationContext) => ({
    annotation: {
        operation: { name: descriptor.id },
        request:   {
            maxTokens:   context.appSettings.language.maxTokens,
            model:       context.appSettings.language.primary.model,
            temperature: context.appSettings.language.temperature,
            topK:        context.appSettings.language.topK,
            topP:        context.appSettings.language.topP,
        },
        system: context.appSettings.language.primary.provider,
    },
    labels: {
        model:     context.appSettings.language.primary.model,
        operation: descriptor.id,
        provider:  context.appSettings.language.primary.provider,
        tenant:    context.tenantId,
    },
});
const _embeddingMeta = (descriptor: OperationDescriptor, context: OperationContext) => ({
    annotation: {
        operation: { name: descriptor.id },
        request:   {
            dimensions: context.appSettings.embedding.primary.dimensions,
            model:      context.appSettings.embedding.primary.model,
        },
        system: context.appSettings.embedding.primary.provider,
    },
    labels: {
        dimensions: String(context.appSettings.embedding.primary.dimensions),
        model:      context.appSettings.embedding.primary.model,
        operation:  descriptor.id,
        provider:   context.appSettings.embedding.primary.provider,
        tenant:     context.tenantId,
    },
});

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
        const incrementBudget = (tenantId: string, totalTokens: number, rateDelta = 1) =>
            provider.readBudget(tenantId).pipe(
                Effect.flatMap((current) =>
                    provider.writeBudget(tenantId, {
                        dailyTokens: current.dailyTokens + totalTokens,
                        rateCount:   current.rateCount + rateDelta,
                    })),
            );
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
                            (budget) => budget.dailyTokens < appSettings.policy.maxTokensPerDay && budget.rateCount < appSettings.policy.maxRequestsPerMinute,
                            (budget) => new AiError({
                                cause:     { dailyTokens: budget.dailyTokens, limits: { daily: appSettings.policy.maxTokensPerDay, rate: appSettings.policy.maxRequestsPerMinute }, rateCount: budget.rateCount, tenantId },
                                operation: descriptor.id,
                                reason:    budget.dailyTokens >= appSettings.policy.maxTokensPerDay ? 'budget_exceeded' : 'rate_exceeded',
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
            onSuccess:  (value: A, meta: ReturnType<typeof _languageMeta> | ReturnType<typeof _embeddingMeta>) => Effect.Effect<void, unknown, never> = () => Effect.void,
        ) => {
            const meta = descriptor.rail === 'language' ? _languageMeta(descriptor, context) : _embeddingMeta(descriptor, context);
            return provider.trackEffect(descriptor.id, meta.labels, effect).pipe(
                Effect.tap((value) => onSuccess(value, meta)),
                Effect.tapError((error) => provider.observeError(descriptor.id, meta.labels, error)),
                Effect.ensuring(provider.annotate(meta.annotation)),
                Effect.ensuring(provider.observeRequest(descriptor.id, meta.labels)),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        };
        const applyToolPolicy = <Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>>(descriptor: OperationDescriptor, context: OperationContext, options: Options) => {
            const policy = context.appSettings.policy.tools;
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
            const constrainOneOf = (value: { readonly mode?: 'auto' | 'required'; readonly oneOf: readonly string[] }, allowedNames: readonly string[]) =>
                Match.value(value.oneOf.filter((name) => allowedNames.includes(name))).pipe(
                    Match.when((filtered) => filtered.length === 0 && value.mode === 'required', () => deny({ policy, reason: 'required_subset_empty', requestedTools: value.oneOf })),
                    Match.when((filtered) => filtered.length === 0, () => Effect.succeed('none' as const)),
                    Match.orElse((filtered) => Effect.succeed({ ...value, oneOf: filtered } satisfies LanguageModel.ToolChoice<string>)),
                );
            const constrainChoice = (allowedNames: readonly string[]) =>
                Match.value(toolChoice).pipe(
                    Match.when('required', () => allowedNames.length > 0 ? Effect.succeed(toolChoice) : deny({ policy, reason: 'required_without_allowed_tools' })),
                    Match.when((value): value is { readonly tool: string } => typeof value === 'object' && value !== null && 'tool' in value, (value) =>
                        allowedNames.includes(value.tool) ? Effect.succeed(toolChoice) : deny({ policy, reason: 'tool_not_allowed', requestedTool: value.tool })),
                    Match.when((value): value is { readonly mode?: 'auto' | 'required'; readonly oneOf: readonly string[] } => typeof value === 'object' && value !== null && 'oneOf' in value, (value) =>
                        constrainOneOf(value, allowedNames)),
                    Match.orElse((value) => Effect.succeed(value)),
                );
            const toolkit = options.toolkit;
            return toolkit === undefined
                ? constrainChoice([]).pipe(Effect.map((constrained) => ({ ...options, toolChoice: constrained } as Options)))
                : Effect.gen(function* () {
                    const resolvedToolkit = yield* (Effect.isEffect(toolkit) ? toolkit : Effect.succeed(toolkit));
                    const tools = resolvedToolkit.tools as Record<string, Tool.Any>;
                    const filtered = Object.fromEntries(Object.entries(tools).filter(([, tool]) => policy.mode === 'allow'
                        ? policy.names.length === 0 || policy.names.includes(tool.name)
                        : !policy.names.includes(tool.name))) as Record<string, Tool.Any>;
                    const constrained = yield* constrainChoice(Object.values(filtered).map((tool) => tool.name));
                    return { ...options, toolChoice: constrained, toolkit: { ...resolvedToolkit, tools: filtered as Tools } } as Options;
                });
        };
        const languagePlan = (context: OperationContext) => {
            const layers = AiRegistry.layers(context.appSettings, context.credentials);
            const [head, ...tail] = [layers.language, ...layers.fallbackLanguage] as const;
            return ExecutionPlan.make({ provide: head }, ...tail.map((layer) => ({ provide: layer })));
        };
        const runLanguage = <A extends { readonly usage: Response.Usage }, Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>, R>(
            descriptor: OperationDescriptor,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiSdkError.AiError, R>,
        ) => Effect.gen(function* () {
            const context = yield* resolveContext(descriptor);
            const policyOptions = yield* applyToolPolicy<Tools, Options>(descriptor, context, options);
            const withPlan = Effect.withExecutionPlan(run(policyOptions), languagePlan(context));
            const withPolicy = withPlan.pipe(
                Effect.tap((response) => incrementBudget(context.tenantId, response.usage.totalTokens ?? 0).pipe(Effect.ignore)),
                Effect.tap((response) => enforceRequestTokens(descriptor, context, 'usage.totalTokens', response.usage.totalTokens ?? 0)),
            );
            return yield* runEffectOperation(descriptor, context, withPolicy, (response, meta) =>
                Effect.all([provider.observeTokens(meta.labels, response.usage), provider.annotate({ ...meta.annotation, usage: response.usage })], { discard: true }));
        });
        const runLanguageStream = <Tools extends Record<string, Tool.Any> = Record<string, never>>(descriptor: OperationDescriptor, options: LanguageModel.GenerateTextOptions<Tools>) =>
            Stream.unwrap(
                Effect.gen(function* () {
                    const context = yield* resolveContext(descriptor);
                    const policyOptions = yield* applyToolPolicy<Tools, LanguageModel.GenerateTextOptions<Tools>>(descriptor, context, options);
                    const meta = _languageMeta(descriptor, context);
                    const withPlan = Stream.withExecutionPlan(LanguageModel.streamText(policyOptions), languagePlan(context));
                    const withFinish = Stream.mapEffect(withPlan, (part) =>
                        (part.type === 'finish' && 'usage' in part
                            ? incrementBudget(context.tenantId, part.usage.totalTokens ?? 0).pipe(
                                Effect.ignore,
                                Effect.zipRight(enforceRequestTokens(descriptor, context, 'usage.totalTokens', part.usage.totalTokens ?? 0)),
                                Effect.zipRight(Effect.all([provider.observeTokens(meta.labels, part.usage), provider.annotate({ ...meta.annotation, usage: part.usage })], { discard: true })),
                            )
                            : Effect.void).pipe(Effect.as(part)));
                    return provider.trackStream(
                        descriptor.id,
                        meta.labels,
                        Stream.onStart(
                            Stream.tapError(withFinish, (error) => provider.observeError(descriptor.id, meta.labels, error)),
                            Effect.all([provider.annotate(meta.annotation), provider.observeRequest(descriptor.id, meta.labels)], { discard: true }),
                        ),
                    );
                }).pipe(Effect.mapError(AiError.from(descriptor.id))),
            ).pipe(Stream.mapError(AiError.from(descriptor.id)));
        const runEmbedding = <A>(descriptor: OperationDescriptor, usage: AiRegistry.EmbeddingUsage, effect: (service: EmbeddingModel.Service) => Effect.Effect<A, AiSdkError.AiError>) =>
            Effect.gen(function* () {
                const context = yield* resolveContext(descriptor);
                const embeddingEffect = EmbeddingModel.EmbeddingModel.pipe(
                    Effect.flatMap(effect),
                    Effect.provide(AiRegistry.embeddingLayer(context.appSettings.embedding.primary, context.credentials, usage)),
                    Effect.tap(() => incrementBudget(context.tenantId, 0).pipe(Effect.ignore)),
                );
                return yield* runEffectOperation(descriptor, context, embeddingEffect, (value, meta) =>
                    provider.observeEmbedding(meta.labels, Array.isArray(value) && Array.isArray(value[0]) ? value.length : 1));
            });
        const settings = () =>
            provider.resolveTenantId.pipe(
                Effect.flatMap((tenantId) => provider.resolveSettings(tenantId)),
                Effect.map(_capMaxTokens),
            );
        const embeddingSettings = () => settings().pipe(Effect.map((value) => value.embedding.primary));
        const countTokens = Effect.fn('AiRuntime.countTokens')((input: string) =>
            resolveContext(AI_OPERATIONS.countTokens).pipe(
                Effect.flatMap((context) =>
                    Tokenizer.Tokenizer.pipe(
                        Effect.flatMap((tokenizer) => tokenizer.tokenize(input)),
                        Effect.map((tokens) => tokens.length),
                        Effect.provide(AiRegistry.languageLayer(context.appSettings.language, context.credentials)),
                        Effect.flatMap((count) => runEffectOperation(AI_OPERATIONS.countTokens, context, Effect.succeed(count))),
                    )),
            ),
        );
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
        const embed = (input: string, options?: { readonly usage?: AiRegistry.EmbeddingUsage }) =>
            runEmbedding(AI_OPERATIONS.embed, options?.usage ?? 'document', (service) => service.embed(input));
        const embedMany = (input: ReadonlyArray<string>, options?: { readonly concurrency?: number | undefined; readonly usage?: AiRegistry.EmbeddingUsage }) =>
            runEmbedding(AI_OPERATIONS.embedMany, options?.usage ?? 'document', (service) => service.embedMany(input, { concurrency: options?.concurrency }));
        const runtimeLanguageLayer = Layer.succeed(LanguageModel.LanguageModel, { generateObject, generateText, streamText } as LanguageModel.Service);
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(
                    AI_OPERATIONS.chat,
                    context,
                    Match.value(options?.prompt).pipe(Match.when(Match.undefined, () => Chat.empty), Match.orElse((prompt) => Chat.fromPrompt(prompt))).pipe(Effect.provide(runtimeLanguageLayer)),
                )),
            );
        const deserializeChat = (chatJson: string) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(
                    AI_OPERATIONS.chat,
                    context,
                    Match.value(chatJson.trim()).pipe(Match.when('', () => Chat.empty), Match.orElse((json) => Chat.fromJson(json))).pipe(Effect.provide(runtimeLanguageLayer)),
                )),
            );
        const serializeChat = (chatService: Chat.Service) =>
            resolveContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(AI_OPERATIONS.chat, context, chatService.exportJson)),
            );
        const compactChat = Effect.fn('AiRuntime.compactChat')((
            currentChat: Chat.Service,
            options: {
                readonly buildPrompt: (context: { readonly before: number; readonly serialized: string }) => string;
                readonly target: number;
                readonly trigger: number;
            },
        ) =>
            Effect.gen(function* () {
                const serialized = yield* serializeChat(currentChat).pipe(Effect.catchAll(() => Effect.succeed('')));
                const before = yield* countTokens(serialized).pipe(Effect.option);
                return yield* Option.match(before, {
                    onNone: () => Effect.succeed(Option.none<{ readonly after: number; readonly before: number; readonly compacted: Chat.Service }>()),
                    onSome: (beforeCount) =>
                        beforeCount < options.trigger
                            ? Effect.succeed(Option.none())
                            : Effect.gen(function* () {
                                const compacted = yield* chat({ prompt: options.buildPrompt({ before: beforeCount, serialized }) });
                                const json = yield* serializeChat(compacted).pipe(Effect.catchAll(() => Effect.succeed('')));
                                const after = yield* countTokens(json).pipe(Effect.option);
                                return Option.flatMap(after, (a) => a <= options.target ? Option.some({ after: a, before: beforeCount, compacted }) : Option.none());
                            }),
                });
            }),
        );
        return { chat, compactChat, countTokens, deserializeChat, embed, embeddingSettings, embedMany, generateObject, generateText, serializeChat, settings, streamText };
    }),
}) {
    static readonly Live = AiRuntime.Default.pipe(Layer.provideMerge(AiRuntimeProvider.Default));
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
