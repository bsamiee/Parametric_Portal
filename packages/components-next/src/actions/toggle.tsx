/**
 * Toggle components: Switch + Checkbox + CheckboxGroup.
 * Pure presentation - async state from external useEffectMutate hook.
 * REQUIRED: color, size, and icon props - no defaults, no hardcoded mappings.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { LucideIcon } from 'lucide-react';
import type { FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import {
	Checkbox as RACCheckbox, CheckboxGroup as RACCheckboxGroup, type CheckboxGroupProps as RACCheckboxGroupProps, type CheckboxProps as RACCheckboxProps,
	FieldError, Switch as RACSwitch, type SwitchProps as RACSwitchProps, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SwitchProps = Omit<RACSwitchProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly color: string;
	readonly gesture?: GestureProps;
	readonly ref?: Ref<HTMLLabelElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type CheckboxProps = Omit<RACCheckboxProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly color: string;
	readonly gesture?: GestureProps;
	readonly icon: LucideIcon | ReactNode;
	readonly iconIndeterminate?: LucideIcon | ReactNode;
	readonly ref?: Ref<HTMLLabelElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type CheckboxGroupProps = Omit<RACCheckboxGroupProps, 'children'> & {
	readonly children: ReactNode;
	readonly color: string;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly orientation?: 'horizontal' | 'vertical';
	readonly size: string;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: {
		checkboxBase: cn(
			'group inline-flex items-center gap-(--checkbox-gap) cursor-pointer',
			'disabled:pointer-events-none disabled:opacity-(--checkbox-disabled-opacity)',
			'readonly:cursor-default',
		),
		checkboxBox: cn(
			'shrink-0 flex items-center justify-center',
			'size-(--checkbox-box-size) rounded-(--checkbox-box-radius)',
			'bg-(--checkbox-box-bg) border-(--checkbox-border-width) border-(--checkbox-border-color)',
			'transition-all duration-(--checkbox-transition-duration) ease-(--checkbox-transition-easing)',
			'group-selected:bg-(--checkbox-selected-bg) group-selected:border-(--checkbox-selected-border)',
			'group-data-[indeterminate]:bg-(--checkbox-selected-bg) group-data-[indeterminate]:border-(--checkbox-selected-border)',
			'group-invalid:border-(--checkbox-invalid-border)',
			'group-focus-visible:ring-(--focus-ring-width) group-focus-visible:ring-(--focus-ring-color)',
		),
		checkboxError: cn('text-(--checkbox-group-error-size) text-(--checkbox-group-error-color)'),
		checkboxIcon: cn('size-(--checkbox-icon-size) text-(--checkbox-icon-color)'),
		checkboxLabel: cn('text-(--checkbox-label-size) text-(--checkbox-label-color)'),
		group: cn('flex gap-(--checkbox-group-gap)', 'data-[orientation=vertical]:flex-col'),
		switchBase: cn(
			'group inline-flex items-center gap-(--switch-gap) cursor-pointer',
			'disabled:pointer-events-none disabled:opacity-(--switch-disabled-opacity)',
			'readonly:cursor-default',
		),
		switchLabel: cn('text-(--switch-label-size) text-(--switch-label-color)'),
		switchThumb: cn(
			'absolute size-(--switch-thumb-size) rounded-full bg-(--switch-thumb-bg) shadow-(--switch-thumb-shadow)',
			'left-(--switch-thumb-offset) transition-all duration-(--switch-transition-duration) ease-(--switch-transition-easing)',
			'group-selected:left-[calc(100%-var(--switch-thumb-size)-var(--switch-thumb-offset))]',
		),
		switchTrack: cn(
			'relative shrink-0 w-(--switch-track-width) h-(--switch-track-height) rounded-(--switch-track-radius)',
			'bg-(--switch-track-bg) transition-colors duration-(--switch-transition-duration) ease-(--switch-transition-easing)',
			'group-selected:bg-(--switch-selected-bg)',
			'group-focus-visible:ring-(--focus-ring-width) group-focus-visible:ring-(--focus-ring-color)',
		),
	} as const,
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Switch: FC<SwitchProps> = ({
	asyncState, children, className, color, gesture, isDisabled, ref, size, tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const activeChildren = slot.resolve(children);
	const switchRef = useRef<HTMLLabelElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'switch',
		ref: switchRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, switchRef, tooltipProps.ref as Ref<HTMLLabelElement>]);
	return (
		<>
			<RACSwitch
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACSwitchProps)}
				className={composeTailwindRenderProps(className, B.slot.switchBase)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='switch'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				<span className={B.slot.switchTrack}>
					<span className={B.slot.switchThumb} />
				</span>
				{activeChildren && <span className={B.slot.switchLabel}>{activeChildren}</span>}
			</RACSwitch>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const Checkbox: FC<CheckboxProps> = ({
	asyncState, children, className, color, gesture, icon, iconIndeterminate, isDisabled, ref, size, tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const activeChildren = slot.resolve(children);
	const checkboxRef = useRef<HTMLLabelElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'checkbox',
		ref: checkboxRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, checkboxRef, tooltipProps.ref as Ref<HTMLLabelElement>]);
	return (
		<>
			<RACCheckbox
				{...({ ...racProps, ...tooltipProps, ...gestureProps } as unknown as RACCheckboxProps)}
				className={composeTailwindRenderProps(className, B.slot.checkboxBase)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='checkbox'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
			>
				{({ isSelected: selected, isIndeterminate: indeterminate }) => (
					<>
						<span className={B.slot.checkboxBox}>
							{Slot.content(
								(indeterminate && iconIndeterminate) || (selected && icon) || null,
								B.slot.checkboxIcon,
							)}
						</span>
						{activeChildren && <span className={B.slot.checkboxLabel}>{activeChildren}</span>}
					</>
				)}
			</RACCheckbox>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const CheckboxGroup: FC<CheckboxGroupProps> = ({
	children, className, color, errorMessage, orientation, size, variant, ...racProps }) => (
	<RACCheckboxGroup
		{...(racProps as RACCheckboxGroupProps)}
		className={composeTailwindRenderProps(className, B.slot.group)}
		data-color={color}
		data-orientation={orientation}
		data-size={size}
		data-slot='checkbox-group'
		data-variant={variant}
		{...defined({ orientation })}
	>
		{children}
		<FieldError className={B.slot.checkboxError} data-slot='checkbox-group-error'>{errorMessage}</FieldError>
	</RACCheckboxGroup>
);

// --- [EXPORT] ----------------------------------------------------------------

export { Checkbox, CheckboxGroup, Switch };
export type { CheckboxGroupProps, CheckboxProps, SwitchProps };
