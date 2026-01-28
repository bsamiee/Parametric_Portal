/**
 * Unified input with type discrimination: text, search, number.
 * Requires color, size, type props. Supports multiline, clear, stepper icons.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import {
	Button as RACButton, FieldError, Group, Input, Label, Text, TextArea, TextField as RACTextField, type TextFieldProps as RACTextFieldProps, SearchField as RACSearchField,
	type SearchFieldProps as RACSearchFieldProps, NumberField as RACNumberField, type NumberFieldProps as RACNumberFieldProps, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type FieldProps = TextFieldProps | SearchFieldProps | NumberFieldProps;
type BaseFieldProps = {
	readonly asyncState?: AsyncState;
	readonly color: string;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly gesture?: GestureProps;
	readonly label?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type TextFieldProps = Omit<RACTextFieldProps, 'children'> & BaseFieldProps & {
	readonly type: 'text';
	readonly multiline?: boolean;
	readonly placeholder?: string;
	readonly prefix?: SlotInput;
	readonly rows?: number;
	readonly suffix?: SlotInput;
};
type SearchFieldProps = Omit<RACSearchFieldProps, 'children'> & BaseFieldProps & {
	readonly type: 'search';
	readonly clearIcon: SlotInput;
	readonly placeholder?: string;
	readonly searchIcon: SlotInput;
};
type NumberFieldProps = Omit<RACNumberFieldProps, 'children'> & BaseFieldProps & {
	readonly type: 'number';
	readonly decrementIcon: SlotInput;
	readonly formatOptions?: Intl.NumberFormatOptions;
	readonly incrementIcon: SlotInput;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	slot: {
		// Search field slots
		clearButton: cn(
			'flex items-center justify-center cursor-pointer',
			'size-(--field-clear-size)',
			'rounded-(--field-clear-radius)',
			'text-(--field-clear-color)',
			'transition-colors duration-(--field-transition-duration)',
			'hovered:bg-(--field-clear-hover-bg)',
			'pressed:bg-(--field-clear-pressed-bg)',
			'group-data-[empty]:hidden',
		),
		clearIcon: cn('size-(--field-clear-icon-size)'),
		// Shared slots
		description: cn('text-(--field-description-size) text-(--field-description-color)'),
		error: cn('text-(--field-error-size) text-(--field-error-color)'),
		// Text field slots
		input: cn(
			'flex-1 bg-transparent outline-none text-(--field-input-color) text-(--field-font-size)',
			'placeholder:text-(--field-placeholder-color)',
			'disabled:cursor-not-allowed',
		),
		inputWrapper: cn(
			'flex items-center gap-(--field-gap)',
			'h-(--field-height) px-(--field-px)',
			'bg-(--field-bg) rounded-(--field-radius)',
			'border-(--field-border-width) border-(--field-border-color)',
			'transition-colors duration-(--field-transition-duration) ease-(--field-transition-easing)',
			'focus-within:border-(--field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'group-invalid:border-(--field-invalid-border)',
			'group-disabled:opacity-(--field-disabled-opacity) group-disabled:pointer-events-none',
		),
		label: cn('text-(--field-label-size) text-(--field-label-color) font-(--field-label-weight)'),
		// Number field slots
		numberGroup: cn(
			'flex items-center',
			'h-(--field-height)',
			'bg-(--field-bg) rounded-(--field-radius)',
			'border-(--field-border-width) border-(--field-border-color)',
			'transition-colors duration-(--field-transition-duration) ease-(--field-transition-easing)',
			'focus-within:border-(--field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'data-[invalid]:border-(--field-invalid-border)',
			'data-[disabled]:opacity-(--field-disabled-opacity) data-[disabled]:pointer-events-none',
		),
		numberInput: cn(
			'flex-1 bg-transparent outline-none text-center text-(--field-input-color) text-(--field-font-size)',
			'w-(--field-input-width)',
			'placeholder:text-(--field-placeholder-color)',
			'disabled:cursor-not-allowed',
		),
		prefixIcon: cn('size-(--field-icon-size) shrink-0 text-(--field-icon-color)'),
		root: cn('group flex flex-col gap-(--field-wrapper-gap)'),
		searchIcon: cn('size-(--field-icon-size) shrink-0 text-(--field-icon-color)'),
		searchInput: cn(
			'flex-1 bg-transparent outline-none text-(--field-input-color) text-(--field-font-size)',
			'placeholder:text-(--field-placeholder-color)',
			'disabled:cursor-not-allowed',
			'[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
		),
		stepper: cn(
			'flex items-center justify-center cursor-pointer',
			'size-(--field-stepper-size)',
			'text-(--field-stepper-color)',
			'transition-colors duration-(--field-transition-duration)',
			'hovered:bg-(--field-stepper-hover-bg)',
			'pressed:bg-(--field-stepper-pressed-bg)',
			'disabled:opacity-(--field-stepper-disabled-opacity) disabled:cursor-not-allowed',
		),
		stepperIcon: cn('size-(--field-stepper-icon-size)'),
		suffixIcon: cn('size-(--field-icon-size) shrink-0 text-(--field-icon-color)'),
		textarea: cn(
			'flex-1 bg-transparent outline-none text-(--field-input-color) text-(--field-font-size)',
			'placeholder:text-(--field-placeholder-color)',
			'disabled:cursor-not-allowed',
			'resize-y min-h-(--field-textarea-min-height)',
		),
		textareaWrapper: cn(
			'flex gap-(--field-gap)',
			'min-h-(--field-textarea-min-height) px-(--field-px) py-(--field-py)',
			'bg-(--field-bg) rounded-(--field-radius)',
			'border-(--field-border-width) border-(--field-border-color)',
			'transition-colors duration-(--field-transition-duration) ease-(--field-transition-easing)',
			'focus-within:border-(--field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'group-invalid:border-(--field-invalid-border)',
			'group-disabled:opacity-(--field-disabled-opacity) group-disabled:pointer-events-none',
		),
	},
} as const;

// --- [TEXT_FIELD_CONTENT] ----------------------------------------------------

const TextFieldContent: FC<TextFieldProps> = ({
	asyncState, className, color, description, errorMessage, gesture, isDisabled, label, multiline, placeholder, prefix, ref, rows, size, suffix,
	tooltip, variant, type: _type, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'field',
		ref: fieldRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, fieldRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACTextField
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACTextFieldProps)}
				className={composeTailwindRenderProps(className, _B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-multiline={multiline || undefined}
				data-size={size}
				data-slot='field'
				data-type='text'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{label && <Label className={_B.slot.label} data-slot='field-label'>{label}</Label>}
				{multiline ? (
					<div className={_B.slot.textareaWrapper} data-slot='field-textarea-wrapper'>
						{Slot.render(prefix, asyncState, _B.slot.prefixIcon)}
						<TextArea className={_B.slot.textarea} data-slot='field-textarea' {...defined({ placeholder, rows })} />
						{Slot.render(suffix, asyncState, _B.slot.suffixIcon)}
					</div>
				) : (
					<div className={_B.slot.inputWrapper} data-slot='field-input-wrapper'>
						{Slot.render(prefix, asyncState, _B.slot.prefixIcon)}
						<Input className={_B.slot.input} data-slot='field-input' {...defined({ placeholder })} />
						{Slot.render(suffix, asyncState, _B.slot.suffixIcon)}
					</div>
				)}
				{description && <Text className={_B.slot.description} data-slot='field-description' slot='description'>{description}</Text>}
				<FieldError className={_B.slot.error} data-slot='field-error'>{errorMessage}</FieldError>
			</RACTextField>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [SEARCH_FIELD_CONTENT] --------------------------------------------------

const SearchFieldContent: FC<SearchFieldProps> = ({
	asyncState, className, clearIcon, color, description, errorMessage, gesture, isDisabled, label, placeholder, ref, searchIcon, size, tooltip, variant, type: _type, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'field',
		ref: fieldRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, fieldRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACSearchField
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACSearchFieldProps)}
				className={composeTailwindRenderProps(className, _B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='field'
				data-type='search'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{label && <Label className={_B.slot.label} data-slot='field-label'>{label}</Label>}
				<div className={_B.slot.inputWrapper} data-slot='field-input-wrapper'>
					{slot.render(searchIcon, _B.slot.searchIcon)}
					<Input className={_B.slot.searchInput} data-slot='field-input' {...defined({ placeholder })} />
					<RACButton className={_B.slot.clearButton} data-slot='field-clear'>
						{slot.render(clearIcon, _B.slot.clearIcon)}
					</RACButton>
				</div>
				{description && <Text className={_B.slot.description} data-slot='field-description' slot='description'>{description}</Text>}
				<FieldError className={_B.slot.error} data-slot='field-error'>{errorMessage}</FieldError>
			</RACSearchField>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [NUMBER_FIELD_CONTENT] --------------------------------------------------

const NumberFieldContent: FC<NumberFieldProps> = ({
	asyncState, className, color, decrementIcon, description, errorMessage, formatOptions, gesture, incrementIcon, isDisabled, label, ref, size, tooltip, variant, type: _type, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'field',
		ref: fieldRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, fieldRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACNumberField
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACNumberFieldProps)}
				{...(formatOptions && { formatOptions })}
				className={composeTailwindRenderProps(className, _B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='field'
				data-type='number'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{label && <Label className={_B.slot.label} data-slot='field-label'>{label}</Label>}
				<Group className={_B.slot.numberGroup} data-slot='field-group'>
					<RACButton className={_B.slot.stepper} data-slot='field-decrement' slot='decrement'>
						{slot.render(decrementIcon, _B.slot.stepperIcon)}
					</RACButton>
					<Input className={_B.slot.numberInput} data-slot='field-input' />
					<RACButton className={_B.slot.stepper} data-slot='field-increment' slot='increment'>
						{slot.render(incrementIcon, _B.slot.stepperIcon)}
					</RACButton>
				</Group>
				{description && <Text className={_B.slot.description} data-slot='field-description' slot='description'>{description}</Text>}
				<FieldError className={_B.slot.error} data-slot='field-error'>{errorMessage}</FieldError>
			</RACNumberField>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Field: FC<FieldProps> = (props) => {
	switch (props.type) {
		case 'text': return <TextFieldContent {...props} />;
		case 'search': return <SearchFieldContent {...props} />;
		case 'number': return <NumberFieldContent {...props} />;
	}
};

// --- [EXPORT] ----------------------------------------------------------------

export { Field };
export type { FieldProps, NumberFieldProps as FieldNumberProps, SearchFieldProps as FieldSearchProps, TextFieldProps as FieldTextProps };
