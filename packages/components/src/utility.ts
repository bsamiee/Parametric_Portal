import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, merge, resolveScale } from './schema.ts';

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

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    dir: {
        both: 'overflow-auto',
        horizontal: 'overflow-x-auto overflow-y-hidden',
        vertical: 'overflow-x-hidden overflow-y-auto',
    } as { readonly [K in ScrollDirection]: string },
    scrollbar: {
        hidden: 'scrollbar-none',
        visible: 'scrollbar-thin',
    },
    var: {
        h: 'h-[var(--util-height)]',
        maxH: 'max-h-[var(--util-height)]',
        px: 'px-[var(--util-padding-x)]',
        py: 'py-[var(--util-padding-y)]',
        r: 'rounded-[var(--util-radius)]',
    },
} as const);

// --- Component Factory ------------------------------------------------------

const createScrollArea = (i: UtilityInput) => {
    const scl = resolveScale(i.scale);
    const vars = cssVars(computeScale(scl), 'util');
    const dir = i.direction ?? 'vertical';
    const Comp = forwardRef((props: ScrollAreaProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, direction = dir, hideScrollbar = i.hideScrollbar, style, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(
                    'relative',
                    B.dir[direction],
                    hideScrollbar ? B.scrollbar.hidden : B.scrollbar.visible,
                    B.var.r,
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

const createUtility = (tuning?: { scale?: ScaleInput }) =>
    Object.freeze({
        create: (i: UtilityInput) =>
            createScrollArea({
                ...i,
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
            }),
        ScrollArea: createScrollArea({ ...(tuning?.scale && { scale: tuning.scale }) }),
    });

// --- Export -----------------------------------------------------------------

export { B as UTILITY_TUNING, createUtility };
export type { ScrollAreaProps, ScrollDirection, UtilityInput };
