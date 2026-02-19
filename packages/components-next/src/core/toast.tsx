/**
 * Multi-queue toast system with lazy initialization and CSS variable theming.
 * Direct API: Toast.show/dismiss. Provider API: Toast.Provider renders regions.
 */
import { readCssInt, readCssMs } from '@parametric-portal/runtime/runtime';
import type { AsyncState } from '@parametric-portal/types/async';
import { Array as A, Effect, Match, Option, pipe } from 'effect';
import type { CSSProperties, FC, ReactNode } from 'react';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
    Button, Text, UNSTABLE_Toast as RACToast, UNSTABLE_ToastContent as RACToastContent,
    UNSTABLE_ToastQueue as RACToastQueue, UNSTABLE_ToastRegion as RACToastRegion,
} from 'react-aria-components';
import { flushSync } from 'react-dom';
import { cn, Slot, type SlotInput } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type ToastPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
type QueueContent = Omit<ToastPayload, 'timeout' | 'onClose' | 'position'>;
type ToastType = 'error' | 'info' | 'success' | 'warning';
type ToastRenderConfig = { readonly position?: ToastPosition | undefined; readonly style?: string | undefined; readonly className?: string | undefined };
type ToastMessage = {
    readonly title: string;
    readonly description?: string;
    readonly dismissible?: boolean;
    readonly closeIcon?: SlotInput | false;
    readonly action?: { readonly label: string; readonly onClick: () => void };
    readonly timeout?: number;
    readonly onClose?: () => void;
    readonly icon?: SlotInput | false;
};
type ToastPayload = ToastMessage & {
    readonly type?: ToastType | undefined;
    readonly style?: string | undefined;
    readonly position?: ToastPosition | undefined;
    readonly progress?: number | undefined;
    readonly showDuration?: boolean | undefined;
};
type ToastTrigger = {
    readonly pending?: ToastMessage;
    readonly success?: ToastMessage;
    readonly failure?: ToastMessage;
    readonly style?: string | undefined;
    readonly position?: ToastPosition | undefined;
};
type ProviderProps = {
    readonly children: ReactNode;
    readonly positions?: readonly ToastPosition[];
    readonly style?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    cssVars: {
        maxVisible: '--toast-max-visible',
        timeout: '--toast-timeout',
    },
    defaults: {
        dismissible: true,
        maxVisible: 5,
        position: 'bottom-right' as ToastPosition,
        timeout: 5000,
        type: 'info' as ToastType,
    },
    slot: {
        action: cn(
            'shrink-0',
            'text-(--toast-action-color) font-(--toast-action-weight)',
            'underline-offset-4 hover:underline',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--toast-focus-ring-color)',
            'transition-colors cursor-pointer',
        ),
        close: cn(
            'shrink-0 inline-flex items-center justify-center',
            'size-(--toast-dismiss-size) rounded-(--toast-dismiss-radius)',
            'text-(--toast-dismiss-color) hover:bg-(--toast-dismiss-hover-bg)',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--toast-focus-ring-color)',
            'transition-colors cursor-pointer',
        ),
        closeIcon: cn('size-(--toast-dismiss-icon-size)'),
        content: cn('flex-1 min-w-0 flex flex-col gap-(--toast-content-gap)'),
        description: cn('text-(--toast-description-color) text-(--toast-description-size)'),
        icon: cn('shrink-0 size-(--toast-icon-size) text-(--toast-icon-color)'),
        progress: cn(
            'absolute inset-x-0 bottom-0',
            '[&[data-position=top]]:top-0 [&[data-position=top]]:bottom-auto',
            'h-(--toast-progress-height) rounded-(--toast-progress-radius) bg-(--toast-progress-bg)',
            'transition-[width] duration-(--toast-transition-duration) ease-(--toast-transition-easing)',
        ),
        region: cn(
            'fixed z-(--toast-z-index) flex flex-col gap-(--toast-gap) p-(--toast-offset)',
            'pointer-events-none max-h-screen overflow-hidden outline-none',
            'data-[focus-visible]:outline-2 data-[focus-visible]:outline-(--toast-focus-ring-color)',
        ),
        title: cn('text-(--toast-title-color) font-(--toast-title-weight)'),
        toast: cn(
            'relative pointer-events-auto overflow-hidden',
            'flex items-start gap-(--toast-inner-gap)',
            'w-full max-w-(--toast-max-width)',
            'px-(--toast-padding-x) py-(--toast-padding-y)',
            'rounded-(--toast-radius) shadow-(--toast-shadow)',
            '[border-width:var(--toast-border-width,0)] [border-color:var(--toast-border-color,transparent)]',
            'bg-(--toast-bg) text-(--toast-fg) text-(--toast-font-size)',
            'transition-all duration-(--toast-transition-duration) ease-(--toast-transition-easing)',
            'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-(--toast-focus-ring-color)',
        ),
    },
    typeMap: {
        failure: 'error' as ToastType,
        pending: 'info' as ToastType,
        success: 'success' as ToastType,
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const renderIcon = (content: QueueContent): ReactNode => content.icon === false ? null : Slot.render(content.icon, undefined, _B.slot.icon);
const renderCloseIcon = (content: QueueContent): ReactNode => content.closeIcon === false ? null : Slot.render(content.closeIcon, undefined, _B.slot.closeIcon) ?? <span aria-hidden className={_B.slot.closeIcon}>×</span>;
const wrapInViewTransition = (fn: () => void): void => {
    'startViewTransition' in document
        ? (document as Document & { startViewTransition: (fn: () => void) => { ready: Promise<void> } })
                .startViewTransition(() => flushSync(fn))
                .ready.catch((e) => { import.meta.env.DEV && console.debug('[Toast] View transition aborted:', e); })
        : fn();
};
const resolveTimeout = (value?: number): number =>
    pipe(
        Option.fromNullable(value),
        Option.filter((val) => val > 0),
        Option.orElse(() => pipe(Option.some(readCssMs(_B.cssVars.timeout)), Option.filter((val) => val > 0))),
        Option.getOrElse(() => _B.defaults.timeout),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const triggerHandlers = {
    Failure: (trigger: ToastTrigger) => Option.map(Option.fromNullable(trigger.failure), (msg): ToastPayload => ({ ...msg, position: trigger.position, progress: undefined, showDuration: undefined, style: trigger.style, type: _B.typeMap.failure })),
    Idle: () => Option.none<ToastPayload>(),
    Loading: (trigger: ToastTrigger) => Option.map(Option.fromNullable(trigger.pending), (msg): ToastPayload => ({ ...msg, position: trigger.position, progress: undefined, showDuration: undefined, style: trigger.style, type: _B.typeMap.pending })),
    Success: (trigger: ToastTrigger) => Option.map(Option.fromNullable(trigger.success), (msg): ToastPayload => ({ ...msg, position: trigger.position, progress: undefined, showDuration: undefined, style: trigger.style, type: _B.typeMap.success })),
} satisfies Record<AsyncState<unknown, unknown>['_tag'], (trigger: ToastTrigger) => Option.Option<ToastPayload>>;

// --- [SERVICES] --------------------------------------------------------------

const queueRegistry = new Map<ToastPosition, RACToastQueue<QueueContent>>();
const contentStore = new Map<string, { content: QueueContent; position: ToastPosition; timeout: number }>();
const subscriptions = new Set<() => void>();
const notifySubscribers = (): void => { A.map(A.fromIterable(subscriptions), (fn) => { fn(); }); };
const createQueue = (): RACToastQueue<QueueContent> =>
    new RACToastQueue<QueueContent>({
        maxVisibleToasts: pipe(
            Option.some(readCssInt(_B.cssVars.maxVisible)),
            Option.filter((val) => val > 0),
            Option.getOrElse(() => _B.defaults.maxVisible),
        ),
        wrapUpdate: wrapInViewTransition,
    });
const getQueue = (position: ToastPosition): RACToastQueue<QueueContent> =>
    pipe(
        Option.fromNullable(queueRegistry.get(position)),
        Option.getOrElse(() => {
            const queue = createQueue();
            queueRegistry.set(position, queue);
            return queue;
        }),
    );
const show = (payload: ToastPayload): string => {
    const { timeout, onClose, position = _B.defaults.position, ...content } = payload;
    const resolvedTimeout = resolveTimeout(timeout);
    const key = getQueue(position).add(content, { timeout: resolvedTimeout, ...(onClose !== undefined && { onClose }) });
    contentStore.set(key, { content, position, timeout: resolvedTimeout });
    return key;
};
const update = (key: string, partial: Partial<QueueContent>): boolean =>
    Option.match(Option.fromNullable(contentStore.get(key)), {
        onNone: () => false,
        onSome: (entry) => {
            contentStore.set(key, { ...entry, content: { ...entry.content, ...partial } });
            notifySubscribers();
            return true;
        },
    });
const promise = <A,>(
    thenable: Promise<A>,
    config: { readonly pending: ToastPayload; readonly success: ToastPayload | ((result: A) => ToastPayload); readonly failure: ToastPayload | ((error: unknown) => ToastPayload) },
): Promise<Option.Option<A>> => {
    const key = show({ ...config.pending, type: _B.typeMap.pending });
    return pipe(
        Effect.tryPromise({ catch: (error: unknown) => error, try: () => thenable }),
        Effect.tap((result) => Effect.sync(() => update(key, typeof config.success === 'function' ? config.success(result) : config.success))),
        Effect.tapError((error) => Effect.sync(() => update(key, typeof config.failure === 'function' ? config.failure(error) : config.failure))),
        Effect.option,
        Effect.runPromise,
    );
};
const isActive = (key: string): boolean => contentStore.has(key);
const dismiss = (key: string, position?: ToastPosition): void => {
    const storedPosition = position ?? contentStore.get(key)?.position;
    contentStore.delete(key);
    pipe(
        Option.fromNullable(storedPosition),
        Option.flatMap((pos) => Option.fromNullable(queueRegistry.get(pos))),
        Option.map((queue) => queue.close(key)),
    );
};
const dismissAll = (position?: ToastPosition): void => {
    const closeAll = (queue: RACToastQueue<QueueContent>): void => {
        A.map(queue.visibleToasts, (toastItem) => { contentStore.delete(toastItem.key); queue.close(toastItem.key); });
    };
    position
        ? Option.map(Option.fromNullable(queueRegistry.get(position)), closeAll)
        : pipe(A.fromIterable(queueRegistry.values()), A.map(closeAll));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const ToastRegion: FC<ToastRenderConfig> = ({ position = _B.defaults.position, style, className }) => {
    const queue = getQueue(position);
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        subscriptions.add(forceUpdate);
        return () => { subscriptions.delete(forceUpdate); };
    }, []);
    return (
        <RACToastRegion queue={queue} className={cn(_B.slot.region, className)} data-slot="toast-region" data-position={position} data-style={style}>
            {({ toast }) => {
                const entry = contentStore.get(toast.key);
                const content = entry?.content ?? toast.content;
                const timeout = entry?.timeout ?? _B.defaults.timeout;
                const progressMode = Match.value({ d: content.showDuration, p: content.progress }).pipe(
                    Match.when(({ p }) => typeof p === 'number', () => 'controlled' as const),
                    Match.when(({ d }) => d === true, () => 'duration' as const),
                    Match.orElse(() => undefined),
                );
                const progressStyle: CSSProperties | undefined = Match.value(progressMode).pipe(
                    Match.when((m) => m === 'controlled', () => ({ width: `${(content.progress ?? 0) * 100}%` })),
                    Match.when((m) => m === 'duration', () => ({ animation: `toast-countdown ${timeout}ms linear forwards` })),
                    Match.orElse(() => undefined),
                );
                return (
                    <RACToast toast={toast} className={_B.slot.toast} data-slot="toast" data-style={content.style ?? style} data-toast-type={content.type ?? _B.defaults.type} style={{ viewTransitionName: toast.key }}>
                        {renderIcon(content)}
                        <RACToastContent className={_B.slot.content} data-slot="toast-content">
                            <Text slot="title" className={_B.slot.title} data-slot="toast-title"> {content.title} </Text>
                            {content.description !== undefined && (<Text slot="description" className={_B.slot.description} data-slot="toast-description"> {content.description} </Text>)}
                        </RACToastContent>
                        {content.action !== undefined && (<Button className={_B.slot.action} data-slot="toast-action" onPress={content.action.onClick}> {content.action.label} </Button>)}
                        {(content.dismissible ?? _B.defaults.dismissible) && (<Button slot="close" className={_B.slot.close} data-slot="toast-close" aria-label="Dismiss notification">{renderCloseIcon(content)}</Button>)}
                        {progressMode !== undefined && (<div className={_B.slot.progress} data-slot="toast-progress" data-progress-mode={progressMode} style={progressStyle} />)}
                    </RACToast>
                );
            }}
        </RACToastRegion>
    );
};
const Provider: FC<ProviderProps> = ({ children, positions = [_B.defaults.position], style }) => (
    <>
        {children}
        {positions.map((position) => (<ToastRegion key={position} position={position} style={style} className={undefined} />))}
    </>
);
const useRender = (renderConfig?: ToastRenderConfig): (() => ReactNode) => useCallback(() => <ToastRegion position={renderConfig?.position} style={renderConfig?.style} className={renderConfig?.className} />, [renderConfig?.position, renderConfig?.style, renderConfig?.className]);
const useTrigger = (asyncState: AsyncState<unknown, unknown> | undefined, trigger: ToastTrigger | undefined): void => {
    const prevTagRef = useRef<string | undefined>(undefined);
    const triggerRef = useRef(trigger);
    triggerRef.current = trigger;
    useEffect(() => {
        const prevTag = prevTagRef.current;
        const currentTag = asyncState?._tag;
        prevTagRef.current = currentTag;
        const cfg = triggerRef.current;
        asyncState && cfg && prevTag !== undefined && prevTag !== currentTag && Option.map(triggerHandlers[asyncState._tag](cfg), show);
    }, [asyncState]);
};
const Toast = Object.freeze({
    dismiss,
    dismissAll,
    isActive,
    Provider,
    promise,
    show,
    update,
    useRender,
    useTrigger,
});

// --- [EXPORT] ----------------------------------------------------------------

export { Toast };
export type { ToastPayload, ToastPosition, ToastRenderConfig, ToastTrigger };
