/**
 * NumberField: Numeric input with increment/decrement stepper buttons.
 * Pure presentation - CSS variable driven styling.
 * Supports: stepper icons (REQUIRED), tooltip, all RAC form props.
 * REQUIRED: color, size, incrementIcon, decrementIcon props - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { FC, ReactNode, Ref } from 'react';
import { useRef } from 'react';
import {
	Button as RACButton, FieldError, Group, Input, Label, Text,
	NumberField as RACNumberField, type NumberFieldProps as RACNumberFieldProps,
	type ValidationResult,
} from 'react-aria-components';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { cn, composeTailwindRenderProps, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type NumberFieldProps = Omit<RACNumberFieldProps, 'children'> & {
	readonly color: string;
	readonly decrementIcon: SlotInput;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly incrementIcon: SlotInput;
	readonly label?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		description: cn('text-(--number-field-description-size) text-(--number-field-description-color)'),
		error: cn('text-(--number-field-error-size) text-(--number-field-error-color)'),
		group: cn(
			'flex items-center',
			'h-(--number-field-height)',
			'bg-(--number-field-bg) rounded-(--number-field-radius)',
			'border-(--number-field-border-width) border-(--number-field-border-color)',
			'transition-colors duration-(--number-field-transition-duration) ease-(--number-field-transition-easing)',
			'focus-within:border-(--number-field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'data-[invalid]:border-(--number-field-invalid-border)',
			'data-[disabled]:opacity-(--number-field-disabled-opacity) data-[disabled]:pointer-events-none',
		),
		input: cn(
			'flex-1 bg-transparent outline-none text-center text-(--number-field-input-color)',
			'w-(--number-field-input-width)',
			'placeholder:text-(--number-field-placeholder-color)',
			'disabled:cursor-not-allowed',
		),
		label: cn('text-(--number-field-label-size) text-(--number-field-label-color) font-(--number-field-label-weight)'),
		root: cn('group flex flex-col gap-(--number-field-wrapper-gap)'),
		stepper: cn(
			'flex items-center justify-center cursor-pointer',
			'size-(--number-field-stepper-size)',
			'text-(--number-field-stepper-color)',
			'transition-colors duration-(--number-field-transition-duration)',
			'hovered:bg-(--number-field-stepper-hover-bg)',
			'pressed:bg-(--number-field-stepper-pressed-bg)',
			'disabled:opacity-(--number-field-stepper-disabled-opacity) disabled:cursor-not-allowed',
		),
		stepperIcon: cn('size-(--number-field-stepper-icon-size)'),
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const NumberField: FC<NumberFieldProps> = ({
	className, color, decrementIcon, description, errorMessage, incrementIcon, label, ref, size, tooltip, variant, ...racProps
}) => {
	const inputRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, inputRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACNumberField
				{...(racProps as RACNumberFieldProps)}
				{...tooltipProps}
				className={composeTailwindRenderProps(className, B.slot.root)}
				data-color={color}
				data-size={size}
				data-slot='number-field'
				data-variant={variant}
				ref={mergedRef}
			>
				{label && <Label className={B.slot.label} data-slot='number-field-label'>{label}</Label>}
				<Group className={B.slot.group} data-slot='number-field-group'>
					<RACButton className={B.slot.stepper} data-slot='number-field-decrement' slot='decrement'>
						{Slot.render(decrementIcon, undefined, B.slot.stepperIcon)}
					</RACButton>
					<Input className={B.slot.input} data-slot='number-field-input' />
					<RACButton className={B.slot.stepper} data-slot='number-field-increment' slot='increment'>
						{Slot.render(incrementIcon, undefined, B.slot.stepperIcon)}
					</RACButton>
				</Group>
				{description && <Text className={B.slot.description} data-slot='number-field-description' slot='description'>{description}</Text>}
				<FieldError className={B.slot.error} data-slot='number-field-error'>{errorMessage}</FieldError>
			</RACNumberField>
			{renderTooltip?.()}
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { NumberField };
export type { NumberFieldProps };
