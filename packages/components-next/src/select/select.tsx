/**
 * Select: Dropdown selection with ListBox, Popover positioning, and async state support.
 * Supports single/multi-select, sections, badges, tooltips, and custom validation.
 * Pure presentation - async state from external useEffectMutate hook.
 * REQUIRED: color, size, suffix (chevron icon) props - no defaults, no hardcoded mappings.
 */
import { FloatingNode, useFloatingNodeId, useMergeRefs } from '@floating-ui/react';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import type { LucideIcon } from 'lucide-react';
import { createContext, type FC, type ReactElement, type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import {
	type Key, Header, ListBox, ListBoxItem, type ListBoxItemProps, ListBoxSection,
	Popover, Button as RACButton, Select as RACSelect, type SelectProps as RACSelectProps,
	SelectValue, Separator,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip } from '../core/floating';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, defined, Slot } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SelectionMode = 'multiple' | 'single';
type SelectionBehavior = 'replace' | 'toggle';
type LayoutType = 'grid' | 'stack';
type SelectOption = { readonly id: Key; readonly label: string };
type SelectContextValue = { readonly size: string };
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
	readonly defaultValue?: Key | null;
	readonly dependencies?: readonly unknown[];
	readonly disallowEmptySelection?: boolean;
	readonly escapeKeyBehavior?: 'clearSelection' | 'none';
	readonly isOpen?: boolean;
	readonly items?: Iterable<T>;
	readonly layout?: LayoutType;
	readonly offset?: number;
	readonly onChange?: (value: Key | null) => void;
	readonly onSelectionChange?: (key: Key | null) => void;
	readonly placeholder?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly renderEmptyState?: () => ReactNode;
	readonly selectedKey?: Key | null;
	readonly selectionBehavior?: SelectionBehavior;
	readonly selectionMode?: SelectionMode;
	readonly shouldFocusOnHover?: boolean;
	readonly shouldFocusWrap?: boolean;
	readonly suffix: LucideIcon | ReactNode;
	readonly validate?: RACSelectProps<T>['validate'];
	readonly validationBehavior?: 'aria' | 'native';
	readonly value?: Key | null;
};
type SelectItemSpecificProps = {
	readonly children?: ReactNode | ((state: SelectItemState) => ReactNode);
	readonly className?: string;
	readonly description?: ReactNode;
	readonly destructive?: boolean;
	readonly isDisabled?: boolean;
	readonly onAction?: () => void;
	readonly textValue?: string;
};
type SelectSectionSpecificProps<T extends object = object> = {
	readonly children: ReactNode | ((item: T) => ReactElement);
	readonly className?: string;
	readonly items?: Iterable<T>;
	readonly title?: string;
};
type SelectProps<T extends SelectOption = SelectOption> = BasePropsFor<'select'> & SelectSpecificProps<T>;
type SelectItemProps = BasePropsFor<'selectItem'> & SelectItemSpecificProps;
type SelectSectionProps<T extends object = object> = BasePropsFor<'selectSection'> & SelectSectionSpecificProps<T>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		badgeMax: '--select-item-badge-max',
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
			'data-[destructive]:text-(--select-item-destructive-fg)',
			'data-[destructive]:hovered:bg-(--select-item-destructive-hover-bg)',
		),
		itemBadge: cn(
			'inline-flex items-center justify-center ml-auto',
			'min-w-(--select-item-badge-min-width) px-(--select-item-badge-padding-x)',
			'text-(--select-item-badge-font-size)',
			'bg-(--select-item-badge-bg) text-(--select-item-badge-fg)',
			'rounded-(--select-item-badge-radius)',
		),
		itemDescription: cn('text-(--select-item-description-font-size) text-(--select-item-description-fg)'),
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
		section: cn(''),
		sectionHeader: cn(
			'px-(--select-section-header-px) py-(--select-section-header-py)',
			'text-(--select-section-header-font-size) text-(--select-section-header-fg) font-(--select-section-header-font-weight)',
		),
		separator: cn('h-(--select-separator-height) my-(--select-separator-my) bg-(--select-separator-color)'),
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
const SelectContext = createContext<SelectContextValue | null>(null);

// --- [ENTRY_POINT] -----------------------------------------------------------

const Select = <T extends SelectOption = SelectOption>({
	asyncState, autoFocus, children, className, color, defaultOpen, defaultSelectedKey, defaultValue,
	dependencies, disabledKeys, disallowEmptySelection, escapeKeyBehavior, excludeFromTabOrder, form,
	isDisabled, isInvalid, isOpen, isReadOnly, isRequired, items, layout, name, offset, onChange,
	onOpenChange, onSelectionChange, orientation, placeholder, ref, renderEmptyState,
	selectedKey, selectionBehavior, selectionMode, shouldFocusOnHover, shouldFocusWrap, size, slot,
	suffix, tooltip, validate, validationBehavior, value, variant,
	...rest
}: SelectProps<T>): ReactNode => {
	const nodeId = useFloatingNodeId();
	const resolvedOffset = offset ?? readCssPx(B.cssVars.offset);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
	const asyncSlot = Slot.bind(asyncState);
	const contextValue = useMemo(() => ({ size }), [size]);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	useEffect(() => {
		const el = triggerRef.current;
		const observer = el ? new ResizeObserver(() => setTriggerWidth(el.offsetWidth)) : null;
		el && observer?.observe(el);
		return () => observer?.disconnect();
	}, []);
	return (
		<SelectContext.Provider value={contextValue}>
			<RACSelect
				{...tooltipProps}
				className={composeTailwindRenderProps(className, '')}
				data-async-state={asyncSlot.attr}
				data-color={color}
				data-orientation={orientation}
				data-size={size}
				data-slot='select'
				data-pending={asyncSlot.pending || undefined}
				data-variant={variant}
				isDisabled={isDisabled || asyncSlot.pending}
				ref={mergedRef}
				{...({
					...rest,
					...defined({
						autoFocus, defaultOpen, defaultSelectedKey, defaultValue, disabledKeys, excludeFromTabOrder,
						form, isInvalid, isOpen, isReadOnly, isRequired, name, onChange, onOpenChange,
						onSelectionChange, selectedKey, selectionMode, slot, validate, validationBehavior, value,
					}),
				} as unknown as RACSelectProps<T>)}
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
							{...defined({
								dependencies, disallowEmptySelection, escapeKeyBehavior, items, layout, orientation,
								renderEmptyState, selectionBehavior, shouldFocusOnHover, shouldFocusWrap,
							})}
						>
							{children}
						</ListBox>
					</Popover>
				</FloatingNode>
			</RACSelect>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</SelectContext.Provider>
	);
};
const SelectItem: FC<SelectItemProps> = ({
	badge, children, className, description, destructive, download, href, icon, id, isDisabled, onAction,
	ref, rel, slot, target, textValue, tooltip, ...rest
}) => {
	const badgeMax = readCssPx(B.cssVars.badgeMax);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const isRenderFn = typeof children === 'function';
	return (
		<>
			<ListBoxItem
				{...({ ...rest, ...tooltipProps } as ListBoxItemProps)}
				className={composeTailwindRenderProps(className, B.slot.item)}
				data-destructive={destructive || undefined}
				data-slot='select-item'
				ref={mergedRef}
				{...defined({ download, href, id, isDisabled, onAction, rel, slot, target, textValue })}
			>
				{(renderProps) => (
					<>
						{Slot.render(icon, undefined, B.slot.itemIcon)}
						<span className='flex-1 flex flex-col'>
							{isRenderFn
								? (children as (state: SelectItemState) => ReactNode)({
									isDisabled: renderProps.isDisabled,
									isFocused: renderProps.isFocused,
									isFocusVisible: renderProps.isFocusVisible,
									isHovered: renderProps.isHovered,
									isPressed: renderProps.isPressed,
									isSelected: renderProps.isSelected,
								})
							: children}
							{description && <span className={B.slot.itemDescription}>{description}</span>}
						</span>
						{badge !== undefined && (
							<span className={B.slot.itemBadge}>
								{typeof badge === 'number' && badgeMax !== undefined && badge > badgeMax ? `${badgeMax}+` : badge}
							</span>
						)}
					</>
				)}
			</ListBoxItem>
			{renderTooltip?.()}
		</>
	);
};
const SelectSection = <T extends object = object>({
	children, className, disabledKeys, id, items, title, ...rest
}: SelectSectionProps<T>): ReactNode => (
	<ListBoxSection
		{...(rest as object)}
		className={cn(B.slot.section, className)}
		data-slot='select-section'
		{...defined({ disabledKeys, id, items })}
	>
		{title && <Header className={B.slot.sectionHeader}>{title}</Header>}
		{children as ReactNode}
	</ListBoxSection>
);
const SelectSeparator: FC<{ readonly className?: string }> = ({ className }) => (
	<Separator className={cn(B.slot.separator, className)} data-slot='select-separator' />
);

// --- [EXPORT] ----------------------------------------------------------------

export { Select, SelectItem, SelectSection, SelectSeparator };
export type { SelectItemProps, SelectItemState, SelectOption, SelectProps, SelectSectionProps };
