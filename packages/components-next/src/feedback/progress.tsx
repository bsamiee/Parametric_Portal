/**
 * Progress: Unified progress/meter display with shape modes.
 * CSS variable inheritance - color/size/variant set on root, visual derived.
 * REQUIRED: color, size props on Progress root.
 *
 * Shape modes: shape="linear" (default) | shape="circular"
 * Meter mode: Auto-detected from threshold prop presence (Button-style pattern).
 *
 * Meter mode exposes data-meter-zone (optimal|warning|critical) for threshold-based styling.
 * Indeterminate: Auto-derived from asyncState.Loading + no value. No explicit prop.
 */
import { useMergeRefs } from '@floating-ui/react';
import { AsyncState } from '@parametric-portal/types/async';
import { Loader2 } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { useMemo } from 'react';
import {
	Label, Meter as RACMeter, type MeterProps as RACMeterProps, ProgressBar as RACProgressBar, type ProgressBarProps as RACProgressBarProps,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { useTooltip, type TooltipConfig } from '../core/floating';
import { cn, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ProgressShape = 'circular' | 'linear';
type MeterZone = 'critical' | 'optimal' | 'warning';
type ProgressProps = Omit<RACMeterProps & RACProgressBarProps, 'children' | 'isIndeterminate'> & {
	readonly asyncState?: AsyncState;
	readonly centerIcon?: SlotInput;
	readonly color: string;
	readonly criticalThreshold?: number;
	readonly formatOptions?: Intl.NumberFormatOptions;
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
	readonly variant?: string;
	readonly warningThreshold?: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	circle: 44,
	slot: Object.freeze({
		bar: cn('relative overflow-hidden', 'h-(--progress-track-height) w-full', 'bg-(--progress-track-bg)', 'rounded-(--progress-track-radius)'),
		circle: cn('relative inline-flex items-center justify-center', 'size-(--progress-circle-size)'),
		circleCenterIcon: cn('size-(--progress-circle-icon-size)', 'text-(--progress-circle-icon-color)'),
		circleIndeterminateIcon: cn('size-(--progress-circle-size)', 'text-(--progress-circle-indicator-stroke)', 'animate-spin'),
		circleIndicator: cn('origin-center -rotate-90', 'transition-[stroke-dashoffset]', 'duration-(--progress-animation-duration)', 'ease-(--progress-animation-easing)'),
		circleSvg: cn('size-full'),
		circleTrack: cn('origin-center -rotate-90'),
		circleValue: cn('absolute inset-0 flex items-center justify-center', 'text-(--progress-circle-value-font-size)', 'font-(--progress-circle-value-font-weight)', 'text-(--progress-circle-value-fg)', 'tabular-nums'),
		fill: cn('absolute inset-y-0 left-0', 'h-full', 'bg-(--progress-fill-bg)', 'rounded-(--progress-fill-radius)', 'transition-[width]', 'duration-(--progress-animation-duration)', 'ease-(--progress-animation-easing)'),
		fillIndeterminate: cn('absolute inset-y-0', 'h-full', 'w-(--progress-indeterminate-width)', 'bg-(--progress-fill-bg)', 'rounded-(--progress-fill-radius)', '[animation:var(--progress-indeterminate-animation)]'),
		header: cn('flex justify-between items-center'),
		label: cn('text-(--progress-label-font-size)', 'font-(--progress-label-font-weight)', 'text-(--progress-label-fg)'),
		root: cn('flex flex-col', 'gap-(--progress-gap)', 'w-(--progress-width)', 'disabled:opacity-(--progress-disabled-opacity)'),
		rootCircular: cn('inline-flex flex-col items-center', 'gap-(--progress-gap)', 'disabled:opacity-(--progress-disabled-opacity)'),
		value: cn('text-(--progress-value-font-size)', 'font-(--progress-value-font-weight)', 'text-(--progress-value-fg)', 'tabular-nums'),
	}),
	threshold: { critical: 90, warning: 70 },
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const circleGeometry = (sw: number) => ({
	c: 2 * Math.PI * ((B.circle - sw) / 2),
	center: B.circle / 2,
	r: (B.circle - sw) / 2,
});
const getMeterZone = (pct: number, warning: number, critical: number): MeterZone =>
	pct < warning ? 'optimal' : pct < critical ? 'warning' : 'critical';

// --- [ENTRY_POINT] -----------------------------------------------------------

const Progress: FC<ProgressProps> = (props) => {
	const {
		asyncState, centerIcon, className, color, criticalThreshold, formatOptions, formatValue, indeterminateIcon,
		isDisabled, label, ref, shape = 'linear', showValue = false,
		size, strokeWidth = 4, tooltip, variant, warningThreshold, ...racProps } = props;
	const meterMode = 'warningThreshold' in props || 'criticalThreshold' in props;
	const isIndeterminate = !meterMode && AsyncState.isPending(asyncState) && racProps.value === undefined;
	const slot = Slot.bind(asyncState);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const geo = useMemo(() => circleGeometry(strokeWidth), [strokeWidth]);
	const isCircular = shape === 'circular';
	const sharedProps = {
		...(tooltipProps as object),
		className: cn(isCircular ? B.slot.rootCircular : B.slot.root, className),
		'data-async-state': slot.attr,
		'data-color': color,
		'data-disabled': isDisabled || undefined,
		'data-semantic': meterMode ? 'meter' : 'progress',
		'data-shape': shape,
		'data-size': size,
		'data-variant': variant,
		ref: mergedRef,
	};
	const renderContent = ({ percentage = 0, valueText = '' }: { percentage?: number | undefined; valueText?: string | undefined }): ReactNode => {
		const display = formatValue?.(percentage) ?? valueText;
		const zone = meterMode ? getMeterZone(percentage, warningThreshold ?? B.threshold.warning, criticalThreshold ?? B.threshold.critical) : undefined;
		return isCircular ? (
			<>
				<div
					className={B.slot.circle}
					data-indeterminate={isIndeterminate || undefined}
					data-meter-zone={zone}
					data-slot="progress-circle"
					data-value={isIndeterminate ? undefined : percentage}
				>
					{isIndeterminate
						? slot.render(indeterminateIcon ?? { default: Loader2 }, B.slot.circleIndeterminateIcon)
						: (
							<>
								<svg aria-hidden="true" className={B.slot.circleSvg} data-slot="progress-circle-svg" fill="none" viewBox={`0 0 ${B.circle} ${B.circle}`}>
									<circle className={B.slot.circleTrack} cx={geo.center} cy={geo.center} data-slot="progress-circle-track" fill="none" r={geo.r} stroke="var(--progress-circle-track-stroke)" strokeWidth={strokeWidth} />
									<circle
										className={B.slot.circleIndicator}
										cx={geo.center}
										cy={geo.center}
										data-meter-zone={zone}
										data-slot="progress-circle-indicator"
										fill="none"
										r={geo.r}
										stroke="var(--progress-circle-indicator-stroke)"
										strokeDasharray={geo.c}
										strokeDashoffset={geo.c * (1 - percentage / 100)}
										strokeLinecap="round"
										strokeWidth={strokeWidth}
									/>
								</svg>
								{centerIcon && <span className={B.slot.circleValue} data-slot="progress-circle-center">{slot.render(centerIcon, B.slot.circleCenterIcon)}</span>}
								{!centerIcon && showValue && <span className={B.slot.circleValue} data-meter-zone={zone} data-slot="progress-circle-value">{display}</span>}
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
						{showValue && !isIndeterminate && <span className={B.slot.value} data-meter-zone={zone} data-slot="progress-value">{display}</span>}
					</div>
				)}
				<div
					className={B.slot.bar}
					data-indeterminate={isIndeterminate || undefined}
					data-meter-zone={zone}
					data-slot="progress-bar"
					data-value={isIndeterminate ? undefined : percentage}
				>
					{isIndeterminate
						? <div className={B.slot.fillIndeterminate} data-slot="progress-fill" />
						: <div className={B.slot.fill} data-meter-zone={zone} data-slot="progress-fill" style={{ width: `${percentage}%` }} />}
				</div>
			</>
		);
	};
	return (
		<>
			{meterMode ? (
				<RACMeter {...(racProps as RACMeterProps)} {...sharedProps} data-slot="meter">
					{renderContent}
				</RACMeter>
			) : (
				<RACProgressBar {...(racProps as RACProgressBarProps)} {...sharedProps} data-slot="progress">
					{renderContent}
				</RACProgressBar>
			)}
			{renderTooltip?.()}
			<AsyncAnnouncer asyncState={asyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { Progress };
export type { MeterZone, ProgressProps, ProgressShape };
