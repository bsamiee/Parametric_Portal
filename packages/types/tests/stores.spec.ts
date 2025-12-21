/**
 * Validate store slice patterns via property-based testing.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { STORE_TUNING, store } from '../src/stores.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => store();

const arbitrarySliceName = fc.string({ maxLength: 20, minLength: 1 });
const arbitraryInitialState = fc.record({ count: fc.integer() });

// --- [TESTS] -----------------------------------------------------------------

describe('stores package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.createSlice).toBeDefined();
            expect(api.combineSlices).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(STORE_TUNING)).toBe(true);
            expect(STORE_TUNING.defaults.enableDevtools).toBe(false);
            expect(STORE_TUNING.defaults.name).toBe('store');
        });
    });

    describe('slice creation', () => {
        it.prop([arbitrarySliceName, arbitraryInitialState])('creates slice with initial state', (name, state) => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: state, name });
            expect(slice.name).toBe(name);
            expect(slice.getState()).toEqual(state);
            expect(slice.initialState).toEqual(state);
        });

        it('provides base actions', () => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            expect(slice.actions.set).toBeDefined();
            expect(slice.actions.reset).toBeDefined();
            expect(slice.actions.update).toBeDefined();
        });
    });

    describe('slice actions', () => {
        it.prop([arbitraryInitialState])('set action updates state', (newState) => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            slice.actions.set(newState);
            expect(slice.getState()).toEqual(newState);
        });

        it('reset action restores initial state', () => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            slice.actions.set({ count: 42 });
            expect(slice.getState().count).toBe(42);
            slice.actions.reset();
            expect(slice.getState().count).toBe(0);
        });

        it.prop([fc.integer()])('update action transforms state', (increment) => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            const initial = slice.getState().count;
            slice.actions.update((prev) => ({ count: prev.count + increment }));
            expect(slice.getState().count).toBe(initial + increment);
        });
    });

    describe('custom actions', () => {
        it('supports custom actions', () => {
            const api = loadApi();
            const slice = api.createSlice({
                actions: (set, get) => ({
                    double: () => {
                        const current = get();
                        set({ count: current.count * 2 });
                    },
                    increment: () => {
                        const current = get();
                        set({ count: current.count + 1 });
                    },
                }),
                initialState: { count: 5 },
                name: 'counter',
            });
            expect(slice.actions.increment).toBeDefined();
            expect(slice.actions.double).toBeDefined();
            slice.actions.increment();
            expect(slice.getState().count).toBe(6);
            slice.actions.double();
            expect(slice.getState().count).toBe(12);
        });
    });

    describe('subscriptions', () => {
        it('notifies subscribers on state change', () => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            let values: ReadonlyArray<number> = [];
            const unsubscribe = slice.subscribe((state) => {
                values = [...values, state.count];
            });
            slice.actions.set({ count: 1 });
            slice.actions.set({ count: 2 });
            expect(values).toContain(1);
            expect(values).toContain(2);
            unsubscribe();
        });

        it('unsubscribe stops notifications', () => {
            const api = loadApi();
            const slice = api.createSlice({ initialState: { count: 0 }, name: 'test' });
            let callCount = 0;
            const unsubscribe = slice.subscribe(() => {
                callCount = callCount + 1;
            });
            slice.actions.set({ count: 1 });
            expect(callCount).toBe(1);
            unsubscribe();
            slice.actions.set({ count: 2 });
            expect(callCount).toBe(1);
        });
    });

    describe('combined store', () => {
        it('combines multiple slices', () => {
            const api = loadApi();
            const counterSlice = api.createSlice({ initialState: { count: 0 }, name: 'counter' });
            const userSlice = api.createSlice({ initialState: { name: 'John' }, name: 'user' });
            const combined = api.combineSlices({ counter: counterSlice, user: userSlice });
            const state = combined.getState();
            expect(state.counter.count).toBe(0);
            expect(state.user.name).toBe('John');
        });

        it('propagates slice updates to combined state', () => {
            const api = loadApi();
            const counterSlice = api.createSlice({ initialState: { count: 0 }, name: 'counter' });
            const userSlice = api.createSlice({ initialState: { name: 'John' }, name: 'user' });
            const combined = api.combineSlices({ counter: counterSlice, user: userSlice });
            counterSlice.actions.set({ count: 42 });
            const state = combined.getState();
            expect(state.counter.count).toBe(42);
        });

        it('notifies subscribers on any slice change', () => {
            const api = loadApi();
            const counterSlice = api.createSlice({ initialState: { count: 0 }, name: 'counter' });
            const userSlice = api.createSlice({ initialState: { name: 'John' }, name: 'user' });
            const combined = api.combineSlices({ counter: counterSlice, user: userSlice });
            let notified = false;
            combined.subscribe(() => {
                notified = true;
            });
            counterSlice.actions.set({ count: 1 });
            expect(notified).toBe(true);
        });
    });
});
