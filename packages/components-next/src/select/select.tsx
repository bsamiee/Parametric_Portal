/**
 * Select: Dropdown selection with ListBox, Popover positioning, and async state support.
 * Supports single and multi-select modes with custom validation.
 * Pure presentation - async state from external useEffectMutate hook.
 * REQUIRED: color, size, suffix (chevron icon) props - no defaults, no hardcoded mappings.
 */
import { FloatingNode, useFloatingNodeId, useMergeRefs } from '@floating-ui/react';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import type { LucideIcon } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { useEffect, useRef, useState } from 'react';
import { type Key, ListBox, ListBoxItem, type ListBoxItemProps, Popover, Button as RACButton, Select as RACSelect, type SelectProps as RACSelectProps,SelectValue, } from 'react-aria-components';
import { useTooltip } from '../core/floating';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';
import { AsyncAnnouncer } from '../core/announce';

// --- [TYPES] -----------------------------------------------------------------

type SelectionMode = 'multiple' | 'single';
type SelectOption = { readonly id: Key; readonly label: string };
type SelectItemState = {
	readonly isDisabled: boolean;
	readonly isFocused: boolean;
	readonly isFocusVisible: boolean;
	readonly isHovered: boolean;
	readonly isPressed: boolean;
	readonly isSelected: boolean;
};
type SelectSpecificProps<T extends SelectOption = SelectOption> = {
	readonly children?: ReactNode | ((item: T) => ReactNode);
	readonly className?: RACSelectProps<T>['className'];
	readonly defaultOpen?: boolean;
	readonly defaultSelectedKey?: Key;
	readonly defaultValue?: Key | readonly Key[];
	readonly isOpen?: boolean;
	readonly items?: Iterable<T>;
	readonly offset?: number;
	readonly onChange?: (value: Key | readonly Key[]) => void;
	readonly onSelectionChange?: (key: Key | null) => void;
	readonly placeholder?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly renderEmptyState?: () => ReactNode;
	readonly selectedKey?: Key | null;
	readonly selectionMode?: SelectionMode;
	readonly suffix: LucideIcon | ReactNode;
	readonly validate?: RACSelectProps<T>['validate'];
	readonly validationBehavior?: 'aria' | 'native';
	readonly value?: Key | readonly Key[];
};
type SelectItemSpecificProps = {
	readonly children?: SlotDef<ReactNode> | ((state: SelectItemState) => ReactNode);
	readonly className?: string;
	readonly isDisabled?: boolean;
	readonly onAction?: () => void;
	readonly textValue?: string;
};
type SelectProps<T extends SelectOption = SelectOption> = BasePropsFor<'select'> & SelectSpecificProps<T>;
type SelectItemProps = BasePropsFor<'selectItem'> & SelectItemSpecificProps;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		offset: '--select-popover-offset',
	}),
	slot: {
		item: cn(
			'flex items-center gap-(--select-item-gap) cursor-pointer outline-none',
			'h-(--select-item-height) px-(--select-item-px)',
			'text-(--select-item-font-size) text-(--select-item-fg)',
			'rounded-(--select-item-radius)',
			'hovered:bg-(--select-item-hover-bg)',
			'pressed:bg-(--select-item-pressed-bg)',
			'selected:bg-(--select-item-selected-bg) selected:text-(--select-item-selected-fg)',
			'focused:bg-(--select-item-focused-bg)',
			'disabled:pointer-events-none disabled:opacity-(--select-item-disabled-opacity)',
		),
		itemIcon: cn('size-(--select-item-icon-size) shrink-0'),
		listbox: cn('outline-none overflow-auto', 'max-h-(--select-listbox-max-height) p-(--select-listbox-padding)'),
		popover: cn(
			'bg-(--select-listbox-bg) rounded-(--select-listbox-radius) shadow-(--select-listbox-shadow)',
			'border-(--select-listbox-border-width) border-(--select-listbox-border-color)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--select-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--select-popover-animation-scale)',
			'placement-top:slide-in-from-bottom-(--select-popover-animation-offset)',
			'placement-bottom:slide-in-from-top-(--select-popover-animation-offset)',
		),
		trigger: cn(
			'group inline-flex items-center justify-between gap-(--select-gap) cursor-pointer',
			'h-(--select-height) w-(--select-width) px-(--select-px)',
			'text-(--select-font-size) font-(--select-font-weight) rounded-(--select-radius)',
			'bg-(--select-bg) text-(--select-fg)',
			'border-(--select-border-width) border-(--select-border-color)',
			'shadow-(--select-shadow)',
			'transition-colors duration-(--select-transition-duration) ease-(--select-transition-easing)',
			'hovered:bg-(--select-hover-bg) hovered:border-(--select-hover-border)',
			'pressed:bg-(--select-pressed-bg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--select-disabled-opacity)',
			'invalid:border-(--select-invalid-border)',
		),
		triggerIcon: cn(
			'size-(--select-icon-size) shrink-0 text-(--select-icon-color)',
			'transition-transform duration-(--select-transition-duration)',
			'group-open:rotate-180',
		),
		value: cn('truncate text-left flex-1'),
		valuePlaceholder: cn('text-(--select-placeholder-color)'),
	} as const,
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Select = <T extends SelectOption = SelectOption>({
	asyncState, children, className, color, isDisabled, isInvalid, items, offset, onSelectionChange,
	placeholder, ref, renderEmptyState, size, suffix, tooltip, validate, variant,
	...rest
}: SelectProps<T>): ReactNode => {
	const nodeId = useFloatingNodeId();
	const resolvedOffset = offset ?? readCssPx(B.cssVars.offset);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	useEffect(() => {
		const el = triggerRef.current;
		const observer = el ? new ResizeObserver(() => setTriggerWidth(el.offsetWidth)) : null;
		el && observer?.observe(el);
		return () => observer?.disconnect();
	}, []);
	return (
		<>
			<RACSelect
				{...({ ...rest, ...tooltipProps } as unknown as RACSelectProps<T>)}
				className={composeTailwindRenderProps(className, '')}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='select'
				data-pending={slot.pending || undefined}
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...defined({ isInvalid, onSelectionChange, validate })}
			>
				<RACButton className={B.slot.trigger} data-invalid={isInvalid || undefined} ref={triggerRef}>
					<SelectValue className={B.slot.value}>
						{({ selectedText }) => (
							<span className={selectedText ? undefined : B.slot.valuePlaceholder}> {selectedText || placeholder} </span>
						)}
					</SelectValue>
					{Slot.content(suffix, B.slot.triggerIcon)}
				</RACButton>
				<FloatingNode id={nodeId}>
					<Popover
						className={B.slot.popover}
						data-color={color}
						data-size={size}
						data-slot='select-popover'
						data-variant={variant}
						offset={resolvedOffset}
						style={{ minWidth: triggerWidth }}
					>
						<ListBox
							className={B.slot.listbox}
							data-slot='select-listbox'
							{...defined({ items, renderEmptyState })}
						>
							{children}
						</ListBox>
					</Popover>
				</FloatingNode>
			</RACSelect>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const SelectItem: FC<SelectItemProps> = ({ children, className, icon, ...rest }) => {
	const isRenderFn = typeof children === 'function';
	return (
		<ListBoxItem {...(rest as ListBoxItemProps)} className={composeTailwindRenderProps(className, B.slot.item)} data-slot='select-item'>
			{(renderProps) => (
				<>
					{Slot.content(icon, B.slot.itemIcon)}
					{isRenderFn
						? (children as (state: SelectItemState) => ReactNode)({
							isDisabled: renderProps.isDisabled,
							isFocused: renderProps.isFocused,
							isFocusVisible: renderProps.isFocusVisible,
							isHovered: renderProps.isHovered,
							isPressed: renderProps.isPressed,
							isSelected: renderProps.isSelected,
						})
						: Slot.resolve(children as SlotDef<ReactNode> | undefined, undefined)}
				</>
			)}
		</ListBoxItem>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Select, SelectItem };
export type { SelectionMode, SelectItemProps, SelectItemState, SelectOption, SelectProps };
