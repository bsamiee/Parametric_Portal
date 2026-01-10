/**
 * SearchField: Search input with search icon and clear button.
 * Pure presentation - CSS variable driven styling.
 * Supports: searchIcon (REQUIRED), clearIcon (REQUIRED), tooltip, all RAC form props.
 * REQUIRED: color, size, searchIcon, clearIcon props - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import {
	Button as RACButton, FieldError, Input, Label, Text, SearchField as RACSearchField,
	type SearchFieldProps as RACSearchFieldProps, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SearchFieldProps = Omit<RACSearchFieldProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly clearIcon: SlotInput;
	readonly color: string;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly gesture?: GestureProps;
	readonly label?: ReactNode;
	readonly placeholder?: string;
	readonly ref?: Ref<HTMLDivElement>;
	readonly searchIcon: SlotInput;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		clearButton: cn(
			'flex items-center justify-center cursor-pointer',
			'size-(--search-field-clear-size)',
			'rounded-(--search-field-clear-radius)',
			'text-(--search-field-clear-color)',
			'transition-colors duration-(--search-field-transition-duration)',
			'hovered:bg-(--search-field-clear-hover-bg)',
			'pressed:bg-(--search-field-clear-pressed-bg)',
			'group-data-[empty]:hidden',
		),
		clearIcon: cn('size-(--search-field-clear-icon-size)'),
		description: cn('text-(--search-field-description-size) text-(--search-field-description-color)'),
		error: cn('text-(--search-field-error-size) text-(--search-field-error-color)'),
		input: cn(
			'flex-1 bg-transparent outline-none text-(--search-field-input-color)',
			'placeholder:text-(--search-field-placeholder-color)',
			'disabled:cursor-not-allowed',
			'[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
		),
		inputWrapper: cn(
			'flex items-center gap-(--search-field-gap)',
			'h-(--search-field-height) px-(--search-field-px)',
			'bg-(--search-field-bg) rounded-(--search-field-radius)',
			'border-(--search-field-border-width) border-(--search-field-border-color)',
			'transition-colors duration-(--search-field-transition-duration) ease-(--search-field-transition-easing)',
			'focus-within:border-(--search-field-focus-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'group-invalid:border-(--search-field-invalid-border)',
			'group-disabled:opacity-(--search-field-disabled-opacity) group-disabled:pointer-events-none',
		),
		label: cn('text-(--search-field-label-size) text-(--search-field-label-color) font-(--search-field-label-weight)'),
		root: cn('group flex flex-col gap-(--search-field-wrapper-gap)'),
		searchIcon: cn('size-(--search-field-icon-size) shrink-0 text-(--search-field-icon-color)'),
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const SearchField: FC<SearchFieldProps> = ({
	asyncState, className, clearIcon, color, description, errorMessage, gesture, isDisabled, label, placeholder, ref, searchIcon, size, tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'search-field',
		ref: fieldRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, fieldRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACSearchField
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACSearchFieldProps)}
				className={composeTailwindRenderProps(className, B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='search-field'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{label && <Label className={B.slot.label} data-slot='search-field-label'>{label}</Label>}
				<div className={B.slot.inputWrapper} data-slot='search-field-input-wrapper'>
					{slot.render(searchIcon, B.slot.searchIcon)}
					<Input className={B.slot.input} data-slot='search-field-input' {...defined({ placeholder })} />
					<RACButton className={B.slot.clearButton} data-slot='search-field-clear'>
						{slot.render(clearIcon, B.slot.clearIcon)}
					</RACButton>
				</div>
				{description && <Text className={B.slot.description} data-slot='search-field-description' slot='description'>{description}</Text>}
				<FieldError className={B.slot.error} data-slot='search-field-error'>{errorMessage}</FieldError>
			</RACSearchField>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { SearchField };
export type { SearchFieldProps };
