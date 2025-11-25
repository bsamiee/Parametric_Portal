import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { BehaviorInput, ElTuning, ScaleInput } from './schema.ts';
import { B, cls, computeScale, cssVars, merged, pick, resolve, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type Tag = 'article' | 'aside' | 'div' | 'footer' | 'header' | 'main' | 'nav' | 'section' | 'span';
type FlexDir = 'col' | 'col-reverse' | 'row' | 'row-reverse';
type FlexAlign = 'baseline' | 'center' | 'end' | 'start' | 'stretch';
type FlexJustify = 'around' | 'between' | 'center' | 'end' | 'evenly' | 'start';
type GridAutoFlow = keyof typeof B.el.grid.autoFlow;
type DividerOrientation = 'horizontal' | 'vertical';
type ElementInput<T extends Tag = 'div'> = {
    readonly align?: FlexAlign;
    readonly asChild?: boolean;
    readonly autoFlow?: GridAutoFlow;
    readonly behavior?: BehaviorInput | undefined;
    readonly className?: string;
    readonly columns?: number | string;
    readonly direction?: FlexDir;
    readonly gap?: boolean;
    readonly justify?: FlexJustify;
    readonly padding?: boolean;
    readonly radius?: boolean;
    readonly rows?: number | string;
    readonly scale?: ScaleInput | undefined;
    readonly tag?: T;
    readonly wrap?: boolean;
};
type DividerInput = {
    readonly className?: string;
    readonly decorative?: boolean;
    readonly orientation?: DividerOrientation;
};
type ElementProps = HTMLAttributes<HTMLElement> & { readonly asChild?: boolean; readonly children?: ReactNode };
type DividerProps = HTMLAttributes<HTMLDivElement>;

// --- Pure Utility Functions -------------------------------------------------

const flexCls = (d?: FlexDir, a?: FlexAlign, j?: FlexJustify, w?: boolean): string =>
    d
        ? cls(
              'flex',
              `${B.el.flex.dir}${d}`,
              `${B.el.flex.align}${a ?? 'stretch'}`,
              `${B.el.flex.justify}${j ?? 'start'}`,
              B.el.flex.wrap[w ? 'true' : 'false'],
          )
        : '';

const gridCls = (cols?: number | string, rows?: number | string, flow?: GridAutoFlow): string =>
    cols || rows ? cls('grid', flow ? B.el.grid.autoFlow[flow] : undefined) : '';

const gridStyle = (cols?: number | string, rows?: number | string): CSSProperties => ({
    ...(cols ? { gridTemplateColumns: typeof cols === 'number' ? `repeat(${cols}, minmax(0, 1fr))` : cols } : {}),
    ...(rows ? { gridTemplateRows: typeof rows === 'number' ? `repeat(${rows}, minmax(0, 1fr))` : rows } : {}),
});

const varCls = (g?: boolean, p?: boolean, r?: boolean): string =>
    cls(g ? B.el.var.gap : undefined, p ? `${B.el.var.px} ${B.el.var.py}` : undefined, r ? B.el.var.r : undefined);

// --- Component Factory ------------------------------------------------------

const createEl = <T extends Tag>(i: ElementInput<T>) => {
    const beh = resolve('behavior', i.behavior);
    const scl = resolve('scale', i.scale);
    const vars = cssVars(computeScale(scl), 'el');
    const gStyle = gridStyle(i.columns, i.rows);
    const base = cls(
        varCls(i.gap, i.padding, i.radius),
        flexCls(i.direction, i.align, i.justify, i.wrap),
        gridCls(i.columns, i.rows, i.autoFlow),
        i.className,
    );
    const Comp = forwardRef((props: ElementProps, fRef: ForwardedRef<HTMLElement>) => {
        const { asChild, children, className, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const elProps = {
            ...rest,
            'aria-busy': beh.loading || undefined,
            'aria-disabled': beh.disabled || undefined,
            className: cls(base, className),
            ref,
            style: { ...vars, ...gStyle, ...style } as CSSProperties,
            tabIndex: beh.focusable && beh.interactive && !beh.disabled ? 0 : undefined,
        };
        return (asChild ?? i.asChild)
            ? createElement(Slot, elProps, children)
            : createElement(i.tag ?? 'div', elProps, children);
    });
    Comp.displayName = `El(${i.tag ?? 'div'})`;
    return Comp;
};

const createDivider = (i: DividerInput) => {
    const orientation = i.orientation ?? 'horizontal';
    const Comp = forwardRef((props: DividerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement('div', {
            ...rest,
            'aria-hidden': i.decorative ?? true,
            className: cls(B.el.separator.base, B.el.separator[orientation], i.className, className),
            'data-orientation': orientation,
            ref,
            role: 'separator',
        });
    });
    Comp.displayName = `Divider(${orientation})`;
    return Comp;
};

// --- Factory ----------------------------------------------------------------

const K = ['behavior', 'scale'] as const;

const createElements = (tuning?: ElTuning) =>
    Object.freeze({
        Box: createEl({ ...pick(tuning, K) }),
        create: <T extends Tag>(i: ElementInput<T>) => createEl({ ...i, ...merged(tuning, i, K) }),
        createDivider: (i: DividerInput) => createDivider(i),
        Divider: createDivider({}),
        Flex: createEl({ direction: 'row', gap: true, ...pick(tuning, K) }),
        Grid: createEl({ columns: 3, gap: true, ...pick(tuning, K) }),
        Stack: createEl({ direction: 'col', gap: true, ...pick(tuning, K) }),
    });

// --- Export -----------------------------------------------------------------

export { createElements };
export type {
    DividerInput,
    DividerOrientation,
    DividerProps,
    ElementInput,
    ElementProps,
    FlexAlign,
    FlexDir,
    FlexJustify,
    GridAutoFlow,
    Tag,
};
