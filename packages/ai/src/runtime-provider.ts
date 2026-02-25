import { Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Array as A, Duration, Effect, Layer, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';

import { AiError } from './errors.ts';
import { AiRegistry } from './registry.ts';

// --- [SCHEMA] ----------------------------------------------------------------

class SettingsKey extends S.TaggedRequest<SettingsKey>()('SettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) { [PrimaryKey.symbol]() { return `ai:settings:${this.tenantId}`; } }

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const budgets = yield* Ref.make(new Map<string, { dailyTokens: number; rateCount: number }>());
        return {
            annotate:            (_: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.void,
            observeEmbedding:    (_labels: Record<string, string>, _count: number) => Effect.void,
            observeError:        (_op: string, _labels: Record<string, string>, _err: unknown) => Effect.void,
            observeFallback:     (_op: string, _provider: string, _tenantId: string) => Effect.void,
            observePolicyDenied: (_op: string, _tenantId: string) => Effect.void,
            observeRequest:      (_op: string, _labels: Record<string, string>) => Effect.void,
            observeTokens:       (_labels: Record<string, string>, _usage: Response.Usage) => Effect.void,
            readBudget:          (tenantId: string) => Ref.get(budgets).pipe(Effect.map((m) => m.get(tenantId) ?? { dailyTokens: 0, rateCount: 0 })),
            resolveSettings:     (_tenantId: string) => AiRegistry.decodeAppSettings({}),
            resolveTenantId:     Effect.succeed('system'),
            trackEffect:         <A, E, R>(_op: string, _labels: Record<string, string>, e: Effect.Effect<A, E, R>) => e,
            trackStream:         <A, E, R>(_op: string, _labels: Record<string, string>, s: Stream.Stream<A, E, R>) => s,
            writeBudget:         (tenantId: string, v: { dailyTokens: number; rateCount: number }) => Ref.update(budgets, (m) => new Map(m).set(tenantId, v)),
        };
    }),
}) {
    static readonly Server = Effect.gen(function* () {
        const [cache, database, metrics] = yield* Effect.all([CacheService, DatabaseService, MetricsService]);
        const L = MetricsService.label;
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
            annotate: (attrs: AiTelemetry.GenAITelemetryAttributeOptions) =>
                Effect.currentSpan.pipe(Effect.tap((span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attrs))), Effect.ignore),
            observeEmbedding: (labels: Record<string, string>, count: number) =>
                MetricsService.inc(metrics.ai.embeddings, L(labels), count),
            observeError: (operation: string, labels: Record<string, string>, error: unknown) =>
                MetricsService.trackError(metrics.ai.errors, L({ ...labels, operation }), error),
            observeFallback: (operation: string, provider: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.fallbacks, L({ operation, provider, tenant: tenantId })),
            observePolicyDenied: (operation: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.policyDenials, L({ operation, tenant: tenantId })),
            observeRequest: (_operation: string, labels: Record<string, string>) =>
                MetricsService.inc(metrics.ai.requests, L(labels), 1),
            observeTokens: (labels: Record<string, string>, usage: Response.Usage) =>
                Effect.forEach(
                    A.filterMap(
                        [['input', usage.inputTokens], ['output', usage.outputTokens], ['total', usage.totalTokens], ['reasoning', usage.reasoningTokens], ['cached', usage.cachedInputTokens]] as const,
                        ([kind, v]) => Option.fromNullable(v).pipe(Option.map((tokens) => [kind, tokens] as const)),
                    ),
                    ([kind, tokens]) => MetricsService.inc(metrics.ai.tokens, L({ ...labels, kind }), tokens),
                    { discard: true },
                ),
            readBudget: (tenantId: string) =>
                Effect.all([cache.kv.get(`ai:budget:daily:${tenantId}`, S.Number), cache.kv.get(`ai:rate:${tenantId}`, S.Number)]).pipe(
                    Effect.map(([d, r]) => ({ dailyTokens: Option.getOrElse(d, () => 0), rateCount: Option.getOrElse(r, () => 0) })),
                    Effect.catchAll(() => Effect.succeed({ dailyTokens: 0, rateCount: 0 })),
                ),
            resolveSettings: (tenantId: string) =>
                settingsCache.get(new SettingsKey({ tenantId })).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.provider.settings.resolve_error', { error, tenantId }).pipe(Effect.andThen(AiRegistry.decodeAppSettings({})))),
                ),
            resolveTenantId: Context.Request.currentTenantId.pipe(Effect.catchAll(() => Effect.succeed('system'))),
            trackEffect: <A, E, R>(operation: string, labels: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
                Effect.withSpan(MetricsService.trackEffect(effect, { duration: metrics.ai.duration, errors: metrics.ai.errors, labels: L(labels) }), operation, { kind: 'client' }),
            trackStream: <A, E, R>(operation: string, labels: Record<string, string>, stream: Stream.Stream<A, E, R>) =>
                Stream.withSpan(MetricsService.trackStream(Stream.tapError(stream, (e) => MetricsService.trackError(metrics.ai.errors, L(labels), e)), metrics.stream.elements, labels), operation, { kind: 'client' }),
            writeBudget: (tenantId: string, v: { dailyTokens: number; rateCount: number }) =>
                Effect.all([cache.kv.set(`ai:budget:daily:${tenantId}`, v.dailyTokens, Duration.hours(24)), cache.kv.set(`ai:rate:${tenantId}`, v.rateCount, Duration.minutes(1))], { discard: true }).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.budget.write.cache_error', { error, tenantId })),
                ),
        }));
    }).pipe(Layer.unwrapEffect);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntimeProvider };
