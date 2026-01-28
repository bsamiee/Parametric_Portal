/**
 * Layout element components: render flex, grid, stack, divider with semantic tags.
 * Uses B.el, utilities, stateCls, resolve from schema.ts with Radix Slot composition.
 */
import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useMemo } from 'react';
import type { Inputs, TuningFor } from './schema.ts';
import { B, merged, pick, resolve, stateCls, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

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
};
type DividerRuntimeProps = {
    readonly className?: string;
    readonly orientation?: DividerOrientation;
};
type LayoutProps = {
    readonly align?: FlexAlign;
    readonly autoFlow?: GridAutoFlow;
    readonly columns?: number | string;
    readonly direction?: FlexDir;
    readonly gap?: boolean;
    readonly justify?: FlexJustify;
    readonly padding?: boolean;
    readonly radius?: boolean;
    readonly rows?: number | string;
    readonly wrap?: boolean;
};
type ElementProps = HTMLAttributes<HTMLElement> &
    LayoutProps & {
        readonly asChild?: boolean;
        readonly behavior?: Inputs['behavior'] | undefined;
        readonly children?: ReactNode;
        readonly scale?: Inputs['scale'] | undefined;
    };
type DividerProps = HTMLAttributes<HTMLDivElement> & DividerRuntimeProps;

// --- [CONSTANTS] -------------------------------------------------------------

const { dir, align, justify, wrap } = B.el.flex;
const { autoFlow } = B.el.grid;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const wrapKey = (w?: boolean): 'true' | 'false' => (w ? 'true' : 'false');

const flexCls = (d?: FlexDir, a?: FlexAlign, j?: FlexJustify, w?: boolean): string =>
    d
        ? utilities.cls(
              'flex',
              `${dir}${d}`,
              `${align}${a ?? 'stretch'}`,
              `${justify}${j ?? 'start'}`,
              wrap[wrapKey(w)],
          )
        : '';

const flowCls = (flow?: GridAutoFlow): string | undefined => (flow ? autoFlow[flow] : undefined);

const gridCls = (cols?: number | string, rows?: number | string, flow?: GridAutoFlow): string =>
    cols || rows ? utilities.cls('grid', flowCls(flow)) : '';

const gridStyle = (cols?: number | string, rows?: number | string): CSSProperties => ({
    ...(cols ? { gridTemplateColumns: typeof cols === 'number' ? `repeat(${cols}, minmax(0, 1fr))` : cols } : {}),
    ...(rows ? { gridTemplateRows: typeof rows === 'number' ? `repeat(${rows}, minmax(0, 1fr))` : rows } : {}),
});

const varCls = (g?: boolean, p?: boolean, r?: boolean): string =>
    utilities.cls(
        g ? B.el.var.gap : undefined,
        p ? utilities.cls(B.el.var.px, B.el.var.py) : undefined,
        r ? B.el.var.r : undefined,
    );

const createElementComponent = <T extends Tag>(input: ElementInput<T>) => {
    const Component = forwardRef((props: ElementProps, fRef: ForwardedRef<HTMLElement>) => {
        const {
            align: propAlign,
            asChild,
            autoFlow: propAutoFlow,
            behavior: propBehavior,
            children,
            className,
            columns: propColumns,
            direction: propDirection,
            gap: propGap,
            justify: propJustify,
            padding: propPadding,
            radius: propRadius,
            rows: propRows,
            scale: propScale,
            style,
            wrap: propWrap,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const { behavior, vars, gridStyleObject, base } = useMemo(() => {
            const align = propAlign ?? input.align;
            const autoFlow = propAutoFlow ?? input.autoFlow;
            const columns = propColumns ?? input.columns;
            const direction = propDirection ?? input.direction;
            const gap = propGap ?? input.gap;
            const justify = propJustify ?? input.justify;
            const padding = propPadding ?? input.padding;
            const radius = propRadius ?? input.radius;
            const rows = propRows ?? input.rows;
            const wrap = propWrap ?? input.wrap;
            const resolvedBehavior = resolve('behavior', { ...input.behavior, ...propBehavior });
            const resolvedScale = resolve('scale', { ...input.scale, ...propScale });
            return {
                base: utilities.cls(
                    flexCls(direction, align, justify, wrap),
                    gridCls(columns, rows, autoFlow),
                    varCls(gap, padding, radius),
                    input.className,
                ),
                behavior: resolvedBehavior,
                gridStyleObject: gridStyle(columns, rows),
                vars: utilities.cssVars(utilities.computeScale(resolvedScale), 'el'),
            };
        }, [
            propAlign,
            propAutoFlow,
            propBehavior,
            propColumns,
            propDirection,
            propGap,
            propJustify,
            propPadding,
            propRadius,
            propRows,
            propScale,
            propWrap,
        ]);
        const elProps = {
            ...rest,
            'aria-busy': behavior.loading || undefined,
            'aria-disabled': behavior.disabled || undefined,
            className: utilities.cls(base, stateCls.el(behavior), className),
            ref,
            style: { ...vars, ...gridStyleObject, ...style } as CSSProperties,
            tabIndex: behavior.focusable && behavior.interactive && !behavior.disabled ? 0 : undefined,
        };
        return (asChild ?? input.asChild)
            ? createElement(Slot, elProps, children)
            : createElement(input.tag ?? 'div', elProps, children);
    });
    Component.displayName = `El(${input.tag ?? 'div'})`;
    return Component;
};

const createDividerComponent = (input: DividerInput) => {
    const Component = forwardRef((props: DividerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, orientation = 'horizontal', ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement('div', {
            ...rest,
            'aria-hidden': input.decorative ?? true,
            className: utilities.cls(B.el.separator.base, B.el.separator[orientation], input.className, className),
            'data-orientation': orientation,
            ref,
            role: 'separator',
        });
    });
    Component.displayName = 'Divider';
    return Component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createElements = (tuning?: TuningFor<'el'>) =>
    Object.freeze({
        Box: createElementComponent({ ...pick(tuning, TUNING_KEYS.el) }),
        create: <T extends Tag>(input: ElementInput<T>) =>
            createElementComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.el) }),
        createDivider: (input: DividerInput) => createDividerComponent(input),
        Divider: createDividerComponent({}),
        Flex: createElementComponent({ direction: 'row', gap: true, ...pick(tuning, TUNING_KEYS.el) }),
        Grid: createElementComponent({ columns: 3, gap: true, ...pick(tuning, TUNING_KEYS.el) }),
        Sidebar: createElementComponent({
            direction: 'col',
            gap: true,
            padding: true,
            tag: 'aside',
            ...pick(tuning, TUNING_KEYS.el),
        }),
        Stack: createElementComponent({ direction: 'col', gap: true, ...pick(tuning, TUNING_KEYS.el) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createElements };
export type {
    DividerInput,
    DividerOrientation,
    DividerProps,
    DividerRuntimeProps,
    ElementInput,
    ElementProps,
    FlexAlign,
    FlexDir,
    FlexJustify,
    GridAutoFlow,
    LayoutProps,
    Tag,
};
