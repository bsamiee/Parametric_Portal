import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { BehaviorInput, ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, merge, resolveBehavior, resolveScale } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type Tag = 'article' | 'aside' | 'div' | 'footer' | 'header' | 'main' | 'nav' | 'section' | 'span';
type FlexDir = 'col' | 'col-reverse' | 'row' | 'row-reverse';
type FlexAlign = 'baseline' | 'center' | 'end' | 'start' | 'stretch';
type FlexJustify = 'around' | 'between' | 'center' | 'end' | 'evenly' | 'start';
type ElementInput<T extends Tag = 'div'> = {
    readonly align?: FlexAlign;
    readonly asChild?: boolean;
    readonly behavior?: BehaviorInput | undefined;
    readonly className?: string;
    readonly direction?: FlexDir;
    readonly gap?: boolean;
    readonly justify?: FlexJustify;
    readonly padding?: boolean;
    readonly radius?: boolean;
    readonly scale?: ScaleInput | undefined;
    readonly tag?: T;
    readonly wrap?: boolean;
};
type ElementProps = HTMLAttributes<HTMLElement> & { readonly asChild?: boolean; readonly children?: ReactNode };

// --- Constants (Structural CSS Variable Classes Only) -----------------------

const B = Object.freeze({
    flex: { align: 'items-', dir: 'flex-', justify: 'justify-', wrap: { false: 'flex-nowrap', true: 'flex-wrap' } },
    var: {
        gap: 'gap-[var(--el-gap)]',
        px: 'px-[var(--el-padding-x)]',
        py: 'py-[var(--el-padding-y)]',
        r: 'rounded-[var(--el-radius)]',
    },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const flexCls = (d?: FlexDir, a?: FlexAlign, j?: FlexJustify, w?: boolean): string =>
    d
        ? cls(
              'flex',
              `${B.flex.dir}${d}`,
              `${B.flex.align}${a ?? 'stretch'}`,
              `${B.flex.justify}${j ?? 'start'}`,
              B.flex.wrap[w ? 'true' : 'false'],
          )
        : '';

const varCls = (g?: boolean, p?: boolean, r?: boolean): string =>
    cls(g ? B.var.gap : undefined, p ? `${B.var.px} ${B.var.py}` : undefined, r ? B.var.r : undefined);

// --- Component Factory ------------------------------------------------------

const createEl = <T extends Tag>(i: ElementInput<T>) => {
    const beh = resolveBehavior(i.behavior);
    const scl = resolveScale(i.scale);
    const vars = cssVars(computeScale(scl), 'el');
    const base = cls(varCls(i.gap, i.padding, i.radius), flexCls(i.direction, i.align, i.justify, i.wrap), i.className);
    const Comp = forwardRef((props: ElementProps, fRef: ForwardedRef<HTMLElement>) => {
        const { asChild, children, className, style, ...rest } = props;
        const intRef = useRef<HTMLElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLElement>;
        const elProps = {
            ...rest,
            'aria-busy': beh.loading || undefined,
            'aria-disabled': beh.disabled || undefined,
            className: cls(base, className),
            ref,
            style: { ...vars, ...style } as CSSProperties,
            tabIndex: beh.focusable && beh.interactive && !beh.disabled ? 0 : undefined,
        };
        return (asChild ?? i.asChild)
            ? createElement(Slot, elProps, children)
            : createElement(i.tag ?? 'div', elProps, children);
    });
    Comp.displayName = `El(${i.tag ?? 'div'})`;
    return Comp;
};

// --- Factory ----------------------------------------------------------------

const createElements = (tuning?: { scale?: ScaleInput; behavior?: BehaviorInput }) =>
    Object.freeze({
        Box: createEl({
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
        }),
        create: <T extends Tag>(i: ElementInput<T>) =>
            createEl({
                ...i,
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
                ...(merge(tuning?.behavior, i.behavior) && { behavior: merge(tuning?.behavior, i.behavior) }),
            }),
        Flex: createEl({
            direction: 'row',
            gap: true,
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
        }),
        Stack: createEl({
            direction: 'col',
            gap: true,
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
        }),
    });

// --- Export -----------------------------------------------------------------

export { B as ELEMENT_TUNING, createElements };
export type { ElementInput, ElementProps, FlexAlign, FlexDir, FlexJustify, Tag };
