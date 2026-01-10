/**
 * Accordion: Composable disclosure components with standalone trigger.
 * Single import namespace pattern - Accordion.Item, Accordion.Trigger, Accordion.Content.
 * Wraps RAC Disclosure/DisclosureGroup with theme inheritance and DnD reordering.
 *
 * RAC props pass through directly - we only add: theme (color/size/variant), onReorder, lazy.
 * AccordionTrigger is standalone - uses own CSS variable namespace, not Button.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { ChevronDown } from 'lucide-react';
import { createContext, type FC, type ReactNode, type Ref, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button as RACButton, Disclosure as RACDisclosure, DisclosureGroup as RACDisclosureGroup, DisclosurePanel as RACDisclosurePanel,
	type DisclosureGroupProps as RACDisclosureGroupProps, type DisclosureProps as RACDisclosureProps,
	type DisclosurePanelProps as RACDisclosurePanelProps, DisclosureStateContext, Heading,
} from 'react-aria-components';
import { useDrag, useDrop, type TextDropItem } from 'react-aria';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type AccordionContentProps = RACDisclosurePanelProps & { readonly lazy?: boolean };
type AccordionContextValue = {
	readonly color: string | undefined;
	readonly onReorder: ((fromId: string, toId: string) => void) | undefined;
	readonly size: string | undefined;
	readonly variant: string | undefined;
};
type AccordionProps = Omit<RACDisclosureGroupProps, 'children'> & {
	readonly children: ReactNode;
	readonly color?: string;
	readonly onReorder?: (fromId: string, toId: string) => void;
	readonly size?: string;
	readonly variant?: string;
};
type AccordionItemProps = Omit<RACDisclosureProps, 'children' | 'id'> & {
	readonly children: ReactNode;
	readonly id: string; // Override RAC's Key to require string for DnD
};
type AccordionTriggerProps = {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly color?: string;
	readonly gesture?: GestureProps;
	readonly hideIndicator?: boolean;
	readonly indicator?: SlotInput;
	readonly isDisabled?: boolean;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLButtonElement>;
	readonly size?: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		content: cn('flex-1 truncate text-left'),
		indicator: cn(
			'size-(--accordion-trigger-indicator-size) shrink-0',
			'transition-transform duration-(--accordion-animation-duration) ease-(--accordion-animation-easing)',
			'text-(--accordion-trigger-indicator-color)',
			'group-data-[expanded]/accordion-item:rotate-(--accordion-indicator-rotation)',
		),
		item: cn(
			'group/accordion-item',
			'border-b-(--accordion-item-border-width) border-(--accordion-item-border-color)',
			'last:border-b-0',
		),
		panel: cn(
			'overflow-hidden',
			'grid transition-[grid-template-rows] duration-(--accordion-animation-duration) ease-(--accordion-animation-easing)',
			'grid-rows-[0fr] data-[expanded]:grid-rows-[1fr]',
			'text-(--accordion-panel-font-size) text-(--accordion-panel-fg)',
			'bg-(--accordion-panel-bg)',
		),
		panelInner: cn('overflow-hidden p-(--accordion-panel-padding)'),
		prefix: cn('size-(--accordion-trigger-icon-size) shrink-0'),
		root: cn(
			'flex flex-col w-full',
			'border-(--accordion-border-width) border-(--accordion-border-color)',
			'rounded-(--accordion-radius) bg-(--accordion-bg)',
		),
		trigger: cn(
			'group/accordion-trigger inline-flex items-center w-full cursor-pointer outline-none',
			'h-(--accordion-trigger-height) px-(--accordion-trigger-px) gap-(--accordion-trigger-gap)',
			'text-(--accordion-trigger-font-size) font-(--accordion-trigger-font-weight)',
			'bg-(--accordion-trigger-bg) text-(--accordion-trigger-fg)',
			'rounded-(--accordion-trigger-radius)',
			'transition-colors duration-(--accordion-animation-duration) ease-(--accordion-animation-easing)',
			'hovered:bg-(--accordion-trigger-hover-bg)',
			'pressed:bg-(--accordion-trigger-pressed-bg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--accordion-trigger-disabled-opacity)',
		),
	}),
});
const AccordionContext = createContext<AccordionContextValue | null>(null);

// --- [SUB-COMPONENTS] --------------------------------------------------------

const AccordionTrigger: FC<AccordionTriggerProps> = ({
	asyncState, children, className, color, gesture, hideIndicator, indicator, isDisabled, prefix, ref, size, tooltip, variant, }) => {
	const ctx = useContext(AccordionContext);
	const disclosureState = useContext(DisclosureStateContext);
	const isExpanded = disclosureState?.isExpanded ?? false;
	const slot = Slot.bind(asyncState);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'accordion-trigger',
		ref: triggerRef,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, triggerRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	return (
		<Heading className="contents">
			<RACButton
				{...(tooltipProps as object)}
				{...(gestureProps as object)}
				className={composeTailwindRenderProps(className, B.slot.trigger)}
				data-async-state={slot.attr}
				data-color={color ?? ctx?.color}
				data-expanded={isExpanded || undefined}
				data-size={size ?? ctx?.size}
				data-slot="accordion-trigger"
				data-variant={variant ?? ctx?.variant}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				slot="trigger"
			>
				{slot.render(prefix, B.slot.prefix)}
				<span className={B.slot.content}>{slot.resolve(children)}</span>
				{!hideIndicator && (
					<span className={B.slot.indicator} data-expanded={isExpanded || undefined}>
						{Slot.content(Slot.resolve(indicator, asyncState)) ?? <ChevronDown />}
					</span>
				)}
			</RACButton>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</Heading>
	);
};
const AccordionContent: FC<AccordionContentProps> = ({ children, className, lazy = true, ...rest }) => {
	const disclosureState = useContext(DisclosureStateContext);
	const isExpanded = disclosureState?.isExpanded ?? false;
	const [hasExpanded, setHasExpanded] = useState(!lazy || isExpanded);
	useEffect(() => { isExpanded && !hasExpanded && setHasExpanded(true); }, [isExpanded, hasExpanded]);
	return (
		<RACDisclosurePanel
			{...rest}
			className={composeTailwindRenderProps(className, B.slot.panel)}
			data-expanded={isExpanded || undefined}
			data-slot="accordion-panel"
		>
			<div className={B.slot.panelInner}>{hasExpanded ? children : null}</div>
		</RACDisclosurePanel>
	);
};
const AccordionItem: FC<AccordionItemProps> = ({ children, className, id, isDisabled, ...rest }) => {
	const ctx = useContext(AccordionContext);
	const onReorder = ctx?.onReorder;
	const dropRef = useRef<HTMLDivElement>(null);
	const mimeType = 'application/x-accordion-item';
	const { dragProps: { slot: _ds, ...dragProps }, isDragging } = useDrag({
		getItems: () => [{ [mimeType]: id }],
		isDisabled: !onReorder,
	});
	const { dropProps, isDropTarget } = useDrop({
		getDropOperation: (types) => types.has(mimeType) ? 'move' : 'cancel',
		isDisabled: !onReorder,
		onDrop: (e) => {
			const item = e.items.find((i) => i.kind === 'text' && i.types.has(mimeType)) as TextDropItem | undefined;
			item?.getText(mimeType).then((fromId) => fromId !== id && onReorder?.(fromId, id));
		},
		ref: dropRef,
	});
	return (
		<RACDisclosure
			{...({ ...rest, ...(onReorder ? { ...dragProps, ...dropProps } : {}) } as unknown as RACDisclosureProps)}
			className={composeTailwindRenderProps(className, B.slot.item)}
			data-color={ctx?.color}
			data-dragging={isDragging || undefined}
			data-drop-target={isDropTarget || undefined}
			data-size={ctx?.size}
			data-slot="accordion-item"
			data-variant={ctx?.variant}
			id={id}
			ref={dropRef}
			{...(isDisabled != null && { isDisabled })}
		>
			{children}
		</RACDisclosure>
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const AccordionRoot: FC<AccordionProps> = ({
	children, className, color, onReorder, size, variant, ...rest }) => {
	const contextValue: AccordionContextValue = useMemo(
		() => ({ color, onReorder, size, variant }),
		[color, onReorder, size, variant],
	);
	return (
		<RACDisclosureGroup
			{...({ ...rest } as unknown as RACDisclosureGroupProps)}
			className={composeTailwindRenderProps(className, B.slot.root)}
			data-color={color}
			data-size={size}
			data-slot="accordion"
			data-variant={variant}
		>
			<AccordionContext.Provider value={contextValue}>
				{children}
			</AccordionContext.Provider>
		</RACDisclosureGroup>
	);
};
const Accordion = Object.assign(AccordionRoot, {
	Content: AccordionContent,
	Item: AccordionItem,
	Trigger: AccordionTrigger,
	useContext: (): AccordionContextValue | null => useContext(AccordionContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Accordion };
export type { AccordionContentProps, AccordionItemProps, AccordionProps, AccordionTriggerProps };
