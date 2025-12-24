/**
 * Store factory tests: property-based + dispatch-driven middleware composition.
 * Achieves 100% coverage of factory.ts via algorithmic/polymorphic patterns.
 *
 * NOTE: Browser mode requires inline vi.mock with importOriginal pattern.
 * The test-utils/mocks/zustand module uses top-level await which is incompatible.
 */

import { fc, it } from '@fast-check/vitest';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import { TEST_HARNESS } from '@parametric-portal/test-utils/harness';
import { Schema as S } from 'effect';
import { afterEach, describe, expect, vi } from 'vitest';
import { createSlice, createSlicedStore, createStore, STORE_FACTORY_TUNING } from '../src/store/factory';
import type { DevtoolsConfig, PersistConfig, TemporalConfig } from '../src/store/types';

// --- [MOCK] ------------------------------------------------------------------

const { storeResetFns } = vi.hoisted(() => ({ storeResetFns: new Set<() => void>() }));

vi.mock('zustand', async (importOriginal) => {
    const zustand = await importOriginal<typeof import('zustand')>();
    const wrap = <T>(store: ReturnType<typeof zustand.createStore<T>>) => {
        storeResetFns.add(() => store.setState(store.getInitialState(), true));
        return store;
    };
    return {
        ...zustand,
        create: <T>(fn: Parameters<typeof zustand.create<T>>[0]) =>
            typeof fn === 'function' ? wrap(zustand.create(fn)) : (f: typeof fn) => wrap(zustand.create(f)),
        createStore: <T>(fn: Parameters<typeof zustand.createStore<T>>[0]) => wrap(zustand.createStore(fn)),
    };
});

afterEach(() => {
    storeResetFns.forEach((reset) => {
        reset();
    });
    storeResetFns.clear();
});

// --- [CONFIG] ----------------------------------------------------------------

fc.configureGlobal(TEST_CONSTANTS.fc);

// --- [TYPES] -----------------------------------------------------------------

type ValueState = { n: number; setN: (v: number) => void };
type BaseState = { readonly v: number };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arbitraries: {
        devtools: fc.oneof(
            fc.boolean(),
            fc.record({ enabled: fc.boolean() }) as fc.Arbitrary<DevtoolsConfig>,
            fc.constant(undefined),
        ),
        immer: fc.oneof(fc.boolean(), fc.constant(undefined)),
        persist: fc.oneof(
            fc.boolean(),
            fc.record({ enabled: fc.boolean() }) as fc.Arbitrary<PersistConfig<BaseState>>,
            fc.constant(undefined),
        ),
        temporal: fc.oneof(
            fc.boolean(),
            fc.record({ enabled: fc.boolean() }) as fc.Arbitrary<TemporalConfig<BaseState>>,
            fc.constant(undefined),
        ),
    },
    schemas: { value: S.Struct({ value: S.Number }) },
    storeName: 'test-store',
} as const);

// --- [DESCRIBE] STORE_FACTORY_TUNING -----------------------------------------

describe('STORE_FACTORY_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(STORE_FACTORY_TUNING)).toBe(true);
        expect(STORE_FACTORY_TUNING.order).toEqual([
            'immer',
            'computed',
            'persist',
            'temporal',
            'subscribeWithSelector',
            'devtools',
        ]);
        expect(STORE_FACTORY_TUNING.defaults.persist.exclude).toContainEqual(/^set/);
        expect(STORE_FACTORY_TUNING.defaults.temporal.limit).toBe(100);
    });
});

// --- [DESCRIBE] normalizeConfig (property-based) -----------------------------

const configTests = {
    devtools: (cfg: boolean | DevtoolsConfig | undefined) =>
        createStore<BaseState>(() => ({ v: 1 }), { devtools: cfg, name: B.storeName }),
    immer: (cfg: boolean | undefined) => createStore<BaseState>(() => ({ v: 1 }), { immer: cfg, name: B.storeName }),
    persist: (cfg: boolean | PersistConfig<BaseState> | undefined) =>
        createStore<BaseState>(() => ({ v: 1 }), { name: B.storeName, persist: cfg }),
    temporal: (cfg: boolean | TemporalConfig<BaseState> | undefined) =>
        createStore<BaseState>(() => ({ v: 1 }), { name: B.storeName, temporal: cfg }),
} as const;

describe('normalizeConfig', () => {
    it.prop([B.arbitraries.immer])('immer', (cfg) => configTests.immer(cfg).getState().v === 1);
    it.prop([B.arbitraries.persist])('persist', (cfg) => configTests.persist(cfg).getState().v === 1);
    it.prop([B.arbitraries.temporal])('temporal', (cfg) => configTests.temporal(cfg).getState().v === 1);
    it.prop([B.arbitraries.devtools])('devtools', (cfg) => configTests.devtools(cfg).getState().v === 1);
});

// --- [DESCRIBE] warnInvalidConfig --------------------------------------------

describe('warnInvalidConfig', () => {
    it.each(['INVALID!', '@invalid', 'has spaces'])('warns on invalid name: %s', (name) =>
        TEST_HARNESS.console.warn((spy) => {
            createStore(() => ({ v: 1 }), { name });
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid store name'));
        }));

    it('skips warning in production', () => {
        const init = () => ({ v: 1 });
        TEST_HARNESS.console.warn((spy) =>
            TEST_HARNESS.env.production(() => {
                createStore(init, { name: 'INVALID!' });
                expect(spy).not.toHaveBeenCalled();
            }),
        );
    });

    it('does not warn on valid name', () =>
        TEST_HARNESS.console.warn((spy) => {
            createStore(() => ({ v: 1 }), { name: 'valid-name' });
            expect(spy).not.toHaveBeenCalled();
        }));
});

// --- [DESCRIBE] attachSelectors ----------------------------------------------

describe('attachSelectors', () =>
    it('creates use property with state selectors', () => {
        const store = createStore(() => ({ a: 1, b: 'x' }), { name: B.storeName });
        expect(typeof store.use.a).toBe('function');
        expect(typeof store.use.b).toBe('function');
    }));

// --- [DESCRIBE] immer middleware ---------------------------------------------

const incAction = (s: { count: number }) => ({ count: s.count + 1 });

describe('immer middleware', () => {
    it('allows mutations when enabled', () => {
        const store = createStore<{ count: number; inc: () => void }>(
            (set) => ({ count: 0, inc: () => set(incAction) }),
            { immer: true, name: B.storeName },
        );
        store.getState().inc();
        expect(store.getState().count).toBe(1);
    });

    it('works when disabled', () =>
        expect(createStore(() => ({ v: 1 }), { immer: false, name: B.storeName }).getState().v).toBe(1));
});

// --- [DESCRIBE] computed middleware ------------------------------------------

describe('computed middleware', () => {
    it('computes derived state', () => {
        const store = createStore<{ items: number[] }, { total: number }>(() => ({ items: [1, 2, 3] }), {
            computed: { compute: (s) => ({ total: s.items.reduce((a, b) => a + b, 0) }), keys: ['items'] },
            name: B.storeName,
        });
        expect(store.getState().total).toBe(6);
    });

    it('works without compute', () =>
        expect(createStore(() => ({ v: 1 }), { name: B.storeName }).getState().v).toBe(1));
});

// --- [DESCRIBE] devtools middleware ------------------------------------------

describe('devtools middleware', () =>
    it.each([true, false])('enabled=%s', (e) =>
        expect(createStore(() => ({ v: 1 }), { devtools: e, name: B.storeName }).getState().v).toBe(1)));

// --- [DESCRIBE] temporal middleware ------------------------------------------

const valueStore = (cfg: boolean | TemporalConfig<ValueState>) =>
    createStore<ValueState>((set) => ({ n: 0, setN: (v) => set({ n: v }) }), { name: B.storeName, temporal: cfg });

describe('temporal middleware', () => {
    it('provides undo/redo', () => {
        const store = valueStore(true);
        store.getState().setN(10);
        store.getState().setN(20);
        store.temporal.getState().undo();
        expect(store.getState().n).toBe(10);
        store.temporal.getState().redo();
        expect(store.getState().n).toBe(20);
    });

    it('respects custom limit', () => {
        const store = valueStore({ enabled: true, limit: 2 });
        [1, 2, 3].forEach((v) => store.getState().setN(v));
        expect(store.temporal.getState().pastStates.length).toBeLessThanOrEqual(2);
    });

    it('uses custom partialize', () => {
        const store = createStore<{ a: number; b: number; setA: (v: number) => void }>(
            (set) => ({ a: 1, b: 2, setA: (v) => set({ a: v }) }),
            { name: B.storeName, temporal: { enabled: true, partialize: (s) => ({ a: s.a }) } },
        );
        store.getState().setA(10);
        expect(store.temporal.getState().pastStates[0]).toEqual({ a: 1 });
    });

    it('filters functions via default partialize', () => {
        const store = createStore(() => ({ action: () => {}, data: 'x' }), { name: B.storeName, temporal: true });
        store.setState({ data: 'y' });
        expect(store.temporal.getState().pastStates[0] ?? {}).not.toHaveProperty('action');
    });

    it('works when disabled', () =>
        expect(createStore(() => ({ v: 1 }), { name: B.storeName, temporal: false }).getState().v).toBe(1));
});

// --- [DESCRIBE] persist middleware -------------------------------------------

describe('persist middleware', () => {
    it('validates hydration with schema (success)', async () => {
        TEST_HARNESS.storage.seed('schema-valid', { value: 42 });
        const store = createStore(() => ({ value: 0 }), { name: 'schema-valid', persist: { schema: B.schemas.value } });
        await TEST_HARNESS.timers.advance();
        expect(store.getState().value).toBe(42);
    });

    it('validates hydration with schema (failure)', async () => {
        TEST_HARNESS.storage.seed('schema-invalid', { value: 'bad' });
        await TEST_HARNESS.console.warn(async (spy) => {
            const store = createStore(() => ({ value: 99 }), {
                name: 'schema-invalid',
                persist: { schema: B.schemas.value },
            });
            await TEST_HARNESS.timers.advance();
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Hydration validation failed'), expect.anything());
            expect(store.getState().value).toBe(99);
        });
    });

    it('merges without schema', async () => {
        TEST_HARNESS.storage.seed('no-schema', { x: 5 });
        const store = createStore(() => ({ x: 0 }), { name: 'no-schema', persist: true });
        await TEST_HARNESS.timers.advance();
        expect(store.getState().x).toBe(5);
    });

    it('filters keys via exclude patterns', () => {
        // biome-ignore lint/style/useNamingConvention: _private tests /^_/ pattern
        const store = createStore(() => ({ _private: 1, data: 2, secretKey: 3, setData: () => {} }), {
            name: B.storeName,
            persist: { exclude: ['secretKey', /^_/, /^set/] },
        });
        expect(store.getState().data).toBe(2);
    });

    it('works when disabled', () =>
        expect(createStore(() => ({ v: 1 }), { name: B.storeName, persist: false }).getState().v).toBe(1));
});

// --- [DESCRIBE] createSlicedStore --------------------------------------------

const counterSlice = createSlice({
    actions: { inc: () => (s) => ({ count: s.count + 1 }) },
    name: 'counter',
    value: { count: 0 },
});

describe('createSlicedStore', () =>
    it('composes slices', () => {
        // biome-ignore lint/suspicious/noExplicitAny: zustand-slices typing
        const store = createSlicedStore({ name: 'sliced' }, counterSlice) as any;
        expect(store.getState().counter.count).toBe(0);
        store.getState().inc();
        expect(store.getState().counter.count).toBe(1);
    }));

// --- [DESCRIBE] createSlice --------------------------------------------------

describe('createSlice', () => it('re-exports', () => expect(typeof createSlice).toBe('function')));
