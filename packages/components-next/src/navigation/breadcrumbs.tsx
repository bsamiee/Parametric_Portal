/**
 * Navigation path display with automatic separators and ellipsis overflow.
 * Requires color and size props. Supports link and ellipsis item modes.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { createContext, type FC, type ReactNode, type Ref, type RefObject, useContext, useMemo, useRef } from 'react';
import {
	Breadcrumb as RACBreadcrumb, type BreadcrumbProps as RACBreadcrumbProps, Breadcrumbs as RACBreadcrumbs, type BreadcrumbsProps as RACBreadcrumbsProps,
	type Key, Link as RACLink, type LinkProps as RACLinkProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, defined, isExternalHref, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type BreadcrumbsContextValue = { readonly color: string; readonly size: string; readonly variant: string | undefined; };
type BreadcrumbsProps<T extends object = object> = Omit<RACBreadcrumbsProps<T>, 'children'> & {
	readonly children: RACBreadcrumbsProps<T>['children'];
	readonly color: string;
	readonly isDisabled?: boolean;
	readonly onAction?: (key: Key) => void;
	readonly ref?: Ref<HTMLOListElement>;
	readonly size: string;
	readonly variant?: string;
};
type BreadcrumbsItemProps = Omit<RACBreadcrumbProps, 'children' | 'id'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly ellipsis?: boolean;
	readonly ellipsisIcon?: SlotInput;
	readonly gesture?: GestureProps;
	readonly href?: string;
	readonly id?: Key;
	readonly isDisabled?: boolean;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLLIElement>;
	readonly separator?: SlotInput;
	readonly tooltip?: TooltipConfig;
};
type BreadcrumbsCurrentProps = Omit<RACBreadcrumbProps, 'children'> & {
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLLIElement>;
	readonly tooltip?: TooltipConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	slot: {
		current: cn(
			'inline-flex items-center gap-(--breadcrumbs-item-gap)',
			'text-(--breadcrumbs-current-font-size) font-(--breadcrumbs-current-font-weight)',
			'text-(--breadcrumbs-current-fg)',
		),
		ellipsis: cn(
			'inline-flex items-center justify-center cursor-pointer',
			'size-(--breadcrumbs-ellipsis-size)',
			'text-(--breadcrumbs-ellipsis-color)',
			'rounded-(--breadcrumbs-ellipsis-radius)',
			'hovered:bg-(--breadcrumbs-ellipsis-hover-bg)',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color)',
		),
		ellipsisIcon: cn('size-(--breadcrumbs-ellipsis-icon-size)'),
		icon: cn('size-(--breadcrumbs-icon-size) shrink-0'),
		item: cn(
			'inline-flex items-center gap-(--breadcrumbs-item-gap)',
		),
		link: cn(
			'inline-flex items-center gap-(--breadcrumbs-link-gap) cursor-pointer outline-none',
			'text-(--breadcrumbs-link-font-size) font-(--breadcrumbs-link-font-weight)',
			'text-(--breadcrumbs-link-fg)',
			'hovered:text-(--breadcrumbs-link-hover-fg) hovered:underline',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color) focused:rounded-(--breadcrumbs-link-focus-radius)',
			'disabled:pointer-events-none disabled:opacity-(--breadcrumbs-link-disabled-opacity)',
		),
		root: cn(
			'flex items-center gap-(--breadcrumbs-gap)',
			'text-(--breadcrumbs-font-size)',
		),
		separator: cn(
			'size-(--breadcrumbs-separator-size) shrink-0',
			'text-(--breadcrumbs-separator-color)',
			'mx-(--breadcrumbs-separator-mx)',
		),
	},
} as const;
const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null);

// --- [SUB-COMPONENTS] --------------------------------------------------------

const BreadcrumbsItem: FC<BreadcrumbsItemProps> = ({
	asyncState, children, className, ellipsis, ellipsisIcon, gesture, href, id, isDisabled, prefix, ref, separator, tooltip, ...racProps }) => {
	const ctx = useContext(BreadcrumbsContext);
	const slot = Slot.bind(asyncState);
	const ellipsisMode = ellipsis === true;
	const isExternal = isExternalHref(href);
	const target = isExternal ? '_blank' : undefined;
	const rel = isExternal ? 'noopener noreferrer' : undefined;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLLIElement>]);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'breadcrumbs-link',
		ref: linkRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedLinkRef = useMergeRefs([linkRef, tooltipProps.ref as Ref<HTMLAnchorElement>]);
	// Ellipsis mode: renders collapsed indicator with optional dropdown children
	return ellipsisMode ? (
		<>
			<RACBreadcrumb
				{...(racProps as RACBreadcrumbProps)}
				{...(tooltipProps as object)}
				className={cn(_B.slot.item, className)}
				data-async-state={slot.attr}
				data-color={ctx?.color}
				data-ellipsis='true'
				data-size={ctx?.size}
				data-slot='breadcrumbs-item'
				data-variant={ctx?.variant}
				ref={mergedRef}
				{...defined({ id })}
			>
				<span className={_B.slot.ellipsis} data-slot='breadcrumbs-ellipsis'>
					{slot.render(ellipsisIcon ?? { default: MoreHorizontal }, _B.slot.ellipsisIcon)}
				</span>
				{children as ReactNode}
				<span aria-hidden='true' className={_B.slot.separator} data-slot='breadcrumbs-separator'>
					{slot.render(separator ?? { default: ChevronRight }, _B.slot.separator)}
				</span>
			</RACBreadcrumb>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	) : (
		<>
			<RACBreadcrumb
				{...(racProps as RACBreadcrumbProps)}
				className={cn(_B.slot.item, className)}
				data-async-state={slot.attr}
				data-color={ctx?.color}
				data-size={ctx?.size}
				data-slot='breadcrumbs-item'
				data-variant={ctx?.variant}
				ref={mergedRef}
				{...defined({ id })}
			>
				<RACLink
					{...({ ...tooltipProps, ...gestureProps } as unknown as RACLinkProps)}
					className={_B.slot.link}
					data-disabled={isDisabled || slot.pending || undefined}
					data-slot='breadcrumbs-link'
					ref={mergedLinkRef}
					{...defined({ href, isDisabled: isDisabled || slot.pending, rel, target })}
				>
					{slot.render(prefix, _B.slot.icon)}
					<span>{slot.resolve(children)}</span>
				</RACLink>
				<span aria-hidden='true' className={_B.slot.separator} data-slot='breadcrumbs-separator'>
					{slot.render(separator ?? { default: ChevronRight }, _B.slot.separator)}
				</span>
			</RACBreadcrumb>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const BreadcrumbsCurrent: FC<BreadcrumbsCurrentProps> = ({
	children, className, prefix, ref, tooltip, ...racProps }) => {
	const ctx = useContext(BreadcrumbsContext);
	const slot = Slot.bind(undefined);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLLIElement>]);
	return (
		<>
			<RACBreadcrumb
				{...(racProps as RACBreadcrumbProps)}
				{...(tooltipProps as object)}
				className={cn(_B.slot.item, className)}
				data-color={ctx?.color}
				data-current='true'
				data-size={ctx?.size}
				data-slot='breadcrumbs-current'
				data-variant={ctx?.variant}
				ref={mergedRef}
			>
				<span aria-current='page' className={_B.slot.current}>
					{slot.render(prefix, _B.slot.icon)}
					<span>{slot.resolve(children)}</span>
				</span>
			</RACBreadcrumb>
			{renderTooltip?.()}
		</>
	);
};
// --- [ROOT COMPONENT] --------------------------------------------------------

const BreadcrumbsRoot = <T extends object = object>({
	children, className, color, isDisabled, onAction, ref, size, variant, ...racProps }: BreadcrumbsProps<T>): ReactNode => {
	const contextValue = useMemo<BreadcrumbsContextValue>(() => ({ color, size, variant }), [color, size, variant]);
	return (
		<BreadcrumbsContext.Provider value={contextValue}>
			<RACBreadcrumbs
				{...(racProps as RACBreadcrumbsProps<T>)}
				className={cn(_B.slot.root, className)}
				data-color={color}
				data-size={size}
				data-slot='breadcrumbs'
				data-variant={variant}
				ref={ref}
				{...defined({ isDisabled, onAction })}
			>
				{children}
			</RACBreadcrumbs>
		</BreadcrumbsContext.Provider>
	);
};

// --- [COMPOUND COMPONENT] ----------------------------------------------------

const Breadcrumbs = Object.assign(BreadcrumbsRoot, {
	Current: BreadcrumbsCurrent,
	Item: BreadcrumbsItem,
	useContext: (): BreadcrumbsContextValue | null => useContext(BreadcrumbsContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Breadcrumbs };
export type { BreadcrumbsCurrentProps, BreadcrumbsItemProps, BreadcrumbsProps };
