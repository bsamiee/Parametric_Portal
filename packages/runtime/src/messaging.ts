/**
 * Cross-origin iframe/window messaging with Effect Stream for continuous listening and Schema validation.
 * Replaces @rottitime/react-hook-message-event with native browser APIs + Effect.
 */
import { AppError } from '@parametric-portal/types/runtime';
import { Timestamp } from '@parametric-portal/types/types';
import { Effect, Either, Fiber, type ParseResult, Schema as S, Stream } from 'effect';
import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { useRuntime } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type MessagingError = Extract<AppError, { readonly _tag: 'Messaging' }>;
type MessagePayload<T = unknown> = {
    readonly data: T;
    readonly timestamp: Timestamp;
    readonly type: string;
};
type MessageListenerOptions<T = unknown> = {
    // biome-ignore lint/suspicious/noExplicitAny: Schema generic escape
    readonly schema?: S.Schema<T, any>;
    readonly targetOrigin?: string;
    readonly typeFilter?: string;
};
type StoreSyncConfig<T> = {
    readonly debounceMs?: number;
    readonly keys?: ReadonlyArray<keyof T>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        debounceMs: 100,
        targetOrigin: '*',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createPayload = <T>(type: string, data: T): MessagePayload<T> => ({
    data,
    timestamp: Timestamp.nowSync(),
    type,
});
const debounce = <T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T => {
    const state = { timeout: null as ReturnType<typeof setTimeout> | null };
    return ((...args: Parameters<T>) => {
        state.timeout && clearTimeout(state.timeout);
        state.timeout = setTimeout(() => fn(...args), ms);
    }) as T;
};
const validateData = <T>(
    schema: S.Schema<T, unknown> | undefined,
    data: unknown,
): Either.Either<T, ParseResult.ParseError> => (schema ? S.decodeUnknownEither(schema)(data) : Either.right(data as T));

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const sendMessage = <T>(
    type: string,
    data: T,
    options?: { schema?: S.Schema<T, unknown>; targetOrigin?: string },
): Effect.Effect<void, MessagingError> =>
    Effect.gen(function* () {
        const { schema, targetOrigin = B.defaults.targetOrigin } = options ?? {};
        const validated = schema
            ? yield* S.decodeUnknown(schema)(data).pipe(
                  Effect.mapError(() =>
                      AppError.Messaging({ code: 'VALIDATION_FAILED', message: 'Send validation failed' }),
                  ),
              )
            : data;
        yield* Effect.sync(() => window.parent?.postMessage(createPayload(type, validated), targetOrigin));
    });
const createMessageStream = <T>(
    options?: MessageListenerOptions<T>,
): Stream.Stream<MessagePayload<T>, MessagingError> =>
    Stream.asyncScoped<MessagePayload<T>, MessagingError>((emit) =>
        Effect.acquireRelease(
            Effect.sync(() => {
                const { schema, targetOrigin = B.defaults.targetOrigin, typeFilter } = options ?? {};
                const handler = (event: MessageEvent) => {
                    (targetOrigin === '*' || event.origin === targetOrigin) &&
                        (!typeFilter || event.data?.type === typeFilter) &&
                        Either.match(validateData(schema, event.data?.data), {
                            onLeft: () =>
                                void emit.fail(
                                    AppError.Messaging({ code: 'VALIDATION_FAILED', message: 'Invalid message data' }),
                                ),
                            onRight: (data) =>
                                void emit.single({
                                    data,
                                    timestamp: event.data?.timestamp ?? Timestamp.nowSync(),
                                    type: event.data?.type ?? 'message',
                                }),
                        });
                };
                window.addEventListener('message', handler);
                return handler;
            }),
            (handler) => Effect.sync(() => window.removeEventListener('message', handler)),
        ),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const useMessageListener = <T, R = never>(
    handler: (payload: MessagePayload<T>) => void,
    options?: MessageListenerOptions<T>,
): void => {
    const runtime = useRuntime<R, never>();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;
    // biome-ignore lint/correctness/useExhaustiveDependencies: handlerRef pattern for stable callback
    useEffect(() => {
        const fiber = runtime.runFork(
            Stream.runForEach(createMessageStream(options), (payload) =>
                Effect.sync(() => handlerRef.current(payload)),
            ),
        );
        return () => {
            runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [runtime, options?.schema, options?.targetOrigin, options?.typeFilter]);
};
const useStoreSync = <T extends object, R = never>(
    store: { getState: () => T; subscribe: StoreApi<T>['subscribe'] },
    config?: StoreSyncConfig<T>,
): void => {
    const runtime = useRuntime<R, never>();
    const { keys, debounceMs = B.defaults.debounceMs } = config ?? {};
    useEffect(() => {
        const send = debounce((state: T) => {
            const payload = keys ? Object.fromEntries(keys.map((k) => [k, state[k]])) : state;
            runtime.runFork(sendMessage('state-sync', payload));
        }, debounceMs);
        send(store.getState());
        return store.subscribe(send);
    }, [runtime, store, debounceMs, keys]);
};
const useStoreReceiver = <T, R = never>(onReceive: (state: T) => void): void =>
    useMessageListener<T, R>((payload) => payload.type === 'state-sync' && onReceive(payload.data), {
        typeFilter: 'state-sync',
    });

// --- [EXPORT] ----------------------------------------------------------------

export type { MessageListenerOptions, MessagePayload, MessagingError, StoreSyncConfig };
export {
    B as MESSAGING_TUNING,
    createMessageStream,
    createPayload,
    sendMessage,
    useMessageListener,
    useStoreReceiver,
    useStoreSync,
};
