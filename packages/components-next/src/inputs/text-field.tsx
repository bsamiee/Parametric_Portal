/**
 * TextField: Text input with label, description, and error display.
 * Pure presentation - CSS variable driven styling.
 * Supports: prefix/suffix icons, tooltip, multiline (textarea), asyncState, all RAC form props.
 * REQUIRED: color, size props - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import {
	FieldError, Input, Label, Text, TextArea,
	TextField as RACTextField, type TextFieldProps as RACTextFieldProps,
	type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type TextFieldProps = Omit<RACTextFieldProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly color: string;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly gesture?: GestureProps;
	readonly label?: ReactNode;
	readonly multiline?: boolean;
	readonly placeholder?: string;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLDivElement>;
	readonly rows?: number;
	readonly size: string;
	readonly suffix?: SlotInput;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		description: cn('text-(--text-field-description-size) text-(--text-field-description-color)'),
		error: cn('text-(--text-field-error-size) text-(--text-field-error-color)'),
		input: cn(
			'flex-1 bg-transparent outline-none text-(--text-field-input-color)',
			'placeholder:text-(--text-field-placeholder-color)',
			'disabled:cursor-not-allowed',
		),
		inputWrapper: cn(
			'flex items-center gap-(--text-field-gap)',
			'h-(--text-field-height) px-(--text-field-px)',
			'bg-(--text-field-bg) rounded-(--text-field-radius)',
			'border-(--text-field-border-width) border-(--text-field-border-color)',
			'transition-colors duration-(--text-field-transition-duration) ease-(--text-field-transition-easing)',
			'focus-within:border-(--text-field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'group-invalid:border-(--text-field-invalid-border)',
			'group-disabled:opacity-(--text-field-disabled-opacity) group-disabled:pointer-events-none',
		),
		label: cn('text-(--text-field-label-size) text-(--text-field-label-color) font-(--text-field-label-weight)'),
		prefixIcon: cn('size-(--text-field-icon-size) shrink-0 text-(--text-field-icon-color)'),
		root: cn('group flex flex-col gap-(--text-field-wrapper-gap)'),
		suffixIcon: cn('size-(--text-field-icon-size) shrink-0 text-(--text-field-icon-color)'),
		textarea: cn(
			'flex-1 bg-transparent outline-none text-(--text-field-input-color)',
			'placeholder:text-(--text-field-placeholder-color)',
			'disabled:cursor-not-allowed',
			'resize-y min-h-(--text-field-textarea-min-height)',
		),
		textareaWrapper: cn(
			'flex gap-(--text-field-gap)',
			'min-h-(--text-field-textarea-min-height) px-(--text-field-px) py-(--text-field-py)',
			'bg-(--text-field-bg) rounded-(--text-field-radius)',
			'border-(--text-field-border-width) border-(--text-field-border-color)',
			'transition-colors duration-(--text-field-transition-duration) ease-(--text-field-transition-easing)',
			'focus-within:border-(--text-field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'group-invalid:border-(--text-field-invalid-border)',
			'group-disabled:opacity-(--text-field-disabled-opacity) group-disabled:pointer-events-none',
		),
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const TextField: FC<TextFieldProps> = ({
	asyncState, className, color, description, errorMessage, gesture, isDisabled, label, multiline, placeholder, prefix, ref, rows, size, suffix,
	tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'text-field',
		ref: fieldRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, fieldRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACTextField
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACTextFieldProps)}
				className={composeTailwindRenderProps(className, B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-multiline={multiline || undefined}
				data-size={size}
				data-slot='text-field'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{label && <Label className={B.slot.label} data-slot='text-field-label'>{label}</Label>}
				{multiline ? (
					<div className={B.slot.textareaWrapper} data-slot='text-field-textarea-wrapper'>
						{Slot.render(prefix, asyncState, B.slot.prefixIcon)}
						<TextArea className={B.slot.textarea} data-slot='text-field-textarea' {...defined({ placeholder, rows })} />
						{Slot.render(suffix, asyncState, B.slot.suffixIcon)}
					</div>
				) : (
					<div className={B.slot.inputWrapper} data-slot='text-field-input-wrapper'>
						{Slot.render(prefix, asyncState, B.slot.prefixIcon)}
						<Input className={B.slot.input} data-slot='text-field-input' {...defined({ placeholder })} />
						{Slot.render(suffix, asyncState, B.slot.suffixIcon)}
					</div>
				)}
				{description && <Text className={B.slot.description} data-slot='text-field-description' slot='description'>{description}</Text>}
				<FieldError className={B.slot.error} data-slot='text-field-error'>{errorMessage}</FieldError>
			</RACTextField>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { TextField };
export type { TextFieldProps };
