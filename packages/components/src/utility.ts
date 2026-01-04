/**
 * Utility components: render scroll area with customizable overflow behavior.
 * Uses B, utilities, resolve from schema.ts with CSS overflow customization.
 */
import { Svg } from '@parametric-portal/types/svg';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Inputs, TuningFor } from './schema.ts';
import { B, merged, pick, resolve, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type ScrollDirection = 'both' | 'horizontal' | 'vertical';
type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly direction?: ScrollDirection;
    readonly hideScrollbar?: boolean;
};
type SvgPreviewProps = HTMLAttributes<HTMLDivElement> & {
    readonly sanitize?: (svg: string) => string;
    readonly svg: string;
};
type GridOverlayProps = HTMLAttributes<HTMLDivElement> & {
    readonly color?: string;
    readonly divisions?: number;
    readonly opacity?: number;
    readonly show: boolean;
};
type SafeAreaOverlayProps = HTMLAttributes<HTMLDivElement> & {
    readonly borderColor?: string;
    readonly insetPercent?: number;
    readonly opacity?: number;
    readonly show: boolean;
};
type UtilityInput = {
    readonly className?: string;
    readonly direction?: ScrollDirection;
    readonly hideScrollbar?: boolean;
    readonly scale?: Inputs['scale'] | undefined;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

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
                    B.util.var.r,
                    hideScrollbar ? B.util.scrollbar.hidden : B.util.scrollbar.visible,
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

const createSvgPreviewComponent = (input: {
    readonly className?: string;
    readonly sanitize?: (svg: string) => string;
}) => {
    const Component = forwardRef((props: SvgPreviewProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, sanitize = input.sanitize ?? Svg.sanitize, style, svg, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement('div', {
            ...rest,
            className: utilities.cls('[&>svg]:w-full [&>svg]:h-full [&>svg]:block', input.className, className),
            dangerouslySetInnerHTML: { __html: sanitize(svg) },
            ref,
            style,
        });
    });
    Component.displayName = 'Util(svgPreview)';
    return Component;
};

const createGridOverlayComponent = (input: { readonly className?: string }) => {
    const Component = forwardRef((props: GridOverlayProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            color = 'var(--panel-border-preview, currentColor)',
            divisions = 32,
            opacity = 0.2,
            show,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const gridSize = `calc(100% / ${divisions}) calc(100% / ${divisions})`;
        return show
            ? createElement('div', {
                  ...rest,
                  className: utilities.cls('absolute inset-0 pointer-events-none', input.className, className),
                  ref,
                  style: {
                      ...style,
                      backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
                      backgroundSize: gridSize,
                      opacity,
                  } as CSSProperties,
              })
            : null;
    });
    Component.displayName = 'Util(gridOverlay)';
    return Component;
};

const createSafeAreaOverlayComponent = (input: { readonly className?: string }) => {
    const Component = forwardRef((props: SafeAreaOverlayProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            borderColor = 'var(--panel-border-preview, currentColor)',
            className,
            insetPercent = 6.25,
            opacity = 0.4,
            show,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const inset = `${insetPercent}%`;
        return show
            ? createElement('div', {
                  ...rest,
                  className: utilities.cls('absolute pointer-events-none', input.className, className),
                  ref,
                  style: {
                      ...style,
                      border: `1px dashed ${borderColor}`,
                      bottom: inset,
                      left: inset,
                      opacity,
                      right: inset,
                      top: inset,
                  } as CSSProperties,
              })
            : null;
    });
    Component.displayName = 'Util(safeAreaOverlay)';
    return Component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createUtility = (tuning?: TuningFor<'util'>) =>
    Object.freeze({
        create: (input: UtilityInput) =>
            createScrollAreaComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.util) }),
        GridOverlay: createGridOverlayComponent({}),
        SafeAreaOverlay: createSafeAreaOverlayComponent({}),
        ScrollArea: createScrollAreaComponent({ ...pick(tuning, TUNING_KEYS.util) }),
        SvgPreview: createSvgPreviewComponent({}),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createUtility };
export type { GridOverlayProps, SafeAreaOverlayProps, ScrollAreaProps, ScrollDirection, SvgPreviewProps, UtilityInput };
