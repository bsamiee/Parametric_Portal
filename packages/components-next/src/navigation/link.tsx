/**
 * Navigation with text and button-styled modes. Auto-detects external links.
 * Requires color prop. Size required when variant is set.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { CSSProperties, FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import { Link as RACLink, type LinkProps as RACLinkProps, } from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { Toast, type ToastTrigger } from '../core/toast';
import { cn, composeTailwindRenderProps, defined, isExternalHref, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type LinkProps = Omit<RACLinkProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly color: string;
	readonly gesture?: GestureProps;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLAnchorElement>;
	readonly size?: string;
	readonly suffix?: SlotInput;
	readonly toast?: ToastTrigger;
	readonly tooltip?: TooltipConfig;
	readonly variant?: 'solid' | 'outline' | 'ghost';
};
type LinkIconProps = Omit<RACLinkProps, 'children'> & {
	readonly 'aria-label': string;
	readonly asyncState?: AsyncState;
	readonly children: ReactNode;
	readonly color: string;
	readonly isDisabled?: boolean;
	readonly ref?: Ref<HTMLAnchorElement>;
	readonly size: string;
	readonly toast?: ToastTrigger;
	readonly tooltip?: TooltipConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	slot: {
		button: cn(
			'inline-flex items-center justify-center cursor-pointer',
			'h-(--button-height) w-(--button-width) px-(--button-px) gap-(--button-gap)',
			'text-(--button-font-size) rounded-(--button-radius)',
			'[background-color:color-mix(in_oklch,var(--button-bg)_calc(var(--button-bg-opacity,1)*100%),transparent)]',
			'text-(--button-fg)',
			'border-solid [border-width:var(--button-border-width,0)] [border-color:var(--button-border-color,transparent)]',
			'shadow-(--button-shadow) font-(--button-font-weight) whitespace-nowrap overflow-hidden',
			'duration-(--button-transition-duration) ease-(--button-transition-easing)',
			'hovered:bg-(--button-hover-bg)',
			'pressed:bg-(--button-pressed-bg) pressed:scale-(--button-pressed-scale)',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color) focused:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--button-disabled-opacity)',
		),
		buttonIcon: cn('size-(--button-icon-size) shrink-0'),
		buttonText: 'truncate',
		icon: cn('size-(--link-icon-size) shrink-0'),
		iconOnly: cn(
			'inline-flex items-center justify-center cursor-pointer',
			'size-(--link-icon-button-size)',
			'rounded-(--link-icon-button-radius)',
			'text-(--link-fg)',
			'hovered:bg-(--link-icon-hover-bg)',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color)',
			'disabled:pointer-events-none disabled:opacity-(--link-disabled-opacity)',
		),
		text: cn(
			'inline-flex items-center gap-(--link-gap) cursor-pointer',
			'text-(--link-fg) underline decoration-(--link-underline-color)',
			'decoration-(--link-underline-thickness) underline-offset-(--link-underline-offset)',
			'hovered:text-(--link-hover-fg) hovered:decoration-(--link-hover-underline-color)',
			'pressed:text-(--link-pressed-fg)',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color) focused:rounded-(--link-focus-radius)',
			'disabled:pointer-events-none disabled:opacity-(--link-disabled-opacity) disabled:no-underline',
			'[&[aria-current]]:text-(--link-current-fg) [&[aria-current]]:font-(--link-current-font-weight)',
		),
		textContent: 'truncate',
	},
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const LinkCore: FC<LinkProps> = (props) => {
	const {
		asyncState, children, className, color, gesture, href, isDisabled, prefix, ref, rel: relProp, size,
		style: styleProp, suffix, target: targetProp, toast, tooltip, variant, ...rest } = props;
	Toast.useTrigger(asyncState, toast);
	const slot = Slot.bind(asyncState);
	const isButtonMode = variant !== undefined;
	const isExternal = isExternalHref(href);
	const hasGesture = gesture !== undefined;
	const target = targetProp ?? (isExternal ? '_blank' : undefined);
	const rel = relProp ?? (isExternal ? 'noopener noreferrer' : undefined);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'link',
		ref: linkRef as RefObject<HTMLElement | null>,
		...gesture,
	});
	const mergedRef = useMergeRefs([ref, linkRef, tooltipProps.ref as Ref<HTMLAnchorElement>]);
	const mergedStyle = { ...(hasGesture ? gestureProps.style : {}), ...styleProp } as CSSProperties;
	const dataProps = {
		'data-async-state': slot.attr,
		'data-color': color,
		'data-size': size,
		'data-slot': isButtonMode ? 'link-button' : 'link',
		'data-variant': variant,
	};
	const baseClass = isButtonMode ? _B.slot.button : _B.slot.text;
	const iconClass = isButtonMode ? _B.slot.buttonIcon : _B.slot.icon;
	const textClass = isButtonMode ? _B.slot.buttonText : _B.slot.textContent;
	const composedClassName = composeTailwindRenderProps(className, baseClass);
	return (
		<>
			<RACLink
				{...({ ...rest, ...tooltipProps, ...(hasGesture ? gestureProps : {}) } as unknown as RACLinkProps)}
				{...dataProps}
				className={composedClassName}
				ref={mergedRef}
				style={mergedStyle}
				{...defined({ href, isDisabled: isDisabled || slot.pending, rel, target })}
			>
				{slot.render(prefix, iconClass)}
				<span className={textClass}>{slot.resolve(children)}</span>
				{slot.render(suffix, iconClass)}
			</RACLink>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const LinkIcon: FC<LinkIconProps> = (props) => {
	const { 'aria-label': ariaLabel, asyncState, children, className, color, href, isDisabled, ref, size, toast, tooltip, ...rest } = props;
	Toast.useTrigger(asyncState, toast);
	const slot = Slot.bind(asyncState);
	const isExternal = isExternalHref(href);
	const target = isExternal ? '_blank' : undefined;
	const rel = isExternal ? 'noopener noreferrer' : undefined;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const mergedRef = useMergeRefs([ref, linkRef, tooltipProps.ref as Ref<HTMLAnchorElement>]);
	return (
		<>
			<RACLink
				{...({ ...rest, ...tooltipProps } as unknown as RACLinkProps)}
				aria-label={ariaLabel}
				className={composeTailwindRenderProps(className, _B.slot.iconOnly)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot="link-icon"
				ref={mergedRef}
				{...defined({ href, isDisabled: isDisabled || slot.pending, rel, target })}
			>
				{children}
			</RACLink>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};
const Link = Object.assign(LinkCore, { Icon: LinkIcon });

// --- [EXPORT] ----------------------------------------------------------------

export { Link };
export type { LinkIconProps, LinkProps };
