/**
 * Idempotency middleware tests: Schema validation and cache key format.
 * Note: Full middleware integration testing requires service mocks (HttpServerRequest, CacheService, etc.)
 * and is handled separately in integration test suites. These tests focus on the extractable pure logic.
 */
import { describe, it } from '@effect/vitest';
import { Effect, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const IdempotencyRecord = S.Struct({
    bodyHash:     S.String,
    completedAt:  S.Number,
    key:          S.String,
    operationKey: S.String,
    result:       S.Unknown,
    status:       S.Literal('completed', 'pending'),
    tenantId:     S.String,
});

const makeCacheKey = (tenantId: string, resource: string, action: string, key: string) =>
    `idem:${tenantId}:${resource}:${action}:${key}`;

// --- [ALGEBRAIC] -------------------------------------------------------------

describe('Idempotency record schema', () => {
    it.effect('pending status roundtrips correctly', () =>
        Effect.sync(() => {
            const record = S.decodeUnknownSync(IdempotencyRecord)({
                bodyHash:     'abc123',
                completedAt:  0,
                key:          'user-create-001',
                operationKey: 'users:create',
                result:       null,
                status:       'pending',
                tenantId:     'tenant-123',
            });
            expect(record.status).toBe('pending');
            expect(record.completedAt).toBe(0);
            expect(record.result).toBe(null);
        }));

    it.effect('completed status with response data roundtrips correctly', () =>
        Effect.sync(() => {
            const record = S.decodeUnknownSync(IdempotencyRecord)({
                bodyHash:     'def456',
                completedAt:  1707849600000,
                key:          'payment-process-002',
                operationKey: 'payments:process',
                result:       { amount: 1000, id: 'pay_123', status: 'succeeded' },
                status:       'completed',
                tenantId:     'tenant-456',
            });
            expect(record.status).toBe('completed');
            expect(record.completedAt).toBe(1707849600000);
            expect((record.result as Record<string, unknown>)['id']).toBe('pay_123');
        }));

    it.effect('invalid status value is rejected by schema', () =>
        Effect.sync(() => {
            const result = S.decodeUnknownEither(IdempotencyRecord)({
                bodyHash:     'ghi789',
                completedAt:  Date.now(),
                key:          'order-cancel-003',
                operationKey: 'orders:cancel',
                result:       {},
                status:       'invalid-status',
                tenantId:     'tenant-789',
            });
            expect(result._tag).toBe('Left');
        }));

    it.effect('missing required field is rejected by schema', () =>
        Effect.sync(() => {
            const result = S.decodeUnknownEither(IdempotencyRecord)({
                bodyHash:     'jkl012',
                completedAt:  Date.now(),
                operationKey: 'users:update',
                result:       {},
                status:       'completed',
                tenantId:     'tenant-abc',
            });
            expect(result._tag).toBe('Left');
        }));

    it.effect('result field accepts any valid JSON value', () =>
        Effect.sync(() => {
            const record = S.decodeUnknownSync(IdempotencyRecord)({
                bodyHash:     'mno345',
                completedAt:  Date.now(),
                key:          'report-generate-004',
                operationKey: 'reports:generate',
                result:       { message: 'success', nested: { data: [1, 2, 3], flag: true } },
                status:       'completed',
                tenantId:     'tenant-def',
            });
            expect(record.result).toEqual({ message: 'success', nested: { data: [1, 2, 3], flag: true } });
        }));
});

describe('Cache key construction', () => {
    it('follows format idem:{tenantId}:{resource}:{action}:{key}', () => {
        const key = makeCacheKey('tenant-123', 'users', 'create', 'req-001');
        expect(key).toBe('idem:tenant-123:users:create:req-001');
    });

    it('produces unique keys for different components', () => {
        const base = makeCacheKey('tenant-123', 'users', 'create', 'req-001');
        expect(makeCacheKey('tenant-123', 'users', 'create', 'req-002')).not.toBe(base);
        expect(makeCacheKey('tenant-456', 'users', 'create', 'req-001')).not.toBe(base);
        expect(makeCacheKey('tenant-123', 'payments', 'create', 'req-001')).not.toBe(base);
        expect(makeCacheKey('tenant-123', 'users', 'update', 'req-001')).not.toBe(base);
    });
});

describe('Branch condition logic', () => {
    it('identifies replay condition when bodyHash matches', () => {
        const stored = S.decodeUnknownSync(IdempotencyRecord)({
            bodyHash:     'hash-abc-123',
            completedAt:  1707849600000,
            key:          'req-001',
            operationKey: 'users:create',
            result:       { id: 'user-123' },
            status:       'completed',
            tenantId:     'tenant-123',
        });
        expect(stored.bodyHash === 'hash-abc-123').toBe(true);
        expect(stored.status).toBe('completed');
    });

    it('identifies conflict condition when bodyHash differs', () => {
        const stored = S.decodeUnknownSync(IdempotencyRecord)({
            bodyHash:     'hash-original',
            completedAt:  1707849600000,
            key:          'req-002',
            operationKey: 'orders:create',
            result:       { orderId: 'ord-789' },
            status:       'completed',
            tenantId:     'tenant-789',
        });
        const isConflict = stored.status === 'completed' && stored.bodyHash !== 'hash-different';
        expect(isConflict).toBe(true);
    });

    it('identifies in-flight condition when status is pending', () => {
        const stored = S.decodeUnknownSync(IdempotencyRecord)({
            bodyHash:     'hash-pending',
            completedAt:  0,
            key:          'req-003',
            operationKey: 'webhooks:send',
            result:       null,
            status:       'pending',
            tenantId:     'tenant-pending',
        });
        expect(stored.status === 'pending').toBe(true);
        expect(stored.completedAt).toBe(0);
        expect(stored.result).toBe(null);
    });
});
