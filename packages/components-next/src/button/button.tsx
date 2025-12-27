/**
 * Button compound component with CVA variants and Motion animations.
 * Grounding: Compound pattern with React Aria accessibility.
 */

import { Slot } from '@radix-ui/react-slot';
import type { HTMLMotionProps } from 'motion/react';
import { motion } from 'motion/react';
import {
    type ButtonHTMLAttributes,
    type CSSProperties,
    createElement,
    type FC,
    forwardRef,
    type ReactNode,
    type Ref,
    useRef,
} from 'react';
import type { AriaButtonOptions } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover } from 'react-aria';
import { getInteractionProps } from '../core/motion.ts';
import { cn } from '../core/variants.ts';
import { type ButtonVariants, buttonVariants } from './button.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type ButtonRootProps = AriaButtonOptions<'button'> &
    ButtonVariants & {
        readonly animate?: boolean;
        readonly asChild?: boolean;
        readonly children?: ReactNode;
        readonly className?: string;
    };
type ButtonIconProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly side?: 'left' | 'right';
};
type ButtonSpinnerProps = {
    readonly className?: string;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toMotionButtonProps = <T extends { style?: CSSProperties | undefined }>(
    props: T,
    animate: boolean,
): HTMLMotionProps<'button'> => {
    const { style, ...rest } = props;
    const motionProps = animate ? getInteractionProps(true) : {};
    return {
        ...rest,
        ...motionProps,
        ...(style === undefined ? {} : { style }),
    } as HTMLMotionProps<'button'>;
};

// --- [COMPONENTS] ------------------------------------------------------------

const ButtonRoot = forwardRef<HTMLButtonElement, ButtonRootProps>(
    ({ animate = true, asChild = false, children, className, size, variant, ...ariaProps }, forwardedRef) => {
        const internalRef = useRef<HTMLButtonElement>(null);
        const ref = (forwardedRef ?? internalRef) as Ref<HTMLButtonElement>;
        const { buttonProps, isPressed } = useButton(ariaProps, { current: ref as unknown as HTMLButtonElement });
        const { hoverProps, isHovered } = useHover({ isDisabled: ariaProps.isDisabled ?? false });
        const { focusProps, isFocusVisible } = useFocusRing();
        const mergedProps = mergeProps(buttonProps, hoverProps, focusProps);
        const isDisabled = ariaProps.isDisabled ?? false;
        const shouldAnimate = animate && !isDisabled;
        const baseProps = {
            ...mergedProps,
            className: cn(buttonVariants({ size, variant }), className),
            'data-focus-visible': isFocusVisible || undefined,
            'data-hovered': isHovered || undefined,
            'data-pressed': isPressed || undefined,
            ref,
            type: 'button' as const,
        };
        return (
            (asChild && createElement(Slot, baseProps as ButtonHTMLAttributes<HTMLButtonElement>, children)) ||
            (shouldAnimate && createElement(motion.button, toMotionButtonProps(baseProps, true), children)) ||
            createElement('button', { ...baseProps, type: 'button' }, children)
        );
    },
);
ButtonRoot.displayName = 'Button';

const ButtonIcon: FC<ButtonIconProps> = ({ children, className, side = 'left' }) =>
    createElement(
        'span',
        {
            className: cn('shrink-0', side === 'left' ? '-ml-0.5' : '-mr-0.5', className),
            'data-slot': 'icon',
        },
        children,
    );
ButtonIcon.displayName = 'Button.Icon';

const ButtonSpinner: FC<ButtonSpinnerProps> = ({ className }) =>
    createElement(
        'span',
        {
            className: cn('animate-spin', className),
            'data-slot': 'spinner',
        },
        createElement(
            'svg',
            {
                className: 'h-4 w-4',
                fill: 'none',
                viewBox: '0 0 24 24',
                xmlns: 'http://www.w3.org/2000/svg',
            },
            createElement('circle', {
                className: 'opacity-25',
                cx: '12',
                cy: '12',
                r: '10',
                stroke: 'currentColor',
                strokeWidth: '4',
            }),
            createElement('path', {
                className: 'opacity-75',
                d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z',
                fill: 'currentColor',
            }),
        ),
    );
ButtonSpinner.displayName = 'Button.Spinner';

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Button = Object.assign(ButtonRoot, {
    Icon: ButtonIcon,
    Spinner: ButtonSpinner,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
export { Button, ButtonIcon, ButtonRoot, ButtonSpinner };
// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
export type { ButtonIconProps, ButtonRootProps, ButtonSpinnerProps };
