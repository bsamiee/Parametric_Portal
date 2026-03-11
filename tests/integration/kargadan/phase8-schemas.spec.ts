import { it } from '@effect/vitest';
import { Effect, Either } from 'effect';
import { Schema as S } from 'effect';
import { Envelope, Loop } from '../../../apps/kargadan/harness/src/protocol/schemas';
import { expect } from 'vitest';

it.effect.prop(
    'P8-SCHEMA-RT-01: Envelope roundtrips through encode -> decode',
    { envelope: S.typeSchema(Envelope) },
    ({ envelope }) =>
        S.encode(Envelope)(envelope).pipe(
            Effect.flatMap(S.decodeUnknown(Envelope)),
            Effect.tap((decoded) => {
                expect(decoded).toStrictEqual(envelope);
            }),
            Effect.asVoid,
        ),
);

it('P8-SCHEMA-DECODE-01: rejects structurally invalid envelope', () => {
    const invalid = { _tag: 'nonsense', foo: 42 };
    const result = S.decodeUnknownEither(Envelope)(invalid);
    expect(Either.isLeft(result)).toBe(true);
});

it('P8-SCHEMA-DECODE-02: rejects envelope with missing identity fields', () => {
    const partial = { _tag: 'heartbeat', mode: 'ping' };
    const result = S.decodeUnknownEither(Envelope)(partial);
    expect(Either.isLeft(result)).toBe(true);
});

it.effect('P8-SCHEMA-STATE-01: Loop.state typed fields roundtrip', () => {
    const input = {
        attempt: 1, correctionCycles: 0, 
        lastCompaction: { estimatedTokensAfter: 1000, estimatedTokensBefore: 5000, mode: 'history_reset' as const, sequence: 3, targetTokens: 2000, triggerTokens: 4000 },operations: ['read.object.metadata'],
        sceneSummary: { activeLayer: { index: 0, name: 'Default' }, activeView: 'Perspective', layerCount: 1, objectCount: 3,
            objectCountsByType: { Brep: 2, Mesh: 1 }, tolerances: { absoluteTolerance: 0.001, angleToleranceRadians: 0.0175, unitSystem: 'Millimeters' },
            worldBoundingBox: { max: [10, 10, 10] as const, min: [0, 0, 0] as const } },
        sequence: 5, status: 'Planning' as const,
        verificationEvidence: { deterministicFailureClass: null, deterministicStatus: 'ok' as const, visualStatus: 'captured' as const },
        workflowExecution: { approved: true, commandId: 'write.object.create', executionId: 'wf-001' },
    };
    return S.encode(Loop.state)(input).pipe(
        Effect.flatMap(S.decodeUnknown(Loop.state)),
        Effect.tap((decoded) => {
            expect(decoded.lastCompaction?.mode).toBe('history_reset');
            expect(decoded.sceneSummary?.objectCount).toBe(3);
            expect(decoded.verificationEvidence?.visualStatus).toBe('captured');
            expect(decoded.workflowExecution?.approved).toBe(true);
            expect(decoded.workflowExecution?.executionId).toBe('wf-001');
        }),
    );
});
