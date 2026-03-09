import { AiError as AiSdkError, Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { readFileSync } from 'node:fs';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Config, Data, Duration, Effect, FiberRef, Layer, Match, Option, PrimaryKey, Ref, Redacted, Schema as S, Stream } from 'effect';
import { identity } from 'effect/Function';
import { AiRegistry } from './registry.ts';

// --- [ERRORS] ----------------------------------------------------------------

class AiError extends Data.TaggedError('AiError')<{
    readonly cause:     unknown;
    readonly operation: string;
    readonly reason:    'budget_exceeded' | 'policy_denied' | 'rate_exceeded' | 'request_tokens_exceeded' | 'unknown';
}> {
    override get message() { return `AiError[${this.operation}/${this.reason}]: ${String(this.cause)}`; }
    static readonly from = (operation: string) => Match.type<unknown>().pipe(
        Match.withReturnType<AiSdkError.AiError | AiError>(),
        Match.when(AiSdkError.isAiError, identity),
        Match.when(Match.instanceOf(AiError), identity),
        Match.orElse((cause) => new AiError({ cause, operation, reason: 'unknown' })),
    );
}

// --- [CONSTANTS] -------------------------------------------------------------

const _EMPTY_BUDGET: { readonly dailyTokens: number; readonly rateCount: number } = { dailyTokens: 0, rateCount: 0 };
const _BudgetCacheKey = {
    daily: (tenantId: string) => `ai:budget:daily:${tenantId}`,
    rate:  (tenantId: string) => `ai:rate:${tenantId}`,
} as const;
const _resolveApiSecret = (provider: 'anthropic' | 'openai') =>
    Config.redacted(AiRegistry.providerVocabulary[provider].credential.key).pipe(
        Config.orElse(() => Config.redacted(AiRegistry.providerVocabulary[provider].credential.legacyKey)),
        Effect.map((secret) => ({ kind: 'api-secret' as const, secret })),
    );
const _resolveGeminiCredential = Effect.gen(function* () {
    const metadata = AiRegistry.providerVocabulary.gemini.credential;
    const [accessToken, clientPath, refreshToken, tokenExpiry] = yield* Effect.all([
        Config.redacted(metadata.accessTokenKey).pipe(Config.option),
        Config.string(metadata.clientPathKey),
        Config.redacted(metadata.refreshTokenKey).pipe(Config.option),
        Config.string(metadata.expiryKey).pipe(Config.option),
    ]);
    const client = yield* Effect.try({
        catch: (cause) => new AiError({ cause, operation: 'ai.provider.credentials.gemini.client', reason: 'unknown' }),
        try:   () => readFileSync(clientPath, 'utf8'),
    }).pipe(Effect.flatMap(AiRegistry.decodeGeminiClient), Effect.mapError(AiError.from('ai.provider.credentials.gemini.client')));
    const reusableAccessToken = Option.flatMap(accessToken, (token) =>
        tokenExpiry.pipe(Option.filter((value) => {
            const expiresAt = Date.parse(value);
            return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
        }), Option.as(token)));
    const resolvedAccessToken = yield* Option.match(reusableAccessToken, {
        onNone: () =>
            Option.match(refreshToken, {
                onNone: () => accessToken.pipe(Option.match({
                    onNone: () => Effect.fail(new AiError({
                        cause:     { clientPath, provider: 'gemini' },
                        operation: 'ai.provider.credentials.gemini',
                        reason:    'unknown',
                    })),
                    onSome: (token) => Option.match(tokenExpiry, {
                        onNone: () => Effect.succeed(token),
                        onSome: (value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60_000
                            ? Effect.fail(new AiError({
                                cause:     { clientPath, expired: value, provider: 'gemini', refreshTokenAvailable: false },
                                operation: 'ai.provider.credentials.gemini.expired',
                                reason:    'unknown',
                            }))
                            : Effect.succeed(token),
                    }),
                })),
                onSome: (token) => AiRegistry.refreshGeminiAccessToken({ client, refreshToken: Redacted.value(token) }).pipe(
                    Effect.map((next) => Redacted.make(next.accessToken)),
                    Effect.mapError(AiError.from('ai.provider.credentials.gemini.refresh')),
                ),
            }),
        onSome: Effect.succeed,
    });
    return { accessToken: resolvedAccessToken, kind: 'oauth-desktop' as const, projectId: client.projectId } satisfies AiRegistry.Credential<'gemini'>;
});
const _resolveCredential = (provider: AiRegistry.Provider) =>
    Match.value(provider).pipe(
        Match.when('anthropic', () => _resolveApiSecret('anthropic')),
        Match.when('gemini', () => _resolveGeminiCredential),
        Match.orElse(() => _resolveApiSecret('openai')),
    );
const _withOverride = (settings: AiRegistry.Settings, override: Option.Option<AiRegistry.SessionOverride>) =>
    Option.match(override, {
        onNone: () => settings,
        onSome: (o) => AiRegistry.applySessionOverride(settings, o),
    });

// --- [SCHEMA] ----------------------------------------------------------------

class SettingsKey extends S.TaggedRequest<SettingsKey>()('SettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) { [PrimaryKey.symbol]() { return `ai:settings:${this.tenantId}`; } }

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const budgets = yield* Ref.make(new Map<string, typeof _EMPTY_BUDGET>());
        const resolveAppSettings = (tenantId: string) =>
            Effect.serviceOption(DatabaseService).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => AiRegistry.decodeAppSettings({}),
                    onSome: (database) =>
                        database.apps.one([{ field: 'id', value: tenantId }]).pipe(
                            Effect.flatMap(Option.match({
                                onNone: () => AiRegistry.decodeAppSettings({}),
                                onSome: (app) => AiRegistry.decodeAppSettings(app.settings ?? {}),
                            })),
                        ),
                })),
            );
        return {
            annotate:            (_: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.void,
            observeEmbedding:    (_labels: Record<string, string>, _count: number) => Effect.void,
            observeError:        (_op: string, _labels: Record<string, string>, _err: unknown) => Effect.void,
            observeFallback:     (_op: string, _provider: string, _tenantId: string) => Effect.void,
            observePolicyDenied: (_op: string, _tenantId: string) => Effect.void,
            observeRequest:      (_op: string, _labels: Record<string, string>) => Effect.void,
            observeTokens:       (_labels: Record<string, string>, _usage: Response.Usage) => Effect.void,
            readBudget:          (tenantId: string) => Ref.get(budgets).pipe(Effect.map((m) => m.get(tenantId) ?? _EMPTY_BUDGET)),
            resolveCredential:   (provider: AiRegistry.Provider) => _resolveCredential(provider).pipe(Effect.mapError(AiError.from(`ai.provider.credentials.${provider}`))),
            resolveSettings:     (tenantId: string) =>
                Effect.all([resolveAppSettings(tenantId), FiberRef.get(AiRegistry.SessionOverrideRef)]).pipe(
                    Effect.map(([settings, override]) => _withOverride(settings, override)),
                    Effect.mapError(AiError.from('ai.provider.settings')),
                ),
            resolveTenantId:     Context.Request.currentTenantId.pipe(Effect.catchAll(() => Effect.succeed('system'))),
            trackEffect:         <A, E, R>(_op: string, _labels: Record<string, string>, e: Effect.Effect<A, E, R>) => e,
            trackStream:         <A, E, R>(_op: string, _labels: Record<string, string>, s: Stream.Stream<A, E, R>) => s,
            writeBudget:         (tenantId: string, budget: typeof _EMPTY_BUDGET) => Ref.update(budgets, (m) => new Map(m).set(tenantId, budget)),
        };
    }),
}) {
    static readonly Server = Effect.gen(function* () {
        const [cache, database, metrics] = yield* Effect.all([CacheService, DatabaseService, MetricsService]);
        const settingsCache = yield* CacheService.cache({
            inMemoryCapacity: 256,
            lookup:           (key: SettingsKey) =>
                database.apps.one([{ field: 'id', value: key.tenantId }]).pipe(
                    Effect.filterOrFail(Option.isSome, () => new AiError({ cause: { tenantId: key.tenantId }, operation: 'ai.provider.settings', reason: 'unknown' })),
                    Effect.flatMap((o) => AiRegistry.decodeAppSettings(o.value.settings ?? {})),
                    Effect.mapError(AiError.from('ai.provider.settings')),
                ),
            storeId:    'ai:settings',
            timeToLive: Duration.minutes(5),
        });
        return Layer.succeed(AiRuntimeProvider, AiRuntimeProvider.make({
            annotate:            (attrs) => Effect.currentSpan.pipe(Effect.tap((span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attrs))), Effect.ignore),
            observeEmbedding:    (labels, count) =>                 MetricsService.inc(metrics.ai.embeddings,    MetricsService.label(labels), count                            ),
            observeError:        (operation, labels, error) =>      MetricsService.trackError(metrics.ai.errors, MetricsService.label({ ...labels, operation }), error          ),
            observeFallback:     (operation, provider, tenantId) => MetricsService.inc(metrics.ai.fallbacks,     MetricsService.label({ operation, provider, tenant: tenantId })),
            observePolicyDenied: (operation, tenantId) =>           MetricsService.inc(metrics.ai.policyDenials, MetricsService.label({ operation, tenant: tenantId           })),
            observeRequest:      (_operation, labels) =>            MetricsService.inc(metrics.ai.requests,      MetricsService.label(labels), 1                                ),
            observeTokens:       (labels, usage) => {
                const entries = Object.entries({ cached: usage.cachedInputTokens, input: usage.inputTokens, output: usage.outputTokens, reasoning: usage.reasoningTokens, total: usage.totalTokens });
                const valid = entries.filter((e): e is [string, number] => e[1] != null);
                return Effect.forEach(valid, ([kind, tokens]) => MetricsService.inc(metrics.ai.tokens, MetricsService.label({ ...labels, kind }), tokens), { discard: true });
            },
            readBudget: (tenantId) =>
                Effect.all([cache.kv.get(_BudgetCacheKey.daily(tenantId), S.Number), cache.kv.get(_BudgetCacheKey.rate(tenantId), S.Number)]).pipe(
                    Effect.map(([d, r]) => ({ dailyTokens: Option.getOrElse(d, () => _EMPTY_BUDGET.dailyTokens), rateCount: Option.getOrElse(r, () => _EMPTY_BUDGET.rateCount) })),
                    Effect.catchAll(() => Effect.succeed(_EMPTY_BUDGET)),
                ),
            resolveCredential: (provider) => _resolveCredential(provider).pipe(Effect.mapError(AiError.from(`ai.provider.credentials.${provider}`))),
            resolveSettings: (tenantId) =>
                Effect.all([settingsCache.get(new SettingsKey({ tenantId })), FiberRef.get(AiRegistry.SessionOverrideRef)]).pipe(
                    Effect.map(([settings, override]) => Option.match(override, {
                        onNone: () => settings,
                        onSome: (o) => AiRegistry.applySessionOverride(settings, o),
                    })),
                ),
            resolveTenantId: Context.Request.currentTenantId.pipe(Effect.catchAll(() => Effect.succeed('system'))),
            trackEffect: (operation, labels, effect) =>
                Effect.withSpan(MetricsService.trackEffect(effect, { duration: metrics.ai.duration, errors: metrics.ai.errors, labels: MetricsService.label(labels) }), operation, { kind: 'client' }),
            trackStream: (operation, labels, stream) =>
                stream.pipe(
                    Stream.tapError((e) => MetricsService.trackError(metrics.ai.errors, MetricsService.label(labels), e)),
                    (s) => MetricsService.trackStream(s, metrics.stream.elements, labels),
                    Stream.withSpan(operation, { kind: 'client' }),
                ),
            writeBudget: (tenantId, budget) =>
                Effect.all([cache.kv.set(_BudgetCacheKey.daily(tenantId), budget.dailyTokens, Duration.hours(24)), cache.kv.set(_BudgetCacheKey.rate(tenantId), budget.rateCount, Duration.minutes(1))], { discard: true }).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.budget.write.cache_error', { error, tenantId })),
                ),
        }));
    }).pipe(Layer.unwrapEffect);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiError, AiRuntimeProvider };
