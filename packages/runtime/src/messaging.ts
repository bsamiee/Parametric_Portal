/**
 * Handle cross-origin iframe/window messaging with type safety.
 * Provides Effect Stream for continuous listening with Schema validation.
 */
import { AppError } from '@parametric-portal/types/app-error';
import { DurationMs, Timestamp } from '@parametric-portal/types/types';
import { Effect, Either, Fiber, type ParseResult, Schema as S, Stream } from 'effect';
import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand';
import { Runtime } from './runtime';

// --- [TYPES] -----------------------------------------------------------------
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
    readonly debounceMs?: DurationMs;
    readonly keys?: ReadonlyArray<keyof T>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        debounceMs: DurationMs.fromMillis(100),
        targetOrigin: '*',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createPayload = <T>(type: string, data: T): MessagePayload<T> => ({
    data,
    timestamp: Timestamp.nowSync(),
    type,
});
const validateData = <T>(
    schema: S.Schema<T, unknown> | undefined,
    data: unknown,
): Either.Either<T, ParseResult.ParseError> => (schema ? S.decodeUnknownEither(schema)(data) : Either.right(data as T));

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const sendMessage = <T>(
    type: string,
    data: T,
    options?: { schema?: S.Schema<T, unknown>; targetOrigin?: string },
): Effect.Effect<void, AppError<'Messaging'>> =>
    Effect.gen(function* () {
        const { schema, targetOrigin = B.defaults.targetOrigin } = options ?? {};
        const validated = schema
            ? yield* S.decodeUnknown(schema)(data).pipe(
                  Effect.mapError(() => AppError.from('Messaging', 'VALIDATION_FAILED', 'Send validation failed')),
              )
            : data;
        yield* Effect.sync(() => window.parent?.postMessage(createPayload(type, validated), targetOrigin));
    });
const createMessageStream = <T>(
    options?: MessageListenerOptions<T>,
): Stream.Stream<MessagePayload<T>, AppError<'Messaging'>> =>
    Stream.asyncScoped<MessagePayload<T>, AppError<'Messaging'>>((emit) =>
        Effect.acquireRelease(
            Effect.sync(() => {
                const { schema, targetOrigin = B.defaults.targetOrigin, typeFilter } = options ?? {};
                const handler = (event: MessageEvent) => {
                    const isOriginValid = targetOrigin === '*' || event.origin === targetOrigin;
                    const isTypeValid = !typeFilter || event.data?.type === typeFilter;
                    const result = isOriginValid && isTypeValid ? validateData(schema, event.data?.data) : undefined;
                    result &&
                        (Either.isRight(result)
                            ? emit.single({
                                  data: result.right,
                                  timestamp: event.data?.timestamp ?? Timestamp.nowSync(),
                                  type: event.data?.type ?? 'message',
                              })
                            : emit.fail(AppError.from('Messaging', 'VALIDATION_FAILED', 'Invalid message data')));
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
    const runtime = Runtime.use<R, never>();
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
    const runtime = Runtime.use<R, never>();
    const { keys, debounceMs = B.defaults.debounceMs } = config ?? {};
    useEffect(() => {
        const storeStream = Stream.asyncScoped<T, never>((emit) =>
            Effect.acquireRelease(
                Effect.sync(() => {
                    emit.single(store.getState());
                    return store.subscribe(emit.single);
                }),
                (unsubscribe) => Effect.sync(unsubscribe),
            ),
        );
        const fiber = runtime.runFork(
            storeStream.pipe(
                Stream.debounce(debounceMs),
                Stream.runForEach((state) => {
                    const payload = keys ? Object.fromEntries(keys.map((k) => [k, state[k]])) : state;
                    return sendMessage('state-sync', payload).pipe(Effect.ignore);
                }),
            ),
        );
        return () => {
            runtime.runFork(Fiber.interrupt(fiber));
        };
    }, [runtime, store, debounceMs, keys]);
};
const useStoreReceiver = <T, R = never>(onReceive: (state: T) => void): void =>
    useMessageListener<T, R>((payload) => payload.type === 'state-sync' && onReceive(payload.data), {
        typeFilter: 'state-sync',
    });

// --- [EXPORT] ----------------------------------------------------------------

export type { MessageListenerOptions, MessagePayload, StoreSyncConfig };
export {
    B as MESSAGING_TUNING,
    createMessageStream,
    createPayload,
    sendMessage,
    useMessageListener,
    useStoreReceiver,
    useStoreSync,
};
