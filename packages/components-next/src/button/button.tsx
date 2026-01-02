/**
 * Compose button via tailwind-variants slots and CSS variable contracts.
 * Apps customize via CSS variables; polymorphic via asChild.
 */
import type { AsyncState } from '@parametric-portal/types/async';
import type { LucideIcon } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';
import { getStateAnimation } from '../core/animation';
import { renderSlotContent, Slot, type SlotInput, Slottable } from '../core/slots';
import { cn } from '../core/utils';
import { composeTailwindRenderProps, cssVarSlots, tv, type VariantProps } from '../core/variants';

// --- [TYPES] -----------------------------------------------------------------

type ButtonVariants = VariantProps<typeof buttonStyles>;
type ButtonSlots = {
    readonly prefix?: SlotInput;
    readonly suffix?: SlotInput;
    readonly stateIcon?: LucideIcon;
};
type ButtonBaseProps = ButtonSlots &
    ButtonVariants & {
        readonly state?: AsyncState<void, Error>;
        readonly ref?: Ref<HTMLButtonElement>;
        readonly children?: ReactNode;
        readonly className?: string;
        readonly isDisabled?: boolean;
    };
type ButtonProps =
    | ({ readonly asChild?: false } & Omit<RACButtonProps, 'children'> & ButtonBaseProps)
    | ({ readonly asChild: true; readonly children: ReactNode } & ButtonBaseProps);

// --- [CONSTANTS] -------------------------------------------------------------

/** Visual values reference CSS custom properties—zero hardcoded literals. */
const buttonStyles = tv({
    slots: {
        base: [
            // Layout
            'inline-flex items-center justify-center cursor-pointer',
            // Sizing via CSS variables
            cssVarSlots('button', {
                gap: 'gap',
                h: 'height',
                'min-w': 'min-width',
                px: 'padding-x',
                py: 'padding-y',
            }),
            // Colors via CSS variables
            cssVarSlots('button', {
                bg: 'bg',
                'border-[length:var(--button-border-width)]': 'border-width',
                'border-color': 'border-color',
                text: 'fg',
            }),
            // Typography
            cssVarSlots('button', {
                font: 'font-weight',
                'text-[length:var(--button-font-size)]': 'font-size',
            }),
            // Visual effects
            cssVarSlots('button', {
                rounded: 'radius',
                shadow: 'shadow',
            }),
            // Hover state
            'hover:bg-(--button-hover-bg)',
            // Focus state
            'focus-visible:outline-none',
            'focus-visible:ring-(--button-focus-ring)',
            'focus-visible:ring-[length:var(--button-focus-ring-width)]',
            'focus-visible:ring-offset-(--button-focus-ring-offset)',
            // Transitions
            'duration-(--button-transition-duration)',
            'ease-(--button-transition-easing)',
            // Disabled state
            'data-[disabled]:pointer-events-none',
            'data-[disabled]:opacity-(--button-disabled-opacity)',
            // Pressed state
            'active:scale-[var(--button-pressed-scale)]',
        ],
        icon: ['size-(--button-icon-size)', 'shrink-0'],
        stateIndicator: ['size-(--button-icon-size)', 'shrink-0'],
    },
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isLoadingState = (state: AsyncState<void, Error> | undefined): boolean => state?._tag === 'Loading';

// --- [COMPONENTS] ------------------------------------------------------------

const Button: FC<ButtonProps> = (props) => {
    const {
        state,
        prefix,
        suffix,
        stateIcon: StateIconComponent,
        className,
        children,
        isDisabled,
        asChild,
        ref,
    } = props;
    const { base, icon, stateIndicator } = buttonStyles();
    const stateTag = state?._tag ?? 'Idle';
    const isLoading = isLoadingState(state);
    const animationClass = getStateAnimation(stateTag.toLowerCase() as 'failure' | 'idle' | 'loading' | 'success');
    const disabled = isDisabled === true || isLoading;
    const stateIndicatorEl =
        StateIconComponent !== undefined && state !== undefined && stateTag !== 'Idle' ? (
            <StateIconComponent className={cn(stateIndicator(), animationClass)} />
        ) : null;
    const content = (
        <>
            {stateIndicatorEl}
            {renderSlotContent(prefix, icon())}
            <Slottable>{children}</Slottable>
            {renderSlotContent(suffix, icon())}
        </>
    );
    const dataState = disabled ? 'disabled' : stateTag.toLowerCase();
    return asChild === true ? (
        <Slot className={cn(base(), className)} data-slot='button' data-state={dataState} ref={ref}>
            {content}
        </Slot>
    ) : (
        <RACButton
            {...(({ asChild: _, ...rest }) => rest)(props)}
            className={composeTailwindRenderProps(className, base())}
            data-slot='button'
            data-state={dataState}
            isDisabled={disabled}
            ref={ref}
        >
            {content}
        </RACButton>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { Button, buttonStyles };
export type { ButtonProps, ButtonSlots, ButtonVariants };
