/** Transfer tests: service identity, TransferQuery schema roundtrip + boundary PBT. */
import { it } from '@effect/vitest';
import { assertNone } from '@effect/vitest/utils';
import { TransferQuery } from '@parametric-portal/server/api';
import { TransferService } from '@parametric-portal/server/domain/transfer';
import { Effect, Either, FastCheck as fc, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _limit = fc.integer({ max: 200, min: -10 });

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: service identity — stable key + default layer', () =>
    Effect.sync(() => {
        expect((TransferService as { readonly key: string }).key).toBe('server/Transfer');
        expect(TransferService.Default).toBeDefined();
    }));
it.effect.prop('P2: TransferQuery roundtrip decode(encode(x)) = x', { query: TransferQuery }, ({ query }) =>
    Effect.gen(function* () {
        const encoded = yield* S.encode(TransferQuery)(query);
        const decoded = yield* S.decodeUnknown(TransferQuery)(encoded);
        expect(decoded.format).toBe(query.format);
        expect(decoded.limit).toBe(query.limit);
    }), { fastCheck: { numRuns: 100 } });
it.effect('P3: TransferQuery defaults — empty input yields canonical values', () =>
    Effect.sync(() => {
        const decoded = S.decodeSync(TransferQuery)({});
        expect(decoded.format).toBe('ndjson');
        expect(decoded.limit).toBe(20);
        assertNone(decoded.dryRun);
        assertNone(decoded.typeSlug);
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect.prop('E1: TransferQuery limit boundary [1..100] valid, else invalid', { limit: _limit }, ({ limit }) =>
    Effect.sync(() => {
        const result = S.decodeUnknownEither(TransferQuery)({ limit: String(limit) });
        const inBounds = limit >= 1 && limit <= 100;
        expect(Either.isRight(result)).toBe(inBounds);
    }), { fastCheck: { numRuns: 200 } });
