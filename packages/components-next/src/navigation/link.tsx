/**
 * Link: Navigation component with text and button-styled modes.
 * Text mode (default): Underlined text link with color variants.
 * Button mode (variant prop): Button-styled link using Button CSS vars.
 * Auto-detects external links and adds security attributes.
 * Supports: download links, action links (onPress without href renders as span).
 * REQUIRED: color prop. size required when variant is set.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { CSSProperties, FC, ReactNode, Ref, RefObject } from 'react';
import { useRef } from 'react';
import { Link as RACLink, type LinkProps as RACLinkProps, } from 'react-aria-components';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, isExternalHref, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type LinkProps = Omit<RACLinkProps, 'children'> & {
	readonly children?: SlotInput<ReactNode>;
	readonly color: string;
	readonly gesture?: GestureProps;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLAnchorElement>;
	readonly size?: string;
	readonly suffix?: SlotInput;
	readonly tooltip?: TooltipConfig;
	readonly variant?: 'solid' | 'outline' | 'ghost';
};
type LinkIconProps = Omit<RACLinkProps, 'children'> & {
	readonly 'aria-label': string;
	readonly children: ReactNode;
	readonly color: string;
	readonly ref?: Ref<HTMLAnchorElement>;
	readonly size: string;
	readonly tooltip?: TooltipConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
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
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const LinkCore: FC<LinkProps> = (props) => {
	const {
		children, className, color, gesture, href, isDisabled, prefix, ref, rel: relProp, size,
		style: styleProp, suffix, target: targetProp, tooltip, variant, ...rest } = props;
	const isButtonMode = variant !== undefined;
	const isExternal = isExternalHref(href);
	const hasGesture = gesture !== undefined;
	const target = targetProp ?? (isExternal ? '_blank' : undefined);
	const rel = relProp ?? (isExternal ? 'noopener noreferrer' : undefined);
	const slot = Slot.bind(undefined);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const linkRef = useRef<HTMLAnchorElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled ?? false,
		prefix: 'link',
		ref: linkRef as RefObject<HTMLElement | null>,
		...gesture,
	});
	const mergedRef = useMergeRefs([ref, linkRef, tooltipProps.ref as Ref<HTMLAnchorElement>]);
	const mergedStyle = { ...(hasGesture ? gestureProps.style : {}), ...styleProp } as CSSProperties;
	const dataProps = {
		'data-color': color,
		'data-size': size,
		'data-slot': isButtonMode ? 'link-button' : 'link',
		'data-variant': variant,
	};
	const baseClass = isButtonMode ? B.slot.button : B.slot.text;
	const iconClass = isButtonMode ? B.slot.buttonIcon : B.slot.icon;
	const textClass = isButtonMode ? B.slot.buttonText : B.slot.textContent;
	const composedClassName = composeTailwindRenderProps(className, baseClass);
	return (
		<>
			<RACLink
				{...({ ...rest, ...tooltipProps, ...(hasGesture ? gestureProps : {}) } as unknown as RACLinkProps)}
				{...dataProps}
				className={composedClassName}
				ref={mergedRef}
				style={mergedStyle}
				{...defined({ href, isDisabled, rel, target })}
			>
				{slot.render(prefix, iconClass)}
				<span className={textClass}>{slot.resolve(children)}</span>
				{slot.render(suffix, iconClass)}
			</RACLink>
			{renderTooltip?.()}
		</>
	);
};
const LinkIcon: FC<LinkIconProps> = (props) => {
	const { 'aria-label': ariaLabel, children, className, color, href, ref, size, tooltip, ...rest } = props;
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
				className={composeTailwindRenderProps(className, B.slot.iconOnly)}
				data-color={color}
				data-size={size}
				data-slot="link-icon"
				ref={mergedRef}
				{...defined({ href, rel, target })}
			>
				{children}
			</RACLink>
			{renderTooltip?.()}
		</>
	);
};
const Link = Object.assign(LinkCore, { Icon: LinkIcon });

// --- [EXPORT] ----------------------------------------------------------------

export { Link };
export type { LinkIconProps, LinkProps };
