/** HttpError tests: factory determinism, tag discrimination, mapTo preservation. */
import { it } from '@effect/vitest';
import { HttpError } from '@parametric-portal/server/errors';
import { Effect, FastCheck as fc } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const TAGS = ['Auth', 'Conflict', 'Forbidden', 'GatewayTimeout', 'Gone', 'Internal', 'NotFound', 'OAuth', 'RateLimit', 'ServiceUnavailable', 'Validation',] as const;
const _text = fc.string({ maxLength: 32, minLength: 1 });

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: factory _tag determinism + is() accepts variants', { text: _text }, ({ text }) =>
    Effect.sync(() => {
        const instances = [
            HttpError.Auth.of(text),
            HttpError.Conflict.of('r', text),
            HttpError.Forbidden.of(text),
            HttpError.GatewayTimeout.of('up', 100),
            HttpError.Gone.of('r', text),
            HttpError.Internal.of(text),
            HttpError.NotFound.of(text),
            HttpError.OAuth.of('gh', text),
            HttpError.RateLimit.of(1000),
            HttpError.ServiceUnavailable.of(text, 500),
            HttpError.Validation.of('f', text),
        ];
        expect(instances.map((error) => error._tag)).toEqual([...TAGS]);
        instances.forEach((error) => { expect(HttpError.is(error)).toBe(true); });
        expect(HttpError.is(new Error(text))).toBe(false);
        expect(HttpError.is(null)).toBe(false);
        expect(HttpError.is(text)).toBe(false);
    }));
it.effect.prop('P2: mapTo — preserves known errors, wraps unknown as Internal', { text: _text }, ({ text }) =>
    Effect.gen(function* () {
        const known = HttpError.Forbidden.of(text);
        const preserved = yield* Effect.fail(known).pipe(HttpError.mapTo('ignored'), Effect.flip);
        expect(preserved).toBe(known);
        const wrapped = yield* Effect.fail(text).pipe(HttpError.mapTo('wrapped'), Effect.flip);
        expect(wrapped._tag).toBe('Internal');
        expect(wrapped.message).toBe('Internal: wrapped');
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: message format contracts + cause propagation', () =>
    Effect.sync(() => {
        expect(HttpError.Auth.of('x').message).toBe('Auth: x');
        expect(HttpError.Conflict.of('user', 'dup').message).toBe('Conflict: user - dup');
        expect(HttpError.GatewayTimeout.of('search', 3000).message).toBe('GatewayTimeout: search after 3000ms');
        expect(HttpError.NotFound.of('user').message).toBe('NotFound: user');
        expect(HttpError.NotFound.of('user', 'u-1').message).toBe('NotFound: user/u-1');
        expect(HttpError.ServiceUnavailable.of('down', 1200).message).toBe('ServiceUnavailable: down, retry after 1200ms');
        expect(HttpError.Internal.of('panic', new Error('root')).cause).toBeInstanceOf(Error);
    }));
it.effect('E2: is() discriminates by _tag presence in catalog', () =>
    Effect.sync(() => {
        expect(HttpError.is({ _tag: 'Auth', details: 'x' })).toBe(true);
        expect(HttpError.is({ _tag: 'Nope', details: 'x' })).toBe(false);
    }));
