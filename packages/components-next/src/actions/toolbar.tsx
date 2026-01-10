/**
 * Toolbar: Action grouping component with keyboard navigation.
 * Wraps RAC Toolbar with CSS variable slots for theme-driven styling.
 * Supports horizontal/vertical orientation, groups, separators, and items with tooltips.
 * REQUIRED: color, size props on Toolbar - no defaults.
 */
import { useMergeRefs } from '@floating-ui/react';
import { createContext, useContext, useMemo, useRef, type CSSProperties, type FC, type ReactNode, type Ref } from 'react';
import {
	Button as RACButton, type ButtonProps as RACButtonProps, Group as RACGroup, SelectionIndicator as RACSelectionIndicator,
	Separator as RACSeparator, ToggleButton as RACToggleButton, ToggleButtonGroup as RACToggleButtonGroup, type ToggleButtonGroupProps as RACToggleButtonGroupProps,
	type ToggleButtonProps as RACToggleButtonProps, Toolbar as RACToolbar, type ToolbarProps as RACToolbarProps, type Key,
} from 'react-aria-components';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ToolbarContextValue = { readonly color: string; readonly orientation: 'horizontal' | 'vertical'; readonly size: string; };
type ToolbarGroupProps = {
	readonly 'aria-label'?: string;
	readonly children: ReactNode;
	readonly className?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type ToolbarSeparatorProps = {
	readonly className?: string;
	readonly ref?: Ref<HTMLElement>;
};
type ToolbarItemToggleProps = {
	readonly defaultSelected?: boolean;
	readonly id?: Key;
	readonly isSelected?: boolean;
	readonly onChange?: (isSelected: boolean) => void;
};
type ToolbarItemProps = Omit<RACButtonProps, 'children'> & Partial<ToolbarItemToggleProps> & {
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly gesture?: GestureProps;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLButtonElement>;
	readonly selectionIndicator?: boolean;
	readonly suffix?: SlotInput;
	readonly tooltip?: TooltipConfig;
};
type ToolbarToggleGroupProps = Omit<RACToggleButtonGroupProps, 'aria-label' | 'children'> & {
	readonly 'aria-label': string;
	readonly children: ReactNode;
	readonly className?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type ToolbarProps = Omit<RACToolbarProps, 'children'> & {
	readonly children: ReactNode;
	readonly color: string;
	readonly ref?: Ref<HTMLDivElement>;
	readonly size: string;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		group: cn(
			'inline-flex items-center gap-(--toolbar-group-gap)',
			'data-[orientation=vertical]:flex-col',
		),
		item: cn(
			'relative inline-flex items-center justify-center cursor-pointer outline-none',
			'h-(--toolbar-item-height) min-w-(--toolbar-item-min-width) px-(--toolbar-item-px) gap-(--toolbar-item-gap)',
			'text-(--toolbar-item-font-size) font-(--toolbar-item-font-weight) rounded-(--toolbar-item-radius)',
			'bg-(--toolbar-item-bg) text-(--toolbar-item-fg)',
			'transition-colors duration-(--toolbar-item-transition-duration) ease-(--toolbar-item-transition-easing)',
			'hovered:bg-(--toolbar-item-hover-bg)',
			'pressed:bg-(--toolbar-item-pressed-bg)',
			'selected:bg-(--toolbar-item-selected-bg) selected:text-(--toolbar-item-selected-fg)',
			'focused:bg-(--toolbar-item-focused-bg)',
			'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--toolbar-item-disabled-opacity)',
			'pending:pointer-events-none pending:opacity-(--toolbar-item-disabled-opacity)',
		),
		itemIcon: cn('size-(--toolbar-item-icon-size) shrink-0'),
		root: cn(
			'inline-flex items-center gap-(--toolbar-gap)',
			'bg-(--toolbar-bg) p-(--toolbar-padding) rounded-(--toolbar-radius)',
			'border-(--toolbar-border-width) border-(--toolbar-border-color)',
			'data-[orientation=vertical]:flex-col',
		),
		selectionIndicator: cn(
			'absolute inset-0 rounded-(--toolbar-item-radius)',
			'bg-(--toolbar-item-selection-indicator-bg)',
			'transition-all duration-(--toolbar-item-transition-duration) ease-(--toolbar-item-transition-easing)',
		),
		separator: cn(
			'bg-(--toolbar-separator-color)',
			'data-[orientation=horizontal]:w-(--toolbar-separator-thickness) data-[orientation=horizontal]:h-(--toolbar-separator-length) data-[orientation=horizontal]:mx-(--toolbar-separator-margin)',
			'data-[orientation=vertical]:h-(--toolbar-separator-thickness) data-[orientation=vertical]:w-(--toolbar-separator-length) data-[orientation=vertical]:my-(--toolbar-separator-margin)',
		),
	}),
});
const ToolbarContext = createContext<ToolbarContextValue | null>(null);

// --- [ENTRY_POINT] -----------------------------------------------------------

const ToolbarRoot: FC<ToolbarProps> = ({ children, className, color, orientation = 'horizontal', ref, size, variant, ...racProps }) => {
	const contextValue = useMemo<ToolbarContextValue>(
		() => ({ color, orientation, size }),
		[color, orientation, size],
	);
	return (
		<RACToolbar
			{...(racProps as RACToolbarProps)}
			className={composeTailwindRenderProps(className, B.slot.root)}
			data-color={color}
			data-size={size}
			data-slot='toolbar'
			data-variant={variant}
			orientation={orientation}
			ref={ref}
		>
			<ToolbarContext.Provider value={contextValue}>
				{children}
			</ToolbarContext.Provider>
		</RACToolbar>
	);
};
const ToolbarGroup: FC<ToolbarGroupProps> = ({ 'aria-label': ariaLabel, children, className, ref }) => {
	const ctx = useContext(ToolbarContext);
	return (
		<RACGroup
			{...(ariaLabel && { 'aria-label': ariaLabel })}
			className={cn(B.slot.group, className)}
			data-orientation={ctx?.orientation}
			data-slot='toolbar-group'
			ref={ref}
		>
			{children}
		</RACGroup>
	);
};
const ToolbarSeparator: FC<ToolbarSeparatorProps> = ({ className, ref }) => {
	const ctx = useContext(ToolbarContext);
	const orientation = ctx?.orientation ?? 'horizontal';
	return (
		<RACSeparator
			className={cn(B.slot.separator, className)}
			data-orientation={orientation}
			data-slot='toolbar-separator'
			orientation={orientation}
			ref={ref}
		/>
	);
};
const ToolbarToggleGroup: FC<ToolbarToggleGroupProps> = ({ 'aria-label': ariaLabel, children, className, ref, ...rest }) => {
	const ctx = useContext(ToolbarContext);
	const orientation = ctx?.orientation ?? 'horizontal';
	return (
		<RACToggleButtonGroup
			{...(rest as unknown as RACToggleButtonGroupProps)}
			aria-label={ariaLabel}
			className={cn(B.slot.group, className)}
			data-color={ctx?.color}
			data-orientation={orientation}
			data-size={ctx?.size}
			data-slot='toolbar-toggle-group'
			orientation={orientation}
			ref={ref}
		>
			{children}
		</RACToggleButtonGroup>
	);
};
const ToolbarItem: FC<ToolbarItemProps> = (props) => {
	const {
		children, className, defaultSelected, gesture, id, isDisabled, isSelected, onChange,
		prefix, ref, selectionIndicator, style: styleProp, suffix, tooltip, ...rest } = props;
	const ctx = useContext(ToolbarContext);
	const toggleMode = 'isSelected' in props || 'defaultSelected' in props || 'onChange' in props;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const elementRef = useRef<HTMLButtonElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled,
		prefix: 'toolbar-item',
		ref: elementRef as React.RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	} as Parameters<typeof useGesture>[0]);
	const mergedRef = useMergeRefs([ref, elementRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	const mergedStyle = { ...gestureProps.style, ...styleProp } as CSSProperties;
	const composedClassName = composeTailwindRenderProps(className, B.slot.item);
	const dataProps = {
		'data-color': ctx?.color,
		'data-orientation': ctx?.orientation,
		'data-size': ctx?.size,
		'data-slot': 'toolbar-item',
	};
	const content = (
		<>
			{selectionIndicator && <RACSelectionIndicator className={B.slot.selectionIndicator} />}
			{Slot.render(prefix, undefined, B.slot.itemIcon)}
			{children && <span className='truncate'>{Slot.resolve(children, undefined)}</span>}
			{Slot.render(suffix, undefined, B.slot.itemIcon)}
		</>
	);
	const { onChange: _g, ...gesturePropsForToggle } = gestureProps;	// RACToggleButton.onChange conflicts with gesture's onChange - must omit for toggle mode
	const toggleButtonProps = {
		...rest,
		...tooltipProps,
		...gesturePropsForToggle,
		...dataProps,
		className: composedClassName,
		isDisabled,
		ref: mergedRef,
		style: mergedStyle,
		...defined({ defaultSelected, id, isSelected, onChange }),
	} as unknown as RACToggleButtonProps;
	const buttonProps = {
		...rest,
		...tooltipProps,
		...gestureProps,
		...dataProps,
		className: composedClassName,
		isDisabled,
		ref: mergedRef,
		style: mergedStyle,
	} as unknown as RACButtonProps;
	return (
		<>
			{toggleMode
				? <RACToggleButton {...toggleButtonProps}>{content}</RACToggleButton>
				: <RACButton {...buttonProps}>{content}</RACButton>}
			{renderTooltip?.()}
		</>
	);
};

// --- [COMPOUND] --------------------------------------------------------------

const Toolbar = Object.assign(ToolbarRoot, {
	Group: ToolbarGroup,
	Item: ToolbarItem,
	Separator: ToolbarSeparator,
	ToggleGroup: ToolbarToggleGroup,
	useContext: (): ToolbarContextValue | null => useContext(ToolbarContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Toolbar };
export type { ToolbarGroupProps, ToolbarItemProps, ToolbarProps, ToolbarSeparatorProps, ToolbarToggleGroupProps };
