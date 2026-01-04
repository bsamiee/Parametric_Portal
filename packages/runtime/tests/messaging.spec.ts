/**
 * Test messaging payload creation and Effect-based send operations.
 * Validates schema enforcement and Stream-based message listening.
 */
import { it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import { TEST_HARNESS } from '@parametric-portal/test-utils/harness';
import { Effect, Exit, Schema as S } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageStream, createPayload, MESSAGING_TUNING, sendMessage } from '../src/messaging';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    frozenTime: TEST_CONSTANTS.frozenTime.getTime(),
    samples: {
        data: { count: 42, key: 'value' },
        type: 'test-message',
    },
} as const);

// --- [MOCK] ------------------------------------------------------------------

const spyRef = { current: null as ReturnType<typeof vi.spyOn> | null };
beforeEach(() => {
    spyRef.current = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
});
afterEach(() => {
    spyRef.current?.mockRestore();
});
// biome-ignore lint/style/noNonNullAssertion: beforeEach guarantees initialization
const postMessageSpy = (): ReturnType<typeof vi.spyOn> => spyRef.current!;

// --- [DESCRIBE_MESSAGING_TUNING] ---------------------------------------------

describe('MESSAGING_TUNING', () => {
    it('is frozen with expected defaults', () => {
        expect(Object.isFrozen(MESSAGING_TUNING)).toBe(true);
        expect(MESSAGING_TUNING.defaults).toEqual({ debounceMs: 100, targetOrigin: '*' });
    });
});

// --- [DESCRIBE_CREATE_PAYLOAD] -----------------------------------------------

describe('createPayload', () => {
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])(
        'creates valid payload preserving type/data with timestamp',
        (type, data) => {
            const payload = createPayload(type, data);
            expect(payload.type).toBe(type);
            expect(payload.data).toEqual(data);
            expect(Number.isInteger(payload.timestamp)).toBe(true);
            expect(payload.timestamp).toBeGreaterThan(0);
        },
    );
    it('uses frozen time and has exactly 3 properties', () => {
        const payload = createPayload(B.samples.type, B.samples.data);
        expect(payload.timestamp).toBe(B.frozenTime);
        expect(Object.keys(payload).sort((a, b) => a.localeCompare(b))).toEqual(['data', 'timestamp', 'type']);
    });
    it.each([
        ['string', 'string'],
        [42, 42],
        [true, true],
        [null, null],
        [{ nested: { value: [1, 2, 3] } }, { nested: { value: [1, 2, 3] } }],
    ])('preserves data: %p', (input, expected) => {
        expect(createPayload('test', input).data).toEqual(expected);
    });
    it('advances timestamp with time', async () => {
        const p1 = createPayload('test', {});
        await TEST_HARNESS.timers.advance(100);
        const p2 = createPayload('test', {});
        expect(p2.timestamp).toBeGreaterThan(p1.timestamp);
    });
});

// --- [DESCRIBE_SEND_MESSAGE] -------------------------------------------------

describe('sendMessage', () => {
    it('posts message to parent with payload and default origin', async () => {
        postMessageSpy().mockClear();
        const result = await Effect.runPromiseExit(sendMessage(B.samples.type, B.samples.data));
        expect(Exit.isSuccess(result)).toBe(true);
        expect(postMessageSpy()).toHaveBeenCalledTimes(1);
        expect(postMessageSpy()).toHaveBeenCalledWith(
            expect.objectContaining({ data: B.samples.data, timestamp: expect.any(Number), type: B.samples.type }),
            '*',
        );
    });
    it('uses custom targetOrigin when specified', async () => {
        postMessageSpy().mockClear();
        const result = await Effect.runPromiseExit(
            sendMessage(B.samples.type, B.samples.data, { targetOrigin: 'https://example.com' }),
        );
        expect(Exit.isSuccess(result)).toBe(true);
        expect(postMessageSpy()).toHaveBeenCalledWith(expect.anything(), 'https://example.com');
    });
    describe('with schema validation', () => {
        const TestSchema = S.Struct({ name: S.String, value: S.Number });
        it('validates and sends valid data', async () => {
            postMessageSpy().mockClear();
            const result = await Effect.runPromiseExit(
                sendMessage(
                    'test',
                    { name: 'test', value: 42 },
                    // biome-ignore lint/suspicious/noExplicitAny: schema generic escape for test
                    { schema: TestSchema as S.Schema<{ readonly name: string; readonly value: number }, any> },
                ),
            );
            expect(Exit.isSuccess(result)).toBe(true);
            expect(postMessageSpy()).toHaveBeenCalledWith(
                expect.objectContaining({ data: { name: 'test', value: 42 } }),
                '*',
            );
        });
        it('fails with MessagingError for invalid data', async () => {
            postMessageSpy().mockClear();
            const result = await Effect.runPromiseExit(
                // biome-ignore lint/suspicious/noExplicitAny: schema generic escape for test
                sendMessage('test', { invalid: 'data' } as any, { schema: TestSchema as S.Schema<any, any> }),
            );
            expect(Exit.isFailure(result)).toBe(true);
            expect(postMessageSpy()).not.toHaveBeenCalled();
        });
    });
    itProp.prop([FC_ARB.eventName(), FC_ARB.messageData()])(
        'creates valid payload for any input',
        async (type, data) => {
            postMessageSpy().mockClear();
            await Effect.runPromise(sendMessage(type, data));
            expect(postMessageSpy()).toHaveBeenCalledWith(
                expect.objectContaining({ data, timestamp: expect.any(Number), type }),
                '*',
            );
        },
    );
});

// --- [DESCRIBE_CREATE_MESSAGE_STREAM] ----------------------------------------

describe('createMessageStream', () => {
    it('returns a Stream type', () => {
        const stream = createMessageStream();
        expect(stream).toBeDefined();
        expect(typeof stream).toBe('object');
    });
    it('accepts options with schema, targetOrigin, typeFilter', () => {
        const TestSchema = S.asSchema(S.Struct({ value: S.Number }));
        const stream = createMessageStream({
            schema: TestSchema,
            targetOrigin: 'https://example.com',
            typeFilter: 'test-type',
        });
        expect(stream).toBeDefined();
    });
});
