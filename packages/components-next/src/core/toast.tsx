/**
 * Toast notification system with lazy multi-queue architecture.
 * Direct API: Toast.show/dismiss work anywhere (no hook needed).
 * Provider API: Toast.Provider wraps app, renders regions for configured positions.
 * Hook API: Toast.useTrigger for component integration, Toast.useRender for manual region placement.
 * CSS variable driven styling via --toast-* namespace.
 *
 * Component integration pattern:
 *   <Button
 *     asyncState={saveState}
 *     toast={{ pending: { title: 'Saving...' }, success: { title: 'Done!' }, position: 'bottom-right' }}
 *   />
 */
import { readCssInt, readCssMs } from '@parametric-portal/runtime/runtime';
import type { AsyncState } from '@parametric-portal/types/async';
import { Array as A, Effect, Match, Option, pipe } from 'effect';
import type { CSSProperties, FC, ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';
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
type ToastRenderConfig = { readonly position?: ToastPosition | undefined; readonly style?: string | undefined; readonly className?: string | undefined; };
type ToastMessage = {
	readonly title: string;
	readonly description?: string | undefined;
	readonly dismissible?: boolean | undefined;
	readonly closeIcon?: SlotInput | false | undefined;
	readonly action?: { readonly label: string; readonly onClick: () => void } | undefined;
	readonly timeout?: number | undefined;
	readonly onClose?: (() => void) | undefined;
	readonly icon?: SlotInput | false | undefined;
};
type ToastPayload = ToastMessage & {
	readonly type?: ToastType | undefined;
	readonly style?: string | undefined;
	readonly position?: ToastPosition | undefined;
	readonly progress?: number | undefined;
	readonly showDuration?: boolean | undefined;
};
type ToastTrigger = {
	readonly pending?: ToastMessage | undefined;
	readonly success?: ToastMessage | undefined;
	readonly failure?: ToastMessage | undefined;
	readonly style?: string | undefined;
	readonly position?: ToastPosition | undefined;
};
type ProviderProps = {
	readonly children: ReactNode;
	readonly positions?: readonly ToastPosition[] | undefined;
	readonly style?: string | undefined;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		maxVisible: '--toast-max-visible',
		timeout: '--toast-timeout',
	}),
	defaults: Object.freeze({
		dismissible: true,
		maxVisible: 5,
		position: 'bottom-right' as ToastPosition,
		timeout: 5000,
		type: 'info' as ToastType,
	}),
	slot: Object.freeze({
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
	}),
	typeMap: Object.freeze({
		failure: 'error' as ToastType,
		pending: 'info' as ToastType,
		success: 'success' as ToastType,
	}),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const renderIcon = (content: QueueContent): ReactNode => content.icon === false ? null : Slot.render(content.icon, undefined, B.slot.icon);
const renderCloseIcon = (content: QueueContent): ReactNode => content.closeIcon === false ? null : Slot.render(content.closeIcon, undefined, B.slot.closeIcon) ?? <span aria-hidden className={B.slot.closeIcon}>×</span>;
const wrapInViewTransition = (fn: () => void): void => {
	'startViewTransition' in document
		? (document as Document & { startViewTransition: (fn: () => void) => { ready: Promise<void> } })
				.startViewTransition(() => flushSync(fn))
				.ready.catch(() => {})
		: fn();
};
const resolveTimeout = (value?: number): number =>
	pipe(
		Option.fromNullable(value),
		Option.filter((v) => v > 0),
		Option.orElse(() => pipe(Option.some(readCssMs(B.cssVars.timeout)), Option.filter((v) => v > 0))),
		Option.getOrElse(() => B.defaults.timeout),
	);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const triggerHandlers = {
	Failure: (t: ToastTrigger) => Option.map(Option.fromNullable(t.failure), (m): ToastPayload => ({ ...m, position: t.position, style: t.style, type: B.typeMap.failure })),
	Idle: () => Option.none<ToastPayload>(),
	Loading: (t: ToastTrigger) => Option.map(Option.fromNullable(t.pending), (m): ToastPayload => ({ ...m, position: t.position, style: t.style, type: B.typeMap.pending })),
	Success: (t: ToastTrigger) => Option.map(Option.fromNullable(t.success), (m): ToastPayload => ({ ...m, position: t.position, style: t.style, type: B.typeMap.success })),
} satisfies Record<AsyncState<unknown, unknown>['_tag'], (t: ToastTrigger) => Option.Option<ToastPayload>>;

// --- [GLOBAL_QUEUE] ----------------------------------------------------------

const queueRegistry = new Map<ToastPosition, RACToastQueue<QueueContent>>();
const contentStore = new Map<string, { content: QueueContent; position: ToastPosition; timeout: number }>();
const subscriptions = new Set<() => void>();
const notifySubscribers = (): void => { subscriptions.forEach((fn) => { fn(); }); };
const createQueue = (): RACToastQueue<QueueContent> =>
	new RACToastQueue<QueueContent>({
		maxVisibleToasts: pipe(
			Option.some(readCssInt(B.cssVars.maxVisible)),
			Option.filter((v) => v > 0),
			Option.getOrElse(() => B.defaults.maxVisible),
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

// --- [DIRECT_API] ------------------------------------------------------------

const show = (payload: ToastPayload): string => {
	const { timeout, onClose, position = B.defaults.position, ...content } = payload;
	const resolvedTimeout = resolveTimeout(timeout);
	const key = getQueue(position).add(content, { timeout: resolvedTimeout, ...(onClose !== undefined && { onClose }) });
	contentStore.set(key, { content, position, timeout: resolvedTimeout });
	return key;
};
const update = (key: string, partial: Partial<QueueContent>): void =>
	Option.match(Option.fromNullable(contentStore.get(key)), {
		onNone: () => {},
		onSome: (entry) => {
			contentStore.set(key, { ...entry, content: { ...entry.content, ...partial } });
			notifySubscribers();
		},
	});
const promise = <A, E>(
	thenable: Promise<A>,
	config: { readonly pending: ToastPayload; readonly success: ToastPayload | ((a: A) => ToastPayload); readonly failure: ToastPayload | ((e: E) => ToastPayload) },
): Promise<A> => {
	const key = show({ ...config.pending, type: B.typeMap.pending });
	return pipe(
		Effect.tryPromise({ catch: (e) => e as E, try: () => thenable }),
		Effect.tap((a) => Effect.sync(() => update(key, typeof config.success === 'function' ? config.success(a) : config.success))),
		Effect.tapError((e) => Effect.sync(() => update(key, typeof config.failure === 'function' ? config.failure(e) : config.failure))),
		Effect.runPromise,
	);
};
const isActive = (key: string): boolean => contentStore.has(key);
const dismiss = (key: string, position?: ToastPosition): void => {
	contentStore.delete(key);
	pipe(
		position ? Option.fromNullable(queueRegistry.get(position)) : A.findFirst(A.fromIterable(queueRegistry.values()), (q) => q.visibleToasts.some((t) => t.key === key)),
		Option.map((q) => q.close(key)),
	);
};
const dismissAll = (position?: ToastPosition): void => {
	const closeAll = (queue: RACToastQueue<QueueContent>): void => {queue.visibleToasts.forEach((t) => { contentStore.delete(t.key); queue.close(t.key); });};
	position ? Option.map(Option.fromNullable(queueRegistry.get(position)), closeAll) : queueRegistry.forEach(closeAll);
};

// --- [COMPONENTS] ------------------------------------------------------------

const ToastRegion: FC<ToastRenderConfig> = ({ position = B.defaults.position, style, className }) => {
	const queue = getQueue(position);
	const renderTrigger = useRef(0);
	useEffect(() => {
		const sub = (): void => { renderTrigger.current += 1; };
		subscriptions.add(sub);
		return () => { subscriptions.delete(sub); };
	}, []);
	return (
		<RACToastRegion queue={queue} className={cn(B.slot.region, className)} data-slot="toast-region" data-position={position} data-style={style}>
			{({ toast }) => {
				const entry = contentStore.get(toast.key);
				const content = entry?.content ?? toast.content;
				const timeout = entry?.timeout ?? B.defaults.timeout;
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
					<RACToast toast={toast} className={B.slot.toast} data-slot="toast" data-style={content.style ?? style} data-toast-type={content.type ?? B.defaults.type} style={{ viewTransitionName: toast.key }}>
						{renderIcon(content)}
						<RACToastContent className={B.slot.content} data-slot="toast-content">
							<Text slot="title" className={B.slot.title} data-slot="toast-title"> {content.title} </Text>
							{content.description !== undefined && (<Text slot="description" className={B.slot.description} data-slot="toast-description"> {content.description} </Text>)}
						</RACToastContent>
						{content.action !== undefined && (<Button className={B.slot.action} data-slot="toast-action" onPress={content.action.onClick}> {content.action.label} </Button>)}
						{(content.dismissible ?? B.defaults.dismissible) && (<Button slot="close" className={B.slot.close} data-slot="toast-close" aria-label="Dismiss notification">{renderCloseIcon(content)}</Button>)}
						{progressMode !== undefined && (<div className={B.slot.progress} data-slot="toast-progress" data-progress-mode={progressMode} style={progressStyle} />)}
					</RACToast>
				);
			}}
		</RACToastRegion>
	);
};
const Provider: FC<ProviderProps> = ({ children, positions = [B.defaults.position], style }) => (
	<>
		{children}
		{positions.map((position) => (<ToastRegion key={position} position={position} style={style} />))}
	</>
);

// --- [HOOKS] -----------------------------------------------------------------

const useRender = (cfg?: ToastRenderConfig): (() => ReactNode) => useCallback(() => <ToastRegion position={cfg?.position} style={cfg?.style} className={cfg?.className} />, [cfg?.position, cfg?.style, cfg?.className]);
const useTrigger = (asyncState: AsyncState<unknown, unknown> | undefined, trigger: ToastTrigger | undefined): void => {
	const prevTagRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		const prevTag = prevTagRef.current;
		prevTagRef.current = asyncState?._tag;
		asyncState && trigger && prevTag !== undefined && prevTag !== asyncState._tag && Option.map(triggerHandlers[asyncState._tag](trigger), show);
	}, [asyncState, trigger]);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

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
