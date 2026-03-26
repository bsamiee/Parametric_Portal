import { type AiError as AiSdkError, Chat, LanguageModel, type Response, type Tool } from '@effect/ai';
import { Effect, Layer, Match, Option, Stream } from 'effect';
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
    maxOutputTokens: Math.min(settings.maxOutputTokens ?? settings.policy.maxTokensPerRequest, settings.policy.maxTokensPerRequest),
});
const _languageMeta = (descriptor: OperationDescriptor, context: OperationContext) => ({
    annotation: {
        operation: { name: descriptor.id },
        request:   {
            maxTokens:   context.appSettings.maxOutputTokens,
            model:       context.appSettings.model,
            temperature: context.appSettings.temperature,
            topP:        context.appSettings.topP,
        },
        system: context.appSettings.provider,
    },
    labels: {
        model:     context.appSettings.model,
        operation: descriptor.id,
        provider:  context.appSettings.provider,
        tenant:    context.tenantId,
    },
});
const _embeddingMeta = (descriptor: OperationDescriptor, context: OperationContext) => ({
    annotation: {
        operation: { name: descriptor.id },
        request:   {
            dimensions: context.appSettings.embedding.dimensions,
            model:      context.appSettings.embedding.model,
        },
        system: context.appSettings.embedding.provider,
    },
    labels: {
        dimensions: String(context.appSettings.embedding.dimensions),
        model:      context.appSettings.embedding.model,
        operation:  descriptor.id,
        provider:   context.appSettings.embedding.provider,
        tenant:     context.tenantId,
    },
});

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const provider = yield* AiRuntimeProvider;
        const _usageTokens = (usage: {
            readonly inputTokens?: number | undefined;
            readonly totalTokens?: number | undefined;
        }) => usage.totalTokens ?? usage.inputTokens ?? 0;
        const enforceRequestTokens = (descriptor: OperationDescriptor, context: OperationContext, source: string, totalTokens: number) =>
            Effect.filterOrFail(
                Effect.succeed(totalTokens),
                (tokens) => tokens <= context.appSettings.policy.maxTokensPerRequest,
                () => new AiError({ cause: { limit: context.appSettings.policy.maxTokensPerRequest, source, tokens: totalTokens }, operation: descriptor.id, reason: 'request_tokens_exceeded' }),
            ).pipe(
                Effect.tapError(() => provider.observePolicyDenied(descriptor.id, context.tenantId)),
                Effect.asVoid,
            );
        const resolveContext = (descriptor: OperationDescriptor) =>
            provider.resolveTenantId.pipe(
                Effect.bindTo('tenantId'),
                Effect.bind('appSettings', ({ tenantId }) => provider.resolveSettings(tenantId).pipe(Effect.map(_capMaxTokens))),
                Effect.bind('credentials', ({ appSettings, tenantId }) => provider.resolveCredential(appSettings.provider, tenantId).pipe(
                    Effect.map((credential) => ({ [appSettings.provider]: credential } as AiRegistry.Credentials)),
                )),
                Effect.tap(({ tenantId, appSettings }) =>
                    provider.readUsage(tenantId).pipe(
                        Effect.filterOrFail(
                            (usage) => usage.dailyTokens < appSettings.policy.maxTokensPerDay && usage.minuteRequests < appSettings.policy.maxRequestsPerMinute,
                            (usage) => new AiError({
                                cause: {
                                    dailyTokens: usage.dailyTokens,
                                    limits: { daily: appSettings.policy.maxTokensPerDay, rate: appSettings.policy.maxRequestsPerMinute },
                                    minuteRequests: usage.minuteRequests,
                                    tenantId,
                                },
                                operation: descriptor.id,
                                reason:    usage.dailyTokens >= appSettings.policy.maxTokensPerDay ? 'budget_exceeded' : 'rate_exceeded',
                            }),
                        ),
                        Effect.asVoid,
                        Effect.tapError(() => provider.observePolicyDenied(descriptor.id, tenantId)),
                    ),
                ),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        const resolveLocalContext = (descriptor: OperationDescriptor) =>
            provider.resolveTenantId.pipe(
                Effect.bindTo('tenantId'),
                Effect.bind('appSettings', ({ tenantId }) => provider.resolveSettings(tenantId).pipe(Effect.map(_capMaxTokens))),
                Effect.map(({ appSettings, tenantId }) => ({ appSettings, credentials: {} as AiRegistry.Credentials, tenantId })),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        const runEffectOperation = <A, E, R>(
            descriptor: OperationDescriptor,
            context:    OperationContext,
            effect:     Effect.Effect<A, E, R>,
            onSuccess:  (value: A, meta: ReturnType<typeof _languageMeta> | ReturnType<typeof _embeddingMeta>) => Effect.Effect<void, unknown, never> = () => Effect.void,
        ) => {
            const meta = descriptor.rail === 'language' ? _languageMeta(descriptor, context) : _embeddingMeta(descriptor, context);
            return effect.pipe(
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
        const runLanguage = <A extends { readonly usage: Response.Usage }, Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>, R>(
            descriptor: OperationDescriptor,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiSdkError.AiError, R>,
        ) => Effect.gen(function* () {
            const context = yield* resolveContext(descriptor);
            const policyOptions = yield* applyToolPolicy<Tools, Options>(descriptor, context, options);
            const withPlan = run(policyOptions).pipe(
                Effect.provide(AiRegistry.languageLayer(context.appSettings, context.credentials)),
            );
            const withPolicy = withPlan.pipe(
                Effect.tap((response) => provider.incrementUsage(context.tenantId, { requests: 1, tokens: response.usage.totalTokens ?? 0 })),
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
                    const withPlan = LanguageModel.streamText(policyOptions).pipe(
                        Stream.provideLayer(AiRegistry.languageLayer(context.appSettings, context.credentials)),
                    );
                    const withFinish = Stream.mapEffect(withPlan, (part) =>
                        (part.type === 'finish' && 'usage' in part
                            ? provider.incrementUsage(context.tenantId, { requests: 1, tokens: part.usage.totalTokens ?? 0 }).pipe(
                                Effect.zipRight(enforceRequestTokens(descriptor, context, 'usage.totalTokens', part.usage.totalTokens ?? 0)),
                                Effect.zipRight(Effect.all([provider.observeTokens(meta.labels, part.usage), provider.annotate({ ...meta.annotation, usage: part.usage })], { discard: true })),
                            )
                            : Effect.void).pipe(Effect.as(part)));
                    return Stream.onStart(
                        Stream.tapError(withFinish, (error) => provider.observeError(descriptor.id, meta.labels, error)),
                        Effect.all([provider.annotate(meta.annotation), provider.observeRequest(descriptor.id, meta.labels)], { discard: true }),
                    );
                }).pipe(Effect.mapError(AiError.from(descriptor.id))),
            ).pipe(Stream.mapError(AiError.from(descriptor.id)));
        const embed = (input: string, options?: { readonly usage?: AiRegistry.EmbeddingUsage }) =>
            Effect.gen(function* () {
                const context = yield* resolveContext(AI_OPERATIONS.embed);
                const effect = AiRegistry.embed(context.appSettings.embedding, context.credentials, options?.usage ?? 'document', input).pipe(
                    Effect.tap((result) => provider.incrementUsage(context.tenantId, { requests: 1, tokens: _usageTokens(result.usage) })),
                    Effect.tap((result) => enforceRequestTokens(AI_OPERATIONS.embed, context, 'usage.totalTokens', _usageTokens(result.usage))),
                );
                return yield* runEffectOperation(AI_OPERATIONS.embed, context, effect, (result, meta) =>
                    Effect.all([
                        provider.observeEmbedding(meta.labels, 1),
                        provider.observeTokens(meta.labels, result.usage),
                        provider.annotate({ ...meta.annotation, usage: result.usage }),
                    ], { discard: true })).pipe(
                    Effect.map((result) => result.embedding),
                );
            });
        const embedMany = (input: ReadonlyArray<string>, options?: { readonly usage?: AiRegistry.EmbeddingUsage }) =>
            Effect.gen(function* () {
                const context = yield* resolveContext(AI_OPERATIONS.embedMany);
                const effect = AiRegistry.embedMany(context.appSettings.embedding, context.credentials, options?.usage ?? 'document', input).pipe(
                    Effect.tap((result) => provider.incrementUsage(context.tenantId, { requests: 1, tokens: _usageTokens(result.usage) })),
                    Effect.tap((result) => enforceRequestTokens(AI_OPERATIONS.embedMany, context, 'usage.totalTokens', _usageTokens(result.usage))),
                );
                return yield* runEffectOperation(AI_OPERATIONS.embedMany, context, effect, (result, meta) =>
                    Effect.all([
                        provider.observeEmbedding(meta.labels, result.embeddings.length),
                        provider.observeTokens(meta.labels, result.usage),
                        provider.annotate({ ...meta.annotation, usage: result.usage }),
                    ], { discard: true })).pipe(
                    Effect.map((result) => result.embeddings),
                );
            });
        const settings = () =>
            provider.resolveTenantId.pipe(
                Effect.flatMap((tenantId) => provider.resolveSettings(tenantId)),
                Effect.map(_capMaxTokens),
            );
        const countTokens = Effect.fn('AiRuntime.countTokens')((input: string): Effect.Effect<number, unknown, never> =>
            resolveContext(AI_OPERATIONS.countTokens).pipe(
                Effect.flatMap((context) =>
                    AiRegistry.countTokens(context.appSettings, context.credentials, input).pipe(
                        Effect.flatMap((count) => runEffectOperation(AI_OPERATIONS.countTokens, context, Effect.succeed(count))),
                    ),
                ),
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
        const runtimeLanguageLayer = Layer.succeed(LanguageModel.LanguageModel, { generateObject, generateText, streamText } as LanguageModel.Service);
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            resolveLocalContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(
                    AI_OPERATIONS.chat,
                    context,
                    Match.value(options?.prompt).pipe(Match.when(Match.undefined, () => Chat.empty), Match.orElse((prompt) => Chat.fromPrompt(prompt))).pipe(Effect.provide(runtimeLanguageLayer)),
                )),
            );
        const deserializeChat = (chatJson: string) =>
            resolveLocalContext(AI_OPERATIONS.chat).pipe(
                Effect.flatMap((context) => runEffectOperation(
                    AI_OPERATIONS.chat,
                    context,
                    Match.value(chatJson.trim()).pipe(Match.when('', () => Chat.empty), Match.orElse((json) => Chat.fromJson(json))).pipe(Effect.provide(runtimeLanguageLayer)),
                )),
            );
        const serializeChat = (chatService: Chat.Service) =>
            resolveLocalContext(AI_OPERATIONS.chat).pipe(
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
                                return Option.flatMap(after, (value) => value <= options.target ? Option.some({ after: value, before: beforeCount, compacted }) : Option.none());
                            }),
                });
            }),
        );
        return { chat, compactChat, countTokens, deserializeChat, embed, embedMany, generateObject, generateText, serializeChat, settings, streamText };
    }),
}) {
    static readonly Live = AiRuntime.Default.pipe(Layer.provideMerge(AiRuntimeProvider.Default));
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
