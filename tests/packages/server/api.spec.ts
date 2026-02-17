/** Api tests: schema roundtrip, group structure, query defaults. */
import { it } from '@effect/vitest';
import { AuthResponse, ParametricApi, Query, TransferQuery } from '@parametric-portal/server/api';
import { Effect, FastCheck as fc, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _queryInput = fc.record({
    after:       fc.constant('2026-01-01T00:00:00.000Z'),
    before:      fc.constant('2026-01-02T00:00:00.000Z'),
    includeDiff: fc.constantFrom('true', 'false'),
    limit:       fc.integer({ max: 100, min: 1 }).map(String),
    operation:   fc.constantFrom('create', 'update', 'delete'),
});
const EXPECTED_GROUPS = [
    'admin', 'audit', 'auth', 'health', 'jobs', 'search', 'storage',
    'telemetry', 'transfer', 'users', 'webhooks', 'websocket',
] as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: Query roundtrip + defaults', { input: _queryInput }, ({ input }) =>
    Effect.gen(function* () {
        const decoded = yield* S.decodeUnknown(Query)(input);
        expect(typeof decoded.limit).toBe('number');
        expect(typeof decoded.includeDiff).toBe('boolean');
        expect(decoded.after).toBeInstanceOf(Date);
        expect(decoded.before).toBeInstanceOf(Date);
        const empty = yield* S.decodeUnknown(Query)({});
        expect(empty.limit).toBe(20);
        expect(empty.operation).toBeUndefined();
    }));
it.effect.prop('P2: TransferQuery defaults + typeSlug wrapping', {
    format: fc.constantFrom(undefined, 'csv', 'ndjson'),
    slug:   fc.constantFrom(undefined, 'doc', 'image'),
}, ({ format, slug }) =>
    Effect.gen(function* () {
        const input = { ...(format ? { format } : {}), ...(slug ? { typeSlug: slug } : {}) };
        const decoded = yield* S.decodeUnknown(TransferQuery)(input);
        expect(decoded.format).toBe(format ?? 'ndjson');
        expect(Option.isOption(decoded.dryRun)).toBe(true);
        expect(Option.isSome(decoded.typeSlug)).toBe(!!slug);
    }));
it.effect('P3: AuthResponse — valid decode + missing field rejection', () =>
    Effect.all([
        S.decodeUnknown(AuthResponse)({accessToken: 'tok', expiresAt: '2026-01-01T00:00:00.000Z', mfaPending: false,}).pipe(Effect.map((valid) => valid.accessToken)),
        S.decodeUnknown(AuthResponse)({ accessToken: 'tok' }).pipe(Effect.flip, Effect.map(String)),]).pipe(Effect.tap(([token, errorStr]) => {
        expect(token).toBe('tok');
        expect(errorStr).toContain('expiresAt');
    }), Effect.asVoid));
it.effect('P4: ParametricApi group keys are stable', () =>
    Effect.sync(() => {
        const groups = Object.keys(ParametricApi.groups).sort((a, b) => a.localeCompare(b));
        expect(groups).toEqual([...EXPECTED_GROUPS]);
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: Query rejects out-of-range limit + invalid expiresAt', () =>
    Effect.all([
        S.decodeUnknown(Query)({ limit: '0' }).pipe(Effect.flip, Effect.map(String)),
        S.decodeUnknown(Query)({ limit: '101' }).pipe(Effect.flip, Effect.map(String)),
        S.decodeUnknown(AuthResponse)({accessToken: 'tok', expiresAt: 'not-a-date', mfaPending: false,}).pipe(Effect.flip, Effect.map(String)),
    ]).pipe(Effect.tap(([low, high, dateErr]) => {
        expect(low).toContain('between');
        expect(high).toContain('between');
        expect(dateErr).toContain('expiresAt');
    }), Effect.asVoid));
it.effect('E2: group endpoint counts', () =>
    Effect.sync(() => {
        const groups = ParametricApi.groups as unknown as Record<string, { endpoints?: Record<string, unknown> }>;
        const count = (name: string) => Object.keys(groups[name]?.endpoints ?? {}).length;
        expect(count('auth')).toBeGreaterThanOrEqual(10);
        expect(count('admin')).toBeGreaterThanOrEqual(15);
        expect(count('storage')).toBeGreaterThanOrEqual(5);
        expect(count('webhooks')).toBeGreaterThanOrEqual(4);
    }));
