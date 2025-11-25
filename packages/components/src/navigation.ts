import type { CSSProperties, ForwardedRef, HTMLAttributes, Key, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useId, useRef, useState } from 'react';
import type { Animation, AnimationInput, Behavior, BehaviorInput, ScaleInput } from './schema.ts';
import {
    animStyle,
    cls,
    computeScale,
    cssVars,
    merge,
    resolveAnimation,
    resolveBehavior,
    resolveScale,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type NavType = 'breadcrumb' | 'pagination' | 'tabs';
type TabItem = {
    readonly key: Key;
    readonly title: ReactNode;
    readonly content: ReactNode;
    readonly disabled?: boolean;
};
type BreadcrumbItem = { readonly key: Key; readonly label: ReactNode; readonly href?: string };
type TabsProps = HTMLAttributes<HTMLDivElement> & {
    readonly items: ReadonlyArray<TabItem>;
    readonly defaultSelectedKey?: Key;
    readonly selectedKey?: Key;
    readonly onSelectionChange?: (key: Key) => void;
};
type BreadcrumbProps = HTMLAttributes<HTMLElement> & {
    readonly items: ReadonlyArray<BreadcrumbItem>;
    readonly separator?: ReactNode;
};
type PaginationProps = HTMLAttributes<HTMLElement> & {
    readonly current: number;
    readonly total: number;
    readonly onChange: (page: number) => void;
    readonly siblingCount?: number;
};
type NavInput<T extends NavType = 'tabs'> = {
    readonly animation?: AnimationInput | undefined;
    readonly behavior?: BehaviorInput | undefined;
    readonly className?: string;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    state: { active: 'data-[selected]:font-semibold', disabled: 'opacity-50 pointer-events-none' },
    var: {
        fs: 'text-[length:var(--nav-font-size)]',
        g: 'gap-[var(--nav-gap)]',
        h: 'h-[var(--nav-height)]',
        px: 'px-[var(--nav-padding-x)]',
        py: 'py-[var(--nav-padding-y)]',
        r: 'rounded-[var(--nav-radius)]',
    },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const stateCls = (b: Behavior): string => cls(b.disabled ? B.state.disabled : undefined);

// --- Component Builders -----------------------------------------------------

const mkTabs = (i: NavInput<'tabs'>, v: Record<string, string>, b: Behavior, a: Animation) =>
    forwardRef((props: TabsProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, defaultSelectedKey, items, onSelectionChange, selectedKey, style, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        const baseId = useId();
        const [internalKey, setInternalKey] = useState<Key>(() => defaultSelectedKey ?? items[0]?.key ?? '');
        const activeKey = selectedKey ?? internalKey;

        const handleSelect = (key: Key) => {
            if (key !== activeKey) {
                selectedKey === undefined ? setInternalKey(key) : void 0;
                onSelectionChange?.(key);
            }
        };

        const selectedItem = items.find((item) => item.key === activeKey);

        return createElement(
            'div',
            {
                ...rest,
                className: cls('flex flex-col', B.var.g, stateCls(b), i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            createElement(
                'div',
                { className: cls('flex border-b', B.var.g), role: 'tablist' },
                items.map((item) => {
                    const isSelected = item.key === activeKey;
                    const isDisabled = item.disabled || b.disabled;
                    const tabId = `${baseId}-tab-${item.key}`;
                    const panelId = `${baseId}-panel-${item.key}`;
                    return createElement(
                        'button',
                        {
                            'aria-controls': panelId,
                            'aria-disabled': isDisabled || undefined,
                            'aria-selected': isSelected,
                            className: cls(
                                'cursor-pointer border-b-2 border-transparent',
                                B.var.px,
                                B.var.py,
                                B.var.fs,
                                B.state.active,
                            ),
                            'data-disabled': isDisabled || undefined,
                            'data-selected': isSelected || undefined,
                            disabled: isDisabled,
                            id: tabId,
                            key: item.key,
                            onClick: () => !isDisabled && handleSelect(item.key),
                            role: 'tab',
                            style: { ...v, ...animStyle(a) } as CSSProperties,
                            tabIndex: isSelected ? 0 : -1,
                            type: 'button',
                        },
                        item.title,
                    );
                }),
            ),
            createElement(
                'div',
                {
                    'aria-labelledby': `${baseId}-tab-${activeKey}`,
                    className: cls(B.var.px, B.var.py),
                    id: `${baseId}-panel-${activeKey}`,
                    role: 'tabpanel',
                    style: v,
                    tabIndex: 0,
                },
                selectedItem?.content,
            ),
        );
    });

const mkBreadcrumb = (i: NavInput<'breadcrumb'>, v: Record<string, string>, b: Behavior) =>
    forwardRef((props: BreadcrumbProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, items, separator = '/', style, ...rest } = props;
        const intRef = useRef<HTMLElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLElement>;
        return createElement(
            'nav',
            {
                ...rest,
                'aria-label': 'Breadcrumb',
                className: cls('flex items-center', B.var.g, B.var.fs, stateCls(b), i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            createElement(
                'ol',
                { className: cls('flex items-center', B.var.g) },
                items.map((item, idx) => {
                    const isLast = idx === items.length - 1;
                    return createElement(
                        'li',
                        { className: cls('flex items-center', B.var.g), key: item.key },
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

const mkPagination = (i: NavInput<'pagination'>, v: Record<string, string>, b: Behavior) =>
    forwardRef((props: PaginationProps, fRef: ForwardedRef<HTMLElement>) => {
        const { className, current, onChange, siblingCount = 1, style, total, ...rest } = props;
        const intRef = useRef<HTMLElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLElement>;
        const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
        const pages = (() => {
            const totalNums = siblingCount * 2 + 3;
            if (total <= totalNums) {
                return range(1, total);
            }
            const left = Math.max(current - siblingCount, 1);
            const right = Math.min(current + siblingCount, total);
            const showLeftDots = left > 2;
            const showRightDots = right < total - 1;
            if (!showLeftDots && showRightDots) {
                return [...range(1, totalNums - 2), -1, total];
            }
            if (showLeftDots && !showRightDots) {
                return [1, -1, ...range(total - totalNums + 3, total)];
            }
            return [1, -1, ...range(left, right), -2, total];
        })();
        const btn = (p: number, label: ReactNode, disabled: boolean) =>
            createElement(
                'button',
                {
                    'aria-current': p === current ? 'page' : undefined,
                    'aria-disabled': disabled || undefined,
                    className: cls(
                        'min-w-8 flex items-center justify-center border',
                        B.var.h,
                        B.var.px,
                        B.var.r,
                        p === current ? 'font-semibold' : '',
                        disabled ? B.state.disabled : '',
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
                className: cls('flex items-center', B.var.g, B.var.fs, stateCls(b), i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            btn(current - 1, '\u2039', current <= 1),
            pages.map((p) =>
                p < 0 ? createElement('span', { className: 'px-1', key: p }, '\u2026') : btn(p, p, false),
            ),
            btn(current + 1, '\u203a', current >= total),
        );
    });

// --- Dispatch Table ---------------------------------------------------------

const builders = { breadcrumb: mkBreadcrumb, pagination: mkPagination, tabs: mkTabs } as const;

const createNav = <T extends NavType>(i: NavInput<T>) => {
    const s = resolveScale(i.scale);
    const b = resolveBehavior(i.behavior);
    const a = resolveAnimation(i.animation);
    const c = computeScale(s);
    const v = cssVars(c, 'nav');
    const builder = builders[i.type ?? 'tabs'];
    const comp = (
        builder as unknown as (
            i: NavInput<T>,
            v: Record<string, string>,
            b: Behavior,
            a: Animation,
        ) => ReturnType<typeof forwardRef>
    )(i, v, b, a);
    comp.displayName = `Nav(${i.type ?? 'tabs'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createNavigation = (tuning?: { animation?: AnimationInput; behavior?: BehaviorInput; scale?: ScaleInput }) =>
    Object.freeze({
        Breadcrumb: createNav({
            type: 'breadcrumb',
            ...(tuning?.behavior && { behavior: tuning.behavior }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        create: <T extends NavType>(i: NavInput<T>) =>
            createNav({
                ...i,
                ...(merge(tuning?.animation, i.animation) && { animation: merge(tuning?.animation, i.animation) }),
                ...(merge(tuning?.behavior, i.behavior) && { behavior: merge(tuning?.behavior, i.behavior) }),
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
            }),
        Pagination: createNav({
            type: 'pagination',
            ...(tuning?.behavior && { behavior: tuning.behavior }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Tabs: createNav({
            type: 'tabs',
            ...(tuning?.animation && { animation: tuning.animation }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
    });

// --- Export -----------------------------------------------------------------

export { B as NAV_TUNING, createNavigation };
export type { BreadcrumbItem, BreadcrumbProps, NavInput, NavType, PaginationProps, TabItem, TabsProps };
