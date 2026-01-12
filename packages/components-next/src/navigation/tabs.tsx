/**
 * Tabs: Navigation with TabList + Tab + TabPanel.
 * CSS variable inheritance - color/size/variant set on container, children inherit.
 * Supports href links on tabs for router integration, shouldForceMount on panels.
 * DnD reordering via onReorder prop - requires id on each Tab.
 * REQUIRED: color, size props on Tabs - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import { createContext, useContext, useMemo, useRef, type FC, type ReactNode, type Ref } from 'react';
import {
	Tab as RACTab, TabList as RACTabList, type TabListProps as RACTabListProps, TabPanel as RACTabPanel,
	type TabPanelProps as RACTabPanelProps, type TabProps as RACTabProps, type TabRenderProps, Tabs as RACTabs, type TabsProps as RACTabsProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import type { TextDropItem } from 'react-aria';
import { useDrag, useDrop } from 'react-aria';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { Badge, cn, composeTailwindRenderProps, defined, Slot, type BadgeValue, type SlotDef } from '../core/utils';
import type { AsyncState } from '@parametric-portal/types/async';

// --- [TYPES] -----------------------------------------------------------------

type TabPanelProps = RACTabPanelProps & { readonly ref?: Ref<HTMLDivElement>; };
type TabListProps<T extends object = object> = RACTabListProps<T>;
type TabsContextValue = {
	readonly color: string;
	readonly onReorder: ((fromId: string, toId: string) => void) | undefined;
	readonly size: string;
};
type TabsProps = Omit<RACTabsProps, 'children'> & {
	readonly children: ReactNode;
	readonly color: string;
	readonly onReorder?: (fromId: string, toId: string) => void;
	readonly ref?: Ref<HTMLDivElement>;
	readonly size: string;
	readonly variant?: string;
};
type TabProps = Omit<RACTabProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly badge?: BadgeValue;
	readonly children?: SlotDef<ReactNode> | ((state: TabRenderProps) => ReactNode);
	readonly gesture?: GestureProps;
	readonly icon?: SlotDef;
	readonly ref?: Ref<HTMLDivElement>;
	readonly tooltip?: TooltipConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({ badgeMax: '--tabs-tab-badge-max' }),
	slot: Object.freeze({
		list: cn(
			'flex gap-(--tabs-list-gap)',
			'bg-(--tabs-list-bg) p-(--tabs-list-padding) rounded-(--tabs-list-radius)',
			'border-(--tabs-list-border-width) border-(--tabs-list-border-color)',
			'data-[orientation=vertical]:flex-col',
		),
		panel: cn(
			'outline-none p-(--tabs-panel-padding)',
			'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		root: cn(
			'flex gap-(--tabs-gap)',
			'data-[orientation=vertical]:flex-row',
			'data-[orientation=horizontal]:flex-col',
		),
		tab: cn(
			'inline-flex items-center justify-center gap-(--tabs-tab-gap) cursor-pointer outline-none',
			'h-(--tabs-tab-height) px-(--tabs-tab-px)',
			'text-(--tabs-tab-font-size) font-(--tabs-tab-font-weight) rounded-(--tabs-tab-radius)',
			'bg-(--tabs-tab-bg) text-(--tabs-tab-fg)',
			'transition-colors duration-(--tabs-tab-transition-duration) ease-(--tabs-tab-transition-easing)',
			'hovered:bg-(--tabs-tab-hover-bg)',
			'selected:bg-(--tabs-tab-selected-bg) selected:text-(--tabs-tab-selected-fg)',
			'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--tabs-tab-disabled-opacity)',
		),
		tabBadge: cn(
			'inline-flex items-center justify-center',
			'min-w-(--tabs-tab-badge-min-width) px-(--tabs-tab-badge-padding-x)',
			'text-(--tabs-tab-badge-font-size) font-(--tabs-tab-badge-font-weight)',
			'bg-(--tabs-tab-badge-bg) text-(--tabs-tab-badge-fg)',
			'rounded-(--tabs-tab-badge-radius)',
		),
		tabIcon: cn('size-(--tabs-tab-icon-size) shrink-0'),
	}),
});
const TabsContext = createContext<TabsContextValue | null>(null);

// --- [ENTRY_POINT] -----------------------------------------------------------

const TabsRoot: FC<TabsProps> = ({ children, className, color, onReorder, ref, size, variant, ...racProps }) => {
	const contextValue = useMemo<TabsContextValue>(() => ({ color, onReorder, size }), [color, onReorder, size]);
	return (
		<RACTabs
			{...(racProps as RACTabsProps)}
			className={composeTailwindRenderProps(className, B.slot.root)}
			data-color={color}
			data-size={size}
			data-slot='tabs'
			data-variant={variant}
			ref={ref}
		>
			<TabsContext.Provider value={contextValue}>
				{children}
			</TabsContext.Provider>
		</RACTabs>
	);
};
const TabList = <T extends object = object>({ className, ...racProps }: TabListProps<T>): ReactNode => (
	<RACTabList
		{...(racProps as RACTabListProps<T>)}
		className={composeTailwindRenderProps(className, B.slot.list)}
		data-slot='tabs-list'
	/>
);
const Tab: FC<TabProps> = ({ asyncState, badge, children, className, gesture, icon, id, isDisabled, ref, tooltip, ...racProps }) => {
	const ctx = useContext(TabsContext);
	const onReorder = ctx?.onReorder;
	const tabRef = useRef<HTMLDivElement>(null);
	const mimeType = 'application/x-tabs-tab';
	const { dragProps: { slot: _ds, ...dragProps }, isDragging } = useDrag({
		getItems: () => [{ [mimeType]: String(id) }],
		isDisabled: !onReorder,
	});
	const { dropProps, isDropTarget } = useDrop({
		getDropOperation: (types) => types.has(mimeType) ? 'move' : 'cancel',
		isDisabled: !onReorder,
		onDrop: (e) => {
			const item = e.items.find((i) => i.kind === 'text' && i.types.has(mimeType)) as TextDropItem | undefined;
			const targetId = String(id);
			item?.getText(mimeType).then((fromId) => fromId !== targetId && onReorder?.(fromId, targetId));
		},
		ref: tabRef,
	});
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'tabs-tab',
		ref: tabRef,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, tabRef, tooltipProps.ref as Ref<HTMLDivElement>].filter(Boolean) as Array<Ref<HTMLDivElement>>);
	const isRenderFn = typeof children === 'function';
	const badgeLabel = Badge.useLabel(badge, tabRef, B.cssVars.badgeMax);
	return (
		<>
			<RACTab
				{...({ ...(onReorder ? { ...dragProps, ...dropProps } : {}), ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACTabProps)}
				className={composeTailwindRenderProps(className, B.slot.tab)}
				data-async-state={slot.attr}
				data-color={ctx?.color}
				data-dragging={isDragging || undefined}
				data-drop-target={isDropTarget || undefined}
				data-size={ctx?.size}
				data-slot='tabs-tab'
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...defined({ id })}
			>
				{(renderProps) => (
					<>
						{slot.render(icon, B.slot.tabIcon)}
						{isRenderFn
							? (children as (state: TabRenderProps) => ReactNode)(renderProps)
							: slot.resolve(children)}
						{badgeLabel !== null && <span className={B.slot.tabBadge}>{badgeLabel}</span>}
					</>
				)}
			</RACTab>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const TabPanel: FC<TabPanelProps> = ({ className, ref, ...racProps }) => (
	<RACTabPanel
		{...(racProps as RACTabPanelProps)}
		className={composeTailwindRenderProps(className, B.slot.panel)}
		data-slot='tabs-panel'
		ref={ref}
	/>
);

// --- [COMPOUND] --------------------------------------------------------------

const Tabs = Object.assign(TabsRoot, {
	List: TabList,
	Panel: TabPanel,
	Tab: Tab,
	useContext: (): TabsContextValue | null => useContext(TabsContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Tabs };
export type { TabListProps, TabPanelProps, TabProps, TabsProps };
