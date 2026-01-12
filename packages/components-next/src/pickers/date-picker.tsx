/**
 * DatePicker: Unified date/datetime/range selection with calendar popover.
 * CSS variable inheritance - color/size/variant set on root, children inherit.
 * REQUIRED: size prop. Optional: color, variant, mode, granularity.
 * Mode: 'single' (default) or 'range'. Granularity: 'day' | 'hour' | 'minute' | 'second'.
 */
import { FloatingNode, useMergeRefs, useFloatingNodeId } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { createContext, useContext, useRef } from 'react';
import {
	Button as RACButton, type ButtonProps as RACButtonProps, Calendar as RACCalendar, CalendarCell as RACCalendarCell, type CalendarCellProps as RACCalendarCellProps,
	CalendarGrid as RACCalendarGrid, CalendarGridBody as RACCalendarGridBody, CalendarGridHeader as RACCalendarGridHeader, CalendarHeaderCell as RACCalendarHeaderCell,
	DateInput as RACDateInput, DatePicker as RACDatePicker, type DatePickerProps as RACDatePickerProps, DatePickerStateContext, DateRangePicker as RACDateRangePicker,
	DateRangePickerStateContext, type DateRangePickerProps as RACDateRangePickerProps, DateSegment as RACDateSegment, type DateSegmentProps as RACDateSegmentProps,
	type DateValue, Dialog, FieldError, Group, Heading as RACHeading, Label as RACLabel, Popover, RangeCalendar as RACRangeCalendar, Text,
	TimeField as RACTimeField, type TimeFieldProps as RACTimeFieldProps, type TimeValue, type ValidationResult,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DatePickerMode = 'range' | 'single';
type DatePickerGranularity = 'day' | 'hour' | 'minute' | 'second';
type ContextValue = {
	readonly calendarLabel: string | undefined;
	readonly color: string | undefined;
	readonly granularity: DatePickerGranularity;
	readonly isDisabled: boolean;
	readonly isReadOnly: boolean;
	readonly nextButtonLabel: string | undefined;
	readonly prevButtonLabel: string | undefined;
	readonly size: string;
	readonly variant: string | undefined;
};
type TriggerProps = { readonly asyncState?: AsyncState<unknown, unknown>; readonly gesture?: GestureProps; readonly icon?: SlotInput; readonly tooltip?: TooltipConfig };
type DatePickerProps<T extends DateValue> = Omit<RACDatePickerProps<T> & RACDateRangePickerProps<T>, 'children' | 'granularity'> & {
	readonly calendarLabel?: string;
	readonly children?: ReactNode;
	readonly className?: string;
	readonly color?: string;
	readonly description?: ReactNode;
	readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
	readonly granularity?: DatePickerGranularity;
	readonly label?: ReactNode;
	readonly mode?: DatePickerMode;
	readonly nextButtonLabel?: string;
	readonly popoverOffset?: number;
	readonly prevButtonLabel?: string;
	readonly rangeSeparator?: ReactNode | false;
	readonly ref?: Ref<HTMLDivElement>;
	readonly size: string;
	readonly time?: boolean | { readonly label?: ReactNode; readonly description?: ReactNode };
	readonly tooltip?: TooltipConfig;
	readonly triggerAsyncState?: AsyncState<unknown, unknown>;
	readonly triggerGesture?: GestureProps;
	readonly triggerIcon?: SlotInput;
	readonly triggerTooltip?: TooltipConfig;
	readonly variant?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({ offset: '--date-picker-popover-offset' }),
	defaults: Object.freeze({ granularity: 'day' as DatePickerGranularity, mode: 'single' as DatePickerMode, offset: 8, rangeSeparator: '-' }),
	granularity: Object.freeze({ time: ['hour', 'minute', 'second'] as const }),
	icon: Object.freeze({ next: ChevronRight, prev: ChevronLeft }),
	slot: Object.freeze({
		calendar: cn('w-(--date-picker-calendar-width)', 'p-(--date-picker-calendar-padding)', 'bg-(--date-picker-calendar-bg)', 'rounded-(--date-picker-calendar-radius)'),
		cell: cn(
			'flex items-center justify-center', 'size-(--date-picker-cell-size)', 'text-(--date-picker-cell-font-size)', 'rounded-(--date-picker-cell-radius)', 'cursor-pointer',
			'transition-colors duration-(--date-picker-transition-duration)', 'hovered:bg-(--date-picker-cell-hover-bg)', 'pressed:bg-(--date-picker-cell-pressed-bg)',
			'selected:bg-(--date-picker-cell-selected-bg) selected:text-(--date-picker-cell-selected-fg)', 'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'outside-month:text-(--date-picker-cell-outside-fg)', 'today:ring-(--date-picker-cell-today-ring-width) today:ring-(--date-picker-cell-today-ring-color)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		description: cn('text-(--date-picker-description-font-size)', 'text-(--date-picker-description-fg)'),
		error: cn('text-(--date-picker-error-font-size)', 'text-(--date-picker-error-fg)'),
		field: cn(
			'flex items-center gap-(--date-picker-field-gap)', 'h-(--date-picker-field-height) px-(--date-picker-field-px)',
			'bg-(--date-picker-field-bg) text-(--date-picker-field-fg)', 'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'rounded-(--date-picker-field-radius)', 'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
		),
		grid: cn('w-full border-collapse'),
		group: cn(
			'inline-flex items-stretch', 'rounded-(--date-picker-field-radius)', 'bg-(--date-picker-field-bg)',
			'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none', 'open:ring-(--focus-ring-width) open:ring-(--focus-ring-color)',
		),
		header: cn('flex items-center justify-between', 'mb-(--date-picker-header-mb)'),
		headerButton: cn(
			'flex items-center justify-center', 'size-(--date-picker-header-button-size)', 'rounded-(--date-picker-header-button-radius)',
			'hovered:bg-(--date-picker-header-button-hover-bg)', 'pressed:bg-(--date-picker-header-button-pressed-bg)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		headerCell: cn('text-(--date-picker-grid-header-font-size)', 'text-(--date-picker-grid-header-fg)', 'font-(--date-picker-grid-header-font-weight)', 'p-(--date-picker-grid-header-padding)'),
		headerIcon: cn('size-(--date-picker-header-button-icon-size)'),
		headerTitle: cn('text-(--date-picker-header-title-font-size)', 'font-(--date-picker-header-title-font-weight)', 'text-(--date-picker-header-title-fg)'),
		label: cn('text-(--date-picker-label-font-size)', 'font-(--date-picker-label-font-weight)', 'text-(--date-picker-label-fg)'),
		popover: cn(
			'bg-(--date-picker-popover-bg)', 'rounded-(--date-picker-popover-radius)', 'shadow-(--date-picker-popover-shadow)',
			'border-(--date-picker-popover-border-width) border-(--date-picker-popover-border-color)', 'p-(--date-picker-popover-padding)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--date-picker-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--date-picker-popover-animation-scale)',
			'placement-top:slide-in-from-bottom-(--date-picker-popover-animation-offset)', 'placement-bottom:slide-in-from-top-(--date-picker-popover-animation-offset)',
		),
		rangeCalendar: cn('flex gap-(--date-picker-range-calendar-gap)', 'p-(--date-picker-calendar-padding)', 'bg-(--date-picker-calendar-bg)', 'rounded-(--date-picker-calendar-radius)'),
		rangeSeparator: cn('px-(--date-picker-field-px)', 'text-(--date-picker-segment-font-size)', 'text-(--date-picker-field-fg)'),
		root: cn('inline-flex flex-col items-start gap-(--date-picker-gap)'),
		segment: cn(
			'px-(--date-picker-segment-px)', 'rounded-(--date-picker-segment-radius)', 'text-(--date-picker-segment-font-size)',
			'placeholder:text-(--date-picker-segment-placeholder-fg)', 'focus:bg-(--date-picker-segment-focus-bg) focus:text-(--date-picker-segment-focus-fg)', 'focus:outline-none',
		),
		time: cn('flex flex-col items-start gap-(--date-picker-time-gap)'),
		timeInput: cn(
			'flex items-center gap-(--date-picker-field-gap)', 'h-(--date-picker-field-height) px-(--date-picker-field-px)',
			'bg-(--date-picker-field-bg) text-(--date-picker-field-fg)', 'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'rounded-(--date-picker-field-radius)', 'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
		),
		timeLabel: cn('text-(--date-picker-time-label-font-size)', 'text-(--date-picker-time-label-fg)', 'font-(--date-picker-time-label-font-weight)'),
		trigger: cn(
			'inline-flex items-center justify-center gap-(--date-picker-trigger-gap)', 'size-(--date-picker-trigger-size)', 'rounded-(--date-picker-trigger-radius)',
			'bg-(--date-picker-trigger-bg)', 'border-(--date-picker-trigger-border-width) border-(--date-picker-trigger-border-color)',
			'hovered:bg-(--date-picker-trigger-hover-bg)', 'pressed:bg-(--date-picker-trigger-pressed-bg)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none', 'pending:pointer-events-none pending:opacity-(--date-picker-disabled-opacity)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		triggerIcon: cn('size-(--date-picker-trigger-icon-size) shrink-0'),
	}),
});
const Ctx = createContext<ContextValue | null>(null);

// --- [INTERNAL_COMPONENTS] ---------------------------------------------------

const Segment: FC<{ readonly segment: RACDateSegmentProps['segment'] }> = ({ segment }) => (
	<RACDateSegment
		className={B.slot.segment}
		data-editable={segment.isEditable || undefined}
		data-placeholder={segment.isPlaceholder || undefined}
		data-slot='date-picker-segment'
		data-type={segment.type}
		segment={segment}
	/>
);
const Field: FC<{ readonly slot?: 'end' | 'start' }> = ({ slot }) => {
	const ctx = useContext(Ctx);
	return (
		<RACDateInput
			className={B.slot.field}
			data-color={ctx?.color}
			data-granularity={ctx?.granularity}
			data-size={ctx?.size}
			data-slot={slot ? `date-picker-range-field-${slot}` : 'date-picker-field'}
			data-variant={ctx?.variant}
			{...defined({ slot })}
		>
			{(seg) => <Segment segment={seg} />}
		</RACDateInput>
	);
};
const Trigger: FC<TriggerProps> = ({ asyncState, gesture, icon, tooltip }) => {
	const ctx = useContext(Ctx);
	const slot = Slot.bind(asyncState);
	const isDisabled = ctx?.isDisabled || ctx?.isReadOnly || slot.pending;
	const elementRef = useRef<HTMLButtonElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled,
		prefix: 'date-picker-trigger',
		ref: elementRef as React.RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([elementRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	return (
		<>
			<RACButton
				{...({ ...tooltipProps, ...gestureProps, style: gestureProps.style } as unknown as RACButtonProps)}
				className={B.slot.trigger}
				data-async-state={slot.attr}
				data-color={ctx?.color}
				data-size={ctx?.size}
				data-slot='date-picker-trigger'
				data-variant={ctx?.variant}
				isDisabled={isDisabled}
				isPending={slot.pending}
				ref={mergedRef}
			>
				{slot.render(icon, B.slot.triggerIcon)}
			</RACButton>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};
const CalendarHeader: FC = () => {
	const ctx = useContext(Ctx);
	return (
		<header className={B.slot.header} data-slot='date-picker-header'>
			<RACButton className={B.slot.headerButton} data-slot='date-picker-prev-button' slot='previous' {...defined({ 'aria-label': ctx?.prevButtonLabel })}>
				{Slot.render(B.icon.prev, undefined, B.slot.headerIcon)}
			</RACButton>
			<RACHeading className={B.slot.headerTitle} data-slot='date-picker-heading' />
			<RACButton className={B.slot.headerButton} data-slot='date-picker-next-button' slot='next' {...defined({ 'aria-label': ctx?.nextButtonLabel })}>
				{Slot.render(B.icon.next, undefined, B.slot.headerIcon)}
			</RACButton>
		</header>
	);
};
const CalendarGrid: FC = () => (
	<RACCalendarGrid className={B.slot.grid} data-slot='date-picker-grid'>
		<RACCalendarGridHeader>
			{(day) => <RACCalendarHeaderCell className={B.slot.headerCell} data-slot='date-picker-header-cell'>{day}</RACCalendarHeaderCell>}
		</RACCalendarGridHeader>
		<RACCalendarGridBody>
			{(date: RACCalendarCellProps['date']) => <RACCalendarCell className={B.slot.cell} data-slot='date-picker-cell' date={date} />}
		</RACCalendarGridBody>
	</RACCalendarGrid>
);
const Calendar: FC<{ readonly isRange: boolean }> = ({ isRange }) => {
	const ctx = useContext(Ctx);
	const dataProps = { 'data-color': ctx?.color, 'data-size': ctx?.size, 'data-variant': ctx?.variant };
	return isRange ? (
		<RACRangeCalendar {...dataProps} className={B.slot.rangeCalendar} data-slot='date-picker-range-calendar' {...defined({ 'aria-label': ctx?.calendarLabel })}>
			<CalendarHeader />
			<CalendarGrid />
		</RACRangeCalendar>
	) : (
		<RACCalendar {...dataProps} className={B.slot.calendar} data-slot='date-picker-calendar' {...defined({ 'aria-label': ctx?.calendarLabel })}>
			<CalendarHeader />
			<CalendarGrid />
		</RACCalendar>
	);
};
const TimeField: FC<{ readonly config: { readonly description?: ReactNode; readonly label?: ReactNode }; readonly slot?: 'end' | 'start' }> = ({ config, slot }) => {
	const ctx = useContext(Ctx);
	const rangeState = useContext(DateRangePickerStateContext);
	const singleState = useContext(DatePickerStateContext);
	const hasTime = (rangeState ?? singleState)?.hasTime ?? false;
	const part = slot === 'end' ? 'end' : 'start';
	const rangeValue = rangeState?.timeRange ?? null;
	const autoValue = rangeState ? (part === 'end' ? rangeValue?.end : rangeValue?.start) ?? null : singleState?.timeValue ?? null;
	const handleChange = (next: TimeValue | null): void => { rangeState ? rangeState.setTime(part, next) : next !== null && singleState?.setTimeValue(next);};
	const timeGranularity = B.granularity.time.includes(ctx?.granularity as (typeof B.granularity.time)[number])
		? (ctx?.granularity as 'hour' | 'minute' | 'second')
		: undefined;
	return hasTime ? (
		<RACTimeField
			className={B.slot.time}
			data-color={ctx?.color}
			data-size={ctx?.size}
			data-slot='date-picker-time'
			data-variant={ctx?.variant}
			onChange={handleChange as NonNullable<RACTimeFieldProps<TimeValue>['onChange']>}
			value={autoValue}
			{...defined({ granularity: timeGranularity, slot })}
		>
			{config.label && <RACLabel className={B.slot.timeLabel} data-slot='date-picker-time-label'>{config.label}</RACLabel>}
			<RACDateInput className={B.slot.timeInput} data-color={ctx?.color} data-size={ctx?.size} data-slot='date-picker-time-input' data-variant={ctx?.variant}>
				{(seg) => <Segment segment={seg} />}
			</RACDateInput>
			{config.description && <Text className={B.slot.description} data-slot='date-picker-time-description' slot='description'>{config.description}</Text>}
		</RACTimeField>
	) : null;
};
const PopoverContent: FC<{ readonly children: ReactNode; readonly offset?: number | undefined }> = ({ children, offset }) => {
	const nodeId = useFloatingNodeId();
	const ctx = useContext(Ctx);
	const resolvedOffset = offset ?? (readCssPx(B.cssVars.offset) || B.defaults.offset);
	return (
		<FloatingNode id={nodeId}>
			<Popover
				className={B.slot.popover}
				data-color={ctx?.color}
				data-size={ctx?.size}
				data-slot='date-picker-popover'
				data-theme='date-picker'
				data-variant={ctx?.variant}
				offset={resolvedOffset}
			>
				<Dialog className='outline-none' data-slot='date-picker-dialog'>{children}</Dialog>
			</Popover>
		</FloatingNode>
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const DatePicker = <T extends DateValue>(props: DatePickerProps<T>): ReactNode => {
	const {
		calendarLabel, children, className, color, description, errorMessage, granularity: granularityProp, isDisabled = false, isReadOnly = false,
		label, mode: modeProp, nextButtonLabel, popoverOffset, prevButtonLabel, rangeSeparator, ref, size, time, tooltip, triggerAsyncState,
		triggerGesture, triggerIcon, triggerTooltip, variant, ...racProps } = props;
	const { render: renderTooltip } = useTooltip(tooltip);
	const mode = modeProp ?? B.defaults.mode;
	const granularity = granularityProp ?? B.defaults.granularity;
	const isRange = mode === 'range';
	const separator = rangeSeparator === false ? null : rangeSeparator ?? B.defaults.rangeSeparator;
	const isDefaultSeparator = rangeSeparator === undefined;
	const showTime = time === true || (typeof time === 'object') || B.granularity.time.includes(granularity as (typeof B.granularity.time)[number]);
	const timeConfig = typeof time === 'object' ? time : {};
	const ctxValue: ContextValue = { calendarLabel, color, granularity, isDisabled, isReadOnly, nextButtonLabel, prevButtonLabel, size, variant };
	const dataProps = {
		'data-color': color,
		'data-granularity': granularity,
		'data-mode': mode,
		'data-size': size,
		'data-slot': isRange ? 'date-picker-range' : 'date-picker',
		'data-theme': 'date-picker',
		'data-variant': variant,
	};
	const content = children ?? (
		<>
			<Group className={B.slot.group} data-slot='date-picker-group'>
				{isRange ? (
					<>
						<Field slot='start' />
						{separator && <span aria-hidden={isDefaultSeparator || undefined} className={B.slot.rangeSeparator} data-slot='date-picker-range-separator'>{separator}</span>}
						<Field slot='end' />
					</>
				) : (
					<Field />
				)}
				<Trigger {...{ asyncState: triggerAsyncState, gesture: triggerGesture, icon: triggerIcon, tooltip: triggerTooltip } as TriggerProps} />
			</Group>
			{description && <Text className={B.slot.description} data-slot='date-picker-description' slot='description'>{description}</Text>}
			<FieldError className={B.slot.error} data-slot='date-picker-error'>{errorMessage}</FieldError>
			<PopoverContent offset={popoverOffset}>
				<Calendar isRange={isRange} />
				{showTime && (isRange ? (
					<>
						<TimeField config={{ ...timeConfig, label: timeConfig.label ?? 'Start time' }} slot='start' />
						<TimeField config={{ ...timeConfig, label: timeConfig.label ? `${timeConfig.label} (end)` : 'End time' }} slot='end' />
					</>
				) : (
					<TimeField config={timeConfig} />
				))}
			</PopoverContent>
		</>
	);
	return (
		<>
			<Ctx.Provider value={ctxValue}>
				{isRange ? (
					<RACDateRangePicker
						{...(racProps as Omit<RACDateRangePickerProps<T>, 'children' | 'granularity'>)}
						{...dataProps}
						className={cn(B.slot.root, className)}
						granularity={granularity}
						isDisabled={isDisabled}
						isReadOnly={isReadOnly}
						ref={ref}
					>
						{label && <RACLabel className={B.slot.label} data-slot='date-picker-label'>{label}</RACLabel>}
						{content}
					</RACDateRangePicker>
				) : (
					<RACDatePicker
						{...(racProps as Omit<RACDatePickerProps<T>, 'children' | 'granularity'>)}
						{...dataProps}
						className={cn(B.slot.root, className)}
						granularity={granularity}
						isDisabled={isDisabled}
						isReadOnly={isReadOnly}
						ref={ref}
					>
						{label && <RACLabel className={B.slot.label} data-slot='date-picker-label'>{label}</RACLabel>}
						{content}
					</RACDatePicker>
				)}
			</Ctx.Provider>
			{renderTooltip?.()}
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { DatePicker };
export type { DatePickerProps };
