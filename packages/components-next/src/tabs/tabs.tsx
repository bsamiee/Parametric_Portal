/**
 * Tabs: Navigation with TabList + Tab + TabPanel.
 * CSS variable inheritance - color/size/variant set on container, children inherit.
 * Supports href links on tabs for router integration, shouldForceMount on panels.
 * REQUIRED: color, size props on Tabs - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { FC, ReactNode, Ref } from 'react';
import {
	type Key, Tab as RACTab, TabList as RACTabList, type TabListProps as RACTabListProps, TabPanel as RACTabPanel,
    type TabPanelProps as RACTabPanelProps, type TabProps as RACTabProps, Tabs as RACTabs, type TabsProps as RACTabsProps,
} from 'react-aria-components';
import { useTooltip } from '../core/floating';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';
import { AsyncAnnouncer } from '../core/announce';

// --- [TYPES] -----------------------------------------------------------------

type TabState = {
	readonly isDisabled: boolean;
	readonly isFocused: boolean;
	readonly isFocusVisible: boolean;
	readonly isHovered: boolean;
	readonly isPressed: boolean;
	readonly isSelected: boolean;
};
type TabsSpecificProps = {
	readonly children: ReactNode;
	readonly className?: RACTabsProps['className'];
	readonly defaultSelectedKey?: Key;
	readonly isDisabled?: boolean;
	readonly keyboardActivation?: 'automatic' | 'manual';
	readonly onSelectionChange?: (key: Key) => void;
	readonly ref?: Ref<HTMLDivElement>;
	readonly selectedKey?: Key | null;
};
type TabListSpecificProps<T extends object = object> = {
	readonly children: ReactNode | ((item: T) => ReactNode);
	readonly className?: RACTabListProps<T>['className'];
	readonly dependencies?: readonly unknown[];
	readonly items?: Iterable<T>;
};
type TabSpecificProps = {
	readonly children?: SlotDef<ReactNode> | ((state: TabState) => ReactNode);
	readonly className?: RACTabProps['className'];
	readonly isDisabled?: boolean;
};
type TabPanelSpecificProps = {
	readonly children?: ReactNode;
	readonly className?: RACTabPanelProps['className'];
	readonly ref?: Ref<HTMLDivElement>;
	readonly shouldForceMount?: boolean;
};
type TabsProps = BasePropsFor<'tabs'> & TabsSpecificProps;
type TabListProps<T extends object = object> = BasePropsFor<'tabList'> & TabListSpecificProps<T>;
type TabProps = BasePropsFor<'tab'> & TabSpecificProps;
type TabPanelProps = BasePropsFor<'tabPanel'> & TabPanelSpecificProps;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: {
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
	} as const,
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Tabs: FC<TabsProps> = ({ children, className, color, ref, size, slot, variant, ...rest }) => (
	<RACTabs
		{...({ ...rest } as unknown as RACTabsProps)}
		className={composeTailwindRenderProps(className, B.slot.root)}
		data-color={color}
		data-size={size}
		data-slot='tabs'
		data-variant={variant}
		ref={ref}
		{...defined({ slot })}
	>
		{children}
	</RACTabs>
);
const TabList = <T extends object = object>({
	children, className, dependencies, items,
	...rest
}: TabListProps<T>): ReactNode => (
	<RACTabList
		{...({ ...rest } as unknown as RACTabListProps<T>)}
		className={composeTailwindRenderProps(className, B.slot.list)}
		data-slot='tabs-list'
		{...defined({ dependencies, items })}
	>
		{children}
	</RACTabList>
);
const Tab: FC<TabProps> = ({
	asyncState, badge, children, className, download, href, icon, isDisabled, ref, rel,
	target, tooltip,
	...rest
}) => {
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const isRenderFn = typeof children === 'function';
	return (
		<>
			<RACTab
				{...({ ...rest, ...tooltipProps } as unknown as RACTabProps)}
				className={composeTailwindRenderProps(className, B.slot.tab)}
				data-async-state={slot.attr}
				data-slot='tabs-tab'
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...defined({ download, href, rel, target })}
			>
				{(renderProps) => (
					<>
						{slot.render(icon, B.slot.tabIcon)}
						{isRenderFn
							? (children as (state: TabState) => ReactNode)({
								isDisabled: renderProps.isDisabled,
								isFocused: renderProps.isFocused,
								isFocusVisible: renderProps.isFocusVisible,
								isHovered: renderProps.isHovered,
								isPressed: renderProps.isPressed,
								isSelected: renderProps.isSelected,
							})
							: slot.resolve(children)}
						{badge !== undefined && ( <span className={B.slot.tabBadge}> {typeof badge === 'number' && badge > 99 ? '99+' : badge} </span> )}
					</>
				)}
			</RACTab>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const TabPanel: FC<TabPanelProps> = ({ children, className, ref, shouldForceMount, ...rest }) => (
	<RACTabPanel
		{...({ ...rest } as unknown as RACTabPanelProps)}
		className={composeTailwindRenderProps(className, B.slot.panel)}
		data-slot='tabs-panel'
		ref={ref}
		{...defined({ shouldForceMount })}
	>
		{children}
	</RACTabPanel>
);

// --- [EXPORT] ----------------------------------------------------------------

export { Tab, TabList, TabPanel, Tabs };
export type { TabListProps, TabPanelProps, TabProps, TabsProps, TabState };
