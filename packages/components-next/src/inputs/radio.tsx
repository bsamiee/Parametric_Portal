/**
 * RadioGroup and Radio for mutually exclusive selection.
 * Requires color, size, icon props. Presets: card, segmented.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { LucideIcon } from 'lucide-react';
import { createContext, type FC, type ReactNode, type Ref, useContext, useMemo, useRef } from 'react';
import {
    FieldError, Label, Radio as RACRadio, RadioGroup as RACRadioGroup, type RadioGroupProps as RACRadioGroupProps,
    type RadioProps as RACRadioProps, type RadioRenderProps, Text, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type RadioGroupContextValue = { readonly segmented: boolean };
type RadioGroupProps = Omit<RACRadioGroupProps, 'children'> & {
    readonly children: ReactNode;
    readonly color: string;
    readonly description?: ReactNode;
    readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
    readonly label?: ReactNode;
    readonly segmented?: boolean;
    readonly size: string;
    readonly variant?: string;
};
type RadioProps = Omit<RACRadioProps, 'children'> & {
    readonly asyncState?: AsyncState;
    readonly card?: boolean;
    readonly children?: SlotDef<ReactNode> | ((state: RadioRenderProps) => ReactNode);
    readonly color: string;
    readonly gesture?: GestureProps;
    readonly icon: LucideIcon | ReactNode;
    readonly ref?: Ref<HTMLLabelElement>;
    readonly size: string;
    readonly tooltip?: TooltipConfig;
    readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    slot: {
        description: cn('text-(--radio-group-description-size) text-(--radio-group-description-color)'),
        fieldError: cn('text-(--radio-group-error-size) text-(--radio-group-error-color)'),
        groupBase: cn('flex flex-col gap-(--radio-group-gap)', 'data-[orientation=horizontal]:flex-row'),
        groupLabel: cn('text-(--radio-group-label-size) text-(--radio-group-label-color) font-(--radio-group-label-weight)'),
        groupSegmented: cn(
            'inline-flex p-(--radio-group-segmented-padding) gap-(--radio-group-segmented-gap)',
            'bg-(--radio-group-segmented-bg) rounded-(--radio-group-segmented-radius)',
        ),
        groupWrapper: cn('flex flex-col gap-(--radio-group-wrapper-gap)'),
        radioBase: cn(
            'group inline-flex items-center gap-(--radio-gap) cursor-pointer',
            'disabled:pointer-events-none disabled:opacity-(--radio-disabled-opacity)',
            'readonly:cursor-default',
        ),
        radioCard: cn(
            'group relative flex gap-(--radio-card-gap) cursor-pointer',
            'p-(--radio-card-padding) rounded-(--radio-card-radius)',
            'bg-(--radio-card-bg) border-(--radio-card-border-width) border-(--radio-card-border-color)',
            'transition-all duration-(--radio-transition-duration) ease-(--radio-transition-easing)',
            'hovered:bg-(--radio-card-hover-bg) hovered:border-(--radio-card-hover-border)',
            'selected:bg-(--radio-card-selected-bg) selected:border-(--radio-card-selected-border)',
            'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
            'disabled:pointer-events-none disabled:opacity-(--radio-disabled-opacity)',
            'invalid:border-(--radio-invalid-border)',
        ),
        radioCircle: cn(
            'relative shrink-0 flex items-center justify-center',
            'size-(--radio-circle-size) rounded-full',
            'bg-(--radio-circle-bg) border-(--radio-border-width) border-(--radio-border-color)',
            'transition-all duration-(--radio-transition-duration) ease-(--radio-transition-easing)',
            'group-selected:bg-(--radio-selected-bg) group-selected:border-(--radio-selected-border)',
            'group-invalid:border-(--radio-invalid-border)',
            'group-focus-visible:ring-(--focus-ring-width) group-focus-visible:ring-(--focus-ring-color)',
        ),
        radioIcon: cn('size-(--radio-icon-size) text-(--radio-icon-color)'),
        radioIndicator: cn(
            'absolute size-(--radio-indicator-size) rounded-full bg-(--radio-indicator-color)',
            'transition-transform duration-(--radio-transition-duration) ease-(--radio-transition-easing)',
            'scale-(--radio-indicator-scale) group-selected:scale-(--radio-indicator-scale-selected)',
        ),
        radioLabel: cn('text-(--radio-label-size) text-(--radio-label-color)'),
        radioSegmented: cn(
            'group inline-flex items-center justify-center cursor-pointer',
            'px-(--radio-segmented-px) py-(--radio-segmented-py) rounded-(--radio-segmented-radius)',
            'text-(--radio-segmented-font-size) font-(--radio-segmented-font-weight) text-(--radio-segmented-fg)',
            'transition-all duration-(--radio-transition-duration) ease-(--radio-transition-easing)',
            'hovered:bg-(--radio-segmented-hover-bg)',
            'selected:bg-(--radio-segmented-selected-bg) selected:text-(--radio-segmented-selected-fg) selected:shadow-(--radio-segmented-selected-shadow)',
            'disabled:pointer-events-none disabled:opacity-(--radio-disabled-opacity)',
        ),
    } as const,
} as const;
const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

// --- [ENTRY_POINT] -----------------------------------------------------------

const RadioGroupRoot: FC<RadioGroupProps> = ({
    children, className, color, description, errorMessage, label, orientation, segmented, size, variant, ...racProps }) => {
    const contextValue = useMemo(() => ({ segmented: segmented ?? false }), [segmented]);
    return (
        <RACRadioGroup
            {...(racProps as RACRadioGroupProps)}
            className={composeTailwindRenderProps(className, _B.slot.groupWrapper)}
            data-color={color}
            data-segmented={segmented || undefined}
            data-size={size}
            data-slot='radio-group'
            data-variant={variant}
            {...defined({ orientation })}
        >
            <RadioGroupContext.Provider value={contextValue}>
                {label && <Label className={_B.slot.groupLabel} data-slot='radio-group-label'>{label}</Label>}
                {description && <Text className={_B.slot.description} data-slot='radio-group-description' slot='description'>{description}</Text>}
                <div className={segmented ? _B.slot.groupSegmented : _B.slot.groupBase} data-orientation={orientation}>{children}</div>
                <FieldError className={_B.slot.fieldError} data-slot='radio-group-error'>{errorMessage}</FieldError>
            </RadioGroupContext.Provider>
        </RACRadioGroup>
    );
};
const Radio: FC<RadioProps> = ({
    asyncState, card, children, className, color, gesture, icon, isDisabled, ref, size, tooltip, variant, ...racProps }) => {
    const groupCtx = useContext(RadioGroupContext);
    const slot = Slot.bind(asyncState);
    const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
    const radioRef = useRef<HTMLLabelElement>(null);
    const { props: gestureProps } = useGesture({
        isDisabled: isDisabled || slot.pending,
        prefix: 'radio',
        ref: radioRef,
        ...gesture,
        ...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
    });
    const mergedRef = useMergeRefs([ref, radioRef, tooltipProps.ref as Ref<HTMLLabelElement>]);
    const isSegmented = groupCtx?.segmented ?? false;
    const baseSlot = (isSegmented && _B.slot.radioSegmented) || (card && _B.slot.radioCard) || _B.slot.radioBase;
    const showCircle = !isSegmented;
    const isRenderFn = typeof children === 'function';
    return (
        <>
            <RACRadio
                {...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACRadioProps)}
                className={composeTailwindRenderProps(className, baseSlot)}
                data-async-state={slot.attr}
                data-card={card || undefined}
                data-color={color}
                data-size={size}
                data-slot='radio'
                data-variant={variant}
                isDisabled={isDisabled || slot.pending}
                ref={mergedRef}
            >
                {(renderProps) => (
                    <>
                        {showCircle && (
                            <span className={_B.slot.radioCircle} data-slot='radio-circle'>
                                <span className={_B.slot.radioIndicator} data-slot='radio-indicator' />
                                {Slot.content(renderProps.isSelected ? icon : null, _B.slot.radioIcon)}
                            </span>
                        )}
                        {isRenderFn
                            ? (children as (state: RadioRenderProps) => ReactNode)(renderProps)
                            : children && <span className={_B.slot.radioLabel}>{slot.resolve(children)}</span>}
                    </>
                )}
            </RACRadio>
            {renderTooltip?.()}
            <AsyncAnnouncer asyncState={asyncState} />
        </>
    );
};

// --- [COMPOUND] --------------------------------------------------------------

const RadioGroup = Object.assign(RadioGroupRoot, {
    useContext: (): RadioGroupContextValue | null => useContext(RadioGroupContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Radio, RadioGroup };
export type { RadioGroupProps, RadioProps };
