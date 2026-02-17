/** field.ts tests: resolve round-trip, unknown-key annihilation, metadata assignments, sqlCast. */
import { it } from '@effect/vitest';
import { Field } from '@parametric-portal/database/field';
import { Effect, FastCheck as fc } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _WRAP_MAP = { casefold: ['email', 'namespace'] } as const;
const _GEN_MAP = { stored: ['createdAt', 'documentHash', 'searchVector', 'size'], uuidv7: ['id'], virtual: ['prefix', 'remaining'] } as const;
const _MARK_MAP = { exp: ['expiryRefresh', 'expiresAt'], soft: ['deletedAt', 'replayedAt'] } as const;
const _ALL_FIELDS = [
    'action', 'agent', 'appId', 'attempts', 'backedUp', 'backups', 'channel', 'completedAt', 'content', 'contentText', 'contextAgent', 'contextIp', 'contextRequestId', 'contextUserId',
    'correlation', 'counter', 'createdAt', 'credentialId', 'deletedAt', 'delivery', 'delta', 'deviceType', 'dimensions', 'displayText', 'documentHash', 'email', 'embedding',
    'enabledAt', 'encrypted', 'entityId', 'entityType', 'errorReason', 'errors', 'expiryAccess', 'expiryRefresh', 'expiresAt', 'externalId', 'hash', 'history', 'id',
    'ipAddress', 'jobId', 'key', 'value', 'lastUsedAt', 'metadata', 'model', 'name', 'namespace', 'provider', 'operation', 'output', 'payload', 'preferences', 'prefix', 'priority', 'publicKey',
    'recipient', 'remaining', 'replayedAt', 'requestId', 'resource', 'retryCurrent', 'retryMax', 'role', 'scheduledAt', 'scopeId', 'searchVector', 'sessionId', 'settings', 'size',
    'source', 'sourceId', 'status', 'storageRef', 'targetId', 'targetType', 'template', 'tokenAccess', 'tokenPayload', 'tokenRefresh', 'transports', 'type', 'updatedAt', 'userId', 'verifiedAt',
] as const;
const _SQL_TYPE_SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ['contextIp', 'INET'], ['ipAddress', 'INET'], ['correlation', 'JSONB'], ['metadata', 'JSONB'], ['payload', 'JSONB'], ['id', 'UUID'], ['appId', 'UUID'], ['userId', 'UUID'], ['sessionId', 'UUID'],
    ['createdAt', 'TIMESTAMPTZ'], ['updatedAt', 'TIMESTAMPTZ'], ['encrypted', 'BYTEA'], ['tokenPayload', 'BYTEA'], ['embedding', 'HALFVEC'], ['searchVector', 'TSVECTOR'], ['backups', 'TEXT[]'],
    ['transports', 'TEXT[]'], ['attempts', 'INTEGER'], ['counter', 'INTEGER'], ['backedUp', 'BOOLEAN'],
] as const;
const _fieldArb = fc.constantFrom(..._ALL_FIELDS);

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: resolve round-trip + divergent col names contain underscore', { field: _fieldArb }, ({ field }) =>
    Effect.sync(() => {
        const entry = Field.resolve(field);
        expect(entry).toBeDefined();
        expect(entry?.field).toBe(field);
        expect(Field.resolve(entry?.col ?? '')).toStrictEqual(entry);
        expect(entry?.col === entry?.field || entry?.col.includes('_')).toBe(true);
    }),
    { fastCheck: { numRuns: 200 } },
);
it.effect.prop('P2: unknown keys annihilate', { key: fc.string().filter((k) => Field.resolve(k) === undefined) }, ({ key }) =>
    Effect.sync(() => { expect(Field.resolve(key)).toBeUndefined(); }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: registry size + field identity', () =>
    Effect.sync(() => {
        const resolved = _ALL_FIELDS.map((f) => Field.resolve(f)).filter(Boolean);
        expect(resolved).toHaveLength(_ALL_FIELDS.length);
        // Sentinel: pinned registry count — update when fields are added/removed
        expect(_ALL_FIELDS).toHaveLength(86);
        expect(_ALL_FIELDS.map((f) => Field.resolve(f)?.field)).toEqual([..._ALL_FIELDS]);
    }),
);
it.effect('E2: gen/mark/wrap metadata assignments are exact', () =>
    Effect.sync(() => {
        const allGenFields = new Set<string>([..._GEN_MAP.stored, ..._GEN_MAP.uuidv7, ..._GEN_MAP.virtual]);
        const allMarkFields = new Set<string>([..._MARK_MAP.soft, ..._MARK_MAP.exp]);
        const casefoldSet = new Set<string>(_WRAP_MAP.casefold);
        expect(_GEN_MAP.stored.map((f) => Field.resolve(f)?.gen)).toEqual(_GEN_MAP.stored.map(() => 'stored'));
        expect(_GEN_MAP.uuidv7.map((f) => Field.resolve(f)?.gen)).toEqual(_GEN_MAP.uuidv7.map(() => 'uuidv7'));
        expect(_GEN_MAP.virtual.map((f) => Field.resolve(f)?.gen)).toEqual(_GEN_MAP.virtual.map(() => 'virtual'));
        expect(_ALL_FIELDS.filter((f) => !allGenFields.has(f)).map((f) => Field.resolve(f)?.gen).filter(Boolean)).toEqual([]);
        expect(_MARK_MAP.soft.map((f) => Field.resolve(f)?.mark)).toEqual(_MARK_MAP.soft.map(() => 'soft'));
        expect(_MARK_MAP.exp.map((f) => Field.resolve(f)?.mark)).toEqual(_MARK_MAP.exp.map(() => 'exp'));
        expect(_ALL_FIELDS.filter((f) => !allMarkFields.has(f)).map((f) => Field.resolve(f)?.mark).filter(Boolean)).toEqual([]);
        expect(_WRAP_MAP.casefold.map((f) => Field.resolve(f)?.wrap)).toEqual(_WRAP_MAP.casefold.map(() => 'casefold'));
        expect(_ALL_FIELDS.filter((f) => !casefoldSet.has(f)).map((f) => Field.resolve(f)?.wrap).filter(Boolean)).toEqual([]);
    }),
);
it.effect('E3: sql types + sqlCast + structural invariants', () =>
    Effect.sync(() => {
        expect(_SQL_TYPE_SAMPLES.map(([field, expected]) => [Field.resolve(field)?.sql, expected])).toEqual(_SQL_TYPE_SAMPLES.map(([, expected]) => [expected, expected]));
        expect(Field.sqlCast).toStrictEqual({ INET: 'inet', JSONB: 'jsonb', UUID: 'uuid' });
        expect(_ALL_FIELDS.map((f) => Field.resolve(f)?.sql.length).every((len) => (len ?? 0) > 0)).toBe(true);
        expect(_ALL_FIELDS.filter((f) => f !== 'id').map((f) => Field.resolve(f)?.gen).filter((g) => g === 'uuidv7')).toEqual([]);
    }),
);
