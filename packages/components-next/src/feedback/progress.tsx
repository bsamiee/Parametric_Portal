/**
 * Progress: Determinate/indeterminate progress display with shape modes.
 * CSS variable inheritance - color/size/variant set on root, visual derived.
 * REQUIRED: color, size props on Progress root.
 *
 * Shape modes (prop-based switching):
 * - shape="linear" (default): Horizontal progress bar
 * - shape="circular": SVG for determinate, Lucide icon for indeterminate
 *
 * Supports: asyncState (completion announcement), label, showValue, formatOptions,
 * valueLabel, formatValue, centerIcon, indeterminateIcon, tooltip, isDisabled.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { Loader2 } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { Label, ProgressBar as RACProgressBar, type ProgressBarProps as RACProgressBarProps, } from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ProgressShape = 'circular' | 'linear';
type ProgressProps = Omit<RACProgressBarProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly centerIcon?: SlotInput;
	readonly className?: string;
	readonly color: string;
	readonly formatValue?: (percentage: number) => string;
	readonly indeterminateIcon?: SlotInput;
	readonly isDisabled?: boolean;
	readonly label?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>;
	readonly shape?: ProgressShape;
	readonly showValue?: boolean;
	readonly size: string;
	readonly strokeWidth?: number;
	readonly tooltip?: TooltipConfig;
	readonly valueLabel?: ReactNode;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	circle: Object.freeze({ size: 44, viewBox: 44 }),
	slot: Object.freeze({
		bar: cn(
			'relative overflow-hidden',
			'h-(--progress-track-height) w-full',
			'bg-(--progress-track-bg)',
			'rounded-(--progress-track-radius)',
		),
		circle: cn(
			'relative inline-flex items-center justify-center',
			'size-(--progress-circle-size)',
		),
		circleCenterIcon: cn(
			'size-(--progress-circle-icon-size)',
			'text-(--progress-circle-icon-color)',
		),
		circleIndeterminateIcon: cn(
			'size-(--progress-circle-size)',
			'text-(--progress-circle-indicator-stroke)',
			'animate-spin',
		),
		circleIndicator: cn(
			'origin-center -rotate-90',
			'transition-[stroke-dashoffset]',
			'duration-(--progress-animation-duration)',
			'ease-(--progress-animation-easing)',
		),
		circleSvg: cn('size-full'),
		circleTrack: cn('origin-center -rotate-90'),
		circleValue: cn(
			'absolute inset-0 flex items-center justify-center',
			'text-(--progress-circle-value-font-size)',
			'font-(--progress-circle-value-font-weight)',
			'text-(--progress-circle-value-fg)',
			'tabular-nums',
		),
		fill: cn(
			'absolute inset-y-0 left-0',
			'h-full',
			'bg-(--progress-fill-bg)',
			'rounded-(--progress-fill-radius)',
			'transition-[width]',
			'duration-(--progress-animation-duration)',
			'ease-(--progress-animation-easing)',
		),
		fillIndeterminate: cn(
			'absolute inset-y-0',
			'h-full',
			'w-(--progress-indeterminate-width)',
			'bg-(--progress-fill-bg)',
			'rounded-(--progress-fill-radius)',
			'[animation:var(--progress-indeterminate-animation)]',
		),
		header: cn('flex justify-between items-center'),
		label: cn(
			'text-(--progress-label-font-size)',
			'font-(--progress-label-font-weight)',
			'text-(--progress-label-fg)',
		),
		root: cn(
			'flex flex-col',
			'gap-(--progress-gap)',
			'w-(--progress-width)',
			'disabled:opacity-(--progress-disabled-opacity)',
		),
		rootCircular: cn(
			'inline-flex flex-col items-center',
			'gap-(--progress-gap)',
			'disabled:opacity-(--progress-disabled-opacity)',
		),
		value: cn(
			'text-(--progress-value-font-size)',
			'font-(--progress-value-font-weight)',
			'text-(--progress-value-fg)',
			'tabular-nums',
		),
	}),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const circleGeometry = (strokeWidth: number, pct: number) => {
	const r = (B.circle.size - strokeWidth) / 2;
	const c = 2 * Math.PI * r;
	return { c, center: B.circle.size / 2, offset: c - (pct / 100) * c, r };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Progress: FC<ProgressProps> = ({
	asyncState, centerIcon, className, color, formatOptions, formatValue, indeterminateIcon, isDisabled, isIndeterminate = false, label, maxValue = 100,
	minValue = 0, ref, shape = 'linear', showValue = false, size, strokeWidth = 4, tooltip, value = 0, valueLabel, variant, ...racProps }) => {
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const isCircular = shape === 'circular';
	return (
		<>
			<RACProgressBar
				{...(racProps as RACProgressBarProps)}
				{...(tooltipProps as object)}
				className={composeTailwindRenderProps(className, isCircular ? B.slot.rootCircular : B.slot.root)}
				data-async-state={slot.attr}
				data-color={color}
				data-disabled={isDisabled || undefined}
				data-shape={shape}
				data-size={size}
				data-slot="progress"
				data-variant={variant}
				ref={mergedRef}
				{...defined({ formatOptions, isIndeterminate, maxValue, minValue, value: isIndeterminate ? undefined : value })}
			>
				{({ percentage, valueText: racValueText }) => {
					const pct = percentage ?? 0;
					const displayValue = valueLabel ?? (formatValue && percentage !== undefined ? formatValue(pct) : null) ?? racValueText;
					const circle = circleGeometry(strokeWidth, pct);
					return isCircular ? (
						<>
							<div
								className={B.slot.circle}
								data-indeterminate={isIndeterminate || undefined}
								data-slot="progress-circle"
								data-value={isIndeterminate ? undefined : pct}
							>
								{isIndeterminate
									? slot.render(indeterminateIcon ?? { default: Loader2 }, B.slot.circleIndeterminateIcon)
									: (
										<>
											<svg
												aria-hidden="true"
												className={B.slot.circleSvg}
												data-slot="progress-circle-svg"
												fill="none"
												viewBox={`0 0 ${B.circle.viewBox} ${B.circle.viewBox}`}
											>
												<circle
													className={B.slot.circleTrack}
													cx={circle.center}
													cy={circle.center}
													data-slot="progress-circle-track"
													fill="none"
													r={circle.r}
													stroke="var(--progress-circle-track-stroke)"
													strokeWidth={strokeWidth}
												/>
												<circle
													className={B.slot.circleIndicator}
													cx={circle.center}
													cy={circle.center}
													data-slot="progress-circle-indicator"
													fill="none"
													r={circle.r}
													stroke="var(--progress-circle-indicator-stroke)"
													strokeDasharray={circle.c}
													strokeDashoffset={circle.offset}
													strokeLinecap="round"
													strokeWidth={strokeWidth}
												/>
											</svg>
											{centerIcon && (
												<span className={B.slot.circleValue} data-slot="progress-circle-center"> {slot.render(centerIcon, B.slot.circleCenterIcon)} </span>
											)}
											{!centerIcon && showValue && (
												<span className={B.slot.circleValue} data-slot="progress-circle-value"> {displayValue} </span>
											)}
										</>
									)}
							</div>
							{label && <Label className={B.slot.label} data-slot="progress-label">{label}</Label>}
						</>
					) : (
						<>
							{(label || showValue) && (
								<div className={B.slot.header} data-slot="progress-header">
									{label && <Label className={B.slot.label} data-slot="progress-label">{label}</Label>}
									{showValue && !isIndeterminate && (
										<span className={B.slot.value} data-slot="progress-value">{displayValue}</span>
									)}
								</div>
							)}
							<div
								className={B.slot.bar}
								data-indeterminate={isIndeterminate || undefined}
								data-slot="progress-bar"
								data-value={isIndeterminate ? undefined : pct}
							>
								{isIndeterminate
									? <div className={B.slot.fillIndeterminate} data-slot="progress-fill" />
									: <div className={B.slot.fill} data-slot="progress-fill" style={{ width: `${pct}%` }} />}
							</div>
						</>
					);
				}}
			</RACProgressBar>
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Progress };
export type { ProgressProps, ProgressShape };
