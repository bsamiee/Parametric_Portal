import {Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Duration, Effect, Layer, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
import { AiError } from './errors.ts';
import { AiRegistry } from './registry.ts';

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
        const budgets = yield* Ref.make(new Map<string, AiRuntimeProvider.Budget>());
        return {
            budget: {
                read: (tenantId: string): Effect.Effect<AiRuntimeProvider.Budget, unknown, never> =>
                    Ref.get(budgets).pipe(Effect.map((entries) => entries.get(tenantId) ?? { dailyTokens: 0, rateCount: 0 })),
                write: (tenantId: string, value: AiRuntimeProvider.Budget): Effect.Effect<void, unknown, never> =>
                    Ref.update(budgets, (entries) => new Map(entries).set(tenantId, value)),
            },
            observe: {
                annotate:       (_attributes: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.void,
                onEmbedding:    (_labels: Record<string, string>, _count: number) => Effect.void,
                onError:        (_operation: string, _labels: Record<string, string>, _error: unknown) => Effect.void,
                onFallback:     (_operation: string, _provider: string, _tenantId: string) => Effect.void,
                onPolicyDenied: (_operation: string, _tenantId: string) => Effect.void,
                onRequest:      (_operation: string, _labels: Record<string, string>) => Effect.void,
                onTokens:       (_labels: Record<string, string>, _usage: Response.Usage) => Effect.void,
            },
            resolve: {
                settings: (_tenantId: string): Effect.Effect<AiRuntimeProvider.Settings, unknown, never> => AiRegistry.decodeAppSettings({}),
                tenantId: Effect.succeed('system') as Effect.Effect<string, unknown, never>,
            },
            track: {
                effect: ((_operation: string, _labels: Record<string, string>, effect: Effect.Effect<unknown, unknown, unknown>) =>
                    effect) as AiRuntimeProvider.Track,
                stream: ((_operation: string, _labels: Record<string, string>, stream: Stream.Stream<unknown, unknown, unknown>) =>
                    stream) as AiRuntimeProvider.TrackStream,
            },
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
            onEmbedding: (labels: Record<string, string>, count: number) =>
                MetricsService.inc(metrics.ai.embeddings, MetricsService.label(labels), count),
            onError: (operation: string, labels: Record<string, string>, error: unknown) =>
                MetricsService.trackError(metrics.ai.errors, MetricsService.label({ ...labels, operation }), error),
            onFallback: (operation: string, provider: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.fallbacks, MetricsService.label({ operation, provider, tenant: tenantId })),
            onPolicyDenied: (operation: string, tenantId: string) =>
                MetricsService.inc(metrics.ai.policyDenials, MetricsService.label({ operation, tenant: tenantId })),
            onRequest: (_operation: string, labels: Record<string, string>) =>
                MetricsService.inc(metrics.ai.requests, MetricsService.label(labels), 1),
            onTokens: (labels: Record<string, string>, usage: Response.Usage) =>
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
            read: (tenantId: string) =>
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
            write: (tenantId: string, value: AiRuntimeProvider.Budget) =>
                Effect.all([
                    cache.kv.set(`${_CONFIG.budget.dailyKeyPrefix}${tenantId}`, value.dailyTokens, _CONFIG.budget.dailyTtl),
                    cache.kv.set(`${_CONFIG.budget.rateKeyPrefix}${tenantId}`, value.rateCount, _CONFIG.budget.rateTtl),
                ], { discard: true }).pipe(Effect.mapError(AiError.from('ai.provider.budget.write'))),
        } as const;
        const resolve = {
            settings: (tenantId: string) => settingsCache.get(new AiSettingsKey({ tenantId })).pipe(Effect.mapError(mapSettingsError)),
            tenantId: Context.Request.currentTenantId as Effect.Effect<string, unknown, never>,
        } as const;
        const track = {
            effect: ((operation: string, labels: Record<string, string>, effect: Effect.Effect<unknown, unknown, unknown>) =>
                MetricsService.trackEffect(
                    Resilience.run(operation, effect).pipe(Effect.provide(Resilience.Layer)),
                    {
                        duration: metrics.ai.duration,
                        errors:   metrics.ai.errors,
                        labels:   MetricsService.label(labels),
                    },
                )) as AiRuntimeProvider.Track,
            stream: ((operation: string, labels: Record<string, string>, stream: Stream.Stream<unknown, unknown, unknown>) =>
                Stream.withSpan(
                    MetricsService.trackStream(
                        Stream.tapError(stream, (error) => MetricsService.trackError(metrics.ai.errors, MetricsService.label(labels), error)),
                        metrics.stream.elements,
                        labels,
                    ),
                    operation,
                    { kind: 'client' },
                )) as AiRuntimeProvider.TrackStream,
        } as const;
        return Layer.succeed(AiRuntimeProvider, AiRuntimeProvider.make({ budget, observe, resolve, track }));
    }).pipe(Layer.unwrapEffect);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRuntimeProvider {
    export type Budget = { readonly dailyTokens: number; readonly rateCount: number };
    export type Settings = S.Schema.Type<typeof AiRegistry.schema>;
    export type Track = <A, E, R>(operation: string, labels: Record<string, string>, effect: Effect.Effect<A, E, R>,) => Effect.Effect<A, unknown, R>;
    export type TrackStream = <A, E, R>(operation: string, labels: Record<string, string>, stream: Stream.Stream<A, E, R>,) => Stream.Stream<A, E, R>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRuntimeProvider };
