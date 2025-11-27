import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Inputs, TuningFor } from './schema.ts';
import { B, fn, merged, pick, resolve, stateCls, TUNING_KEYS, useForwardedRef } from './schema.ts';

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
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly className?: string;
    readonly columns?: number | string;
    readonly direction?: FlexDir;
    readonly gap?: boolean;
    readonly justify?: FlexJustify;
    readonly padding?: boolean;
    readonly radius?: boolean;
    readonly rows?: number | string;
    readonly scale?: Inputs['scale'] | undefined;
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

// --- Shared Constants (Destructured) ----------------------------------------

const { dir, align, justify, wrap } = B.el.flex;
const { autoFlow } = B.el.grid;
const { gap, px: elPx, py: elPy, r: elR } = B.el.var;

// --- Pure Utility Functions -------------------------------------------------

const flexCls = (d?: FlexDir, a?: FlexAlign, j?: FlexJustify, w?: boolean): string =>
    d
        ? fn.cls(
              'flex',
              `${dir}${d}`,
              `${align}${a ?? 'stretch'}`,
              `${justify}${j ?? 'start'}`,
              wrap[w ? 'true' : 'false'],
          )
        : '';

const gridCls = (cols?: number | string, rows?: number | string, flow?: GridAutoFlow): string =>
    cols || rows ? fn.cls('grid', flow ? autoFlow[flow] : undefined) : '';

const gridStyle = (cols?: number | string, rows?: number | string): CSSProperties => ({
    ...(cols ? { gridTemplateColumns: typeof cols === 'number' ? `repeat(${cols}, minmax(0, 1fr))` : cols } : {}),
    ...(rows ? { gridTemplateRows: typeof rows === 'number' ? `repeat(${rows}, minmax(0, 1fr))` : rows } : {}),
});

const varCls = (g?: boolean, p?: boolean, r?: boolean): string =>
    fn.cls(g ? gap : undefined, p ? `${elPx} ${elPy}` : undefined, r ? elR : undefined);

// --- Component Factory ------------------------------------------------------

const createEl = <T extends Tag>(i: ElementInput<T>) => {
    const beh = resolve('behavior', i.behavior);
    const scl = resolve('scale', i.scale);
    const vars = fn.cssVars(fn.computeScale(scl), 'el');
    const gStyle = gridStyle(i.columns, i.rows);
    const base = fn.cls(
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
            className: fn.cls(base, stateCls.el(beh), className),
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
            className: fn.cls(B.el.separator.base, B.el.separator[orientation], i.className, className),
            'data-orientation': orientation,
            ref,
            role: 'separator',
        });
    });
    Comp.displayName = `Divider(${orientation})`;
    return Comp;
};

// --- Factory ----------------------------------------------------------------

const createElements = (tuning?: TuningFor<'el'>) =>
    Object.freeze({
        Box: createEl({ ...pick(tuning, TUNING_KEYS.el) }),
        create: <T extends Tag>(i: ElementInput<T>) => createEl({ ...i, ...merged(tuning, i, TUNING_KEYS.el) }),
        createDivider: (i: DividerInput) => createDivider(i),
        Divider: createDivider({}),
        Flex: createEl({ direction: 'row', gap: true, ...pick(tuning, TUNING_KEYS.el) }),
        Grid: createEl({ columns: 3, gap: true, ...pick(tuning, TUNING_KEYS.el) }),
        Stack: createEl({ direction: 'col', gap: true, ...pick(tuning, TUNING_KEYS.el) }),
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
