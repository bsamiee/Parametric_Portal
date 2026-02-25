import {AiError as AiSdkError, Chat, EmbeddingModel, LanguageModel, type Response, type Tool } from '@effect/ai';
import { Effect, Layer, Match, Option, Stream } from 'effect';
import { AiError } from './errors.ts';
import { AiRegistry } from './registry.ts';
import { AiRuntimeProvider } from './runtime-provider.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _OPERATIONS = {
    chat:           { id: 'ai.chat',           kind: 'language',  telemetry: 'chat'       },
    embed:          { id: 'ai.embed',          kind: 'embedding', telemetry: 'embeddings' },
    generateObject: { id: 'ai.generateObject', kind: 'language',  telemetry: 'chat'       },
    generateText:   { id: 'ai.generateText',   kind: 'language',  telemetry: 'chat'       },
    streamText:     { id: 'ai.streamText',     kind: 'language',  telemetry: 'chat'       },
} as const;

// --- [TYPES] -----------------------------------------------------------------

type _OperationDescriptor = (typeof _OPERATIONS)[keyof typeof _OPERATIONS];
type _RuntimeContext = { readonly appSettings: AiRegistry.Settings; readonly tenantId: string };

// --- [FUNCTIONS] -------------------------------------------------------------

const _isFinishPart = <Tools extends Record<string, Tool.Any>>(part: Response.StreamPart<Tools>): part is Response.FinishPart =>
    part.type === 'finish' && 'usage' in part;
const _isToolChoiceOneOf = (value: LanguageModel.ToolChoice<string> | undefined): value is { readonly mode?: 'auto' | 'required'; readonly oneOf: ReadonlyArray<string> } =>
    typeof value === 'object' && value !== null && 'oneOf' in value;
const _isToolChoiceTool = (value: LanguageModel.ToolChoice<string> | undefined): value is { readonly tool: string } =>
    typeof value === 'object' && value !== null && 'tool' in value;
const _policyConstrainedSettings = (settings: AiRegistry.Settings): AiRegistry.Settings => ({
    ...settings,
    language: {
        ...settings.language,
        maxTokens: Math.min(settings.language.maxTokens, settings.policy.maxTokensPerRequest),
    },
});
const _toolAllowedByPolicy = (policy: AiRegistry.Settings['policy']['tools'], name: string): boolean =>
    Match.value(policy.mode).pipe(
        Match.when('allow', () => policy.names.length === 0 || policy.names.includes(name)),
        Match.orElse(() => !policy.names.includes(name)),
    );
const _languageAnnotation = (appSettings: AiRegistry.Settings) => ({
    operation: { name: _OPERATIONS.chat.telemetry },
    request: {
        maxTokens:   appSettings.language.maxTokens,
        model:       appSettings.language.model,
        temperature: appSettings.language.temperature,
        topK:        appSettings.language.topK,
        topP:        appSettings.language.topP,
    },
    system: appSettings.language.provider,
}) as const;
const _annotation = (descriptor: _OperationDescriptor, appSettings: AiRegistry.Settings) =>
    Match.value(descriptor.kind).pipe(
        Match.when('embedding', () => ({
            operation: { name: descriptor.telemetry },
            request:   { model: appSettings.embedding.model },
            system:    appSettings.embedding.provider,
        })),
        Match.orElse(() => _languageAnnotation(appSettings)),
    );
const _labels = (descriptor: _OperationDescriptor, context: _RuntimeContext) =>
    Match.value(descriptor.kind).pipe(
        Match.when('embedding', () => ({
            dimensions: String(context.appSettings.embedding.dimensions),
            model:      context.appSettings.embedding.model,
            operation:  descriptor.id,
            provider:   context.appSettings.embedding.provider,
            tenant:     context.tenantId,
        })),
        Match.orElse(() => ({
            model:     context.appSettings.language.model,
            operation: descriptor.id,
            provider:  context.appSettings.language.provider,
            tenant:    context.tenantId,
        })),
    );

// --- [SERVICES] --------------------------------------------------------------

class AiRuntime extends Effect.Service<AiRuntime>()('ai/Runtime', {
    effect: Effect.gen(function* () {
        const provider = yield* AiRuntimeProvider;
        const checkBudget = (descriptor: _OperationDescriptor, tenantId: string, policy: AiRegistry.Settings['policy']) =>
            provider.readBudget(tenantId).pipe(
                Effect.filterOrFail(
                    ({ dailyTokens }) => dailyTokens < policy.maxTokensPerDay,
                    ({ dailyTokens }) => new AiError({ cause: { dailyTokens, limit: policy.maxTokensPerDay, tenantId }, operation: descriptor.id, reason: 'budget_exceeded' }),
                ),
                Effect.filterOrFail(
                    ({ rateCount }) => rateCount < policy.maxRequestsPerMinute,
                    ({ rateCount }) => new AiError({ cause: { limit: policy.maxRequestsPerMinute, rateCount, tenantId }, operation: descriptor.id, reason: 'rate_exceeded' }),
                ),
                Effect.asVoid,
                Effect.tapError(() => provider.observePolicyDenied(descriptor.id, tenantId)),
            );
        const policyDenied = (
            descriptor: _OperationDescriptor,
            tenantId: string,
            cause: unknown,
        ) =>
            provider.observePolicyDenied(descriptor.id, tenantId).pipe(
                Effect.zipRight(Effect.fail(new AiError({ cause: { ...((typeof cause === 'object' && cause !== null) ? cause : { cause }), tenantId }, operation: descriptor.id, reason: 'policy_denied' }))),
            );
        const enforceRequestTokens = (
            descriptor: _OperationDescriptor,
            context: _RuntimeContext,
            source: string,
            totalTokens: number,
        ) =>
            Effect.succeed(totalTokens).pipe(
                Effect.filterOrFail(
                    (tokens) => tokens <= context.appSettings.policy.maxTokensPerRequest,
                    (tokens) => new AiError({
                        cause: {
                            limit: context.appSettings.policy.maxTokensPerRequest,
                            source,
                            tokens,
                        },
                        operation: descriptor.id,
                        reason:    'request_tokens_exceeded',
                    }),
                ),
                Effect.asVoid,
                Effect.tapError(() => provider.observePolicyDenied(descriptor.id, context.tenantId)),
            );
        const incrementBudget = (tenantId: string, totalTokens: number) =>
            provider.readBudget(tenantId).pipe(
                Effect.flatMap((current) =>
                    provider.writeBudget(tenantId, { dailyTokens: current.dailyTokens + totalTokens, rateCount: current.rateCount + 1 }),
                ),
            );
        const resolveContext = (descriptor: _OperationDescriptor) =>
            provider.resolveTenantId.pipe(
                Effect.bindTo('tenantId'),
                Effect.bind('appSettings', ({ tenantId }) => provider.resolveSettings(tenantId).pipe(Effect.map(_policyConstrainedSettings))),
                Effect.tap(({ tenantId, appSettings }) => checkBudget(descriptor, tenantId, appSettings.policy)),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        const runEffectOperation = <A, E, R>(
            descriptor: _OperationDescriptor,
            context: _RuntimeContext,
            effect: Effect.Effect<A, E, R>,
            onSuccess: (value: A, labels: Record<string, string>) => Effect.Effect<void, unknown, never> = () => Effect.void,
        ) => {
            const labels = _labels(descriptor, context);
            return provider.trackEffect(descriptor.id, labels, effect).pipe(
                Effect.tap((value) => onSuccess(value, labels)),
                Effect.tapError((error) => provider.observeError(descriptor.id, labels, error)),
                Effect.ensuring(provider.annotate(_annotation(descriptor, context.appSettings))),
                Effect.ensuring(provider.observeRequest(descriptor.id, labels)),
                Effect.mapError(AiError.from(descriptor.id)),
            );
        };
        const constrainOneOf = (
            descriptor: _OperationDescriptor,
            tenantId: string,
            policy: AiRegistry.Settings['policy']['tools'],
            value: { readonly mode?: 'auto' | 'required'; readonly oneOf: ReadonlyArray<string> },
            allowedNames: ReadonlyArray<string>,
        ) => {
            const oneOf = value.oneOf.filter((name) => allowedNames.includes(name));
            return oneOf.length === 0
                ? Match.value(value.mode).pipe(
                    Match.when('required', () =>
                        policyDenied(descriptor, tenantId, {
                            policy,
                            reason: 'required_subset_empty',
                            requestedTools: value.oneOf,
                        }),
                    ),
                    Match.orElse(() => Effect.succeed('none' as const)),
                )
                : Effect.succeed({ ...value, oneOf } satisfies LanguageModel.ToolChoice<string>);
        };
        const applyToolPolicy = <Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>>(
            descriptor: _OperationDescriptor,
            context: _RuntimeContext,
            options: Options,
        ) => {
            const policy = context.appSettings.policy.tools;
            const constrainToolChoice = (
                toolChoice: LanguageModel.ToolChoice<string> | undefined,
                allowedNames: ReadonlyArray<string>,
            ) =>
                Match.value(toolChoice).pipe(
                    Match.when('required', () =>
                        allowedNames.length === 0
                            ? policyDenied(descriptor, context.tenantId, {
                                policy,
                                reason: 'required_without_allowed_tools',
                            })
                            : Effect.succeed(toolChoice),
                    ),
                    Match.orElse((value) =>
                        Match.value(value).pipe(
                            Match.when(_isToolChoiceTool, (v) =>
                                Match.value(allowedNames.includes(v.tool)).pipe(
                                    Match.when(true, () => Effect.succeed(value)),
                                    Match.orElse(() =>
                                        policyDenied(descriptor, context.tenantId, {
                                            policy,
                                            reason: 'tool_not_allowed',
                                            requestedTool: v.tool,
                                        })),
                                ),
                            ),
                            Match.when(_isToolChoiceOneOf, (v) => constrainOneOf(descriptor, context.tenantId, policy, v, allowedNames)),
                            Match.orElse(() => Effect.succeed(value)),
                        ),
                    ),
                );
            return Option.fromNullable(options.toolkit).pipe(
                Option.match({
                    onNone: () => Effect.succeed(options),
                    onSome: (toolkitOrEffect) => {
                        const toolkitEffect = Effect.isEffect(toolkitOrEffect) ? toolkitOrEffect : Effect.succeed(toolkitOrEffect);
                        return toolkitEffect.pipe(
                            Effect.map((toolkit) => toolkit as unknown as { readonly tools: Record<string, Tool.Any> }),
                            Effect.flatMap((toolkit) => {
                                const allowedTools = Object.fromEntries(
                                    Object.entries(toolkit.tools).filter(([, tool]) => _toolAllowedByPolicy(policy, tool.name)),
                                ) as Record<string, Tool.Any>;
                                const allowedNames = Object.values(allowedTools).map((tool) => tool.name);
                                return constrainToolChoice(options.toolChoice, allowedNames).pipe(
                                    Effect.map((toolChoice) => ({
                                        ...options,
                                        toolChoice,
                                        toolkit: {
                                            ...(toolkit as object),
                                            tools: allowedTools,
                                        },
                                    } as Options)),
                                );
                            }),
                        );
                    },
                }),
            );
        };
        const runLanguage = <A extends { readonly usage: Response.Usage }, Tools extends Record<string, Tool.Any>, Options extends LanguageModel.GenerateTextOptions<Tools>, R>(
            descriptor: _OperationDescriptor,
            options: Options,
            run: (opts: Options) => Effect.Effect<A, AiSdkError.AiError, R>,
        ) =>
            resolveContext(descriptor).pipe(
                Effect.flatMap((context) =>
                    applyToolPolicy<Tools, Options>(descriptor, context, options).pipe(
                        Effect.flatMap((policyOptions) => {
                            const labels = _labels(descriptor, context);
                            const layers = AiRegistry.layers(context.appSettings);
                            const primary = provider.trackEffect(
                                descriptor.id,
                                labels,
                                run(policyOptions).pipe(Effect.provide(layers.language)),
                            );
                            const withFallback = layers.fallbackLanguage.reduce<Effect.Effect<A, unknown, unknown>>(
                                (accumulated, fallbackLayer, index) => {
                                    const fallbackProvider = context.appSettings.language.fallback[index] ?? context.appSettings.language.provider;
                                    return accumulated.pipe(
                                        Effect.catchIf(AiSdkError.isAiError, () =>
                                            provider.trackEffect(
                                                descriptor.id,
                                                { ...labels, provider: fallbackProvider },
                                                run(policyOptions).pipe(Effect.provide(fallbackLayer)),
                                            ).pipe(Effect.tap(() => provider.observeFallback(descriptor.id, fallbackProvider, context.tenantId))),
                                        ),
                                    );
                                },
                                primary,
                            );
                            const withPolicy = withFallback.pipe(
                                Effect.tap((response) => incrementBudget(context.tenantId, response.usage.totalTokens ?? 0).pipe(Effect.ignore)),
                                Effect.tap((response) => enforceRequestTokens(descriptor, context, 'usage.totalTokens', response.usage.totalTokens ?? 0)),
                            );
                            return runEffectOperation(
                                descriptor,
                                context,
                                withPolicy,
                                (response, operationLabels) =>
                                    Effect.all([
                                        provider.observeTokens(operationLabels, response.usage),
                                        provider.annotate({ ..._annotation(descriptor, context.appSettings), usage: response.usage }),
                                    ], { discard: true }),
                            );
                        }),
                    ),
                ),
            );
        const runLanguageStream = <Tools extends Record<string, Tool.Any> = Record<string, never>>(
            descriptor: _OperationDescriptor,
            options: LanguageModel.GenerateTextOptions<Tools>,
        ) =>
            Stream.unwrap(
                resolveContext(descriptor).pipe(
                    Effect.flatMap((context) =>
                        applyToolPolicy<Tools, LanguageModel.GenerateTextOptions<Tools>>(descriptor, context, options).pipe(
                            Effect.map((policyOptions) => {
                                const labels = _labels(descriptor, context);
                                const annotation = _annotation(descriptor, context.appSettings);
                                const layers = AiRegistry.layers(context.appSettings);
                                const onFinish = (part: Response.StreamPart<Tools>) =>
                                    _isFinishPart(part)
                                        ? incrementBudget(context.tenantId, part.usage.totalTokens ?? 0).pipe(
                                            Effect.ignore,
                                            Effect.zipRight(enforceRequestTokens(descriptor, context, 'usage.totalTokens', part.usage.totalTokens ?? 0)),
                                            Effect.zipRight(
                                                Effect.all(
                                                    [
                                                        provider.observeTokens(labels, part.usage),
                                                        provider.annotate({ ...annotation, usage: part.usage }),
                                                    ],
                                                    { discard: true },
                                                ),
                                            ),
                                        )
                                        : Effect.void;
                                type _LanguageLayer = (typeof layers)['language'] | (typeof layers)['fallbackLanguage'][number];
                                const streamForLayer = (layer: _LanguageLayer): Stream.Stream<Response.StreamPart<Tools>, unknown, unknown> =>
                                    LanguageModel.streamText(policyOptions).pipe(Stream.provideLayer(layer)) as Stream.Stream<Response.StreamPart<Tools>, unknown, unknown>;
                                const withFallback = layers.fallbackLanguage.reduce<Stream.Stream<Response.StreamPart<Tools>, unknown, unknown>>(
                                    (accumulated, fallbackLayer, index) => {
                                        const fallbackProvider = context.appSettings.language.fallback[index] ?? context.appSettings.language.provider;
                                        return Stream.catchAll(
                                            accumulated,
                                            (error) =>
                                                AiSdkError.isAiError(error)
                                                    ? Stream.unwrap(
                                                        provider.observeFallback(descriptor.id, fallbackProvider, context.tenantId).pipe(
                                                            Effect.as(streamForLayer(fallbackLayer)),
                                                        ),
                                                    )
                                                    : Stream.fail(error),
                                        );
                                    },
                                    streamForLayer(layers.language),
                                );
                                const started = Stream.onStart(
                                    withFallback,
                                    Effect.all(
                                        [
                                            provider.annotate(annotation),
                                            provider.observeRequest(descriptor.id, labels),
                                        ],
                                        { discard: true },
                                    ),
                                );
                                return provider.trackStream(
                                    descriptor.id,
                                    labels,
                                    Stream.tapError(
                                        Stream.mapEffect(started, (part) => onFinish(part).pipe(Effect.as(part))),
                                        (error) => provider.observeError(descriptor.id, labels, error),
                                    ),
                                );
                            }),
                        ),
                    ),
                    Effect.mapError(AiError.from(descriptor.id)),
                ),
            ).pipe(Stream.mapError(AiError.from(descriptor.id)));
        const settings = () =>
            provider.resolveTenantId.pipe(
                Effect.flatMap(provider.resolveSettings),
                Effect.map(_policyConstrainedSettings),
            );
        function embed(input: string): Effect.Effect<readonly number[], AiSdkError.AiError | AiError, never>;
        function embed(input: readonly string[]): Effect.Effect<readonly (readonly number[])[], AiSdkError.AiError | AiError, never>;
        function embed(input: string | readonly string[]): Effect.Effect<readonly number[] | readonly (readonly number[])[], unknown, unknown> {
            return resolveContext(_OPERATIONS.embed).pipe(
                Effect.flatMap((context) => {
                    const layers = AiRegistry.layers(context.appSettings);
                    const usage = Match.value(input).pipe(
                        Match.when(Match.string, (value) => ({ count: 1, estimatedTokens: Math.ceil(value.length / 4) })),
                        Match.orElse((values) => ({ count: values.length, estimatedTokens: Math.ceil(values.join('').length / 4) })),
                    );
                    return enforceRequestTokens(_OPERATIONS.embed, context, 'embedding.estimatedTokens', usage.estimatedTokens).pipe(
                        Effect.zipRight(
                            runEffectOperation(
                                _OPERATIONS.embed,
                                context,
                                EmbeddingModel.EmbeddingModel.pipe(
                                    Effect.flatMap((model) =>
                                        Match.value(input).pipe(
                                            Match.when(Match.string, (value) => model.embed(value)),
                                            Match.orElse((values) => model.embedMany(values)),
                                        ),
                                    ),
                                    Effect.provide(layers.embedding),
                                ),
                                (_result, labels) =>
                                    Effect.all(
                                        [
                                            provider.observeEmbedding(labels, usage.count),
                                            incrementBudget(context.tenantId, usage.estimatedTokens),
                                        ],
                                        { discard: true },
                                    ),
                            ),
                        ),
                    );
                }),
            );
        }
        const generateText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            runLanguage<LanguageModel.GenerateTextResponse<Tools>, Tools, LanguageModel.GenerateTextOptions<Tools>, unknown>(
                _OPERATIONS.generateText,
                options,
                LanguageModel.generateText,
            );
        const generateObject = <A, I extends Record<string, unknown>, R, Tools extends Record<string, Tool.Any> = Record<string, never>>(
            options: LanguageModel.GenerateObjectOptions<Tools, A, I, R>,
        ) => runLanguage<LanguageModel.GenerateObjectResponse<Tools, A>, Tools, LanguageModel.GenerateObjectOptions<Tools, A, I, R>, unknown>(
            _OPERATIONS.generateObject,
            options,
            LanguageModel.generateObject,
        );
        const streamText = <Tools extends Record<string, Tool.Any> = Record<string, never>>(options: LanguageModel.GenerateTextOptions<Tools>) =>
            runLanguageStream(_OPERATIONS.streamText, options);
        const runtimeLanguageService: LanguageModel.Service = {
            generateObject: (options) => runLanguage(_OPERATIONS.generateObject, options as never, LanguageModel.generateObject as never) as never,
            generateText: (options) => runLanguage(_OPERATIONS.generateText, options as never, LanguageModel.generateText as never) as never,
            streamText: (options) => runLanguageStream(_OPERATIONS.streamText, options as never) as never,
        };
        const runtimeLanguageLayer = Layer.succeed(LanguageModel.LanguageModel, runtimeLanguageService);
        const chat = (options?: { readonly prompt?: Parameters<typeof Chat.fromPrompt>[0] }) =>
            resolveContext(_OPERATIONS.chat).pipe(
                Effect.flatMap((context) =>
                    runEffectOperation(
                        _OPERATIONS.chat,
                        context,
                        Option.fromNullable(options?.prompt).pipe(
                            Option.match({
                                onNone: () => Chat.empty,
                                onSome: Chat.fromPrompt,
                            }),
                            Effect.provide(runtimeLanguageLayer),
                        ),
                    ),
                ),
            );
        return { chat, embed, generateObject, generateText, settings, streamText };
    }),
}) {
    static readonly Live = Layer.provide(AiRuntime.Default, AiRuntimeProvider.Server);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntime };
