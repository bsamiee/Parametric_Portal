/** Middleware tests: class shape, resource accessor contracts, static members. */
import { it } from '@effect/vitest';
import { Middleware } from '@parametric-portal/server/middleware';
import { PolicyService } from '@parametric-portal/server/security/policy';
import { Effect, FastCheck as fc } from 'effect';
import { expect } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type Resource = keyof typeof PolicyService.Catalog;

// --- [CONSTANTS] -------------------------------------------------------------

const _resource = fc.constantFrom<Resource>(...Object.keys(PolicyService.Catalog) as Array<Resource>);
const STATICS = ['permission', 'feature', 'guarded', 'resource', 'pipeline', 'layer'] as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: resource() returns api/mutation/realtime — all are functions', {
    resource: _resource,
}, ({ resource }) =>
    Effect.sync(() => {
        const accessor = Middleware.resource(resource);
        expect(typeof accessor.api).toBe('function');
        expect(typeof accessor.mutation).toBe('function');
        expect(typeof accessor.realtime).toBe('function');
    }));
it.effect('P2: Middleware static members are all functions', () =>
    Effect.sync(() => {STATICS.forEach((name) => { expect(typeof Middleware[name]).toBe('function'); });}));
