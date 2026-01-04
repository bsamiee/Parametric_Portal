/**
 * Button: Pure presentation component with theme-driven styling via CSS variable slots.
 * Async state comes from external hooks (useEffectMutate) - no internal Effect execution.
 * REQUIRED: color and size props - no defaults, no hardcoded mappings.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';
import { cn, composeTailwindRenderProps } from '../core/css-slots';
import { type AsyncSlotConfig, deriveAsyncSlot, renderSlotContent, type SlotInput } from '../core/slots';

// --- [TYPES] -----------------------------------------------------------------

type ButtonProps = Omit<RACButtonProps, 'children'> & {
    readonly asyncState?: AsyncState<unknown, unknown>;
    readonly children?: ReactNode;
    readonly childrenAsync?: AsyncSlotConfig<ReactNode>;
    readonly color: string;
    readonly prefix?: SlotInput;
    readonly prefixAsync?: AsyncSlotConfig;
    readonly ref?: Ref<HTMLButtonElement>;
    readonly size: string;
    readonly suffix?: SlotInput;
    readonly suffixAsync?: AsyncSlotConfig;
    readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    slot: Object.freeze({
        base: cn(
            'inline-flex items-center justify-center cursor-pointer',
            'h-(--button-height) w-(--button-width) px-(--button-px) gap-(--button-gap)',
            'text-(--button-font-size) rounded-(--button-radius)',
            'bg-(--button-bg) text-(--button-fg)',
            'border-solid [border-width:var(--button-border-width,0)] [border-color:var(--button-border-color,transparent)]',
            'shadow-(--button-shadow) font-(--button-font-weight) whitespace-nowrap overflow-hidden',
            'duration-(--button-transition-duration) ease-(--button-transition-easing)',
            'hovered:bg-(--button-hover-bg)',
            'pressed:bg-(--button-pressed-bg) pressed:scale-(--button-pressed-scale)',
            'focused:outline-none focused:ring-(--button-focus-ring-width) focused:ring-(--button-focus-ring-color) focused:ring-offset-(--button-focus-ring-offset)',
            'disabled:pointer-events-none disabled:opacity-(--button-disabled-opacity)',
        ),
        icon: cn('size-(--button-icon-size) shrink-0', '[animation:var(--button-icon-animation,none)]'),
        text: 'truncate',
    }),
});

// --- [COMPONENTS] ------------------------------------------------------------

const Button: FC<ButtonProps> = ({
    asyncState,
    children,
    childrenAsync,
    className,
    color,
    isDisabled,
    prefix,
    prefixAsync,
    ref,
    size,
    suffix,
    suffixAsync,
    variant,
    ...rest
}) => {
    const isPending = AsyncState.isPending(asyncState);
    const activePrefix = deriveAsyncSlot(prefix, prefixAsync, asyncState);
    const activeSuffix = deriveAsyncSlot(suffix, suffixAsync, asyncState);
    const activeChildren = deriveAsyncSlot(children, childrenAsync, asyncState);
    return (
        <RACButton
            {...rest}
            className={composeTailwindRenderProps(className, B.slot.base)}
            data-async-state={AsyncState.toAttr(asyncState)}
            data-color={color}
            data-size={size}
            data-slot='button'
            data-variant={variant}
            isDisabled={isDisabled === true || isPending}
            isPending={isPending}
            ref={ref}
        >
            {renderSlotContent(activePrefix, B.slot.icon)}
            <span className={B.slot.text}>{activeChildren}</span>
            {renderSlotContent(activeSuffix, B.slot.icon)}
        </RACButton>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as BUTTON_TUNING, Button };
export type { ButtonProps };
