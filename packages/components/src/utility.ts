import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { ScaleInput, UtilTuning } from './schema.ts';
import { B, cls, computeScale, cssVars, merged, pick, resolve, useForwardedRef } from './schema.ts';

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
    readonly scale?: ScaleInput | undefined;
};

// --- Component Factory ------------------------------------------------------

const createScrollArea = (i: UtilityInput) => {
    const scl = resolve('scale', i.scale);
    const vars = cssVars(computeScale(scl), 'util');
    const dir = i.direction ?? 'vertical';
    const Comp = forwardRef((props: ScrollAreaProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, direction = dir, hideScrollbar = i.hideScrollbar, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: cls(
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

const K = ['scale'] as const;

const createUtility = (tuning?: UtilTuning) =>
    Object.freeze({
        create: (i: UtilityInput) => createScrollArea({ ...i, ...merged(tuning, i, K) }),
        ScrollArea: createScrollArea({ ...pick(tuning, K) }),
    });

// --- Export -----------------------------------------------------------------

export { createUtility };
export type { ScrollAreaProps, ScrollDirection, UtilityInput };
