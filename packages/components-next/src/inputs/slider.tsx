/**
 * Range/value selection with visual track, thumb, and optional output display.
 * Requires color and size props. Supports single value or range via value props.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { CSSProperties, FC, ReactNode, Ref } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
	Label, Slider as RACSlider, SliderOutput as RACSliderOutput, type SliderOutputProps as RACSliderOutputProps, type SliderProps as RACSliderProps,
	SliderThumb as RACSliderThumb, type SliderThumbProps as RACSliderThumbProps, SliderTrack as RACSliderTrack, type SliderTrackProps as RACSliderTrackProps,
} from 'react-aria-components';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { cn, composeTailwindRenderProps } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type SliderProps = Omit<RACSliderProps, 'children'> & {
	readonly children?: ReactNode;
	readonly color: string;
	readonly label?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly showOutput?: boolean;
	readonly size: string;
	readonly thumbTooltip?: boolean;
	readonly tooltip?: TooltipConfig;
	readonly variant?: string;
};
type SliderTrackProps = Omit<RACSliderTrackProps, 'children'> & {
	readonly children?: ReactNode | ((state: { readonly isRange: boolean }) => ReactNode);
	readonly ref?: Ref<HTMLDivElement>;
};
type SliderThumbProps = Omit<RACSliderThumbProps, 'children'> & {
	readonly children?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly tooltip?: boolean | TooltipConfig;
};
type SliderOutputProps = Omit<RACSliderOutputProps, 'children'> & {
	readonly children?: ReactNode | ((state: { readonly values: readonly number[] }) => ReactNode);
	readonly ref?: Ref<HTMLOutputElement>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	slot: {
		fill: cn(
			'absolute rounded-(--slider-fill-radius)',
			'bg-(--slider-fill-bg)',
			'transition-[width,height,left,bottom] duration-(--slider-transition-duration) ease-(--slider-transition-easing)',
			'data-[orientation=horizontal]:h-full',
			'data-[orientation=horizontal]:[left:calc(var(--slider-fill-start,0)*100%)]',
			'data-[orientation=horizontal]:[width:calc(var(--slider-fill-percent,0)*100%)]',
			'data-[orientation=vertical]:w-full',
			'data-[orientation=vertical]:[bottom:calc(var(--slider-fill-start,0)*100%)]',
			'data-[orientation=vertical]:[height:calc(var(--slider-fill-percent,0)*100%)]',
		),
		label: cn('text-(--slider-label-size) text-(--slider-label-color) font-(--slider-label-weight)'),
		output: cn(
			'text-(--slider-output-size) text-(--slider-output-color) font-(--slider-output-weight)',
			'tabular-nums',
		),
		root: cn(
			'group grid gap-(--slider-gap)',
			'data-[orientation=horizontal]:grid-cols-[1fr_auto] data-[orientation=horizontal]:w-(--slider-width)',
			'data-[orientation=vertical]:grid-rows-[auto_1fr_auto] data-[orientation=vertical]:h-(--slider-height)',
			'disabled:opacity-(--slider-disabled-opacity) disabled:pointer-events-none',
		),
		thumb: cn(
			'size-(--slider-thumb-size) rounded-(--slider-thumb-radius)',
			'bg-(--slider-thumb-bg) border-(--slider-thumb-border-width) border-(--slider-thumb-border-color)',
			'shadow-(--slider-thumb-shadow)',
			'transition-[transform,box-shadow] duration-(--slider-transition-duration) ease-(--slider-transition-easing)',
			'dragging:scale-(--slider-thumb-dragging-scale) dragging:shadow-(--slider-thumb-dragging-shadow)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		track: cn(
			'relative cursor-pointer',
			'bg-(--slider-track-bg) rounded-(--slider-track-radius)',
			'data-[orientation=horizontal]:h-(--slider-track-height) data-[orientation=horizontal]:w-full',
			'data-[orientation=vertical]:w-(--slider-track-width) data-[orientation=vertical]:h-full',
			'disabled:cursor-not-allowed',
		),
	},
} as const;

// --- [SUB_COMPONENTS] --------------------------------------------------------

const DragStateSync: FC<{
	readonly children: ReactNode;
	readonly isDragging: boolean;
	readonly onSync: (state: { isDragging: boolean; valueLabel: string }) => void;
	readonly valueLabel: string;
}> = ({ children, isDragging, onSync, valueLabel }) => {
	useEffect(() => { onSync({ isDragging, valueLabel }); }, [isDragging, onSync, valueLabel]);
	return <>{children}</>;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const SliderRoot: FC<SliderProps> = ({
	children, className, color, label, orientation = 'horizontal', ref, showOutput, size, thumbTooltip, tooltip, variant, ...racProps }) => {
	const isRange = Array.isArray(racProps.value) || Array.isArray(racProps.defaultValue);
	const sliderRef = useRef<HTMLDivElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, sliderRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	const defaultContent = (
		<SliderTrack>
			{isRange ? (
				<>
					<SliderThumb index={0} {...(thumbTooltip && { tooltip: true })} />
					<SliderThumb index={1} {...(thumbTooltip && { tooltip: true })} />
				</>
			) : (
				<SliderThumb {...(thumbTooltip && { tooltip: true })} />
			)}
		</SliderTrack>
	);
	return (
		<>
			<RACSlider
				{...({ ...racProps, ...tooltipProps } as unknown as RACSliderProps)}
				className={composeTailwindRenderProps(className, _B.slot.root)}
				data-color={color}
				data-orientation={orientation}
				data-size={size}
				data-slot='slider'
				data-variant={variant}
				orientation={orientation}
				ref={mergedRef}
			>
				{() => (
					<>
						{label && <Label className={_B.slot.label} data-slot='slider-label'>{label}</Label>}
						{showOutput && <SliderOutput />}
						{children ?? defaultContent}
					</>
				)}
			</RACSlider>
			{renderTooltip?.()}
		</>
	);
};
const SliderTrack: FC<SliderTrackProps> = ({ children, className, ref, ...racProps }) => (
	<RACSliderTrack
		{...(racProps as RACSliderTrackProps)}
		className={composeTailwindRenderProps(className, _B.slot.track)}
		data-slot='slider-track'
		ref={ref}
	>
		{(renderProps) => {
			const { state } = renderProps;
			const isRange = state.values.length > 1;
			const fillStart = isRange ? state.getThumbPercent(0) : 0;
			const fillEnd = isRange ? state.getThumbPercent(1) : state.getThumbPercent(0);
			const fillPercent = fillEnd - fillStart;
			const orientation = state.orientation;
			const fillStyle = {
				'--slider-fill-percent': fillPercent,
				'--slider-fill-start': fillStart,
			} as CSSProperties;
			const isRenderFn = typeof children === 'function';
			return (
				<>
					<div
						className={_B.slot.fill}
						data-orientation={orientation}
						data-slot='slider-fill'
						style={fillStyle}
					/>
					{isRenderFn ? children({ isRange }) : children}
				</>
			);
		}}
	</RACSliderTrack>
);
const SliderThumb: FC<SliderThumbProps> = ({ children, className, ref, tooltip, ...racProps }) => {
	const thumbRef = useRef<HTMLDivElement>(null);
	const [dragState, setDragState] = useState({ isDragging: false, valueLabel: '' });
	const tooltipConfig: TooltipConfig | undefined = tooltip
		? { content: dragState.valueLabel, open: dragState.isDragging, placement: 'top',
				...(typeof tooltip === 'object' ? tooltip : {}) }
		: undefined;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltipConfig);
	const mergedRef = useMergeRefs([ref, thumbRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACSliderThumb
				{...(racProps as RACSliderThumbProps)}
				className={composeTailwindRenderProps(className, _B.slot.thumb)}
				data-slot='slider-thumb'
				ref={mergedRef}
			>
				{(renderProps) => {
					const { isDragging, state } = renderProps;
					const index = racProps.index ?? 0;
					const valueLabel = state.getThumbValueLabel(index);
					return (
						<DragStateSync isDragging={isDragging} onSync={setDragState} valueLabel={valueLabel}>
							{children}
						</DragStateSync>
					);
				}}
			</RACSliderThumb>
			{renderTooltip?.()}
		</>
	);
};
const SliderOutput: FC<SliderOutputProps> = ({ children, className, ref, ...racProps }) => (
	<RACSliderOutput
		{...(racProps as RACSliderOutputProps)}
		className={composeTailwindRenderProps(className, _B.slot.output)}
		data-slot='slider-output'
		ref={ref}
	>
		{(renderProps) => {
			const isRenderFn = typeof children === 'function';
			return isRenderFn
				? children({ values: renderProps.state.values })
				: children ?? renderProps.state.values.map((_value, index) => renderProps.state.getThumbValueLabel(index)).join(' – ');
		}}
	</RACSliderOutput>
);
const Slider = Object.assign(SliderRoot, { Output: SliderOutput, Thumb: SliderThumb, Track: SliderTrack });

// --- [EXPORT] ----------------------------------------------------------------

export { Slider };
export type { SliderOutputProps, SliderProps, SliderThumbProps, SliderTrackProps };
