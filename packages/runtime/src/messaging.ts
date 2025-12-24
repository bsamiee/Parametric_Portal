/**
 * Cross-origin iframe/window messaging with type-safe channels and Effect schema validation.
 */
import useMessage from '@rottitime/react-hook-message-event';
import { Either, Schema as S } from 'effect';
import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand';

// --- [TYPES] -----------------------------------------------------------------

type MessagePayload<T = unknown> = {
    readonly data: T;
    readonly timestamp: number;
    readonly type: string;
};
type MessageHandler<T> = (payload: T, reply: (response: unknown) => void) => void;
type MessageChannelConfig<TSend = unknown, TReceive = unknown> = {
    readonly eventName: string;
    // biome-ignore lint/suspicious/noExplicitAny: Schema generic escape
    readonly receiveSchema?: S.Schema<TReceive, any>;
    // biome-ignore lint/suspicious/noExplicitAny: Schema generic escape
    readonly sendSchema?: S.Schema<TSend, any>;
    readonly targetOrigin?: string;
};
type StoreSyncConfig<T> = {
    readonly debounceMs?: number;
    readonly keys?: ReadonlyArray<keyof T>;
};
type MessageChannelApi<TSend, TReceive> = {
    readonly send: (type: string, data: TSend) => void;
    readonly useListener: (type: string, handler: MessageHandler<TReceive>) => void;
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
    timestamp: Date.now(),
    type,
});
const debounce = <T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T => {
    const state = { timeout: null as ReturnType<typeof setTimeout> | null };
    return ((...args: Parameters<T>) => {
        state.timeout && clearTimeout(state.timeout);
        state.timeout = setTimeout(() => fn(...args), ms);
    }) as T;
};

// --- [FACTORIES] -------------------------------------------------------------

const createMessageChannel = <TSend, TReceive>(
    config: MessageChannelConfig<TSend, TReceive>,
): MessageChannelApi<TSend, TReceive> => {
    const { eventName, receiveSchema, sendSchema, targetOrigin = B.defaults.targetOrigin } = config;
    return Object.freeze({
        send: (type: string, data: TSend) => {
            const validated = sendSchema
                ? Either.match(S.decodeUnknownEither(sendSchema)(data), {
                      onLeft: (err) => {
                          console.warn(`[messaging] Send validation failed:`, err);
                          return data;
                      },
                      onRight: (v) => v,
                  })
                : data;
            window.parent?.postMessage(createPayload(type, validated), targetOrigin);
        },
        useListener: (type: string, handler: MessageHandler<TReceive>) => {
            useMessage(eventName, ((send: (response: unknown) => void, rawPayload: MessagePayload<TReceive>) => {
                rawPayload.type === type &&
                    (receiveSchema
                        ? Either.match(S.decodeUnknownEither(receiveSchema)(rawPayload.data), {
                              onLeft: (err) => console.warn(`[messaging] Receive validation failed:`, err),
                              onRight: (data) => handler(data, send),
                          })
                        : handler(rawPayload.data, send));
            }) as Parameters<typeof useMessage>[1]);
        },
    });
};

// --- [HOOKS] -----------------------------------------------------------------

const useStoreSync = <T extends object>(
    useStore: { (): T; getState: () => T; subscribe: StoreApi<T>['subscribe'] },
    eventName: string,
    config?: StoreSyncConfig<T>,
): void => {
    const { keys, debounceMs = B.defaults.debounceMs } = config ?? {};
    // biome-ignore lint/suspicious/noExplicitAny: useMessage return type
    const { sendToParent } = useMessage(eventName) as any;
    const sendState = useRef(
        debounce((state: T) => {
            const payload = keys ? Object.fromEntries(keys.map((k) => [k, state[k]])) : state;
            sendToParent(createPayload('state-sync', payload));
        }, debounceMs),
    );
    useEffect(() => {
        const unsubscribe = useStore.subscribe((state) => {
            sendState.current(state);
        });
        sendState.current(useStore.getState());
        return unsubscribe;
    }, [useStore]);
};
const useStoreReceiver = <T>(eventName: string, onReceive: (state: T) => void): void => {
    useMessage(
        eventName,
        ((_send: (response: unknown) => void, rawPayload: MessagePayload<T>) =>
            rawPayload.type === 'state-sync' && onReceive(rawPayload.data)) as Parameters<typeof useMessage>[1],
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as MESSAGING_TUNING, createMessageChannel, createPayload, useStoreReceiver, useStoreSync };
export type { MessageChannelApi, MessageChannelConfig, MessageHandler, MessagePayload, StoreSyncConfig };
