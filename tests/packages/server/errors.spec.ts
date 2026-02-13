import { it } from '@effect/vitest';
import { HttpError } from '@parametric-portal/server/errors';
import { Effect } from 'effect';
import { expect } from 'vitest';

// --- [TESTS] -----------------------------------------------------------------

it.effect('mapTo wraps unknown error in Internal with label and cause', () =>
    Effect.gen(function* () {
        const cause = new Error('boom');
        const result = yield* Effect.fail(cause).pipe(HttpError.mapTo('db failed'), Effect.flip);
        expect(result._tag).toBe('Internal');
        expect((result as HttpError.Internal).details).toBe('db failed');
        expect((result as HttpError.Internal).cause).toBe(cause);
    }));

it.effect('mapTo passes through existing HttpError.NotFound unchanged', () =>
    Effect.gen(function* () {
        const original = HttpError.NotFound.of('user', '123');
        const result = yield* Effect.fail(original).pipe(HttpError.mapTo('should not wrap'), Effect.flip);
        expect(result).toBe(original);
        expect(result._tag).toBe('NotFound');
    }));

it.effect('mapTo passes through existing HttpError.Internal unchanged', () =>
    Effect.gen(function* () {
        const original = HttpError.Internal.of('original label');
        const result = yield* Effect.fail(original).pipe(HttpError.mapTo('different label'), Effect.flip);
        expect(result).toBe(original);
        expect((result as HttpError.Internal).details).toBe('original label');
    }));
