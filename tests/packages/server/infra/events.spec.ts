/** EventBus model tests: eventId schema, eventType inference, error classification, envelope codec. */
import { it } from '@effect/vitest';
import { EventBus } from '@parametric-portal/server/infra/events';
import { DateTime, Effect, FastCheck as fc, PrimaryKey, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const { Envelope, Error: Err, Event } = EventBus.Model;
const _reason =    fc.constantFrom<typeof Err.prototype.reason>('DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'ValidationFailed');
const _digit =     fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');
const _validId =   fc.array(_digit, { maxLength: 19, minLength: 18 }).map((a) => a.join(''));
const _tag =       fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 8, minLength: 1 }).map((a) => a.join(''));
const _action =    fc.array(fc.constantFrom('x', 'y', 'z'), { maxLength: 6, minLength: 1 }).map((a) => a.join(''));
const _timestamp = fc.integer({ max: 1893456000000, min: 1704067200000 });
const _decodeId =  S.decodeSync(Event.fields.eventId);
const _mkEvent =   (payload: unknown) => new Event({ aggregateId: 'agg-1', eventId: _decodeId('123456789012345678'), payload, tenantId: 'tenant-1' });

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: eventId roundtrip + eventType resolution + PrimaryKey identity -- three schema-derived properties in one pass.
it.effect.prop('P1: eventId roundtrips + eventType resolves tag.action + PrimaryKey', { action: _action, id: _validId, tag: _tag }, ({ id, tag, action }) =>
    Effect.sync(() => {
        expect(_decodeId(id)).toBe(id);
        const event = _mkEvent({ _tag: tag, action });
        expect(event.eventType).toBe(`${tag}.${action}`);
        expect(PrimaryKey.value(event)).toBe(event.eventId);
    }),
);
// Why: Error classification complement law -- retryable XOR terminal, DeliveryFailed uniquely retryable.
it.effect.prop('P2: error retryable XOR terminal, DeliveryFailed uniquely retryable', { reason: _reason }, ({ reason }) =>
    Effect.sync(() => {
        const error = Err.from('evt-1', reason, new Error('test'));
        expect(error.isRetryable).toBe(!error.isTerminal);
        expect(error.isRetryable).toBe(reason === 'DeliveryFailed');
        expect(error._tag).toBe('EventError');
        expect(error.reason).toBe(reason);
    }),
);
// Why: Envelope schema roundtrip -- encode then decode preserves identity (inverse law).
it.effect.prop('P3: envelope encode/decode roundtrip', { id: _validId, ms: _timestamp, tag: _tag }, ({ id, ms, tag }) =>
    Effect.gen(function* () {
        const event = new Event({ aggregateId: 'agg-1', eventId: _decodeId(id), payload: { _tag: tag, action: 'create' }, tenantId: 'tenant-1' });
        const envelope = new Envelope({ emittedAt: DateTime.unsafeMake(ms), event });
        const encoded = yield* S.encode(Envelope)(envelope);
        const decoded = yield* S.decodeUnknown(Envelope)(encoded);
        expect(decoded.event.eventId).toBe(envelope.event.eventId);
        expect(decoded.event.aggregateId).toBe(envelope.event.aggregateId);
        expect(decoded.event.eventType).toBe(envelope.event.eventType);
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: eventId boundary rejection + eventType unknown for unstructured + schemaVersion default + error without cause.
it.effect('E1: boundary rejection + defaults + error without cause', () =>
    Effect.sync(() => {
        const decode = S.decodeEither(Event.fields.eventId);
        expect(['12345678901234567', '12345678901234567890', 'abcdefghijklmnopqr', ''].map((s) => decode(s)._tag)).toEqual(['Left', 'Left', 'Left', 'Left']);
        expect([null, [1, 2], { _tag: 'job' }, { action: 'login' }, {}, { _tag: 123, action: 'login' }].map((p) => _mkEvent(p).eventType)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
        const event = _mkEvent({ _tag: 'auth', action: 'login' });
        expect(event.schemaVersion).toBe(1);
        const envelope = new Envelope({ emittedAt: DateTime.unsafeMake(1735689600000), event });
        expect(envelope.event.eventType).toBe('auth.login');
        expect(String(envelope.emittedAt)).toContain('2025');
        const errorNoCause = Err.from('evt-2', 'ValidationFailed');
        expect(errorNoCause.cause).toBeUndefined();
        expect(errorNoCause.isTerminal).toBe(true);
    }),
);
