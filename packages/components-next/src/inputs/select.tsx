/**
 * Select: Dropdown selection with ListBox, Popover positioning, and async state support.
 * Supports single/multi-select, sections, badges, tooltips, and custom validation.
 * Pure presentation - async state from external useEffectMutate hook.
 * REQUIRED: color, size, suffix (chevron icon) props - no defaults, no hardcoded mappings.
 */
import { FloatingNode, useFloatingNodeId, useMergeRefs } from '@floating-ui/react';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import type { AsyncState } from '@parametric-portal/types/async';
import type { LucideIcon } from 'lucide-react';
import { createContext, useContext, type FC, type ReactElement, type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import {
	ComboBox as RACComboBox, FieldError, Header, Input, type Key, Label, ListBox, type ListBoxProps, ListBoxItem, type ListBoxItemProps, type ListBoxItemRenderProps,
	ListBoxSection, type ListBoxSectionProps, Popover, Button as RACButton, Select as RACSelect, type SelectProps as RACSelectProps, SelectValue, Separator, Text,
	type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SelectOption = { readonly id: Key; readonly label: string };
type SelectContextValue = { readonly size: string };
type SelectProps<T extends SelectOption = SelectOption> = Omit<RACSelectProps<T>, 'children'> &
	Pick<ListBoxProps<T>, 'dependencies' | 'disallowEmptySelection' | 'escapeKeyBehavior' | 'items' | 'layout' | 'orientation' | 'renderEmptyState' | 'selectionBehavior' | 'shouldFocusOnHover' | 'shouldFocusWrap'> & {
	readonly asyncState?: AsyncState;
	readonly children?: ReactNode | ((item: T) => ReactNode);
	readonly color: string;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly label?: ReactNode;
	readonly offset?: number;
	readonly ref?: Ref<HTMLDivElement>;
	readonly searchable?: boolean;
	readonly size: string;
	readonly suffix: LucideIcon | ReactNode;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type SelectItemProps = Omit<ListBoxItemProps, 'children'> & {
	readonly badge?: ReactNode | number | string;
	readonly children?: ReactNode | ((state: ListBoxItemRenderProps) => ReactNode);
	readonly description?: ReactNode;
	readonly destructive?: boolean;
	readonly icon?: SlotDef;
	readonly ref?: Ref<HTMLDivElement>;
	readonly tooltip?: TooltipConfig;
};
type SelectSectionProps<T extends object = object> = Omit<ListBoxSectionProps<T>, 'children'> & {
	readonly children: ReactNode | ((item: T) => ReactElement);
	readonly title?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		badgeMax: '--select-item-badge-max',
		offset: '--select-popover-offset',
	}),
	slot: {
		description: cn('text-(--select-description-size) text-(--select-description-color)'),
		error: cn('text-(--select-error-size) text-(--select-error-color)'),
		input: cn(
			'flex-1 bg-transparent outline-none text-(--select-fg)',
			'placeholder:text-(--select-placeholder-color)',
			'disabled:cursor-not-allowed',
		),
		inputIcon: cn(
			'size-(--select-icon-size) shrink-0 text-(--select-icon-color)',
			'pointer-events-none',
		),
		inputWrapper: cn(
			'group inline-flex items-center gap-(--select-gap) cursor-text',
			'h-(--select-height) w-(--select-width) px-(--select-px)',
			'text-(--select-font-size) font-(--select-font-weight) rounded-(--select-radius)',
			'bg-(--select-bg) text-(--select-fg)',
			'border-(--select-border-width) border-(--select-border-color)',
			'shadow-(--select-shadow)',
			'transition-colors duration-(--select-transition-duration) ease-(--select-transition-easing)',
			'hovered:bg-(--select-hover-bg) hovered:border-(--select-hover-border)',
			'focus-within:border-(--select-hover-border) focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color) focus-within:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--select-disabled-opacity)',
			'invalid:border-(--select-invalid-border)',
		),
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
		label: cn('text-(--select-label-size) text-(--select-label-color) font-(--select-label-weight)'),
		listbox: cn('outline-none overflow-auto', 'max-h-(--select-listbox-max-height) p-(--select-listbox-padding)'),
		popover: cn(
			'bg-(--select-listbox-bg) rounded-(--select-listbox-radius) shadow-(--select-listbox-shadow)',
			'border-(--select-listbox-border-width) border-(--select-listbox-border-color)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--select-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--select-popover-animation-scale)',
			'placement-top:slide-in-from-bottom-(--select-popover-animation-offset)',
			'placement-bottom:slide-in-from-top-(--select-popover-animation-offset)',
		),
		root: cn('group flex flex-col gap-(--select-wrapper-gap)'),
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

const SelectRoot = <T extends SelectOption = SelectOption>({
	asyncState, children, className, color, dependencies, description, disallowEmptySelection, errorMessage, escapeKeyBehavior, isDisabled, isInvalid, items,
	label, layout, offset, orientation, placeholder, ref, renderEmptyState, searchable, selectionBehavior, shouldFocusOnHover, shouldFocusWrap,
	size, suffix, tooltip, variant, ...racProps }: SelectProps<T>): ReactNode => {
	const nodeId = useFloatingNodeId();
	const resolvedOffset = offset ?? readCssPx(B.cssVars.offset);
	const triggerRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
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
	const popoverContent = (
		<FloatingNode id={nodeId}>
			<Popover
				className={B.slot.popover}
				data-color={color}
				data-size={size}
				data-slot='select-popover'
				data-theme='select'
				data-variant={variant}
				offset={resolvedOffset}
				style={{ minWidth: triggerWidth }}
			>
				<ListBox
					className={B.slot.listbox}
					data-slot='select-listbox'
					{...defined({ dependencies, disallowEmptySelection, escapeKeyBehavior, items, layout, orientation, renderEmptyState, selectionBehavior, shouldFocusOnHover, shouldFocusWrap })}
				>
					{children}
				</ListBox>
			</Popover>
		</FloatingNode>
	);
	return (
		<SelectContext.Provider value={contextValue}>
			{searchable ? (
				<RACComboBox
					{...({ ...racProps, ...tooltipProps } as unknown as object)}
					className={cn(B.slot.root, className)}
					data-async-state={asyncSlot.attr}
					data-color={color}
					data-orientation={orientation}
					data-searchable={true}
					data-size={size}
					data-slot='select'
					data-pending={asyncSlot.pending || undefined}
					data-variant={variant}
					{...(isInvalid !== undefined && { isInvalid })}
					isDisabled={isDisabled || asyncSlot.pending}
					ref={mergedRef}
				>
					{label && <Label className={B.slot.label} data-slot='select-label'>{label}</Label>}
					<div className={B.slot.inputWrapper} data-invalid={isInvalid || undefined} ref={triggerRef as Ref<HTMLDivElement>}>
						<Input className={B.slot.input} {...defined({ placeholder })} />
						{Slot.content(suffix, B.slot.inputIcon)}
					</div>
					{popoverContent}
					{description && <Text className={B.slot.description} data-slot='select-description' slot='description'>{description}</Text>}
					<FieldError className={B.slot.error} data-slot='select-error'>{errorMessage}</FieldError>
				</RACComboBox>
			) : (
				<RACSelect
					{...(racProps as RACSelectProps<T>)}
					{...tooltipProps}
					className={composeTailwindRenderProps(className, B.slot.root)}
					data-async-state={asyncSlot.attr}
					data-color={color}
					data-orientation={orientation}
					data-size={size}
					data-slot='select'
					data-pending={asyncSlot.pending || undefined}
					data-variant={variant}
					{...(isInvalid !== undefined && { isInvalid })}
					isDisabled={isDisabled || asyncSlot.pending}
					ref={mergedRef}
				>
					{label && <Label className={B.slot.label} data-slot='select-label'>{label}</Label>}
					<RACButton className={B.slot.trigger} data-invalid={isInvalid || undefined} ref={triggerRef as Ref<HTMLButtonElement>}>
						<SelectValue className={B.slot.value}>
							{({ selectedText }) => (
								<span className={selectedText ? undefined : B.slot.valuePlaceholder}> {selectedText || placeholder} </span>
							)}
						</SelectValue>
						{Slot.content(suffix, B.slot.triggerIcon)}
					</RACButton>
					{popoverContent}
					{description && <Text className={B.slot.description} data-slot='select-description' slot='description'>{description}</Text>}
					<FieldError className={B.slot.error} data-slot='select-error'>{errorMessage}</FieldError>
				</RACSelect>
			)}
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</SelectContext.Provider>
	);
};
const SelectItem: FC<SelectItemProps> = ({
	badge, children, className, description, destructive, icon, ref, tooltip, ...racProps }) => {
	const badgeMax = readCssPx(B.cssVars.badgeMax) || 99;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const isRenderFn = typeof children === 'function';
	return (
		<>
			<ListBoxItem
				{...(racProps as ListBoxItemProps)}
				{...tooltipProps}
				className={composeTailwindRenderProps(className, B.slot.item)}
				data-destructive={destructive || undefined}
				data-slot='select-item'
				ref={mergedRef}
			>
				{(renderProps) => (
					<>
						{Slot.render(icon, undefined, B.slot.itemIcon)}
						<span className='flex-1 flex flex-col'>
							{isRenderFn
								? (children as (state: ListBoxItemRenderProps) => ReactNode)(renderProps)
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
const SelectSection = <T extends object = object>({ children, className, title, ...racProps }: SelectSectionProps<T>): ReactNode => (
	<ListBoxSection
		{...(racProps as ListBoxSectionProps<T>)}
		className={cn(B.slot.section, className)}
		data-slot='select-section'
	>
		{title && <Header className={B.slot.sectionHeader}>{title}</Header>}
		{children as ReactNode}
	</ListBoxSection>
);
const SelectSeparator: FC<{ readonly className?: string }> = ({ className }) => (
	<Separator className={cn(B.slot.separator, className)} data-slot='select-separator' />
);

// --- [COMPOUND] --------------------------------------------------------------

const Select = Object.assign(SelectRoot, {
	Item: SelectItem,
	Section: SelectSection,
	Separator: SelectSeparator,
	useContext: (): SelectContextValue | null => useContext(SelectContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Select };
export type { SelectItemProps, SelectOption, SelectProps, SelectSectionProps };
