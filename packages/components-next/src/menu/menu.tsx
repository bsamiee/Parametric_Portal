/**
 * Menu: Context/dropdown menu with sections, shortcuts, submenus, and destructive actions.
 * CSS variable inheritance - color/size set on Menu, children inherit.
 * REQUIRED: color, size props on Menu. Optional trigger prop for self-contained usage.
 * Supports: SubmenuTrigger for nested menus, href links on items, section-level selection.
 */
import { FloatingNode, useFloatingNodeId, useMergeRefs } from '@floating-ui/react';
import { useClipboard } from '@parametric-portal/runtime/hooks/browser';
import { readCssMs, readCssPx } from '@parametric-portal/runtime/runtime';
import { AsyncState } from '@parametric-portal/types/async';
import { ChevronRight, Clipboard, Copy, Trash2 } from 'lucide-react';
import { createContext, createElement, type FC, type ReactElement, type ReactNode, type Ref, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
	type Key, Header, MenuTrigger, Popover, Menu as RACMenu, MenuItem as RACMenuItem, type MenuItemProps as RACMenuItemProps, type MenuProps as RACMenuProps,
	MenuSection as RACMenuSection, type MenuSectionProps as RACMenuSectionProps, Separator, type Selection, SubmenuTrigger as RACSubmenuTrigger,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip } from '../core/floating';
import { type LongPressProps, useLongPressGesture } from '../core/gesture';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';
import { type ConfirmConfig, ConfirmDialog, useConfirm } from './confirm';

// --- [TYPES] -----------------------------------------------------------------

type SelectionMode = 'multiple' | 'none' | 'single';
type MenuContextValue = { readonly size: string };
type MenuItemState = {
	readonly hasSubmenu: boolean;
	readonly isDisabled: boolean;
	readonly isFocused: boolean;
	readonly isFocusVisible: boolean;
	readonly isHovered: boolean;
	readonly isOpen: boolean;
	readonly isPressed: boolean;
	readonly isSelected: boolean;
	readonly selectionMode: SelectionMode;
};
type UseMenuReturn = {
	readonly close: () => void;
	readonly isOpen: boolean;
	readonly menuProps: { readonly onOpenChange: (open: boolean) => void };
	readonly open: () => void;
	readonly toggle: () => void;
};
type MenuSpecificProps<T extends object> = {
	readonly children: ReactNode | ((item: T) => ReactNode);
	readonly className?: RACMenuProps<T>['className'];
	readonly defaultSelectedKeys?: Iterable<Key> | 'all';
	readonly dependencies?: readonly unknown[];
	readonly disallowEmptySelection?: boolean;
	readonly escapeKeyBehavior?: 'clearSelection' | 'none';
	readonly items?: Iterable<T>;
	readonly offset?: number;
	readonly onAction?: (key: Key) => void;
	readonly onSelectionChange?: (keys: Selection) => void;
	readonly renderEmptyState?: () => ReactNode;
	readonly selectedKeys?: Iterable<Key> | 'all';
	readonly selectionMode?: SelectionMode;
	readonly trigger?: ReactNode;
	readonly triggerBehavior?: 'longPress' | 'press';
};
type MenuItemSpecificProps = {
	readonly children?: SlotDef<ReactNode> | ((state: MenuItemState) => ReactNode);
	readonly className?: RACMenuItemProps['className'];
	readonly confirm?: ConfirmConfig;
	readonly copy?: boolean | string;
	readonly delete?: boolean;
	readonly destructive?: boolean;
	readonly isDisabled?: boolean;
	readonly longPress?: LongPressProps;
	readonly onAction?: () => void;
	readonly paste?: boolean;
	readonly shortcut?: string;
	readonly submenu?: ReactElement;
	readonly submenuAsyncState?: AsyncState<unknown, unknown>;
	readonly submenuDelay?: number;
	readonly submenuIndicator?: SlotDef;
	readonly submenuOffset?: number;
	readonly submenuSize?: string;
	readonly submenuSkeletonCount?: number;
	readonly textValue?: string;
};
type MenuSectionSpecificProps<T extends object = object> = {
	readonly children: ReactNode | ((item: T) => ReactElement);
	readonly className?: string;
	readonly defaultSelectedKeys?: Iterable<Key> | 'all';
	readonly dependencies?: readonly unknown[];
	readonly disallowEmptySelection?: boolean;
	readonly items?: Iterable<T>;
	readonly onSelectionChange?: (keys: Selection) => void;
	readonly selectedKeys?: Iterable<Key> | 'all';
	readonly selectionMode?: SelectionMode;
	readonly title?: string;
};
type MenuProps<T extends object> = BasePropsFor<'menu'> & MenuSpecificProps<T>;
type MenuItemProps = BasePropsFor<'menuItem'> & MenuItemSpecificProps;
type MenuSectionProps<T extends object = object> = BasePropsFor<'menuSection'> & MenuSectionSpecificProps<T>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		badgeMax: '--menu-item-badge-max',
		hapticDuration: '--menu-item-longpress-haptic-duration',
		longPressThreshold: '--menu-item-longpress-threshold',
		offset: '--menu-popover-offset',
		submenuDelay: '--menu-submenu-delay',
		submenuOffset: '--menu-submenu-offset',
		submenuSkeletonCount: '--menu-submenu-skeleton-count',
	}),
	slot: {
		item: cn(
			'flex items-center gap-(--menu-item-gap) cursor-pointer outline-none',
			'h-(--menu-item-height) px-(--menu-item-px)',
			'text-(--menu-item-font-size) text-(--menu-item-fg)',
			'rounded-(--menu-item-radius)',
			'hovered:bg-(--menu-item-hover-bg)',
			'pressed:bg-(--menu-item-pressed-bg)',
			'selected:bg-(--menu-item-selected-bg) selected:text-(--menu-item-selected-fg)',
			'focused:bg-(--menu-item-focused-bg)',
			'disabled:pointer-events-none disabled:opacity-(--menu-item-disabled-opacity)',
			'data-[destructive]:text-(--menu-item-destructive-fg)',
			'data-[destructive]:hovered:bg-(--menu-item-destructive-hover-bg)',
		),
		itemBadge: cn(
			'inline-flex items-center justify-center ml-auto',
			'min-w-(--menu-item-badge-min-width) px-(--menu-item-badge-padding-x)',
			'text-(--menu-item-badge-font-size)',
			'bg-(--menu-item-badge-bg) text-(--menu-item-badge-fg)',
			'rounded-(--menu-item-badge-radius)',
		),
		itemIcon: cn('size-(--menu-item-icon-size) shrink-0'),
		menu: cn('outline-none p-(--menu-padding)'),
		popover: cn(
			'bg-(--menu-bg) rounded-(--menu-radius) shadow-(--menu-shadow)',
			'border-(--menu-border-width) border-(--menu-border-color)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--menu-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--menu-popover-animation-scale)',
			'placement-top:slide-in-from-bottom-(--menu-popover-animation-offset)',
			'placement-bottom:slide-in-from-top-(--menu-popover-animation-offset)',
		),
		section: cn(''),
		sectionHeader: cn(
			'px-(--menu-section-header-px) py-(--menu-section-header-py)',
			'text-(--menu-section-header-font-size) text-(--menu-section-header-fg) font-(--menu-section-header-font-weight)',
		),
		separator: cn('h-(--menu-separator-height) my-(--menu-separator-my) bg-(--menu-separator-color)'),
		shortcut: cn('ml-auto text-(--menu-shortcut-font-size) text-(--menu-shortcut-fg)'),
		submenuIndicator: cn(
			'ml-auto shrink-0',
			'size-(--menu-submenu-indicator-size)',
			'text-(--menu-submenu-indicator-color)',
		),
		submenuPopover: cn(
			'bg-(--menu-bg) rounded-(--menu-radius) shadow-(--menu-shadow)',
			'border-(--menu-border-width) border-(--menu-border-color)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--menu-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--menu-popover-animation-scale)',
			'placement-left:slide-in-from-right-(--menu-popover-animation-offset)',
			'placement-right:slide-in-from-left-(--menu-popover-animation-offset)',
		),
		submenuSkeleton: cn(
			'animate-pulse',
			'rounded-(--menu-submenu-skeleton-radius)',
			'bg-(--menu-submenu-skeleton-bg)',
			'h-(--menu-submenu-skeleton-height)',
		),
		submenuSkeletonContainer: cn(
			'flex flex-col',
			'gap-(--menu-submenu-skeleton-gap)',
			'p-(--menu-padding)',
		),
	} as const,
});
const MenuContext = createContext<MenuContextValue | null>(null);
const useMenuContext = (): MenuContextValue | null => useContext(MenuContext);

// --- [COMPONENTS] ------------------------------------------------------------

const SubmenuSkeleton: FC<{ readonly count?: number }> = ({ count }) => {
	const resolvedCount = count ?? Math.max(1, Math.round(readCssPx(B.cssVars.submenuSkeletonCount)) || 3);
	return (
		<div className={B.slot.submenuSkeletonContainer} data-slot='submenu-skeleton'>
			{Array.from({ length: resolvedCount }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static, never reorder
				<div className={B.slot.submenuSkeleton} key={i} />
			))}
		</div>
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Menu = <T extends object>({
	autoFocus, children, className, color, defaultSelectedKeys, dependencies, disallowEmptySelection,
    escapeKeyBehavior, items, offset, onClose, onOpenChange, onSelectionChange, renderEmptyState,
    selectedKeys, selectionMode, size, slot, trigger, triggerBehavior,
	...rest
}: MenuProps<T>): ReactNode => {
	const nodeId = useFloatingNodeId();
	const resolvedOffset = offset ?? readCssPx(B.cssVars.offset);
	const contextValue = useMemo(() => ({ size }), [size]);
	const menu = (
		<MenuContext.Provider value={contextValue}>
			<RACMenu
				{...({ ...rest } as unknown as RACMenuProps<T>)}
				className={composeTailwindRenderProps(className, B.slot.menu)}
				data-color={color}
				data-size={size}
				data-slot='menu'
				{...defined({ autoFocus, defaultSelectedKeys, dependencies, disallowEmptySelection, escapeKeyBehavior, items, onClose, onSelectionChange, renderEmptyState, selectedKeys, selectionMode, slot })}
			>
				{children}
			</RACMenu>
		</MenuContext.Provider>
	);
	return trigger === undefined ? (
		menu
	) : (
		<MenuTrigger {...defined({ onOpenChange, trigger: triggerBehavior })}>
			{trigger}
			<FloatingNode id={nodeId}>
				<Popover className={B.slot.popover} data-color={color} data-size={size} data-slot='menu-popover' offset={resolvedOffset}>
					{menu}
				</Popover>
			</FloatingNode>
		</MenuTrigger>
	);
};
const MenuItem: FC<MenuItemProps> = ({
	asyncState, badge, children, className, confirm, copy, delete: deletePreset, destructive, download, href,
	icon: iconProp, isDisabled, longPress, paste, ref, rel, shortcut: shortcutProp, submenu, submenuAsyncState,
	submenuDelay, submenuIndicator, submenuOffset, submenuSize, submenuSkeletonCount, target, textValue, tooltip,
	...rest
}) => {
	const confirmState = useConfirm();
	const menuCtx = useMenuContext();
	const clipboard = useClipboard();
	const slot = Slot.bind(asyncState);
	const icon: SlotDef | undefined = iconProp ?? (
		copy ? { default: Copy } :
		paste ? { default: Clipboard } :
		deletePreset ? { default: Trash2 } :
		undefined
	);
	const shortcut = shortcutProp ?? (
		copy ? '⌘C' :
		paste ? '⌘V' :
		deletePreset ? '⌘⌫' :
		undefined
	);
	const resolvedSubmenuSize = submenuSize ?? menuCtx?.size;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const itemRef = useRef<HTMLDivElement>(null);
	const submenuNodeId = useFloatingNodeId();
	const hasSubmenu = submenu !== undefined;
	const submenuIsLoading = AsyncState.isPending(submenuAsyncState);
	const resolvedSubmenuConfig = useMemo(
		() => hasSubmenu ? ({ delay: submenuDelay ?? readCssMs(B.cssVars.submenuDelay), offset: submenuOffset ?? readCssPx(B.cssVars.submenuOffset) }) : null,
		[hasSubmenu, submenuDelay, submenuOffset],
	);
	const { badgeMax, hapticMs, defaultThresholdMs } = useMemo(
		() => ({ badgeMax: readCssPx(B.cssVars.badgeMax) || 99, defaultThresholdMs: readCssMs(B.cssVars.longPressThreshold), hapticMs: readCssMs(B.cssVars.hapticDuration) }),
		[],
	);
	const { props: longPressProps } = useLongPressGesture({
		cssVar: '--menu-item-longpress-progress',
		defaultThresholdMs,
		hapticMs,
		isDisabled: isDisabled || slot.pending,
		props: longPress,
		ref: itemRef,
	});
	const mergedRef = useMergeRefs([ref, itemRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	const { onAction: originalOnAction, ...restWithoutAction } = rest as { onAction?: () => void };
	const handleAction = useCallback(() => {
		const executeAction = (): void => {
			copy && clipboard.copy(typeof copy === 'string' ? copy : (textValue ?? ''));
			paste && clipboard.paste();
			originalOnAction?.();
		};
		confirm ? confirmState.open(executeAction) : executeAction();
	}, [confirm, confirmState, copy, paste, clipboard, textValue, originalOnAction]);
	const isRenderFn = typeof children === 'function';
	const itemContent = (
		<RACMenuItem
			{...({ ...restWithoutAction, ...tooltipProps, ...longPressProps } as unknown as RACMenuItemProps)}
			className={composeTailwindRenderProps(className, B.slot.item)}
			data-async-state={slot.attr}
			data-destructive={destructive || undefined}
			data-slot='menu-item'
			isDisabled={isDisabled || slot.pending}
			onAction={handleAction}
			ref={mergedRef}
			{...defined({ download, href, rel, target, textValue })}
		>
			{(renderProps) => (
				<>
					{slot.render(icon, B.slot.itemIcon)}
					<span className='flex-1'>
						{isRenderFn
							? (children as (state: MenuItemState) => ReactNode)({
								hasSubmenu,
								isDisabled: renderProps.isDisabled,
								isFocused: renderProps.isFocused,
								isFocusVisible: renderProps.isFocusVisible,
								isHovered: renderProps.isHovered,
								isOpen: renderProps.isOpen,
								isPressed: renderProps.isPressed,
								isSelected: renderProps.isSelected,
								selectionMode: renderProps.selectionMode,
							})
							: slot.resolve(children)}
					</span>
					{hasSubmenu && slot.render(submenuIndicator ?? { default: ChevronRight }, B.slot.submenuIndicator)}
					{badge !== undefined && !hasSubmenu && (
						<span className={B.slot.itemBadge}> {typeof badge === 'number' && badge > badgeMax ? `${badgeMax}+` : badge} </span>
					)}
					{shortcut && !hasSubmenu && createElement('kbd', { className: B.slot.shortcut }, shortcut)}
				</>
			)}
		</RACMenuItem>
	);
	const auxiliaryContent = (
		<>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
			{confirmState.isOpen && confirm && (
				<ConfirmDialog config={confirm} onCancel={confirmState.cancel} onConfirm={confirmState.confirm} />
			)}
		</>
	);
	return hasSubmenu ? (
		<RACSubmenuTrigger delay={resolvedSubmenuConfig?.delay ?? readCssMs(B.cssVars.submenuDelay)}>
			{itemContent}
			<FloatingNode id={submenuNodeId}>
				<Popover
					className={B.slot.submenuPopover}
					data-slot='submenu-popover'
					offset={resolvedSubmenuConfig?.offset ?? readCssPx(B.cssVars.submenuOffset)}
					{...defined({ 'data-size': resolvedSubmenuSize })}
				>
					{submenuIsLoading ? <SubmenuSkeleton {...defined({ count: submenuSkeletonCount })} /> : submenu}
				</Popover>
			</FloatingNode>
			{auxiliaryContent}
		</RACSubmenuTrigger>
	) : (
		<>
			{itemContent}
			{auxiliaryContent}
		</>
	);
};
const MenuSection = <T extends object = object>({
	children, className, defaultSelectedKeys, dependencies, disabledKeys, disallowEmptySelection, id,
	items, onSelectionChange, selectedKeys, selectionMode, title,
	...rest
}: MenuSectionProps<T>): ReactNode => (
	<RACMenuSection
		{...({ ...rest } as unknown as RACMenuSectionProps<T>)}
		className={cn(B.slot.section, className)}
		data-slot='menu-section'
		{...defined({ defaultSelectedKeys, dependencies, disabledKeys, disallowEmptySelection, id, items, onSelectionChange, selectedKeys, selectionMode })}
	>
		{title && <Header className={B.slot.sectionHeader}>{title}</Header>}
		{children as ReactNode}
	</RACMenuSection>
);
const MenuSeparator: FC<{ readonly className?: string }> = ({ className }) => (
	<Separator className={cn(B.slot.separator, className)} data-slot='menu-separator' />
);

// --- [HOOKS] -----------------------------------------------------------------

const useMenu = (defaultOpen = false): UseMenuReturn => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	return useMemo(() => ({
		close: () => setIsOpen(false),
		isOpen,
		menuProps: { onOpenChange: setIsOpen },
		open: () => setIsOpen(true),
		toggle: () => setIsOpen((v) => !v),
	}), [isOpen]);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Menu, MenuItem, MenuSection, MenuSeparator, useMenu };
export type { MenuItemProps, MenuItemState, MenuProps, MenuSectionProps, SelectionMode, UseMenuReturn };
