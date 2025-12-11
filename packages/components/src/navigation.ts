/**
 * Navigation components: render breadcrumb, pagination, tabs with keyboard support.
 * Uses B, utilities, animStyle, stateCls from schema.ts with React Aria tab management.
 */
import type { CSSProperties, FC, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import { useFocusRing, useTab, useTabList, useTabPanel } from 'react-aria';
import type { Key, Node, TabListState } from 'react-stately';
import { Item, useTabListState } from 'react-stately';
import type { Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, merged, pick, resolve, stateCls, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type NavType = 'breadcrumb' | 'pagination' | 'tabs';
type TabOrientation = 'horizontal' | 'vertical';
type TabItem = {
    readonly content: ReactNode;
    readonly disabled?: boolean;
    readonly key: Key;
    readonly title: ReactNode;
};
type BreadcrumbItem = { readonly href?: string; readonly key: Key; readonly label: ReactNode };
type TabsProps = HTMLAttributes<HTMLDivElement> & {
    readonly defaultSelectedKey?: Key;
    readonly items: ReadonlyArray<TabItem>;
    readonly keyboardActivation?: 'automatic' | 'manual';
    readonly onSelectionChange?: (key: Key) => void;
    readonly orientation?: TabOrientation;
    readonly selectedKey?: Key;
};
type BreadcrumbProps = HTMLAttributes<HTMLElement> & {
    readonly items: ReadonlyArray<BreadcrumbItem>;
    readonly separator?: ReactNode;
};
type PaginationProps = HTMLAttributes<HTMLElement> & {
    readonly current: number;
    readonly onChange: (page: number) => void;
    readonly siblingCount?: number;
    readonly total: number;
};
type NavInput<T extends NavType = 'tabs'> = {
    readonly animation?: Inputs['animation'] | undefined;
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly className?: string;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const range = (start: number, end: number): ReadonlyArray<number> =>
    Array.from({ length: end - start + 1 }, (_, idx) => start + idx);

// --- [DISPATCH_TABLES] -------------------------------------------------------

type PaginationParams = {
    readonly left: number;
    readonly right: number;
    readonly showLeftDots: boolean;
    readonly showRightDots: boolean;
    readonly total: number;
    readonly totalNums: number;
};

const paginationStrategy = {
    both: (p: PaginationParams): ReadonlyArray<number> => [1, -1, ...range(p.left, p.right), -2, p.total],
    full: (p: PaginationParams): ReadonlyArray<number> => range(1, p.total),
    leftOnly: (p: PaginationParams): ReadonlyArray<number> => [...range(1, p.totalNums - 2), -1, p.total],
    rightOnly: (p: PaginationParams): ReadonlyArray<number> => [1, -1, ...range(p.total - p.totalNums + 3, p.total)],
} as const;

type DotsKey = 'ff' | 'ft' | 'tf' | 'tt';
const dotsDispatch: Readonly<Record<DotsKey, (p: PaginationParams) => ReadonlyArray<number>>> = {
    ff: paginationStrategy.leftOnly,
    ft: paginationStrategy.leftOnly,
    tf: paginationStrategy.rightOnly,
    tt: paginationStrategy.both,
};

const dotsKey = (left: boolean, right: boolean): DotsKey => `${left ? 't' : 'f'}${right ? 't' : 'f'}` as DotsKey;

const computePages = (current: number, total: number, siblingCount: number): ReadonlyArray<number> => {
    const totalNums = siblingCount * 2 + 3;
    const left = Math.max(current - siblingCount, 1);
    const right = Math.min(current + siblingCount, total);
    const showLeftDots = left > 2;
    const showRightDots = right < total - 1;
    const params: PaginationParams = { left, right, showLeftDots, showRightDots, total, totalNums };
    return total <= totalNums
        ? paginationStrategy.full(params)
        : dotsDispatch[dotsKey(showLeftDots, showRightDots)](params);
};

type TabComponentProps<T> = {
    readonly item: Node<T>;
    readonly orientation: TabOrientation;
    readonly state: TabListState<T>;
    readonly vars: Record<string, string>;
};

const TabComponent = <T>({ item, orientation, state, vars }: TabComponentProps<T>) => {
    const ref = useRef<HTMLDivElement>(null);
    const { isDisabled, isSelected, tabProps } = useTab({ key: item.key }, state, ref);
    const { focusProps, isFocusVisible } = useFocusRing();
    const orient = B.nav.tabs.orientation[orientation];
    return createElement(
        'div',
        {
            ...tabProps,
            ...focusProps,
            className: utilities.cls(
                orient.tab,
                B.nav.tabs.tab.base,
                B.nav.var.px,
                B.nav.var.py,
                B.nav.var.fs,
                isSelected && utilities.cls(orient.tabSelected, B.nav.tabs.tab.selected),
                isDisabled && B.nav.tabs.tab.disabled,
                isFocusVisible && B.nav.tabs.tab.focus,
            ),
            'data-disabled': isDisabled || undefined,
            'data-focus': isFocusVisible || undefined,
            'data-selected': isSelected || undefined,
            ref,
            style: vars as CSSProperties,
        },
        item.rendered,
    );
};

type TabPanelComponentProps<T> = { readonly state: TabListState<T>; readonly vars: Record<string, string> };

const TabPanelComponent = <T>({ state, vars }: TabPanelComponentProps<T>) => {
    const ref = useRef<HTMLDivElement>(null);
    const { tabPanelProps } = useTabPanel({}, state, ref);
    return createElement(
        'div',
        { ...tabPanelProps, className: utilities.cls(B.nav.var.px, B.nav.var.py), ref, style: vars as CSSProperties },
        state.selectedItem?.props.children,
    );
};

const createTabsComponent = (
    input: NavInput<'tabs'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
    animation: Resolved['animation'],
) =>
    forwardRef((props: TabsProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            defaultSelectedKey,
            items,
            keyboardActivation = 'automatic',
            onSelectionChange,
            orientation = 'horizontal',
            selectedKey,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const tabListRef = useRef<HTMLDivElement>(null);
        const disabledKeys = items.filter((it) => it.disabled || behavior.disabled).map((it) => it.key);
        // Build react-stately collection - children prop required for exactOptionalPropertyTypes
        const tabChildren = items.map((it) =>
            createElement(Item as FC<{ children: ReactNode; key: Key; textValue: string }>, {
                // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                children: [it.content, it.title],
                key: it.key,
                textValue: String(it.key),
            }),
        );
        // Conditionally include optional props to satisfy exactOptionalPropertyTypes
        const ariaProps = {
            children: tabChildren,
            disabledKeys: disabledKeys as Iterable<Key>,
            keyboardActivation,
            orientation,
            ...(defaultSelectedKey !== undefined && { defaultSelectedKey }),
            ...(selectedKey !== undefined && { selectedKey }),
            ...(onSelectionChange && { onSelectionChange }),
        };
        const state = useTabListState(ariaProps);
        const { tabListProps } = useTabList({ ...ariaProps, 'aria-label': 'Tabs' }, state, tabListRef);
        const orient = B.nav.tabs.orientation[orientation];
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'flex',
                    orient.container,
                    B.nav.var.g,
                    stateCls.nav(behavior),
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...animStyle(animation), ...style } as CSSProperties,
            },
            createElement(
                'div',
                { ...tabListProps, className: utilities.cls(orient.list, B.nav.var.g), ref: tabListRef },
                [...state.collection].map((item) =>
                    createElement(TabComponent, { item, key: item.key, orientation, state, vars }),
                ),
            ),
            createElement(TabPanelComponent, { key: state.selectedItem?.key, state, vars }),
        );
    });

const createBreadcrumbComponent = (
    input: NavInput<'breadcrumb'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
) =>
    forwardRef((props: BreadcrumbProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, items, separator = '/', style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'nav',
            {
                ...rest,
                'aria-label': 'Breadcrumb',
                className: utilities.cls(
                    'flex items-center',
                    B.nav.var.g,
                    B.nav.var.fs,
                    stateCls.nav(behavior),
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...style } as CSSProperties,
            },
            createElement(
                'ol',
                { className: utilities.cls('flex items-center', B.nav.var.g) },
                items.map((item, idx) => {
                    const isLast = idx === items.length - 1;
                    return createElement(
                        'li',
                        { className: utilities.cls('flex items-center', B.nav.var.g), key: item.key },
                        createElement(
                            item.href && !isLast ? 'a' : 'span',
                            {
                                'aria-current': isLast ? 'page' : undefined,
                                className: isLast ? 'font-semibold' : 'opacity-70 hover:opacity-100',
                                href: item.href && !isLast ? item.href : undefined,
                            },
                            item.label,
                        ),
                        !isLast && createElement('span', { 'aria-hidden': true, className: 'opacity-50' }, separator),
                    );
                }),
            ),
        );
    });

const createPaginationComponent = (
    input: NavInput<'pagination'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
) =>
    forwardRef((props: PaginationProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, current, onChange, siblingCount = 1, style, total, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const pages = computePages(current, total, siblingCount);
        const renderButton = (page: number, label: ReactNode, disabled: boolean) =>
            createElement(
                'button',
                {
                    'aria-current': page === current ? 'page' : undefined,
                    'aria-disabled': disabled || undefined,
                    className: utilities.cls(
                        'flex items-center justify-center border',
                        B.nav.var.minW,
                        B.nav.var.h,
                        B.nav.var.px,
                        B.nav.var.r,
                        page === current ? 'font-semibold' : '',
                        disabled ? B.nav.state.disabled : '',
                    ),
                    disabled,
                    key: page,
                    onClick: () => !disabled && onChange(page),
                    type: 'button',
                },
                label,
            );
        return createElement(
            'nav',
            {
                ...rest,
                'aria-label': 'Pagination',
                className: utilities.cls(
                    'flex items-center',
                    B.nav.var.g,
                    B.nav.var.fs,
                    stateCls.nav(behavior),
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...style } as CSSProperties,
            },
            renderButton(current - 1, '\u2039', current <= 1),
            pages.map((page) =>
                page < 0
                    ? createElement('span', { className: B.nav.var.ellipsisPx, key: page }, '\u2026')
                    : renderButton(page, page, false),
            ),
            renderButton(current + 1, '\u203a', current >= total),
        );
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    breadcrumb: createBreadcrumbComponent,
    pagination: createPaginationComponent,
    tabs: createTabsComponent,
} as const;

const createNavigationComponent = <T extends NavType>(input: NavInput<T>) => {
    const scale = resolve('scale', input.scale);
    const behavior = resolve('behavior', input.behavior);
    const animation = resolve('animation', input.animation);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'nav');
    const builder = builderHandlers[input.type ?? 'tabs'];
    const component = (
        builder as unknown as (
            input: NavInput<T>,
            vars: Record<string, string>,
            behavior: Resolved['behavior'],
            animation: Resolved['animation'],
        ) => ReturnType<typeof forwardRef>
    )(input, vars, behavior, animation);
    component.displayName = `Nav(${input.type ?? 'tabs'})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createNavigation = (tuning?: TuningFor<'nav'>) =>
    Object.freeze({
        Breadcrumb: createNavigationComponent({ type: 'breadcrumb', ...pick(tuning, ['behavior', 'scale']) }),
        create: <T extends NavType>(input: NavInput<T>) =>
            createNavigationComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.nav) }),
        Pagination: createNavigationComponent({ type: 'pagination', ...pick(tuning, ['behavior', 'scale']) }),
        Tabs: createNavigationComponent({ type: 'tabs', ...pick(tuning, TUNING_KEYS.nav) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createNavigation };
export type { BreadcrumbItem, BreadcrumbProps, NavInput, NavType, PaginationProps, TabItem, TabOrientation, TabsProps };
