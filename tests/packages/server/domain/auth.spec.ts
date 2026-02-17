/** Auth tests: service identity contract, stable key + default layer. */
import { it } from '@effect/vitest';
import { Auth } from '@parametric-portal/server/domain/auth';
import { Effect } from 'effect';
import { expect } from 'vitest';

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: service identity — stable key + default layer', () =>
    Effect.sync(() => {
        expect((Auth.Service as { readonly key: string }).key).toBe('server/Auth');
        expect(Auth.Service.Default).toBeDefined();
    }));
