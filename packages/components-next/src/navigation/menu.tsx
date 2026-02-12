/**
 * Context/dropdown menu with sections, shortcuts, submenus, and destructive actions.
 * Requires color and size props. Supports SubmenuTrigger for nested menus.
 */
import { FloatingNode, useFloatingNodeId, useMergeRefs } from '@floating-ui/react';
import { Browser } from '@parametric-portal/runtime/browser';
import { readCssMs, readCssPx, Runtime } from '@parametric-portal/runtime/runtime';
import { AsyncState } from '@parametric-portal/types/async';
import { Effect, Match } from 'effect';
import { ChevronRight, Clipboard, Copy, Trash2 } from 'lucide-react';
import { createContext, createElement, type FC, type ReactElement, type ReactNode, type Ref, useCallback, useContext, useMemo, useRef } from 'react';
import {
    Header, type Key, type MenuItemRenderProps, MenuTrigger, Popover, Menu as RACMenu, MenuItem as RACMenuItem, type MenuItemProps as RACMenuItemProps, type MenuProps as RACMenuProps,
    MenuSection as RACMenuSection, type MenuSectionProps as RACMenuSectionProps, Separator, SubmenuTrigger as RACSubmenuTrigger,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type DialogConfig, useDialog } from '../overlays/dialog';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { Toast, type ToastTrigger } from '../core/toast';
import { Badge, cn, composeTailwindRenderProps, defined, Slot, type BadgeValue, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type MenuContextValue = { readonly color: string; readonly size: string; readonly variant: string | undefined };
type MenuProps<T extends object> = Omit<RACMenuProps<T>, 'children'> & {
    readonly children?: RACMenuProps<T>['children'];
    readonly color: string;
    readonly offset?: number;
    readonly onOpenChange?: (value: boolean) => void;
    readonly size: string;
    readonly trigger?: ReactNode;
    readonly triggerBehavior?: 'longPress' | 'press';
    readonly variant?: string;
};
type MenuItemProps = Omit<RACMenuItemProps, 'children' | 'onAction'> & {
    readonly asyncState?: AsyncState<unknown, unknown>;
    readonly badge?: BadgeValue;
    readonly children?: SlotDef<ReactNode> | ((state: MenuItemRenderProps) => ReactNode);
    readonly confirm?: DialogConfig;
    readonly copy?: boolean | string;
    readonly delete?: boolean;
    readonly destructive?: boolean;
    readonly gesture?: GestureProps;
    readonly icon?: SlotDef;
    readonly onAction?: (key: Key) => void;
    readonly paste?: boolean;
    readonly ref?: Ref<HTMLDivElement>;
    readonly shortcut?: string;
    readonly submenu?: ReactElement;
    readonly submenuAsyncState?: AsyncState<unknown, unknown>;
    readonly submenuDelay?: number;
    readonly submenuIndicator?: SlotDef;
    readonly submenuOffset?: number;
    readonly submenuSize?: string;
    readonly submenuSkeletonCount?: number;
    readonly toast?: ToastTrigger;
    readonly tooltip?: TooltipConfig;
};
type MenuSectionProps<T extends object = object> = Omit<RACMenuSectionProps<T>, 'children'> & {
    readonly children: RACMenuSectionProps<T>['children'];
    readonly title?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    cssVars: {
        badgeMax: '--menu-item-badge-max',
        offset: '--menu-popover-offset',
        submenuDelay: '--menu-submenu-delay',
        submenuOffset: '--menu-submenu-offset',
        submenuSkeletonCount: '--menu-submenu-skeleton-count',
    },
    defaults: {
        skeletonCount: 3,
    },
    presets: {
        copy: { icon: { default: Copy }, shortcut: '⌘C' },
        delete: { icon: { default: Trash2 }, shortcut: '⌘⌫' },
        paste: { icon: { default: Clipboard }, shortcut: '⌘V' },
    } as const,
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
} as const;
const MenuContext = createContext<MenuContextValue | null>(null);

// --- [COMPONENTS] ------------------------------------------------------------

const SubmenuSkeleton: FC<{ readonly count?: number }> = ({ count }) => {
    const resolvedCount = count ?? Math.max(1, Math.round(readCssPx(_B.cssVars.submenuSkeletonCount)) || _B.defaults.skeletonCount);
    return (
        <div className={_B.slot.submenuSkeletonContainer} data-slot='submenu-skeleton'>
            {Array.from({ length: resolvedCount }, (_element, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items are static, never reorder
                <div className={_B.slot.submenuSkeleton} key={index} />
            ))}
        </div>
    );
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const MenuRoot = <T extends object>({
    children, className, color, offset, onOpenChange, size, trigger, triggerBehavior, variant, ...racProps }: MenuProps<T>): ReactNode => {
    const nodeId = useFloatingNodeId();
    const resolvedOffset = offset ?? readCssPx(_B.cssVars.offset);
    const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
    const menu = (
        <MenuContext.Provider value={contextValue}>
            <RACMenu
                {...(racProps as RACMenuProps<T>)}
                className={composeTailwindRenderProps(className, _B.slot.menu)}
                data-color={color}
                data-size={size}
                data-slot='menu'
                data-variant={variant}
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
                    <Popover
                        className={_B.slot.popover}
                        data-color={color}
                        data-size={size}
                        data-slot='menu-popover'
                        data-theme='menu'
                        data-variant={variant}
                        offset={resolvedOffset}
                    >
                        {menu}
                    </Popover>
                </FloatingNode>
            </MenuTrigger>
    );
};
const MenuItem: FC<MenuItemProps> = ({
    asyncState, badge, children, className, confirm, copy, delete: deletePreset, destructive, gesture, icon: iconProp,
    isDisabled, onAction, paste, ref, shortcut: shortcutProp, submenu, submenuAsyncState, submenuDelay, submenuIndicator, submenuOffset, submenuSize,
    submenuSkeletonCount, textValue, toast, tooltip, ...racProps }) => {
    Toast.useTrigger(asyncState, toast);
    const dialogResult = useDialog(confirm);
    const menuCtx = useContext(MenuContext);
    const runtime = Runtime.use();
    const slot = Slot.bind(asyncState);
    const preset = Match.value({ copy, delete: deletePreset, paste }).pipe(
        Match.when(({ copy: c }) => Boolean(c), () => _B.presets.copy),
        Match.when(({ paste: p }) => Boolean(p), () => _B.presets.paste),
        Match.when(({ delete: d }) => Boolean(d), () => _B.presets.delete),
        Match.orElse(() => null),
    );
    const icon: SlotDef | undefined = iconProp ?? preset?.icon;
    const shortcut = shortcutProp ?? preset?.shortcut;
    const resolvedSubmenuSize = submenuSize ?? menuCtx?.size;
    const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
    const itemRef = useRef<HTMLDivElement>(null);
    const submenuNodeId = useFloatingNodeId();
    const hasSubmenu = submenu !== undefined;
    const submenuIsLoading = submenuAsyncState != null && AsyncState.$is('Loading')(submenuAsyncState);
    const resolvedSubmenuConfig = useMemo(
        () => hasSubmenu ? ({ delay: submenuDelay ?? readCssMs(_B.cssVars.submenuDelay), offset: submenuOffset ?? readCssPx(_B.cssVars.submenuOffset) }) : null,
        [hasSubmenu, submenuDelay, submenuOffset],
    );
    const badgeLabel = Badge.useLabel(badge, _B.cssVars.badgeMax);
    const { props: gestureProps } = useGesture({
        isDisabled: isDisabled || slot.pending,
        prefix: 'menu-item',
        ref: itemRef,
        ...gesture,
        ...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
    });
    const mergedRef = useMergeRefs([ref, itemRef, tooltipProps.ref as Ref<HTMLDivElement>]);
    const handleAction = useCallback(() => {
        const executeAction = (): void => {
            copy && runtime.runFork(Effect.gen(function* () { const svc = yield* Browser.Service; yield* svc.copy(typeof copy === 'string' ? copy : (textValue ?? '')); }));
            paste && runtime.runFork(Effect.gen(function* () { const svc = yield* Browser.Service; yield* svc.paste; }));
            racProps.id !== undefined && onAction?.(racProps.id);
        };
        confirm ? dialogResult.open(executeAction) : executeAction();
    }, [confirm, dialogResult, copy, paste, runtime, textValue, onAction, racProps.id]);
    const isRenderFn = typeof children === 'function';
    const itemContent = (
        <RACMenuItem
            {...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACMenuItemProps)}
            className={composeTailwindRenderProps(className, _B.slot.item)}
            data-async-state={slot.attr}
            data-destructive={destructive || undefined}
            data-slot='menu-item'
            isDisabled={isDisabled || slot.pending}
            onAction={handleAction}
            ref={mergedRef}
            {...defined({ textValue })}
        >
            {(renderProps) => (
                <>
                    {slot.render(icon, _B.slot.itemIcon)}
                    <span className='flex-1'>
                        {isRenderFn
                            ? (children as (state: MenuItemRenderProps) => ReactNode)(renderProps)
                            : slot.resolve(children)}
                    </span>
                    {hasSubmenu && slot.render(submenuIndicator ?? { default: ChevronRight }, _B.slot.submenuIndicator)}
                    {badgeLabel !== null && !hasSubmenu && <span className={_B.slot.itemBadge}>{badgeLabel}</span>}
                    {shortcut && !hasSubmenu && createElement('kbd', { className: _B.slot.shortcut }, shortcut)}
                </>
            )}
        </RACMenuItem>
    );
    const auxiliaryContent = (
        <>
            {renderTooltip?.()}
            <AsyncAnnouncer asyncState={asyncState} />
            {dialogResult.render?.()}
        </>
    );
    return hasSubmenu ? (
        <RACSubmenuTrigger delay={resolvedSubmenuConfig?.delay ?? readCssMs(_B.cssVars.submenuDelay)}>
            {itemContent}
            <FloatingNode id={submenuNodeId}>
                <Popover
                    className={_B.slot.submenuPopover}
                    data-color={menuCtx?.color}
                    data-theme='menu'
                    data-slot='submenu-popover'
                    offset={resolvedSubmenuConfig?.offset ?? readCssPx(_B.cssVars.submenuOffset)}
                    {...defined({ 'data-size': resolvedSubmenuSize, 'data-variant': menuCtx?.variant })}
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
const MenuSection = <T extends object = object>({ children, className, title, ...racProps }: MenuSectionProps<T>): ReactNode => (
    <RACMenuSection
        {...(racProps as RACMenuSectionProps<T>)}
        className={cn(_B.slot.section, className)}
        data-slot='menu-section'
    >
        {title && <Header className={_B.slot.sectionHeader}>{title}</Header>}
        {children as ReactNode}
    </RACMenuSection>
);
const MenuSeparator: FC<{ readonly className?: string }> = ({ className }) => (
    <Separator className={cn(_B.slot.separator, className)} data-slot='menu-separator' />
);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Menu = Object.assign(MenuRoot, {
    Item: MenuItem,
    Section: MenuSection,
    Separator: MenuSeparator,
    useContext: (): MenuContextValue | null => useContext(MenuContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Menu };
export type { MenuItemProps, MenuProps, MenuSectionProps };
