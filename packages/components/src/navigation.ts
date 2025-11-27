import type { CSSProperties, FC, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import { useFocusRing, useTab, useTabList, useTabPanel } from 'react-aria';
import type { Key, Node, TabListState } from 'react-stately';
import { Item, useTabListState } from 'react-stately';
import type { Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, fn, merged, pick, resolve, stateCls, TUNING_KEYS, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

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

// --- Pure Utility Functions -------------------------------------------------

const range = (start: number, end: number): ReadonlyArray<number> =>
    Array.from({ length: end - start + 1 }, (_, idx) => start + idx);

// --- Pagination Dispatch Table (Replaces if/else) ---------------------------

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

const computePages = (current: number, total: number, siblingCount: number): ReadonlyArray<number> => {
    const totalNums = siblingCount * 2 + 3;
    const left = Math.max(current - siblingCount, 1);
    const right = Math.min(current + siblingCount, total);
    const showLeftDots = left > 2;
    const showRightDots = right < total - 1;
    const params: PaginationParams = { left, right, showLeftDots, showRightDots, total, totalNums };
    return total <= totalNums
        ? paginationStrategy.full(params)
        : !showLeftDots && showRightDots
          ? paginationStrategy.leftOnly(params)
          : showLeftDots && !showRightDots
            ? paginationStrategy.rightOnly(params)
            : paginationStrategy.both(params);
};

// --- Tab Sub-Components (react-aria) ----------------------------------------

type TabCompProps<T> = {
    readonly item: Node<T>;
    readonly orientation: TabOrientation;
    readonly state: TabListState<T>;
    readonly vars: Record<string, string>;
};

const TabComp = <T>({ item, orientation, state, vars }: TabCompProps<T>) => {
    const ref = useRef<HTMLDivElement>(null);
    const { isDisabled, isSelected, tabProps } = useTab({ key: item.key }, state, ref);
    const { focusProps, isFocusVisible } = useFocusRing();
    const orient = B.nav.tabs.orientation[orientation];
    return createElement(
        'div',
        {
            ...tabProps,
            ...focusProps,
            className: fn.cls(
                orient.tab,
                B.nav.tabs.tab.base,
                B.nav.var.px,
                B.nav.var.py,
                B.nav.var.fs,
                isSelected && fn.cls(orient.tabSelected, B.nav.tabs.tab.selected),
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

type TabPanelCompProps<T> = { readonly state: TabListState<T>; readonly vars: Record<string, string> };

const TabPanelComp = <T>({ state, vars }: TabPanelCompProps<T>) => {
    const ref = useRef<HTMLDivElement>(null);
    const { tabPanelProps } = useTabPanel({}, state, ref);
    return createElement(
        'div',
        { ...tabPanelProps, className: fn.cls(B.nav.var.px, B.nav.var.py), ref, style: vars as CSSProperties },
        state.selectedItem?.props.children,
    );
};

// --- Component Builders -----------------------------------------------------

const mkTabs = (i: NavInput<'tabs'>, v: Record<string, string>, b: Resolved['behavior'], a: Resolved['animation']) =>
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
        const disabledKeys = items.filter((it) => it.disabled || b.disabled).map((it) => it.key);
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
                className: fn.cls('flex', orient.container, B.nav.var.g, stateCls.nav(b), i.className, className),
                ref,
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            createElement(
                'div',
                { ...tabListProps, className: fn.cls(orient.list, B.nav.var.g), ref: tabListRef },
                [...state.collection].map((item) =>
                    createElement(TabComp, { item, key: item.key, orientation, state, vars: v }),
                ),
            ),
            createElement(TabPanelComp, { key: state.selectedItem?.key, state, vars: v }),
        );
    });

const mkBreadcrumb = (i: NavInput<'breadcrumb'>, v: Record<string, string>, b: Resolved['behavior']) =>
    forwardRef((props: BreadcrumbProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, items, separator = '/', style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'nav',
            {
                ...rest,
                'aria-label': 'Breadcrumb',
                className: fn.cls(
                    'flex items-center',
                    B.nav.var.g,
                    B.nav.var.fs,
                    stateCls.nav(b),
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            createElement(
                'ol',
                { className: fn.cls('flex items-center', B.nav.var.g) },
                items.map((item, idx) => {
                    const isLast = idx === items.length - 1;
                    return createElement(
                        'li',
                        { className: fn.cls('flex items-center', B.nav.var.g), key: item.key },
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

const mkPagination = (i: NavInput<'pagination'>, v: Record<string, string>, b: Resolved['behavior']) =>
    forwardRef((props: PaginationProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, current, onChange, siblingCount = 1, style, total, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const pages = computePages(current, total, siblingCount);
        const btn = (p: number, label: ReactNode, disabled: boolean) =>
            createElement(
                'button',
                {
                    'aria-current': p === current ? 'page' : undefined,
                    'aria-disabled': disabled || undefined,
                    className: fn.cls(
                        'flex items-center justify-center border',
                        B.nav.var.minW,
                        B.nav.var.h,
                        B.nav.var.px,
                        B.nav.var.r,
                        p === current ? 'font-semibold' : '',
                        disabled ? B.nav.state.disabled : '',
                    ),
                    disabled,
                    key: p,
                    onClick: () => !disabled && onChange(p),
                    type: 'button',
                },
                label,
            );
        return createElement(
            'nav',
            {
                ...rest,
                'aria-label': 'Pagination',
                className: fn.cls(
                    'flex items-center',
                    B.nav.var.g,
                    B.nav.var.fs,
                    stateCls.nav(b),
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            btn(current - 1, '\u2039', current <= 1),
            pages.map((p) =>
                p < 0 ? createElement('span', { className: B.nav.var.ellipsisPx, key: p }, '\u2026') : btn(p, p, false),
            ),
            btn(current + 1, '\u203a', current >= total),
        );
    });

// --- Dispatch Table ---------------------------------------------------------

const builders = { breadcrumb: mkBreadcrumb, pagination: mkPagination, tabs: mkTabs } as const;

const createNav = <T extends NavType>(i: NavInput<T>) => {
    const s = resolve('scale', i.scale);
    const b = resolve('behavior', i.behavior);
    const a = resolve('animation', i.animation);
    const c = fn.computeScale(s);
    const v = fn.cssVars(c, 'nav');
    const builder = builders[i.type ?? 'tabs'];
    const comp = (
        builder as unknown as (
            i: NavInput<T>,
            v: Record<string, string>,
            b: Resolved['behavior'],
            a: Resolved['animation'],
        ) => ReturnType<typeof forwardRef>
    )(i, v, b, a);
    comp.displayName = `Nav(${i.type ?? 'tabs'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createNavigation = (tuning?: TuningFor<'nav'>) =>
    Object.freeze({
        Breadcrumb: createNav({ type: 'breadcrumb', ...pick(tuning, ['behavior', 'scale']) }),
        create: <T extends NavType>(i: NavInput<T>) => createNav({ ...i, ...merged(tuning, i, TUNING_KEYS.nav) }),
        Pagination: createNav({ type: 'pagination', ...pick(tuning, ['behavior', 'scale']) }),
        Tabs: createNav({ type: 'tabs', ...pick(tuning, TUNING_KEYS.nav) }),
    });

// --- Export -----------------------------------------------------------------

export { createNavigation };
export type { BreadcrumbItem, BreadcrumbProps, NavInput, NavType, PaginationProps, TabItem, TabOrientation, TabsProps };
