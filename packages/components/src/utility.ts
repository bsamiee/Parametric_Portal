import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Inputs, TuningFor } from './schema.ts';
import { B, fn, merged, pick, resolve, TUNING_KEYS, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ScrollDirection = 'both' | 'horizontal' | 'vertical';
type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly direction?: ScrollDirection;
    readonly hideScrollbar?: boolean;
};
type UtilityInput = {
    readonly className?: string;
    readonly direction?: ScrollDirection;
    readonly hideScrollbar?: boolean;
    readonly scale?: Inputs['scale'] | undefined;
};

// --- Component Factory ------------------------------------------------------

const createScrollArea = (i: UtilityInput) => {
    const scl = resolve('scale', i.scale);
    const vars = fn.cssVars(fn.computeScale(scl), 'util');
    const dir = i.direction ?? 'vertical';
    const Comp = forwardRef((props: ScrollAreaProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, direction = dir, hideScrollbar = i.hideScrollbar, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: fn.cls(
                    'relative',
                    B.util.dir[direction],
                    hideScrollbar ? B.util.scrollbar.hidden : B.util.scrollbar.visible,
                    B.util.var.r,
                    i.className,
                    className,
                ),
                ref,
                style: { ...vars, ...style } as CSSProperties,
                tabIndex: 0,
            },
            children,
        );
    });
    Comp.displayName = 'Util(scrollArea)';
    return Comp;
};

// --- Factory ----------------------------------------------------------------

const createUtility = (tuning?: TuningFor<'util'>) =>
    Object.freeze({
        create: (i: UtilityInput) => createScrollArea({ ...i, ...merged(tuning, i, TUNING_KEYS.util) }),
        ScrollArea: createScrollArea({ ...pick(tuning, TUNING_KEYS.util) }),
    });

// --- Export -----------------------------------------------------------------

export { createUtility };
export type { ScrollAreaProps, ScrollDirection, UtilityInput };
