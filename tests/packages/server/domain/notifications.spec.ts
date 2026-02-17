/** Notification tests: request schema PBT, error algebra, preferences inverse. */
import { it } from '@effect/vitest';
import { NotificationService } from '@parametric-portal/server/domain/notifications';
import { Effect, Either, FastCheck as fc, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _channel  = fc.constantFrom('email' as const, 'inApp' as const, 'webhook' as const);
const _template = fc.string({ maxLength: 32, minLength: 1 }).map((s) => s.trim()).filter((s) => s.length > 0);
const _attempts = fc.integer({ max: 15, min: -5 });
const _reason   = fc.constantFrom('MissingRecipient' as const, 'PreferenceBlocked' as const);

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: maxAttempts [1..10] accepts, out-of-range rejects, omission defaults 5', { channel: _channel, maxAttempts: _attempts, template: _template }, ({ channel, maxAttempts, template }) => Effect.sync(() => {
    const withField = S.decodeUnknownEither(NotificationService.Request)({ channel, data: {}, maxAttempts, template });
    const without   = S.decodeUnknownEither(NotificationService.Request)({ channel, data: {}, template });
    const inBounds  = maxAttempts >= 1 && maxAttempts <= 10 && Number.isInteger(maxAttempts);
    expect(Either.isRight(withField)).toBe(inBounds);
    Either.map(withField, (r) => { expect(r.maxAttempts).toBe(maxAttempts); });
    expect(Either.isRight(without)).toBe(true);
    Either.map(without, (r) => { expect(r.maxAttempts).toBe(5); });
}), { fastCheck: { numRuns: 200 } });
it.effect.prop('P2: error discrimination + cause + catchTag', { msg: fc.string({ maxLength: 32 }), reason: _reason }, ({ msg, reason }) =>
    Effect.gen(function* () {
        const withCause    = NotificationService.Error.from(reason, new Error(msg));
        const withoutCause = NotificationService.Error.from(reason);
        expect(withCause._tag).toBe('NotificationError');
        expect(withCause.reason).toBe(reason);
        expect(String(withCause.cause)).toContain(msg);
        expect(withoutCause.cause).toBeUndefined();
        const caught = yield* Effect.fail(withCause).pipe(Effect.catchTag('NotificationError', (e) => Effect.succeed(e.reason)),);
        expect(caught).toBe(reason);
    }));
it.effect.prop('P3: preferences roundtrip decode(encode(x)) = x', { prefs: NotificationService.Preferences }, ({ prefs }) => {
    const hasProtoKey = Object.keys(prefs.templates).includes('__proto__');
    fc.pre(!hasProtoKey);
    return Effect.gen(function* () {
        const encoded = yield* S.encode(NotificationService.Preferences)(prefs);
        const decoded = yield* S.decodeUnknown(NotificationService.Preferences)(encoded);
        expect(decoded).toEqual(prefs);
    });
}, { fastCheck: { numRuns: 100 } });
it.effect.prop('P4: request roundtrip decode(encode(x)) = x', { request: NotificationService.Request }, ({ request }) =>
    Effect.gen(function* () {
        const encoded = yield* S.encode(NotificationService.Request)(request);
        const decoded = yield* S.decodeUnknown(NotificationService.Request)(encoded);
        expect(decoded).toEqual(request);
    }), { fastCheck: { numRuns: 150 } });

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: request + preferences reject invalid inputs, accept valid', () => Effect.all([
    S.decodeUnknown(NotificationService.Request)({ channel: 'sms',   data: {}, template: 'x' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Request)({ channel: 'email', data: {}, template: '' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Request)({ channel: 'email', data: {}, template: '  ' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Request)({ channel: 'email', data: {}, maxAttempts: 0,  template: 'x' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Request)({ channel: 'email', data: {}, maxAttempts: 11, template: 'x' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Request)({ channel: 'email', data: {}, template: 'x',   userId: 'not-a-uuid' }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Preferences)({}).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Preferences)({ channels: { email: 'yes' }, mutedUntil: null, templates: {} }).pipe(Effect.either, Effect.map(Either.isLeft)),
    S.decodeUnknown(NotificationService.Preferences)({ channels: { email: true,    inApp: true,      webhook: true }, mutedUntil: null, templates: {} }).pipe(Effect.either, Effect.map(Either.isRight)),
]).pipe(Effect.tap((r) => { expect(r).toStrictEqual([true, true, true, true, true, true, true, true, true]); }), Effect.asVoid));
