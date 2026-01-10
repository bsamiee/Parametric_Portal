/**
 * GridList: Grid-based item selection component for displaying items in a 2D grid layout.
 * Compound component pattern - GridList.Item, GridList.LoadMore, GridList.Checkbox.
 * Wraps RAC GridList with theme-driven CSS variable styling.
 *
 * RAC props pass through directly - we only add: theme (color/size/variant), tooltip, gesture, async.
 * Supports keyboard 2D navigation (arrow keys), selection modes (single/multiple/none), and data-* attributes.
 * Enhanced with: emptyState shorthand, href links, actions slot, label/description, infinite scroll.
 * Ideal for image galleries, icon grids, and card selections.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { createContext, type ReactNode, type Ref, useContext, useMemo, useRef } from 'react';
import {
	Checkbox as RACCheckbox, type CheckboxProps as RACCheckboxProps, GridList as RACGridList, GridListItem as RACGridListItem,
	type GridListItemProps as RACGridListItemProps, GridListLoadMoreItem as RACGridListLoadMoreItem, type GridListProps as RACGridListProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, isExternalHref, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type GridListContextValue = { readonly color: string | undefined; readonly size: string | undefined; readonly variant: string | undefined; };
type GridListProps<T extends object> = Omit<RACGridListProps<T>, 'children' | 'renderEmptyState'> & {
	readonly children: RACGridListProps<T>['children'];
	readonly className?: string;
	readonly color?: string;
	readonly emptyState?: ReactNode;
	readonly size?: string;
	readonly variant?: string;
};
type GridListItemProps = Omit<RACGridListItemProps, 'children'> & {
	readonly actions?: ReactNode;
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly color?: string;
	readonly description?: ReactNode;
	readonly gesture?: GestureProps;
	readonly label?: ReactNode;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLDivElement>;
	readonly showExternalIcon?: boolean;
	readonly size?: string;
	readonly suffix?: SlotInput;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type GridListLoadMoreProps = {
	readonly children?: ReactNode;
	readonly className?: string;
	readonly isLoading?: boolean;
	readonly onLoadMore?: () => void;
	readonly scrollOffset?: number;
};
type GridListCheckboxProps = Omit<RACCheckboxProps, 'children' | 'slot'> & {
	readonly children?: ReactNode;
	readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		checkbox: cn(
			'group/checkbox inline-flex items-center justify-center shrink-0',
			'size-(--grid-list-checkbox-size)',
			'border-(--grid-list-checkbox-border-width) border-(--grid-list-checkbox-border-color)',
			'rounded-(--grid-list-checkbox-radius)',
			'bg-(--grid-list-checkbox-bg)',
			'transition-colors duration-(--grid-list-animation-duration) ease-(--grid-list-animation-easing)',
			'selected:bg-(--grid-list-checkbox-selected-bg) selected:border-(--grid-list-checkbox-selected-border)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
			'disabled:opacity-(--grid-list-item-disabled-opacity) disabled:cursor-not-allowed',
			'indeterminate:bg-(--grid-list-checkbox-selected-bg) indeterminate:border-(--grid-list-checkbox-selected-border)',
		),
		checkboxIcon: cn(
			'size-(--grid-list-checkbox-icon-size)',
			'text-(--grid-list-checkbox-icon-fg)',
			'opacity-0 selected:opacity-100 indeterminate:opacity-100',
			'transition-opacity duration-(--grid-list-animation-duration)',
		),
		empty: cn(
			'flex items-center justify-center col-span-full',
			'py-(--grid-list-empty-py)',
			'text-(--grid-list-empty-font-size)',
			'text-(--grid-list-empty-fg)',
		),
		item: cn(
			'group/grid-list-item relative outline-none cursor-default',
			'inline-flex items-center',
			'h-(--grid-list-item-height) px-(--grid-list-item-px) gap-(--grid-list-item-gap)',
			'text-(--grid-list-item-font-size) font-(--grid-list-item-font-weight)',
			'bg-(--grid-list-item-bg) text-(--grid-list-item-fg)',
			'border-(--grid-list-item-border-width) border-(--grid-list-item-border-color)',
			'rounded-(--grid-list-item-radius)',
			'transition-colors duration-(--grid-list-animation-duration) ease-(--grid-list-animation-easing)',
			'hovered:bg-(--grid-list-item-hover-bg)',
			'pressed:bg-(--grid-list-item-pressed-bg)',
			'selected:bg-(--grid-list-item-selected-bg) selected:text-(--grid-list-item-selected-fg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--grid-list-item-disabled-opacity)',
			'drop-target:bg-(--grid-list-item-drop-target-bg) drop-target:ring-(--grid-list-item-drop-target-ring)',
		),
		itemActions: cn(
			'absolute right-(--grid-list-item-px) top-1/2 -translate-y-1/2',
			'flex items-center gap-(--grid-list-item-actions-gap)',
			'opacity-0 group-hovered/grid-list-item:opacity-100',
			'transition-opacity duration-(--grid-list-animation-duration)',
		),
		itemContent: cn('flex flex-col min-w-0 flex-1'),
		itemDescription: cn(
			'text-(--grid-list-item-description-font-size)',
			'text-(--grid-list-item-description-fg)',
			'truncate',
		),
		itemExternalIcon: cn(
			'size-(--grid-list-item-external-icon-size)',
			'text-(--grid-list-item-external-icon-fg)',
			'shrink-0',
		),
		itemIcon: cn('size-(--grid-list-item-icon-size) shrink-0'),
		itemLabel: cn('truncate'),
		loadMore: cn(
			'flex items-center justify-center col-span-full',
			'h-(--grid-list-load-more-height)',
		),
		loadMoreSpinner: cn(
			'size-(--grid-list-load-more-spinner-size)',
			'animate-spin',
			'text-(--grid-list-load-more-spinner-fg)',
		),
		root: cn(
			'grid',
			'gap-(--grid-list-gap)',
			'grid-cols-(--grid-list-columns)',
		),
	}),
});
const GridListContext = createContext<GridListContextValue | null>(null);

// --- [SUB-COMPONENTS] --------------------------------------------------------

const GridListCheckbox = ({ children, className, ...racProps }: GridListCheckboxProps): ReactNode => (
	<RACCheckbox
		{...(racProps as RACCheckboxProps)}
		className={composeTailwindRenderProps(className, B.slot.checkbox)}
		data-slot="grid-list-checkbox"
		slot="selection"
	>
		{children ?? <Check className={B.slot.checkboxIcon} data-slot="grid-list-checkbox-icon" />}
	</RACCheckbox>
);
const GridListItem = ({
	actions, asyncState, children, className, color, description, download, gesture, href, hrefLang, id, isDisabled, label, onAction, ping,
	prefix, ref, referrerPolicy, rel: relProp, showExternalIcon = true, size, suffix, target: targetProp, textValue, tooltip, variant,
	...racProps }: GridListItemProps): ReactNode => {
	const ctx = useContext(GridListContext);
	const slot = Slot.bind(asyncState);
	const itemRef = useRef<HTMLDivElement>(null);
	const isExternal = isExternalHref(href);
	const target = targetProp ?? (isExternal ? '_blank' : undefined);
	const rel = relProp ?? (isExternal ? 'noopener noreferrer' : undefined);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'grid-list-item',
		ref: itemRef,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, itemRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	const { ref: _tooltipRef, ...tooltipPropsWithoutRef } = tooltipProps;
	const { style: gestureStyle, ...gesturePropsWithoutRef } = gestureProps;
	const resolvedColor = color ?? ctx?.color;
	const resolvedSize = size ?? ctx?.size;
	const resolvedVariant = variant ?? ctx?.variant;
	const hasLabelShorthand = label !== undefined || description !== undefined;
	const shouldShowExternalIcon = showExternalIcon && isExternal;
	return (
		<>
			<RACGridListItem
				{...({ ...racProps, ...tooltipPropsWithoutRef, ...gesturePropsWithoutRef } as unknown as RACGridListItemProps)}
				className={composeTailwindRenderProps(className, B.slot.item)}
				data-async-state={slot.attr}
				data-color={resolvedColor}
				data-size={resolvedSize}
				data-slot="grid-list-item"
				data-variant={resolvedVariant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...(gestureStyle && { style: gestureStyle })}
				{...defined({ download, href, hrefLang, id, onAction, ping, referrerPolicy, rel, target, textValue })}
			>
				{slot.render(prefix, B.slot.itemIcon)}
				{hasLabelShorthand ? (
					<span className={B.slot.itemContent} data-slot="grid-list-item-content">
						{label && <span className={B.slot.itemLabel} data-slot="grid-list-item-label">{label}</span>}
						{description && <span className={B.slot.itemDescription} data-slot="grid-list-item-description">{description}</span>}
					</span>
				) : (
					<span className={B.slot.itemLabel} data-slot="grid-list-item-label">{slot.render(children)}</span>
				)}
				{slot.render(suffix, B.slot.itemIcon)}
				{shouldShowExternalIcon && <ExternalLink className={B.slot.itemExternalIcon} data-slot="grid-list-item-external-icon" />}
				{actions && <div className={B.slot.itemActions} data-slot="grid-list-item-actions">{actions}</div>}
			</RACGridListItem>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};
const GridListLoadMore = ({ children, className, isLoading, onLoadMore, scrollOffset, }: GridListLoadMoreProps): ReactNode => (
	<RACGridListLoadMoreItem
		className={cn(B.slot.loadMore, className)}
		data-loading={isLoading || undefined}
		data-slot="grid-list-load-more"
		{...defined({ isLoading, onLoadMore, scrollOffset })}
	>
		{children ?? (isLoading && <Loader2 className={B.slot.loadMoreSpinner} data-slot="grid-list-load-more-spinner" />)}
	</RACGridListLoadMoreItem>
);

// --- [ROOT COMPONENT] --------------------------------------------------------

const GridListRoot = <T extends object>({ children, className, color, emptyState, size, variant, ...racProps }: GridListProps<T>): ReactNode => {
	const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
	const renderEmptyState = emptyState === undefined ? undefined
		: typeof emptyState === 'function' ? emptyState
		: () => <div className={B.slot.empty} data-slot="grid-list-empty">{emptyState}</div>;
	return (
		<GridListContext.Provider value={contextValue}>
			<RACGridList
				{...(racProps as RACGridListProps<T>)}
				className={composeTailwindRenderProps(className, B.slot.root)}
				data-color={color}
				data-size={size}
				data-slot="grid-list"
				data-variant={variant}
				{...defined({ renderEmptyState })}
			>
				{children}
			</RACGridList>
		</GridListContext.Provider>
	);
};

// --- [COMPOUND COMPONENT] ----------------------------------------------------

const GridList = Object.assign(GridListRoot, {
	Checkbox: GridListCheckbox,
	Item: GridListItem,
	LoadMore: GridListLoadMore,
	useContext: (): GridListContextValue | null => useContext(GridListContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { GridList };
export type { GridListCheckboxProps, GridListContextValue, GridListItemProps, GridListLoadMoreProps, GridListProps };
