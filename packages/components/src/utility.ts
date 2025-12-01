/**
 * Utility components: render scroll area with directional control and hiding.
 * Uses B, utilities, resolve from schema.ts with CSS overflow customization.
 */
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Inputs, TuningFor } from './schema.ts';
import { B, merged, pick, resolve, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- Types -------------------------------------------------------------------

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

const createScrollAreaComponent = (input: UtilityInput) => {
    const scale = resolve('scale', input.scale);
    const vars = utilities.cssVars(utilities.computeScale(scale), 'util');
    const defaultDirection = input.direction ?? 'vertical';
    const Component = forwardRef((props: ScrollAreaProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            children,
            className,
            direction = defaultDirection,
            hideScrollbar = input.hideScrollbar,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative',
                    B.util.dir[direction],
                    hideScrollbar ? B.util.scrollbar.hidden : B.util.scrollbar.visible,
                    B.util.var.r,
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...style } as CSSProperties,
                tabIndex: 0,
            },
            children,
        );
    });
    Component.displayName = 'Util(scrollArea)';
    return Component;
};

// --- Entry Point -------------------------------------------------------------

const createUtility = (tuning?: TuningFor<'util'>) =>
    Object.freeze({
        create: (input: UtilityInput) =>
            createScrollAreaComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.util) }),
        ScrollArea: createScrollAreaComponent({ ...pick(tuning, TUNING_KEYS.util) }),
    });

// --- Export ------------------------------------------------------------------

export { createUtility };
export type { ScrollAreaProps, ScrollDirection, UtilityInput };
