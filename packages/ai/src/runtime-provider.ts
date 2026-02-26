import { AiError as AiSdkError, Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Data, Duration, Effect, Layer, Match, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
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
type _Budget = typeof _EMPTY_BUDGET;

// --- [SCHEMA] ----------------------------------------------------------------

class SettingsKey extends S.TaggedRequest<SettingsKey>()('SettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) { [PrimaryKey.symbol]() { return `ai:settings:${this.tenantId}`; } }

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const budgets = yield* Ref.make(new Map<string, _Budget>());
        return {
            annotate:            (_: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.void,
            observeEmbedding:    (_labels: Record<string, string>, _count: number) => Effect.void,
            observeError:        (_op: string, _labels: Record<string, string>, _err: unknown) => Effect.void,
            observeFallback:     (_op: string, _provider: string, _tenantId: string) => Effect.void,
            observePolicyDenied: (_op: string, _tenantId: string) => Effect.void,
            observeRequest:      (_op: string, _labels: Record<string, string>) => Effect.void,
            observeTokens:       (_labels: Record<string, string>, _usage: Response.Usage) => Effect.void,
            readBudget:          (tenantId: string) => Ref.get(budgets).pipe(Effect.map((m) => m.get(tenantId) ?? _EMPTY_BUDGET)),
            resolveSettings:     (_tenantId: string) => AiRegistry.decodeAppSettings({}),
            resolveTenantId:     Effect.succeed('system'),
            trackEffect:         <A, E, R>(_op: string, _labels: Record<string, string>, e: Effect.Effect<A, E, R>) => e,
            trackStream:         <A, E, R>(_op: string, _labels: Record<string, string>, s: Stream.Stream<A, E, R>) => s,
            writeBudget:         (tenantId: string, budget: _Budget) => Ref.update(budgets, (m) => new Map(m).set(tenantId, budget)),
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
                Effect.all([cache.kv.get(`ai:budget:daily:${tenantId}`, S.Number), cache.kv.get(`ai:rate:${tenantId}`, S.Number)]).pipe(
                    Effect.map(([d, r]) => ({ dailyTokens: Option.getOrElse(d, () => _EMPTY_BUDGET.dailyTokens), rateCount: Option.getOrElse(r, () => _EMPTY_BUDGET.rateCount) })),
                    Effect.catchAll(() => Effect.succeed(_EMPTY_BUDGET)),
                ),
            resolveSettings: (tenantId) =>
                settingsCache.get(new SettingsKey({ tenantId })).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.provider.settings.resolve_error', { error, tenantId }).pipe(Effect.andThen(AiRegistry.decodeAppSettings({})))),
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
                Effect.all([cache.kv.set(`ai:budget:daily:${tenantId}`, budget.dailyTokens, Duration.hours(24)), cache.kv.set(`ai:rate:${tenantId}`, budget.rateCount, Duration.minutes(1))], { discard: true }).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.budget.write.cache_error', { error, tenantId })),
                ),
        }));
    }).pipe(Layer.unwrapEffect);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiError, AiRuntimeProvider };
