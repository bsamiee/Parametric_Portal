/**
 * Messaging tests: payload creation, message channel factory, schema validation.
 */
import { it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import { TEST_HARNESS } from '@parametric-portal/test-utils/harness';
import { Schema as S } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageChannel, createPayload, MESSAGING_TUNING } from '../src/messaging';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    frozenTime: TEST_CONSTANTS.frozenTime.getTime(),
    samples: {
        data: { count: 42, key: 'value' },
        eventName: 'test-channel',
        type: 'test-message',
    },
} as const);

// --- [MOCK] ------------------------------------------------------------------

const ctx = { spy: undefined as ReturnType<typeof vi.spyOn> | undefined };
beforeEach(() => {
    ctx.spy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
});
afterEach(() => {
    ctx.spy?.mockRestore();
});
const postMessageSpy = (): ReturnType<typeof vi.spyOn> => ctx.spy as ReturnType<typeof vi.spyOn>;

// --- [DESCRIBE] MESSAGING_TUNING ---------------------------------------------

describe('MESSAGING_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(MESSAGING_TUNING)).toBe(true);
        expect(MESSAGING_TUNING.defaults).toEqual({ debounceMs: 100, targetOrigin: '*' });
    });
    it('has positive debounce default', () => expect(MESSAGING_TUNING.defaults.debounceMs).toBeGreaterThan(0));
    it('has wildcard target origin', () => expect(MESSAGING_TUNING.defaults.targetOrigin).toBe('*'));
});

// --- [DESCRIBE] createPayload ------------------------------------------------

describe('createPayload', () => {
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])(
        'creates payload with all required fields',
        (type, data) => {
            const payload = createPayload(type, data);
            expect(typeof payload.type).toBe('string');
            expect(payload.type).toBe(type);
            expect('data' in payload).toBe(true);
            expect(typeof payload.timestamp).toBe('number');
        },
    );
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])('preserves exact type string', (type, data) => {
        const payload = createPayload(type, data);
        expect(payload.type).toBe(type);
    });
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])('preserves data exactly', (type, data) => {
        const payload = createPayload(type, data);
        expect(payload.data).toEqual(data);
    });
    it('uses frozen time timestamp', () => {
        const payload = createPayload(B.samples.type, B.samples.data);
        expect(payload.timestamp).toBe(B.frozenTime);
    });
    it('payload has exactly 3 properties', () => {
        const payload = createPayload(B.samples.type, B.samples.data);
        expect(Object.keys(payload).sort((a, b) => a.localeCompare(b))).toEqual(['data', 'timestamp', 'type']);
    });
    it('handles primitive data types', () => {
        expect(createPayload('test', 'string').data).toBe('string');
        expect(createPayload('test', 42).data).toBe(42);
        expect(createPayload('test', true).data).toBe(true);
        expect(createPayload('test', null).data).toBeNull();
    });
    it('handles complex data types', () => {
        const obj = { nested: { value: [1, 2, 3] } };
        expect(createPayload('test', obj).data).toEqual(obj);
    });
});

// --- [DESCRIBE] createMessageChannel -----------------------------------------

describe('createMessageChannel', () => {
    it('returns frozen API object', () => {
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        expect(Object.isFrozen(channel)).toBe(true);
    });
    it('exposes send and useListener methods', () => {
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        expect(typeof channel.send).toBe('function');
        expect(typeof channel.useListener).toBe('function');
    });
    it('send posts message to parent window', () => {
        postMessageSpy().mockClear();
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        channel.send(B.samples.type, B.samples.data);
        expect(postMessageSpy()).toHaveBeenCalledTimes(1);
        expect(postMessageSpy()).toHaveBeenCalledWith(
            expect.objectContaining({ data: B.samples.data, type: B.samples.type }),
            '*',
        );
    });
    it('uses custom targetOrigin', () => {
        postMessageSpy().mockClear();
        const channel = createMessageChannel({ eventName: B.samples.eventName, targetOrigin: 'https://example.com' });
        channel.send(B.samples.type, B.samples.data);
        expect(postMessageSpy()).toHaveBeenCalledWith(expect.anything(), 'https://example.com');
    });
    it('defaults to wildcard origin', () => {
        postMessageSpy().mockClear();
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        channel.send(B.samples.type, B.samples.data);
        expect(postMessageSpy()).toHaveBeenCalledWith(expect.anything(), '*');
    });
    describe('with sendSchema', () => {
        const TestSchema = S.Struct({ name: S.String, value: S.Number });
        it('validates and sends valid data', () => {
            postMessageSpy().mockClear();
            const channel = createMessageChannel({ eventName: B.samples.eventName, sendSchema: TestSchema });
            channel.send('test', { name: 'test', value: 42 });
            expect(postMessageSpy()).toHaveBeenCalledWith(
                expect.objectContaining({ data: { name: 'test', value: 42 } }),
                '*',
            );
        });
        it('warns and sends invalid data anyway', () =>
            TEST_HARNESS.console.warn((spy) => {
                postMessageSpy().mockClear();
                const channel = createMessageChannel({ eventName: B.samples.eventName, sendSchema: TestSchema });
                // biome-ignore lint/suspicious/noExplicitAny: intentionally sending invalid data
                channel.send('test', { invalid: 'data' } as any);
                expect(spy).toHaveBeenCalledWith(
                    expect.stringContaining('[messaging] Send validation failed'),
                    expect.anything(),
                );
                expect(postMessageSpy()).toHaveBeenCalled();
            }));
    });
    itProp.prop([FC_ARB.eventName()])('accepts any valid event name', (eventName) => {
        const channel = createMessageChannel({ eventName });
        expect(channel).toBeDefined();
        expect(typeof channel.send).toBe('function');
    });
});

// --- [DESCRIBE] payload structure --------------------------------------------

describe('payload structure', () => {
    it('has readonly-like properties', () => {
        const payload = createPayload(B.samples.type, B.samples.data);
        expect(Object.keys(payload).sort((a, b) => a.localeCompare(b))).toEqual(['data', 'timestamp', 'type']);
    });
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])('timestamp is positive integer', (type, data) => {
        const payload = createPayload(type, data);
        expect(payload.timestamp).toBeGreaterThan(0);
        expect(Number.isInteger(payload.timestamp)).toBe(true);
    });
    it('different calls produce different timestamps after time advance', async () => {
        const p1 = createPayload('test', {});
        await TEST_HARNESS.timers.advance(100);
        const p2 = createPayload('test', {});
        expect(p2.timestamp).toBeGreaterThan(p1.timestamp);
    });
});

// --- [DESCRIBE] channel consistency ------------------------------------------

describe('channel consistency', () => {
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])('send creates valid payload', (type, data) => {
        postMessageSpy().mockClear();
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        channel.send(type, data);
        expect(postMessageSpy()).toHaveBeenCalledWith(
            expect.objectContaining({ data, timestamp: expect.any(Number), type }),
            '*',
        );
    });
    it('multiple sends are independent', () => {
        postMessageSpy().mockClear();
        const channel = createMessageChannel({ eventName: B.samples.eventName });
        channel.send('type1', { a: 1 });
        channel.send('type2', { b: 2 });
        expect(postMessageSpy()).toHaveBeenCalledTimes(2);
    });
    itProp.prop([FC_ARB.eventName()])('each channel instance is independent', (eventName) => {
        postMessageSpy().mockClear();
        const channel1 = createMessageChannel({ eventName });
        const channel2 = createMessageChannel({ eventName: `${eventName}-2` });
        channel1.send('msg', { a: 1 });
        channel2.send('msg', { b: 2 });
        expect(postMessageSpy()).toHaveBeenCalledTimes(2);
    });
});
