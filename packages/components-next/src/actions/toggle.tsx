/**
 * Toggle components: Switch + Checkbox + CheckboxGroup.
 * Pure presentation - async state from external useEffectMutate hook.
 * REQUIRED: color, size, and icon props - no defaults, no hardcoded mappings.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { LucideIcon } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import {
	Checkbox as RACCheckbox, CheckboxGroup as RACCheckboxGroup, type CheckboxGroupProps as RACCheckboxGroupProps,
	type CheckboxProps as RACCheckboxProps, Switch as RACSwitch, type SwitchProps as RACSwitchProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SwitchProps = Omit<RACSwitchProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotDef<ReactNode>;
	readonly color: string;
	readonly ref?: Ref<HTMLLabelElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type CheckboxProps = Omit<RACCheckboxProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: ReactNode;
	readonly color?: string;
	readonly icon: LucideIcon | ReactNode;
	readonly iconIndeterminate?: LucideIcon | ReactNode;
	readonly ref?: Ref<HTMLLabelElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type CheckboxGroupProps = Omit<RACCheckboxGroupProps, 'children'> & {
	readonly children: ReactNode;
	readonly color?: string;
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
	asyncState, children, className, color, isDisabled, ref, size, tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const activeChildren = slot.resolve(children);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLLabelElement>]);
	return (
		<>
			<RACSwitch
				{...({ ...racProps, ...tooltipProps } as unknown as RACSwitchProps)}
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
	asyncState, children, className, color, icon, iconIndeterminate, isDisabled, ref, size, tooltip, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLLabelElement>]);
	return (
		<>
			<RACCheckbox
				{...({ ...racProps, ...tooltipProps } as unknown as RACCheckboxProps)}
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
						{children && <span className={B.slot.checkboxLabel}>{children}</span>}
					</>
				)}
			</RACCheckbox>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const CheckboxGroup: FC<CheckboxGroupProps> = ({
	children, className, color, orientation, size, variant, ...racProps }) => (
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
	</RACCheckboxGroup>
);

// --- [EXPORT] ----------------------------------------------------------------

export { Checkbox, CheckboxGroup, Switch };
export type { CheckboxGroupProps, CheckboxProps, SwitchProps };
