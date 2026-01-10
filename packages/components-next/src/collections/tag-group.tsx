/**
 * TagGroup: Collection component for displaying and managing tags/chips.
 * Compound component pattern - TagGroup.Tag, TagGroup.List, TagGroup.Label.
 * Wraps RAC TagGroup/Tag/TagList with theme-driven CSS variable styling.
 *
 * RAC props pass through directly - we only add: theme (color/size/variant), tooltip, gesture, async.
 * Supports keyboard navigation, selection modes, removable tags, and link tags.
 * Tag accepts href for navigation - auto-detects external links and adds security attributes.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { X } from 'lucide-react';
import { createContext, type FC, type ReactNode, type Ref, type RefObject, useContext, useMemo, useRef } from 'react';
import {
	Button as RACButton, type Key, Label, Tag as RACTag, TagGroup as RACTagGroup, type TagGroupProps as RACTagGroupProps,
	TagList as RACTagList, type TagListProps as RACTagListProps, type TagListRenderProps as RACTagListRenderProps, type TagProps as RACTagProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, isExternalHref, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type TagGroupContextValue = { readonly color: string | undefined; readonly size: string | undefined; readonly variant: string | undefined; };
type TagGroupProps = Omit<RACTagGroupProps, 'children'> & {
	readonly children: RACTagGroupProps['children'];
	readonly className?: string;
	readonly color: string;
	readonly onRemove?: (keys: Set<Key>) => void;
	readonly size: string;
	readonly variant?: string;
};
type TagGroupListProps<T extends object> = Omit<RACTagListProps<T>, 'children' | 'renderEmptyState'> & {
	readonly children: ReactNode | ((item: T) => ReactNode);
	readonly className?: string;
	readonly renderEmptyState?: (props: RACTagListRenderProps) => ReactNode;
};
type TagGroupLabelProps = {
	readonly children: ReactNode;
	readonly className?: string;
};
type TagGroupTagProps = Omit<RACTagProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly color?: string;
	readonly gesture?: GestureProps;
	readonly href?: string;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLDivElement>;
	readonly removeIcon?: SlotInput;
	readonly size?: string;
	readonly target?: string;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		label: cn(
			'text-(--tag-group-label-font-size) font-(--tag-group-label-font-weight)',
			'text-(--tag-group-label-fg)',
			'mb-(--tag-group-label-margin-bottom)',
		),
		list: cn(
			'flex flex-wrap items-center',
			'gap-(--tag-group-list-gap)',
		),
		removeButton: cn(
			'ml-(--tag-remove-margin-left) cursor-pointer',
			'size-(--tag-remove-size) shrink-0',
			'text-(--tag-remove-fg)',
			'rounded-(--tag-remove-radius)',
			'transition-colors duration-(--tag-animation-duration) ease-(--tag-animation-easing)',
			'hovered:bg-(--tag-remove-hover-bg) hovered:text-(--tag-remove-hover-fg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
			'disabled:pointer-events-none disabled:opacity-(--tag-disabled-opacity)',
		),
		root: cn(
			'flex flex-col',
			'gap-(--tag-group-gap)',
		),
		tag: cn(
			'group/tag inline-flex items-center cursor-default outline-none',
			'h-(--tag-height) px-(--tag-px) gap-(--tag-gap)',
			'text-(--tag-font-size) font-(--tag-font-weight)',
			'bg-(--tag-bg) text-(--tag-fg)',
			'border-(--tag-border-width) border-(--tag-border-color)',
			'rounded-(--tag-radius)',
			'transition-colors duration-(--tag-animation-duration) ease-(--tag-animation-easing)',
			'hovered:bg-(--tag-hover-bg)',
			'pressed:bg-(--tag-pressed-bg)',
			'selected:bg-(--tag-selected-bg) selected:text-(--tag-selected-fg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--tag-disabled-opacity)',
		),
		tagIcon: cn('size-(--tag-icon-size) shrink-0'),
		tagLabel: cn('truncate'),
	}),
});
const TagGroupContext = createContext<TagGroupContextValue | null>(null);

// --- [SUB-COMPONENTS] --------------------------------------------------------

const TagGroupTag: FC<TagGroupTagProps> = ({
	asyncState, children, className, color: colorProp, gesture, href, isDisabled,
	prefix, ref, removeIcon, size: sizeProp, target: targetProp, textValue, tooltip, variant: variantProp, ...racProps }) => {
	const ctx = useContext(TagGroupContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	const slot = Slot.bind(asyncState);
	const isExternal = isExternalHref(href);
	const target = targetProp ?? (isExternal ? '_blank' : undefined);
	const rel = isExternal ? 'noopener noreferrer' : undefined;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const tagRef = useRef<HTMLDivElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled ?? false,
		prefix: 'tag',
		ref: tagRef as RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, tagRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACTag
				{...(racProps as RACTagProps)}
				{...(tooltipProps as object)}
				{...(gestureProps as object)}
				className={composeTailwindRenderProps(className, B.slot.tag)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot="tag"
				data-variant={variant}
				ref={mergedRef}
				{...defined({ href, isDisabled, rel, target, textValue })}
			>
				{({ allowsRemoving }) => (
					<>
						{slot.render(prefix, B.slot.tagIcon)}
						<span className={B.slot.tagLabel}>{slot.resolve(children)}</span>
						{allowsRemoving && (
							<RACButton
								className={B.slot.removeButton}
								data-slot="tag-remove"
								slot="remove"
							>
								{slot.render(removeIcon ?? { default: X }, B.slot.tagIcon)}
							</RACButton>
						)}
					</>
				)}
			</RACTag>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};
const TagGroupLabel: FC<TagGroupLabelProps> = ({ children, className }) => (
	<Label
		className={cn(B.slot.label, className)}
		data-slot="tag-group-label"
	>
		{children}
	</Label>
);
const TagGroupList = <T extends object>({ children, className, renderEmptyState, ...racProps }: TagGroupListProps<T>): ReactNode => (
	<RACTagList
		{...(racProps as RACTagListProps<T>)}
		className={cn(B.slot.list, className)}
		data-slot="tag-group-list"
		{...defined({ renderEmptyState })}
	>
		{children}
	</RACTagList>
);

// --- [ROOT COMPONENT] --------------------------------------------------------

const TagGroupRoot = ({ children, className, color, onRemove, size, variant, ...racProps }: TagGroupProps): ReactNode => {
	const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
	return (
		<TagGroupContext.Provider value={contextValue}>
			<RACTagGroup
				{...(racProps as RACTagGroupProps)}
				className={cn(B.slot.root, className)}
				data-color={color}
				data-size={size}
				data-slot="tag-group"
				data-variant={variant}
				{...defined({ onRemove })}
			>
				{children}
			</RACTagGroup>
		</TagGroupContext.Provider>
	);
};

// --- [COMPOUND COMPONENT] ----------------------------------------------------

const TagGroup = Object.assign(TagGroupRoot, {
	Label: TagGroupLabel,
	List: TagGroupList,
	Tag: TagGroupTag,
	useContext: (): TagGroupContextValue | null => useContext(TagGroupContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { TagGroup };
export type { TagGroupContextValue, TagGroupLabelProps, TagGroupListProps, TagGroupProps, TagGroupTagProps };
