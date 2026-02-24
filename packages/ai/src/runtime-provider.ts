import {Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Duration, Effect, Layer, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
import { AiError } from './errors.ts';
import { AiRegistry } from './registry.ts';

// --- [TYPES] -----------------------------------------------------------------

type _Budget = { readonly dailyTokens: number; readonly rateCount: number };

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    budget: {
        dailyKeyPrefix: 'ai:budget:daily:',
        dailyTtl:       Duration.hours(24),
        rateKeyPrefix:  'ai:rate:',
        rateTtl:        Duration.minutes(1),
    },
    cache: { capacity: 256, storeId: 'ai:settings', ttlMinutes: 5 },
} as const;
const _TOKEN_FIELDS = [
    ['input', 'inputTokens'], ['output', 'outputTokens'], ['total', 'totalTokens'],
    ['reasoning', 'reasoningTokens'], ['cached', 'cachedInputTokens'],
] as const;

// --- [SCHEMA] ----------------------------------------------------------------

class AiSettingsKey extends S.TaggedRequest<AiSettingsKey>()('AiSettingsKey', {
    failure: S.Unknown,
    payload: { tenantId: S.String },
    success: AiRegistry.schema,
}) { [PrimaryKey.symbol]() { return `ai:settings:${this.tenantId}`; } }

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const budgets = yield* Ref.make(new Map<string, _Budget>());
        return {
            annotate: (_attributes: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.void,
            observeEmbedding: (_labels: Record<string, string>, _count: number) => Effect.void,
            observeError: (_operation: string, _labels: Record<string, string>, _error: unknown) => Effect.void,
            observeFallback: (_operation: string, _provider: string, _tenantId: string) => Effect.void,
            observePolicyDenied: (_operation: string, _tenantId: string) => Effect.void,
            observeRequest: (_operation: string, _labels: Record<string, string>) => Effect.void,
            observeTokens: (_labels: Record<string, string>, _usage: Response.Usage) => Effect.void,
            readBudget: (tenantId: string): Effect.Effect<_Budget, unknown, never> => Ref.get(budgets).pipe(Effect.map((entries) => entries.get(tenantId) ?? { dailyTokens: 0, rateCount: 0 })),
            resolveSettings: (_tenantId: string): Effect.Effect<AiRegistry.Settings, unknown, never> => AiRegistry.decodeAppSettings({}),
            resolveTenantId: Effect.succeed('system') as Effect.Effect<string, unknown, never>,
            trackEffect: <A, E, R>(_operation: string, _labels: Record<string, string>, effect: Effect.Effect<A, E, R>) => effect,
            trackStream: <A, E, R>(_operation: string, _labels: Record<string, string>, stream: Stream.Stream<A, E, R>) => stream,
            writeBudget: (tenantId: string, value: _Budget): Effect.Effect<void, unknown, never> => Ref.update(budgets, (entries) => new Map(entries).set(tenantId, value)),
        } as const;
    }),
}) {
    static readonly Server = Effect.gen(function* () {
        const [cache, database, metrics] = yield* Effect.all([CacheService, DatabaseService, MetricsService]);
        const mapSettingsError = AiError.from('ai.provider.settings');
        const settingsCache = yield* CacheService.cache({
            inMemoryCapacity: _CONFIG.cache.capacity,
            lookup: (key: AiSettingsKey) =>
                database.apps.one([{ field: 'id', value: key.tenantId }]).pipe(
                    Effect.flatMap(
                        Option.match({
                            onNone: () => Effect.fail(new AiError({ cause: { tenantId: key.tenantId }, operation: 'ai.provider.settings', reason: 'unknown' })),
                            onSome: Effect.succeed,
                        }),
                    ),
                    Effect.flatMap((app) => AiRegistry.decodeAppSettings(app.settings ?? {})),
                    Effect.mapError(mapSettingsError),
                ),
            storeId:    _CONFIG.cache.storeId,
            timeToLive: Duration.minutes(_CONFIG.cache.ttlMinutes),
        });
        const observe = {
            annotate: (attributes: AiTelemetry.GenAITelemetryAttributeOptions) =>
                Effect.currentSpan.pipe(
                    Effect.tap((span) => Effect.sync(() => AiTelemetry.addGenAIAnnotations(span, attributes))),
                    Effect.ignore,
                ),
            observeEmbedding: (labels: Record<string, string>, count: number) =>
                MetricsService.inc(metrics.ai.embeddings, MetricsService.label(labels), count),
            observeError: (operation: string, labels: Record<string, string>, error: unknown) =>
                MetricsService.trackError(metrics.ai.errors, MetricsService.label({ ...labels, operation }), error),
            observeFallback: (operation: string, provider: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.fallbacks, MetricsService.label({ operation, provider, tenant: tenantId })),
            observePolicyDenied: (operation: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.policyDenials, MetricsService.label({ operation, tenant: tenantId })),
            observeRequest: (_operation: string, labels: Record<string, string>) =>
                MetricsService.inc(metrics.ai.requests, MetricsService.label(labels), 1),
            observeTokens: (labels: Record<string, string>, usage: Response.Usage) =>
                Effect.forEach(
                    _TOKEN_FIELDS.flatMap(([kind, field]) => {
                        const value = usage[field];
                        return value == null ? [] : [[kind, value] as const];
                    }),
                    ([kind, tokens]) => MetricsService.inc(metrics.ai.tokens, MetricsService.label({ ...labels, kind }), tokens),
                    { discard: true },
                ),
        } as const;
        const budget = {
            readBudget: (tenantId: string) =>
                Effect.all([
                    cache.kv.get(`${_CONFIG.budget.dailyKeyPrefix}${tenantId}`, S.Number),
                    cache.kv.get(`${_CONFIG.budget.rateKeyPrefix}${tenantId}`,  S.Number),
                ]).pipe(
                    Effect.map(([dailyUsage, rateCount]) => ({
                        dailyTokens: Option.getOrElse(dailyUsage, () => 0),
                        rateCount:   Option.getOrElse(rateCount, () => 0),
                    })),
                    Effect.mapError(AiError.from('ai.provider.budget.read')),
                ),
            writeBudget: (tenantId: string, value: _Budget) =>
                Effect.all([
                    cache.kv.set(`${_CONFIG.budget.dailyKeyPrefix}${tenantId}`, value.dailyTokens, _CONFIG.budget.dailyTtl),
                    cache.kv.set(`${_CONFIG.budget.rateKeyPrefix}${tenantId}`, value.rateCount, _CONFIG.budget.rateTtl),
                ], { discard: true }).pipe(Effect.mapError(AiError.from('ai.provider.budget.write'))),
        } as const;
        const resolve = {
            resolveSettings: (tenantId: string) => settingsCache.get(new AiSettingsKey({ tenantId })).pipe(Effect.mapError(mapSettingsError)),
            resolveTenantId: Context.Request.currentTenantId as Effect.Effect<string, unknown, never>,
        } as const;
        const track = {
            trackEffect: <A, E, R>(operation: string, labels: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
                Effect.withSpan(
                    MetricsService.trackEffect(
                        effect,
                        {
                            duration: metrics.ai.duration,
                            errors:   metrics.ai.errors,
                            labels:   MetricsService.label(labels),
                        },
                    ),
                    operation,
                    { kind: 'client' },
                ),
            trackStream: <A, E, R>(operation: string, labels: Record<string, string>, stream: Stream.Stream<A, E, R>) =>
                Stream.withSpan(
                    MetricsService.trackStream(
                        Stream.tapError(stream, (error) => MetricsService.trackError(metrics.ai.errors, MetricsService.label(labels), error)),
                        metrics.stream.elements,
                        labels,
                    ),
                    operation,
                    { kind: 'client' },
                ),
        } as const;
        return Layer.succeed(AiRuntimeProvider, AiRuntimeProvider.make({ ...observe, ...budget, ...resolve, ...track }));
    }).pipe(Layer.unwrapEffect);
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntimeProvider };
