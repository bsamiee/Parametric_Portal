/**
 * Button: Pure presentation component with theme-driven styling via CSS variable slots.
 * Supports standard press and toggle modes via props discrimination.
 * Async state comes from external hooks (useEffectMutate) - no internal Effect execution.
 * REQUIRED: color and size props - no defaults, no hardcoded mappings.
 *
 * RAC props pass through directly - we only add: theme, asyncState, tooltip, prefix/suffix, gesture.
 * Toggle mode auto-detected from isSelected/defaultSelected/onChange props.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import type { CSSProperties, FC, ReactNode, Ref } from 'react';
import { useRef } from 'react';
import {
	Button as RACButton, type ButtonProps as RACButtonProps, ToggleButton as RACToggleButton, type ToggleButtonProps as RACToggleButtonProps,
	ToggleButtonGroup as RACToggleButtonGroup, type ToggleButtonGroupProps as RACToggleButtonGroupProps, type Key,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { useGesture, type GestureProps } from '../core/gesture';
import { Toast, type ToastTrigger } from '../core/toast';
import { cn, composeTailwindRenderProps, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ButtonProps = Omit<RACButtonProps, 'children'> & BaseButtonProps & Partial<ToggleProps>;
type BaseButtonProps = {
	readonly asyncState?: AsyncState;
	readonly bgOpacity?: number;
	readonly children?: SlotInput<ReactNode>;
	readonly color: string;
	readonly gesture?: GestureProps;
	readonly prefix?: SlotInput;
	readonly ref?: Ref<HTMLButtonElement>;
	readonly size: string;
	readonly suffix?: SlotInput;
	readonly toast?: ToastTrigger;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type ToggleProps = {
	readonly defaultSelected?: boolean;
	readonly id?: Key;
	readonly isSelected?: boolean;
	readonly onChange?: (isSelected: boolean) => void;
};
type ButtonGroupProps = Omit<RACToggleButtonGroupProps, 'children'> & {
	readonly children: ReactNode;
	readonly color?: string;
	readonly size?: string;
	readonly variant?: string;
};

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
			'selected:bg-(--button-selected-bg) selected:text-(--button-selected-fg)',
			'focused:outline-none focused:ring-(--focus-ring-width) focused:ring-(--focus-ring-color) focused:ring-offset-(--focus-ring-offset)',
			'disabled:pointer-events-none disabled:opacity-(--button-disabled-opacity)',
		),
		group: cn('inline-flex gap-(--button-group-gap)', 'data-[orientation=vertical]:flex-col'),
		icon: cn('size-(--button-icon-size) shrink-0', '[animation:var(--button-icon-animation,none)]'),
		text: 'truncate',
	}),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const ButtonGroup: FC<ButtonGroupProps> = ({ children, className, color, size, variant, ...rest }) => (
	<RACToggleButtonGroup
		{...(rest as RACToggleButtonGroupProps)}
		className={composeTailwindRenderProps(className, B.slot.group)}
		data-color={color}
		data-size={size}
		data-slot="button-group"
		data-variant={variant}
	>
		{children}
	</RACToggleButtonGroup>
);
const ButtonCore: FC<ButtonProps> = (props) => {
	const {
		asyncState, bgOpacity, children, className, color, defaultSelected, gesture, id, isDisabled, isSelected, onChange,
		prefix, ref, size, style: styleProp, suffix, toast, tooltip, variant, ...rest
	} = props;
	Toast.useTrigger(asyncState, toast);
	const toggleMode = 'isSelected' in props || 'defaultSelected' in props || 'onChange' in props;
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const elementRef = useRef<HTMLButtonElement>(null);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'button',
		ref: elementRef as React.RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, elementRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	const mergedStyle = {
		...gestureProps.style,
		...styleProp,
		...(bgOpacity !== undefined && { '--button-bg-opacity': bgOpacity }),
	} as CSSProperties;
	const dataProps = {
		'data-async-state': slot.attr,
		'data-color': color,
		'data-size': size,
		'data-slot': 'button',
		'data-variant': variant,
	};
	const content = (
		<>
			{slot.render(prefix, B.slot.icon)}
			<span className={B.slot.text}>{slot.resolve(children)}</span>
			{slot.render(suffix, B.slot.icon)}
		</>
	);
	const { onChange: _gestureOnChange, ...gesturePropsWithoutOnChange } = gestureProps;
	const composedClassName = composeTailwindRenderProps(className, B.slot.base);
	const toggleButtonProps = {
		...rest,
		...tooltipProps,
		...gesturePropsWithoutOnChange,
		...dataProps,
		className: composedClassName,
		isDisabled: isDisabled || slot.pending,
		style: mergedStyle,
		...(defaultSelected !== undefined && { defaultSelected }),
		...(id !== undefined && { id }),
		...(isSelected !== undefined && { isSelected }),
		...(onChange !== undefined && { onChange }),
		ref: mergedRef,
	} as unknown as RACToggleButtonProps;
	const buttonProps = {
		...rest,
		...tooltipProps,
		...gestureProps,
		...dataProps,
		className: composedClassName,
		isDisabled: isDisabled || slot.pending,
		isPending: slot.pending,
		ref: mergedRef,
		style: mergedStyle,
	} as unknown as RACButtonProps;
	return (
		<>
			{toggleMode ? ( <RACToggleButton {...toggleButtonProps}>{content}</RACToggleButton> ) : ( <RACButton {...buttonProps}>{content}</RACButton> )}
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};
const Button = Object.assign(ButtonCore, { Group: ButtonGroup });

// --- [EXPORT] ----------------------------------------------------------------

export { Button };
export type { ButtonGroupProps, ButtonProps };
