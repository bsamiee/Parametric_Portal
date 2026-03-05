import { it } from '@effect/vitest';
import { Effect, Either } from 'effect';
import { Schema as S } from 'effect';
import { Envelope } from '../../../apps/kargadan/harness/src/protocol/schemas';
import { expect } from 'vitest';

it.effect.prop(
    'P8-SCHEMA-RT-01: Envelope roundtrips through encode -> decode',
    { envelope: S.typeSchema(Envelope) },
    ({ envelope }) =>
        S.encode(Envelope)(envelope).pipe(
            Effect.flatMap(S.decodeUnknown(Envelope)),
            Effect.tap((decoded) => {
                expect(decoded._tag).toBe(envelope._tag);
            }),
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
