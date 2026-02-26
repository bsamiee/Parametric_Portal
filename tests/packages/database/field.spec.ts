/** field.ts tests: resolve round-trip, unknown-key annihilation, metadata assignments, sqlCast. */
import { it } from '@effect/vitest';
import { Field } from '@parametric-portal/database/field';
import { AgentJournal } from '@parametric-portal/database/models';
import { Effect, FastCheck as fc } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _WRAP_MAP = { casefold: ['email', 'namespace'] } as const;
const _GEN_MAP = { stored: ['batchKey', 'createdAt', 'dedupeKey', 'documentHash', 'jobKey', 'searchVector', 'size'], uuidv7: ['id'], virtual: ['prefix', 'remaining'] } as const;
const _MARK_MAP = { exp: ['expiryRefresh', 'expiresAt'], soft: ['deletedAt', 'replayedAt'] } as const;
const _ALL_FIELDS = Object.keys(Field.entries) as ReadonlyArray<string>;
const _SQL_TYPE_SAMPLES: ReadonlyArray<readonly [string, string]> = [
    ['contextIp', 'INET'], ['ipAddress', 'INET'], ['correlation', 'JSONB'], ['metadata', 'JSONB'], ['payload', 'JSONB'], ['payloadJson', 'JSONB'], ['id', 'UUID'],
    ['appId', 'UUID'], ['userId', 'UUID'], ['sessionId', 'UUID'], ['createdAt', 'TIMESTAMPTZ'], ['updatedAt', 'TIMESTAMPTZ'], ['encrypted', 'BYTEA'],
    ['tokenPayload', 'BYTEA'], ['embedding', 'HALFVEC'], ['searchVector', 'TSVECTOR'], ['backups', 'TEXT[]'], ['transports', 'TEXT[]'], ['attempts', 'INTEGER'],
    ['counter', 'INTEGER'], ['backedUp', 'BOOLEAN'],
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

it.effect('E1: registry identity + AgentJournal field coverage', () =>
    Effect.sync(() => {
        expect(_ALL_FIELDS.length).toBeGreaterThan(0);
        expect(_ALL_FIELDS.map((field) => Field.resolve(field)?.field)).toEqual([..._ALL_FIELDS]);
        expect(Object.keys(AgentJournal.fields).every((field) => Field.resolve(field) !== undefined)).toBe(true);
        expect(Field.resolve('entryKind')?.col).toBe('entry_kind');
        expect(Field.resolve('payloadJson')?.col).toBe('payload_json');
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
