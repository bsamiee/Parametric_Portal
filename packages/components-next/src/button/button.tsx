/**
 * Button: Pure presentation component with theme-driven styling via CSS variable slots.
 * Async state comes from external hooks (useEffectMutate) - no internal Effect execution.
 * REQUIRED: color and size props - no defaults, no hardcoded mappings.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { CSSProperties, FC, ReactNode, Ref } from 'react';
import { useRef } from 'react';
import { Button as RACButton, type ButtonProps as RACButtonProps } from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import type { BasePropsFor } from '../core/props';
import { cn, composeTailwindRenderProps, Slot, type SlotDef } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ButtonSpecificProps = {
	readonly bgOpacity?: number;
	readonly children?: SlotDef<ReactNode>;
	readonly className?: RACButtonProps['className'];
	readonly formAction?: string;
	readonly formEncType?: string;
	readonly formMethod?: string;
	readonly formNoValidate?: boolean;
	readonly formTarget?: string;
	readonly gesture?: GestureProps;
	readonly isPending?: boolean;
	readonly prefix?: SlotDef;
	readonly preventFocusOnPress?: boolean;
	readonly ref?: Ref<HTMLButtonElement>;
	readonly suffix?: SlotDef;
	readonly type?: 'button' | 'reset' | 'submit';
	readonly value?: string;
};
type ButtonProps = BasePropsFor<'button'> & ButtonSpecificProps;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		base: cn(
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
		icon: cn('size-(--button-icon-size) shrink-0', '[animation:var(--button-icon-animation,none)]'),
		text: 'truncate',
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Button: FC<ButtonProps> = ({
	asyncState, bgOpacity, children, className, color, gesture, isDisabled,
	prefix, ref, size, suffix, tooltip, variant,
	...rest
}) => {
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		ref: buttonRef,
		...gesture,
		cssVars: { progress: '--button-longpress-progress', ...gesture?.cssVars },
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, buttonRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	return (
		<>
			<RACButton
				{...({ ...rest, ...tooltipProps, ...gestureProps } as unknown as RACButtonProps)}
				className={composeTailwindRenderProps(className, B.slot.base)}
				data-async-state={slot.attr}
				data-color={color}
				data-size={size}
				data-slot='button'
				data-variant={variant}
				isDisabled={isDisabled || slot.pending}
				isPending={slot.pending}
				ref={mergedRef}
				{...(bgOpacity !== undefined && { style: { '--button-bg-opacity': bgOpacity } as CSSProperties })}
			>
				{slot.render(prefix, B.slot.icon)}
				<span className={B.slot.text}>{slot.resolve(children)}</span>
				{slot.render(suffix, B.slot.icon)}
			</RACButton>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Button };
export type { ButtonProps };
