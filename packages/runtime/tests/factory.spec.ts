/**
 * Test store factory middleware composition via property-based and dispatch-driven patterns.
 * Uses unique store names per test for browser mode isolation.
 */
import { fc, it as itProp } from '@fast-check/vitest';
import { TEST_HARNESS } from '@parametric-portal/test-utils/harness';
import { PositiveInt } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';
import { describe, expect, it } from 'vitest';
import { createSlice } from 'zustand-slices';
import type { DevtoolsConfig, PersistConfig, TemporalConfig } from '../src/store/factory';
import { createSlicedStore, createStore, STORE_FACTORY_TUNING } from '../src/store/factory';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Unique store names for browser mode isolation (leverages harness counter). */
const uniqueName = (base: string): string => TEST_HARNESS.uniqueId(base);

// --- [TYPES] -----------------------------------------------------------------

type BaseState = { readonly v: number };
type ValueState = { n: number; setN: (v: number) => void };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    arb: {
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
    init: () => ({ v: 1 }),
    schema: S.Struct({ value: S.Number }),
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const configTests = Object.freeze({
    devtools: (cfg: boolean | DevtoolsConfig | undefined) =>
        createStore<BaseState>(B.init, { name: uniqueName('devtools'), ...(cfg !== undefined && { devtools: cfg }) }),
    immer: (cfg: boolean | undefined) =>
        createStore<BaseState>(B.init, { name: uniqueName('immer'), ...(cfg !== undefined && { immer: cfg }) }),
    persist: (cfg: boolean | PersistConfig<BaseState> | undefined) =>
        createStore<BaseState>(B.init, { name: uniqueName('persist'), ...(cfg !== undefined && { persist: cfg }) }),
    temporal: (cfg: boolean | TemporalConfig<BaseState> | undefined) =>
        createStore<BaseState>(B.init, { name: uniqueName('temporal'), ...(cfg !== undefined && { temporal: cfg }) }),
} as const);
const valueStore = (cfg: boolean | TemporalConfig<ValueState>) =>
    createStore<ValueState>((set) => ({ n: 0, setN: (v) => set({ n: v }) }), {
        name: uniqueName('value'),
        temporal: cfg,
    });

// --- [DESCRIBE_STORE_FACTORY_TUNING] -----------------------------------------

describe('STORE_FACTORY_TUNING', () =>
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
    }));

// --- [DESCRIBE_NORMALIZE_CONFIG] ---------------------------------------------

describe('normalizeConfig', () => {
    itProp.prop([B.arb.immer])('immer', (cfg) => configTests.immer(cfg).getState().v === 1);
    itProp.prop([B.arb.persist])('persist', (cfg) => configTests.persist(cfg).getState().v === 1);
    itProp.prop([B.arb.temporal])('temporal', (cfg) => configTests.temporal(cfg).getState().v === 1);
    itProp.prop([B.arb.devtools])('devtools', (cfg) => configTests.devtools(cfg).getState().v === 1);
});

// --- [DESCRIBE_WARN_INVALID_CONFIG] ------------------------------------------

describe('warnInvalidConfig', () => {
    it.each(['INVALID!', '@invalid', 'has spaces'])('warns on invalid name: %s', (name) =>
        TEST_HARNESS.console.warn((spy) => {
            createStore(B.init, { name });
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid store name'));
        }));
    it('skips warning in production', () =>
        TEST_HARNESS.console.warn((spy) =>
            TEST_HARNESS.env.production(() => {
                createStore(B.init, { name: 'INVALID!' });
                expect(spy).not.toHaveBeenCalled();
            }),
        ));
    it('does not warn on valid name', () =>
        TEST_HARNESS.console.warn((spy) => {
            createStore(B.init, { name: 'valid-name' });
            expect(spy).not.toHaveBeenCalled();
        }));
});

// --- [DESCRIBE_ATTACH_SELECTORS] ---------------------------------------------

describe('attachSelectors', () =>
    it('creates use property with state selectors', () => {
        const store = createStore(() => ({ a: 1, b: 'x' }), { name: uniqueName('selectors') });
        expect(typeof store.use.a).toBe('function');
        expect(typeof store.use.b).toBe('function');
    }));

// --- [DESCRIBE_MIDDLEWARE] ---------------------------------------------------

const incReducer = (s: { count: number }) => ({ count: s.count + 1 });
describe('immer', () => {
    it('allows mutations when enabled', () => {
        const store = createStore<{ count: number; inc: () => void }>(
            (set) => ({ count: 0, inc: () => set(incReducer) }),
            { immer: true, name: uniqueName('immer-enabled') },
        );
        store.getState().inc();
        expect(store.getState().count).toBe(1);
    });
    it('works when disabled', () =>
        expect(createStore(B.init, { immer: false, name: uniqueName('immer-disabled') }).getState().v).toBe(1));
});
describe('computed', () => {
    it('computes derived state', () => {
        const store = createStore<{ items: number[] }, { total: number }>(() => ({ items: [1, 2, 3] }), {
            computed: { compute: (s) => ({ total: s.items.reduce((a, b) => a + b, 0) }), keys: ['items'] },
            name: uniqueName('computed'),
        });
        expect(store.getState().total).toBe(6);
    });
    it('works without compute', () =>
        expect(createStore(B.init, { name: uniqueName('no-compute') }).getState().v).toBe(1));
});
describe('devtools', () =>
    it.each([true, false])('enabled=%s', (e) =>
        expect(createStore(B.init, { devtools: e, name: uniqueName('devtools-test') }).getState().v).toBe(1)));
describe('temporal', () => {
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
        const store = valueStore({ enabled: true, limit: PositiveInt.decodeSync(2) });
        for (const v of [1, 2, 3]) store.getState().setN(v);
        expect(store.temporal.getState().pastStates.length).toBeLessThanOrEqual(2);
    });
    it('uses custom partialize', () => {
        const store = createStore<{ a: number; b: number; setA: (v: number) => void }>(
            (set) => ({ a: 1, b: 2, setA: (v) => set({ a: v }) }),
            { name: uniqueName('partialize'), temporal: { enabled: true, partialize: (s) => ({ a: s.a }) } },
        );
        store.getState().setA(10);
        expect(store.temporal.getState().pastStates[0]).toEqual({ a: 1 });
    });
    it('filters functions via default partialize', () => {
        const store = createStore(() => ({ action: () => {}, data: 'x' }), {
            name: uniqueName('partialize-fn'),
            temporal: true,
        });
        store.setState({ data: 'y' });
        expect(store.temporal.getState().pastStates[0] ?? {}).not.toHaveProperty('action');
    });
    it('works when disabled', () =>
        expect(createStore(B.init, { name: uniqueName('temporal-disabled'), temporal: false }).getState().v).toBe(1));
});
describe('persist', () => {
    it('validates hydration with schema (success)', async () => {
        const name = uniqueName('schema-valid');
        TEST_HARNESS.storage.seed(name, { value: 42 });
        const store = createStore(() => ({ value: 0 }), { name, persist: { schema: B.schema } });
        await TEST_HARNESS.timers.advance();
        expect(store.getState().value).toBe(42);
    });
    it('validates hydration with schema (failure)', async () => {
        const name = uniqueName('schema-invalid');
        TEST_HARNESS.storage.seed(name, { value: 'bad' });
        await TEST_HARNESS.console.warn(async (spy) => {
            const store = createStore(() => ({ value: 99 }), { name, persist: { schema: B.schema } });
            await TEST_HARNESS.timers.advance();
            expect(spy).toHaveBeenCalledWith(expect.stringContaining('Hydration validation failed'), expect.anything());
            expect(store.getState().value).toBe(99);
        });
    });
    it('merges without schema', async () => {
        const name = uniqueName('no-schema');
        TEST_HARNESS.storage.seed(name, { x: 5 });
        const store = createStore(() => ({ x: 0 }), { name, persist: true });
        await TEST_HARNESS.timers.advance();
        expect(store.getState().x).toBe(5);
    });
    it('filters keys via exclude patterns', () => {
        const store = createStore(() => ({ _private: 1, data: 2, secretKey: 3, setData: () => {} }), {
            name: uniqueName('exclude-patterns'),
            persist: { exclude: ['secretKey', /^_/, /^set/] },
        });
        expect(store.getState().data).toBe(2);
    });
    it('works when disabled', () =>
        expect(createStore(B.init, { name: uniqueName('persist-disabled'), persist: false }).getState().v).toBe(1));
});

// --- [DESCRIBE_SLICES] -------------------------------------------------------

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
describe('createSlice', () => it('re-exports', () => expect(typeof createSlice).toBe('function')));
