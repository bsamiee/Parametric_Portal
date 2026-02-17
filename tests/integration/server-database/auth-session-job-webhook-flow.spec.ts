/** Auth-session-job-webhook flow integration tests: cross-service schema compatibility
 * and service tag structural contracts between Auth, JobService, EventBus, WebhookService.
 * Oracle: schema decode/encode roundtrips — structural truths independent of implementation. */
import { it } from '@effect/vitest';
import { EventBus } from '@parametric-portal/server/infra/events';
import { JobService } from '@parametric-portal/server/infra/jobs';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { Effect, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const TENANT_ID = '00000000-0000-7000-8000-000000000010' as const;
const SNOWFLAKE_ID = '123456789012345678' as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: EventBus.Model.Event eventType derives from payload _tag + action', () =>
    Effect.sync(() => {
        const event = new EventBus.Model.Event({
            aggregateId: 'agg-1',
            eventId: S.decodeSync(EventBus.Model.Event.fields.eventId)(SNOWFLAKE_ID),
            payload: { _tag: 'job', action: 'status', status: 'complete' },
            tenantId: TENANT_ID,
        });
        expect(event.eventType).toBe('job.status');
    }));
it.effect('P2: EventBus eventId stays compatible with WebhookPayload id field', () =>
    Effect.sync(() => {
        const eventId = S.decodeSync(EventBus.Model.Event.fields.eventId)(SNOWFLAKE_ID);
        const event = new EventBus.Model.Event({
            aggregateId: 'agg-1',
            eventId,
            payload: { _tag: 'notification', action: 'send' },
            tenantId: TENANT_ID,
        });
        const payload = new WebhookService.Payload({
            data: { eventId: event.eventId },
            id: event.eventId,
            timestamp: 1735689600000,
            type: event.eventType,
        });
        expect(payload.id).toBe(event.eventId);
        expect(payload.type).toBe('notification.send');
    }));
it.effect('P3: WebhookPayload schema roundtrip preserves shape', () =>
    S.decode(WebhookService.Payload)({
        data: { test: true },
        id: SNOWFLAKE_ID,
        timestamp: 1735689600000,
        type: 'webhook.test',
    }).pipe(
        Effect.tap((decoded) => {
            expect(decoded.id).toBe(SNOWFLAKE_ID);
            expect(decoded.type).toBe('webhook.test');
            expect(decoded.schemaVersion).toBe(1);
        }),
        Effect.asVoid));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: service tags have expected identifiers', () =>
    Effect.sync(() => {
        expect((JobService as { readonly key: string }).key).toBe('server/Jobs');
        expect((EventBus as { readonly key: string }).key).toBe('server/EventBus');
        expect((WebhookService as { readonly key: string }).key).toBe('server/Webhooks');
    }));
it.effect('E2: EventBus.Model.Event with no payload tag yields unknown eventType', () =>
    Effect.sync(() => {
        const event = new EventBus.Model.Event({
            aggregateId: 'agg-2',
            eventId: S.decodeSync(EventBus.Model.Event.fields.eventId)(SNOWFLAKE_ID),
            payload: { data: 'no-tag' },
            tenantId: TENANT_ID,
        });
        expect(event.eventType).toBe('unknown');
    }));
it.effect('E3: JobService error reasons expose retryable + terminal via instance getters', () =>
    Effect.sync(() => {
        const reasons = ['AlreadyCancelled', 'HandlerMissing', 'MaxRetries', 'NotFound', 'Processing', 'RunnerUnavailable', 'Timeout', 'Validation'] as const;
        const errors = reasons.map((reason) => new JobService.Error({ reason }));
        expect(errors.every((e) => typeof e.isRetryable === 'boolean' && typeof e.isTerminal === 'boolean')).toBe(true);
        expect(errors.map((e) => e.reason).sort((a, b) => a.localeCompare(b))).toEqual([...reasons]);
    }));
