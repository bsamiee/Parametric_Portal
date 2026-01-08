/**
 * Radio: RadioGroup + Radio for mutually exclusive selection.
 * Pure presentation - CSS variable driven styling.
 * Features: Label/Description/FieldError, SelectionIndicator animation, render props, validation, longPress.
 * Presets: card (bordered container via prop), segmented (button-like via RadioGroup context).
 * REQUIRED: color, size, icon props - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import { createContext, type FC, type ReactNode, type Ref, useContext, useMemo, useRef } from 'react';
import {
	FieldError, Label, Radio as RACRadio, RadioGroup as RACRadioGroup, type RadioGroupProps as RACRadioGroupProps,
	type RadioProps as RACRadioProps, Text, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type RadioGroupContextValue = { readonly segmented: boolean };
type RadioState = {
	readonly isDisabled: boolean;
	readonly isFocused: boolean;
	readonly isFocusVisible: boolean;
	readonly isHovered: boolean;
	readonly isInvalid: boolean;
	readonly isPressed: boolean;
	readonly isReadOnly: boolean;
	readonly isRequired: boolean;
	readonly isSelected: boolean;
};
type RadioGroupSpecificProps = {
	readonly children: ReactNode;
	readonly className?: RACRadioGroupProps['className'];
	readonly defaultValue?: string | null;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly label?: ReactNode;
	readonly onChange?: (value: string) => void;
	readonly segmented?: boolean;
	readonly size: string;
	readonly validate?: RACRadioGroupProps['validate'];
	readonly validationBehavior?: 'aria' | 'native';
	readonly value?: string | null;
};
type RadioSpecificProps = {
	readonly card?: boolean;
	readonly children?: SlotDef<ReactNode> | ((state: RadioState) => ReactNode);
	readonly className?: RACRadioProps['className'];
	readonly gesture?: GestureProps;
	readonly id?: string;
	readonly ref?: Ref<HTMLLabelElement>;
	readonly value: string;
};
type RadioGroupProps = BasePropsFor<'radioGroup'> & RadioGroupSpecificProps;
type RadioProps = BasePropsFor<'radio'> & RadioSpecificProps;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
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
});
const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);
const useRadioGroupContext = (): RadioGroupContextValue | null => useContext(RadioGroupContext);

// --- [ENTRY_POINT] -----------------------------------------------------------

const RadioGroup: FC<RadioGroupProps> = ({
	children, className, color, defaultValue, description, errorMessage, form, isDisabled, isInvalid,
	isReadOnly, isRequired, label, name, onBlur, onChange, onFocus, onFocusChange, orientation, segmented, size, slot, validate, validationBehavior, value, variant,
	...rest
}) => {
	const contextValue = useMemo(() => ({ segmented: segmented ?? false }), [segmented]);
	return (
		<RACRadioGroup
			{...({ ...rest } as unknown as RACRadioGroupProps)}
			className={composeTailwindRenderProps(className, B.slot.groupWrapper)}
			data-color={color}
			data-segmented={segmented || undefined}
			data-size={size}
			data-slot='radio-group'
			data-variant={variant}
			{...defined({ defaultValue, form, isDisabled, isInvalid, isReadOnly, isRequired, name, onBlur, onChange, onFocus, onFocusChange, orientation, slot, validate, validationBehavior, value })}
		>
			<RadioGroupContext.Provider value={contextValue}>
				{label && <Label className={B.slot.groupLabel} data-slot='radio-group-label'>{label}</Label>}
				{description && <Text className={B.slot.description} data-slot='radio-group-description' slot='description'>{description}</Text>}
				<div className={segmented ? B.slot.groupSegmented : B.slot.groupBase} data-orientation={orientation}>{children}</div>
				<FieldError className={B.slot.fieldError} data-slot='radio-group-error'>{errorMessage}</FieldError>
			</RadioGroupContext.Provider>
		</RACRadioGroup>
	);
};
const Radio: FC<RadioProps> = ({
	asyncState, autoFocus, card, children, className, color, gesture, icon, inputRef, isDisabled,
	onBlur, onFocus, onFocusChange, onHoverEnd, onHoverStart, onKeyDown, onKeyUp, ref, size, slot: slotProp, tooltip,
	...rest
}) => {
	const groupCtx = useRadioGroupContext();
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const radioRef = useRef<HTMLLabelElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		ref: radioRef,
		...gesture,
		cssVars: { progress: '--radio-longpress-progress', ...gesture?.cssVars },
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, radioRef, tooltipProps.ref as Ref<HTMLLabelElement>]);
	const isSegmented = groupCtx?.segmented ?? false;
	const baseSlot = (isSegmented && B.slot.radioSegmented) || (card && B.slot.radioCard) || B.slot.radioBase;
	const showCircle = !isSegmented;
	const isRenderFn = typeof children === 'function';
	return (
		<>
			<RACRadio
				{...({ ...rest, ...tooltipProps, ...gestureProps } as unknown as RACRadioProps)}
				className={composeTailwindRenderProps(className, baseSlot)}
				data-async-state={slot.attr}
				data-card={card || undefined}
				data-color={color}
				data-size={size}
				data-slot='radio'
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...defined({ autoFocus, inputRef, onBlur, onFocus, onFocusChange, onHoverEnd, onHoverStart, onKeyDown, onKeyUp, slot: slotProp })}
			>
				{(renderProps) => (
					<>
						{showCircle && (
							<span className={B.slot.radioCircle} data-slot='radio-circle'>
								<span className={B.slot.radioIndicator} data-slot='radio-indicator' />
								{Slot.content(renderProps.isSelected ? icon : null, B.slot.radioIcon)}
							</span>
						)}
						{isRenderFn
							? (children as (state: RadioState) => ReactNode)(renderProps)
							: children && <span className={B.slot.radioLabel}>{slot.resolve(children)}</span>}
					</>
				)}
			</RACRadio>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Radio, RadioGroup };
export type { RadioGroupProps, RadioProps, RadioState };
