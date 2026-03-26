/** biome-ignore-all assist/source/useSortedKeys: <Provider registry is grouped intentionally> */
import { LanguageModel, type AiError as AiSdkError, type Response, Tokenizer } from '@effect/ai';
import { type Generated as GoogleGenerated, GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { type Generated as OpenAiGenerated, OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform';
import { KargadanAiSettingsSchema as AiSettingsSchema, type KargadanAiProviderSchema as AiProviderSchema } from '@parametric-portal/database/models';
import { Array as A, Effect, FiberRef, Layer, Option, Redacted, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const _OpenAiModelListSchema = S.Struct({
    data: S.Array(S.Struct({ id: S.NonEmptyTrimmedString })),
});
const _GeminiModelListSchema = S.Struct({
    models: S.optional(S.Array(S.Struct({
        displayName:                S.optional(S.String),
        name:                       S.NonEmptyTrimmedString,
        supportedGenerationMethods: S.optional(S.Array(S.NonEmptyTrimmedString)),
    }))),
});

// --- [TYPES] -----------------------------------------------------------------

type _Provider = typeof AiProviderSchema.Type;
type _PersistedSettings = typeof AiSettingsSchema.Type;
type _EmbeddingUsage = 'document' | 'query' | 'similarity';
type _EmbeddingBatch = {
    readonly embeddings: ReadonlyArray<readonly number[]>;
    readonly usage:      Response.Usage;
};
type _LiveModel = {
    readonly id:       string;
    readonly provider: _Provider;
    readonly title:    string;
};
type _Credential<P extends _Provider = _Provider> = ({
    gemini: { readonly accessToken: Redacted.Redacted<string>; readonly kind: 'oauth-desktop'; readonly projectId: string };
    openai: { readonly kind: 'api-secret'; readonly secret: Redacted.Redacted<string> };
})[P];
type _Credentials = Partial<{ [P in _Provider]: _Credential<P> }>;
type _OnTokenRefresh = (data: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken: string }) => Effect.Effect<void>;
type _Embedding = (typeof _EMBEDDING_PROFILES)[_Provider];
type _GenerationSettings<P extends _Provider = _Provider> = Pick<_PersistedSettings, 'maxOutputTokens' | 'model' | 'temperature' | 'topP'> & { readonly provider: P };
type _Settings<P extends _Provider = _Provider> = _PersistedSettings & {
    readonly provider: P;
    readonly embedding: (typeof _EMBEDDING_PROFILES)[P];
    readonly knowledge: {
        readonly maxCandidates: number;
    };
    readonly policy: {
        readonly maxRequestsPerMinute: number;
        readonly maxTokensPerDay: number;
        readonly maxTokensPerRequest: number;
        readonly tools: {
            readonly mode: 'allow' | 'deny';
            readonly names: ReadonlyArray<string>;
        };
    };
};

// --- [CONSTANTS] -------------------------------------------------------------

const _KNOWLEDGE_DEFAULTS = { maxCandidates: 12 } as const;
const _POLICY_DEFAULTS = {
    maxRequestsPerMinute: 60,
    maxTokensPerDay:      1_000_000,
    maxTokensPerRequest:  16_384,
    tools:                { mode: 'allow' as const, names: [] as ReadonlyArray<string> },
} as const;
const _OnTokenRefreshRef = FiberRef.unsafeMake<Option.Option<_OnTokenRefresh>>(Option.none());
const _emptyEmbeddingBatch = { embeddings: [] as ReadonlyArray<readonly number[]>, usage: {} as Response.Usage } as const satisfies _EmbeddingBatch;
const _EMBEDDING_PROFILES = {
    gemini: { dimensions: 1_536, model: 'gemini-embedding-001', provider: 'gemini' },
    openai: { dimensions: 1_536, model: 'text-embedding-3-large', provider: 'openai' },
} as const;
const _OPENAI_LANGUAGE_MODEL_PATTERNS = {
    allow: [/^chatgpt-/u, /^codex-/u, /^gpt-/u, /^o[134](?:$|[-])/u] as const,
    deny:  [/audio/u, /embedding/u, /image/u, /moderation/u, /omni-moderation/u, /realtime/u, /search/u, /transcri/u, /tts/u, /whisper/u] as const,
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _toEmbeddingUsage = (usage: {
    readonly cachedInputTokens?: number | undefined;
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
    readonly reasoningTokens?: number | undefined;
    readonly totalTokens?: number | undefined;
}) => ({
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens:       usage.inputTokens,
    outputTokens:      usage.outputTokens,
    reasoningTokens:   usage.reasoningTokens,
    totalTokens:       usage.totalTokens,
}) satisfies Response.Usage;
const _mapOpenAiEmbedding = (response: OpenAiGenerated.CreateEmbeddingResponse): _EmbeddingBatch => ({
    embeddings: response.data.map(({ embedding }) => embedding as readonly number[]),
    usage:      _toEmbeddingUsage({
        inputTokens:  response.usage.prompt_tokens,
        outputTokens: 0,
        totalTokens:  response.usage.total_tokens,
    }),
});
const _mapGeminiEmbedding = (response: typeof GoogleGenerated.BatchEmbedContentsResponse.Type): _EmbeddingBatch => ({
    embeddings: (response.embeddings ?? []).map((embedding) => embedding.values ?? []),
    usage:      _toEmbeddingUsage({}),
});
const _embeddingTaskType = (usage: _EmbeddingUsage) =>
    ({ document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY', similarity: 'SEMANTIC_SIMILARITY' } as const)[usage];
const _clientLayers = {
    gemini: (credential: _Credential<'gemini'>) =>
        GoogleClient.layer({
            transformClient: (client) =>
                client.pipe(HttpClient.mapRequest((request) =>
                    request.pipe(
                        HttpClientRequest.bearerToken(Redacted.value(credential.accessToken)),
                        HttpClientRequest.setHeader('x-goog-user-project', credential.projectId),
                    ))),
        }).pipe(Layer.provide(FetchHttpClient.layer)),
    openai: (credential: _Credential<'openai'>) =>
        OpenAiClient.layer({ apiKey: credential.secret }).pipe(Layer.provide(FetchHttpClient.layer)),
} as const;
const _httpJson = <A>(request: ReturnType<typeof HttpClientRequest.get>, schema: S.Schema<A>) =>
    HttpClient.execute(request).pipe(
        Effect.flatMap((response) => response.json),
        Effect.scoped,
        Effect.provide(FetchHttpClient.layer),
        Effect.flatMap(S.decodeUnknown(schema)),
    );
const _credential = <P extends _Provider>(credentials: _Credentials, provider: P) =>
    Option.getOrThrowWith(Option.fromNullable(credentials[provider]), () => new Error(`Missing credential for provider: ${provider}`)) as _Credential<P>;
const _ProviderCatalog = {
    gemini: {
        credential: {
            configKeys: { accessToken: 'AI_GEMINI_ACCESS_TOKEN', clientPath: 'AI_GEMINI_CLIENT_PATH', expiry: 'AI_GEMINI_TOKEN_EXPIRY', refreshToken: 'AI_GEMINI_REFRESH_TOKEN' },
            kind: 'oauth-desktop',
            scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'],
            tokenExpiryBufferMs: 60_000,
        },
        embedding: _EMBEDDING_PROFILES.gemini,
        embedMany: (credential: _Credential<'gemini'>, usage: _EmbeddingUsage, input: ReadonlyArray<string>): Effect.Effect<_EmbeddingBatch, Error | AiSdkError.AiError> =>
            A.match(input, {
                onEmpty: () => Effect.succeed(_emptyEmbeddingBatch),
                onNonEmpty: (values) =>
                    GoogleClient.GoogleClient.pipe(
                        Effect.flatMap((client) => Effect.all([
                            client.client.BatchEmbedContents(_ProviderCatalog.gemini.embedding.model, {
                                requests: A.map(values, (value) => ({
                                    content: { parts: [{ text: value }], role: 'user' },
                                    model:   `models/${_ProviderCatalog.gemini.embedding.model}`,
                                    outputDimensionality: _ProviderCatalog.gemini.embedding.dimensions,
                                    taskType: _embeddingTaskType(usage),
                                })),
                            }),
                            client.client.CountTokens(_ProviderCatalog.gemini.embedding.model, {
                                contents: A.map(values, (value) => ({ parts: [{ text: value }], role: 'user' })),
                            }),
                        ])),
                        Effect.provide(_clientLayers.gemini(credential)),
                        Effect.map(([response, tokenCount]) => ({
                            ..._mapGeminiEmbedding(response),
                            usage: _toEmbeddingUsage({
                                inputTokens:  tokenCount.totalTokens ?? 0,
                                outputTokens: 0,
                                totalTokens:  tokenCount.totalTokens ?? 0,
                            }),
                        })),
                        Effect.filterOrFail(
                            (result) =>
                                result.embeddings.length === values.length
                                && result.embeddings.every((embedding) => embedding.length === _ProviderCatalog.gemini.embedding.dimensions),
                            () => new Error(`Gemini embedding shape mismatch: ${_ProviderCatalog.gemini.embedding.model}`),
                        ),
                    ),
            }),
        countTokens: (credential: _Credential<'gemini'>, settings: _GenerationSettings, input: string): Effect.Effect<number, Error | AiSdkError.AiError> =>
            GoogleClient.GoogleClient.pipe(
                Effect.flatMap((client) => client.client.CountTokens(settings.model, {
                    contents: [{ parts: [{ text: input }], role: 'user' }],
                })),
                Effect.provide(_clientLayers.gemini(credential)),
                Effect.map((result) => result.totalTokens ?? 0),
            ),
        languageLayer: (credential: _Credential<'gemini'>, settings: _GenerationSettings) =>
            GoogleLanguageModel.model(settings.model, {
                generationConfig: {
                    maxOutputTokens: settings.maxOutputTokens,
                    temperature:     settings.temperature,
                    topP:            settings.topP,
                },
                toolConfig: {},
            }).pipe(Layer.provide(_clientLayers.gemini(credential))),
        listModels: (credential: _Credential<'gemini'>): Effect.Effect<ReadonlyArray<_LiveModel>, Error> =>
            _httpJson(
                HttpClientRequest.get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000').pipe(
                    HttpClientRequest.bearerToken(Redacted.value(credential.accessToken)),
                    HttpClientRequest.setHeader('x-goog-user-project', credential.projectId),
                ),
                _GeminiModelListSchema,
            ).pipe(
                Effect.map(({ models }) => (models ?? [])
                    .filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
                    .map((model) => ({
                        id:       model.name.replace(/^models\//u, ''),
                        provider: 'gemini' as const,
                        title:    model.displayName?.trim() || model.name.replace(/^models\//u, ''),
                    }))
                    .toSorted((left, right) => left.id.localeCompare(right.id))),
            ),
        validateSelection: (credential: _Credential<'gemini'>, settings: _Settings<'gemini'>): Effect.Effect<void, Error | AiSdkError.AiError> =>
            _ProviderCatalog.gemini.listModels(credential).pipe(
                Effect.filterOrFail(
                    (available) => available.some((model) => model.id === settings.model),
                    () => new Error(`Unknown ${settings.provider} language model id: ${settings.model}`),
                ),
                Effect.asVoid,
                Effect.zipRight(LanguageModel.generateText({ prompt: 'Reply with ok.' }).pipe(
                    Effect.provide(_ProviderCatalog.gemini.languageLayer(credential, { ...settings, maxOutputTokens: 1 })),
                    Effect.asVoid,
                )),
            ),
        requiresBrowser: true,
        requiresClientPath: true,
        secretEnvKey: 'AI_GEMINI_ACCESS_TOKEN',
        supportsHeadlessEnrollment: false,
        title: 'Google (Gemini)',
    },
    openai: {
        credential: { configKeys: { secret: 'AI_OPENAI_API_SECRET' }, kind: 'api-secret' },
        embedding: _EMBEDDING_PROFILES.openai,
        embedMany: (credential: _Credential<'openai'>, _usage: _EmbeddingUsage, input: ReadonlyArray<string>): Effect.Effect<_EmbeddingBatch, Error | AiSdkError.AiError> =>
            A.match(input, {
                onEmpty: () => Effect.succeed(_emptyEmbeddingBatch),
                onNonEmpty: (values) =>
                    OpenAiClient.OpenAiClient.pipe(
                        Effect.flatMap((client) => client.createEmbedding({
                            dimensions: _ProviderCatalog.openai.embedding.dimensions,
                            input:      values as [string, ...string[]],
                            model:      _ProviderCatalog.openai.embedding.model,
                        })),
                        Effect.provide(_clientLayers.openai(credential)),
                        Effect.map(_mapOpenAiEmbedding),
                        Effect.filterOrFail(
                            (result) =>
                                result.embeddings.length === values.length
                                && result.embeddings.every((embedding) => embedding.length === _ProviderCatalog.openai.embedding.dimensions),
                            () => new Error(`OpenAI embedding shape mismatch: ${_ProviderCatalog.openai.embedding.model}`),
                        ),
                    ),
            }),
        countTokens: (credential: _Credential<'openai'>, settings: _GenerationSettings, input: string): Effect.Effect<number, Error | AiSdkError.AiError> =>
            Tokenizer.Tokenizer.pipe(
                Effect.flatMap((tokenizer) => tokenizer.tokenize(input)),
                Effect.map((tokens) => tokens.length),
                Effect.provide(_ProviderCatalog.openai.languageLayer(credential, settings)),
            ),
        languageLayer: (credential: _Credential<'openai'>, settings: _GenerationSettings) =>
            OpenAiLanguageModel.modelWithTokenizer(settings.model, {
                max_output_tokens: settings.maxOutputTokens,
                temperature:       settings.temperature,
                top_p:             settings.topP,
            }).pipe(Layer.provide(_clientLayers.openai(credential))),
        listModels: (credential: _Credential<'openai'>): Effect.Effect<ReadonlyArray<_LiveModel>, Error> =>
            _httpJson(
                HttpClientRequest.get('https://api.openai.com/v1/models').pipe(
                    HttpClientRequest.bearerToken(Redacted.value(credential.secret)),
                ),
                _OpenAiModelListSchema,
            ).pipe(
                Effect.map(({ data }) => data
                    .filter(({ id }) =>
                        _OPENAI_LANGUAGE_MODEL_PATTERNS.allow.some((pattern) => pattern.test(id))
                        && !_OPENAI_LANGUAGE_MODEL_PATTERNS.deny.some((pattern) => pattern.test(id)),
                    )
                    .map(({ id }) => ({ id, provider: 'openai' as const, title: id }))
                    .toSorted((left, right) => left.id.localeCompare(right.id))),
            ),
        validateSelection: (credential: _Credential<'openai'>, settings: _Settings<'openai'>): Effect.Effect<void, Error | AiSdkError.AiError> =>
            _ProviderCatalog.openai.listModels(credential).pipe(
                Effect.filterOrFail(
                    (available) => available.some((model) => model.id === settings.model),
                    () => new Error(`Unknown ${settings.provider} language model id: ${settings.model}`),
                ),
                Effect.asVoid,
                Effect.zipRight(LanguageModel.generateText({ prompt: 'Reply with ok.' }).pipe(
                    Effect.provide(_ProviderCatalog.openai.languageLayer(credential, { ...settings, maxOutputTokens: 1 })),
                    Effect.asVoid,
                )),
            ),
        requiresBrowser: false,
        requiresClientPath: false,
        secretEnvKey: 'AI_OPENAI_API_SECRET',
        supportsHeadlessEnrollment: true,
        title: 'OpenAI',
    },
} as const;
const _listLanguageModels = (provider: _Provider, credentials: _Credentials): Effect.Effect<ReadonlyArray<_LiveModel>, Error> =>
    provider === 'gemini'
        ? _ProviderCatalog.gemini.listModels(_credential(credentials, 'gemini'))
        : _ProviderCatalog.openai.listModels(_credential(credentials, 'openai'));
const _embedMany = (
    ref: _Embedding,
    credentials: _Credentials,
    usage: _EmbeddingUsage,
    input: ReadonlyArray<string>,
): Effect.Effect<_EmbeddingBatch, Error | AiSdkError.AiError> =>
    ref.provider === 'gemini'
        ? _ProviderCatalog.gemini.embedMany(_credential(credentials, 'gemini'), usage, input)
        : _ProviderCatalog.openai.embedMany(_credential(credentials, 'openai'), usage, input);
const _makeLanguageLayer = (settings: _GenerationSettings, credentials: _Credentials) =>
    settings.provider === 'gemini'
        ? _ProviderCatalog.gemini.languageLayer(_credential(credentials, 'gemini'), settings as _GenerationSettings<'gemini'>)
        : _ProviderCatalog.openai.languageLayer(_credential(credentials, 'openai'), settings as _GenerationSettings<'openai'>);
const _countTokens = (settings: _Settings, credentials: _Credentials, input: string): Effect.Effect<number, Error | AiSdkError.AiError> =>
    settings.provider === 'gemini'
        ? _ProviderCatalog.gemini.countTokens(_credential(credentials, 'gemini'), settings as _Settings<'gemini'>, input)
        : _ProviderCatalog.openai.countTokens(_credential(credentials, 'openai'), settings as _Settings<'openai'>, input);
const _validateSelection = (settings: _Settings, credentials: _Credentials): Effect.Effect<void, Error | AiSdkError.AiError> =>
    settings.provider === 'gemini'
        ? _ProviderCatalog.gemini.validateSelection(_credential(credentials, 'gemini'), settings as _Settings<'gemini'>)
        : _ProviderCatalog.openai.validateSelection(_credential(credentials, 'openai'), settings as _Settings<'openai'>);

// --- [OBJECTS] ---------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: merged with the exported namespace below.
const AiRegistry = {
    countTokens: _countTokens,
    decodeAppSettings: (raw: unknown) =>
        S.decodeUnknown(S.Struct({ ai: S.optional(S.Unknown) }))(raw).pipe(
            Effect.flatMap(({ ai }) => Option.fromNullable(ai).pipe(Option.match({
                onNone: () => Effect.fail(new Error('AI model not selected. Run `kargadan ai select --provider <provider> --model <model>`.')),
                onSome: (value) => S.decodeUnknown(AiSettingsSchema)(value, { errors: 'all', onExcessProperty: 'ignore' }),
            }))),
            Effect.map((settings) => ({
                ...settings,
                embedding: _ProviderCatalog[settings.provider].embedding,
                knowledge: _KNOWLEDGE_DEFAULTS,
                policy:    _POLICY_DEFAULTS,
            }) satisfies _Settings),
        ),
    embed: (ref: _Embedding, credentials: _Credentials, usage: _EmbeddingUsage, input: string): Effect.Effect<{ readonly embedding: readonly number[]; readonly usage: Response.Usage }, Error | AiSdkError.AiError> =>
        _embedMany(ref, credentials, usage, [input]).pipe(
            Effect.map((result) => ({
                embedding: result.embeddings[0] ?? [],
                usage:     result.usage,
            })),
        ),
    embedMany: _embedMany,
    languageLayer: _makeLanguageLayer,
    listLanguageModels: _listLanguageModels,
    OnTokenRefreshRef: _OnTokenRefreshRef,
    persistable: (settings: _Settings) => ({
        maxOutputTokens: settings.maxOutputTokens,
        model:           settings.model,
        provider:        settings.provider,
        temperature:     settings.temperature,
        topP:            settings.topP,
    }) satisfies _PersistedSettings,
    providers: _ProviderCatalog,
    validateCredential: (provider: _Provider, credential: _Credential) =>
        _listLanguageModels(provider, { [provider]: credential } as _Credentials).pipe(
            Effect.filterOrFail(
                (models) => models.length > 0,
                () => new Error(`No live language models returned for provider: ${provider}`),
            ),
            Effect.asVoid,
        ),
    validateSelection: _validateSelection,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type Credential<P extends Provider = Provider> = _Credential<P>;
    export type Credentials = _Credentials;
    export type EmbeddingUsage = _EmbeddingUsage;
    export type LiveModel = _LiveModel;
    export type OnTokenRefresh = _OnTokenRefresh;
    export type Provider = _Provider;
    export type Settings = _Settings;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
