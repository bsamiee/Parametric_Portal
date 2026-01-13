/**
 * Audit logging with bounded concurrency and failure tracking.
 * Fail-open: errors logged, never propagate. Alerts after consecutive failures.
 */
import type { AppId, Asset, AuditLogInsert, UserId } from '@parametric-portal/types/schema';
import { Uuidv7 } from '@parametric-portal/types/types';
import { Effect, Option, pipe, Ref } from 'effect';
import { RequestContext } from './context.ts';
import { MetricsService } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type AuditRepo = { readonly log: (data: AuditLogInsert) => Effect.Effect<unknown, unknown, unknown> };
type AuditAssetTarget = { readonly actorId: UserId; readonly assets: Asset | readonly Asset[]; readonly operation: AuditLogInsert['operation'] };
type AuditLogTarget = AuditAssetTarget | AuditInput;
type AuditInput = {
    readonly actorId: UserId | null;
    readonly actorEmail?: string | null;
    readonly appId: AppId;
    readonly changes: Record<string, unknown> | null;
    readonly entityId: string;
    readonly entityType: AuditLogInsert['entityType'];
    readonly ipAddress?: string | null;
    readonly operation: AuditLogInsert['operation'];
    readonly userAgent?: string | null;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    batch: { concurrency: 10 },
    content: { maxLength: 10000 },
    failures: { threshold: 5 },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isValidEntityId = (id: string): boolean =>
    Uuidv7.is(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const truncateContent = (content: string): string =>
    content.length > B.content.maxLength ? `${content.slice(0, B.content.maxLength)}...[truncated]` : content;
const prepareAssetChanges = (asset: Asset, operation: AuditLogInsert['operation']): Record<string, unknown> | null =>
    operation === 'delete' ? null : { assetType: asset.assetType, contentLength: asset.content.length, contentPreview: truncateContent(asset.content) };
const normalizeAssets = (assets: Asset | readonly Asset[]): readonly Asset[] =>
    Array.isArray(assets) ? assets : [assets as Asset];

// --- [SERVICES] --------------------------------------------------------------

class AuditState extends Effect.Service<AuditState>()('server/AuditState', {
    effect: Effect.all([Ref.make(0), Ref.make(false)]).pipe(
        Effect.map(([consecutiveFailures, alertEmitted]) => ({ alertEmitted, consecutiveFailures })),
    ),
}) {}

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const resetFailureState = pipe(
    AuditState,
    Effect.flatMap(({ alertEmitted, consecutiveFailures }) =>
        Effect.all([Ref.set(consecutiveFailures, 0), Ref.set(alertEmitted, false)], { discard: true }),
    ),
);
const handleFailure = (error: unknown, input: AuditInput, requestId: string) =>
    pipe(
        AuditState,
        Effect.flatMap(({ alertEmitted, consecutiveFailures }) =>
            pipe(
                Ref.updateAndGet(consecutiveFailures, (n) => n + 1),
                Effect.flatMap((count) =>
                    pipe(
                        Ref.get(alertEmitted),
                        Effect.flatMap((alreadyAlerted) =>
                            count >= B.failures.threshold && !alreadyAlerted
                                ? pipe(
                                    Ref.set(alertEmitted, true),
                                    Effect.andThen(Effect.logError('AUDIT_FAILURE_ALERT', {
                                        consecutiveFailures: count,
                                        lastError: error instanceof Error ? error.message : String(error),
                                        message: `Audit logging has failed ${count} consecutive times`,
                                        requestId,
                                        threshold: B.failures.threshold,
                                    })),
                                )
                                : Effect.logError('AUDIT_FAILURE', {
                                    actorId: input.actorId, appId: input.appId, entityId: input.entityId,
                                    entityType: input.entityType, error: error instanceof Error ? error.message : String(error),
                                    operation: input.operation, requestId,
                                }),
                        ),
                    ),
                ),
            ),
        ),
    );
const logSingle = (repo: AuditRepo, input: AuditInput): Effect.Effect<void, never, AuditState | MetricsService> =>
    pipe(
        Effect.serviceOption(RequestContext),
        Effect.map(Option.getOrElse(() => ({appId: input.appId, ipAddress: null, requestId: 'system', sessionId: null, userAgent: null, userId: null,}))),
        Effect.flatMap((ctx) =>
            isValidEntityId(input.entityId)
                ? pipe(
                    repo.log({
                        actorId: input.actorId, appId: input.appId, changes: input.changes, entityId: input.entityId,
                        entityType: input.entityType, ipAddress: input.ipAddress ?? ctx.ipAddress,
                        operation: input.operation, userAgent: input.userAgent ?? ctx.userAgent,
                        ...(input.actorEmail != null && { actorEmail: input.actorEmail }),
                    } as AuditLogInsert) as Effect.Effect<unknown, unknown, never>,
                    Effect.tap(() => Effect.all([
                        resetFailureState,
                        MetricsService.track({ _tag: 'AuditWrite', entityType: input.entityType, operation: input.operation }),
                        Effect.logDebug('Audit log created', { entityId: input.entityId, operation: input.operation, requestId: ctx.requestId }),
                    ], { discard: true })),
                    Effect.tapError((e) => Effect.all([
                        MetricsService.track({ _tag: 'AuditFailure', entityType: input.entityType, operation: input.operation }),
                        handleFailure(e, input, ctx.requestId),
                    ], { discard: true })),
                )
                : Effect.all([
                    MetricsService.track({ _tag: 'AuditSkipped', entityType: input.entityType, operation: input.operation, reason: 'invalid_entity_id' }),
                    Effect.logWarning('Invalid entityId for audit', { entityId: input.entityId, operation: input.operation }),
                ], { discard: true }),
        ),
        Effect.catchAll(() => Effect.void),
    );
const logAssets = (
    repo: AuditRepo, assets: Asset | readonly Asset[], actorId: UserId,
    operation: AuditLogInsert['operation'], ): Effect.Effect<void, never, AuditState | MetricsService> =>
    pipe(
        Effect.sync(() => normalizeAssets(assets)),
        Effect.flatMap((items) =>
            items.length === 0
                ? Effect.void
                : pipe(
                    Effect.all(
                        items.map((asset) => logSingle(repo, {
                            actorId,
                            appId: asset.appId,
                            changes: prepareAssetChanges(asset, operation),
                            entityId: asset.id,
                            entityType: 'asset',
                            operation,
                        })),
                        { concurrency: B.batch.concurrency, discard: true },
                    ),
                    Effect.tap(() => Effect.logDebug('Audit batch complete', { count: items.length, operation })),
                    Effect.catchAll(() => Effect.void),
                ),
        ),
    );
const log = (repo: AuditRepo, target: AuditLogTarget): Effect.Effect<void, never, AuditState | MetricsService> =>
    'assets' in target
        ? logAssets(repo, target.assets, target.actorId, target.operation)
        : logSingle(repo, target);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Audit = Object.freeze({ log } as const);

// --- [EXPORT] ----------------------------------------------------------------

export { Audit, AuditState };
export type { AuditAssetTarget, AuditInput, AuditLogTarget, AuditRepo };
