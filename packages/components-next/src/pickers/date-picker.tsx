/**
 * DatePicker: Comprehensive date selection compound component.
 * Supports single dates, date ranges, and datetime values with different granularity levels.
 * Pure presentation - CSS variable driven styling via frozen B constant.
 * All sub-components share theme state via DatePickerContext.
 * REQUIRED: color, size props on root - no defaults, no hardcoded mappings.
 *
 * RAC props pass through directly - we only add: theme (color/size/variant).
 * Compound pattern: DatePicker.Field, .Calendar, .Range, .Time, .Trigger
 */
import { FloatingNode, useMergeRefs, useFloatingNodeId } from '@floating-ui/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import { createContext, type ReactElement, type ReactNode, type Ref, useContext, useMemo, useRef } from 'react';
import {
	Button as RACButton, type ButtonProps as RACButtonProps, Calendar as RACCalendar, CalendarCell as RACCalendarCell, type CalendarCellProps as RACCalendarCellProps, CalendarGrid as RACCalendarGrid,
	CalendarGridBody as RACCalendarGridBody, CalendarGridHeader as RACCalendarGridHeader, CalendarHeaderCell as RACCalendarHeaderCell, type CalendarProps as RACCalendarProps,
	DateInput as RACDateInput, DatePicker as RACDatePicker, type DatePickerProps as RACDatePickerProps, DateRangePicker as RACDateRangePicker, type DateRangePickerProps as RACDateRangePickerProps,
	DateSegment as RACDateSegment, type DateSegmentProps as RACDateSegmentProps, type DateValue, Dialog, Group, Heading as RACHeading, Label as RACLabel,
	Popover, RangeCalendar as RACRangeCalendar, type RangeCalendarProps as RACRangeCalendarProps, TimeField as RACTimeField, type TimeFieldProps as RACTimeFieldProps, type TimeValue,
} from 'react-aria-components';
import { type TooltipConfig, useTooltip } from '../core/floating';
import type { AsyncState } from '@parametric-portal/types/async';
import { AsyncAnnouncer } from '../core/announce';
import { useGesture, type GestureProps } from '../core/gesture';
import { cn, composeTailwindRenderProps, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DatePickerRangeFieldProps = DatePickerFieldProps & { readonly slot: 'start' | 'end'; };
type DatePickerContextValue = {
	readonly color: string | undefined;
	readonly granularity: 'day' | 'hour' | 'minute' | 'second' | undefined;
	readonly size: string | undefined;
	readonly variant: string | undefined;
};
type DatePickerProps<T extends DateValue> = RACDatePickerProps<T> & {
	readonly children: ReactNode; readonly color: string;
	readonly size: string; readonly variant?: string;
};
type DatePickerFieldProps = {
	readonly className?: string; readonly color?: string; readonly ref?: Ref<HTMLDivElement>;
	readonly size?: string; readonly variant?: string;
};
type DatePickerTriggerProps = {
	readonly asyncState?: AsyncState<unknown, unknown>; readonly children?: ReactNode; readonly className?: string;
	readonly color?: string; readonly gesture?: GestureProps; readonly icon?: SlotInput; readonly isDisabled?: boolean;
	readonly ref?: Ref<HTMLButtonElement>; readonly size?: string; readonly tooltip?: TooltipConfig; readonly variant?: string;
};
type DatePickerCalendarProps<T extends DateValue> = Omit<RACCalendarProps<T>, 'children'> & {
	readonly children?: ReactNode; readonly className?: string; readonly color?: string;
	readonly ref?: Ref<HTMLDivElement>; readonly size?: string; readonly variant?: string;
};
type DatePickerRangeCalendarProps<T extends DateValue> = Omit<RACRangeCalendarProps<T>, 'children'> & {
	readonly children?: ReactNode; readonly className?: string; readonly color?: string;
	readonly ref?: Ref<HTMLDivElement>; readonly size?: string; readonly variant?: string;
};
type DatePickerRangeProps<T extends DateValue> = RACDateRangePickerProps<T> & {
	readonly children: ReactNode; readonly color: string;
	readonly size: string; readonly variant?: string;
};
type DatePickerTimeProps<T extends TimeValue> = Omit<RACTimeFieldProps<T>, 'children'> & {
	readonly children?: ReactNode; readonly className?: string; readonly color?: string;
	readonly label?: ReactNode; readonly ref?: Ref<HTMLDivElement>; readonly size?: string; readonly variant?: string;
};
type DatePickerCellProps = {
	readonly className?: string;
	readonly date: RACCalendarCellProps['date'];
	readonly ref?: Ref<HTMLTableCellElement>;
};
type DatePickerHeaderProps = {
	readonly children?: ReactNode;
	readonly className?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type DatePickerGridProps = {
	readonly children?: (date: RACCalendarCellProps['date']) => ReactElement;
	readonly className?: string;
	readonly ref?: Ref<HTMLTableElement>;
};
type DatePickerSegmentProps = {
	readonly className?: string;
	readonly ref?: Ref<HTMLSpanElement>;
	readonly segment: RACDateSegmentProps['segment'];
};
type DatePickerGroupProps = {
	readonly children: ReactNode;
	readonly className?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type DatePickerPopoverProps = {
	readonly children: ReactNode;
	readonly className?: string;
	readonly offset?: number;
};
type DatePickerHeaderCellProps = {
	readonly children: ReactNode;
	readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({ offset: '--date-picker-popover-offset', }),
	defaults: Object.freeze({ offset: 8, }),
	slot: Object.freeze({
		calendar: cn(
			'w-(--date-picker-calendar-width)',
			'p-(--date-picker-calendar-padding)',
			'bg-(--date-picker-calendar-bg)',
			'rounded-(--date-picker-calendar-radius)',
		),
		cell: cn(
			'flex items-center justify-center',
			'size-(--date-picker-cell-size)',
			'text-(--date-picker-cell-font-size)',
			'rounded-(--date-picker-cell-radius)',
			'cursor-pointer',
			'transition-colors duration-(--date-picker-transition-duration)',
			'hovered:bg-(--date-picker-cell-hover-bg)',
			'pressed:bg-(--date-picker-cell-pressed-bg)',
			'selected:bg-(--date-picker-cell-selected-bg) selected:text-(--date-picker-cell-selected-fg)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'outside-month:text-(--date-picker-cell-outside-fg)',
			'today:ring-(--date-picker-cell-today-ring-width) today:ring-(--date-picker-cell-today-ring-color)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		field: cn(
			'flex items-center gap-(--date-picker-field-gap)',
			'h-(--date-picker-field-height) px-(--date-picker-field-px)',
			'bg-(--date-picker-field-bg) text-(--date-picker-field-fg)',
			'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'rounded-(--date-picker-field-radius)',
			'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
		),
		grid: cn('w-full border-collapse'),
		group: cn(
			'inline-flex items-stretch',
			'rounded-(--date-picker-field-radius)',
			'bg-(--date-picker-field-bg)',
			'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'open:ring-(--focus-ring-width) open:ring-(--focus-ring-color)',
		),
		header: cn(
			'flex items-center justify-between',
			'mb-(--date-picker-header-mb)',
		),
		headerButton: cn(
			'flex items-center justify-center',
			'size-(--date-picker-header-button-size)',
			'rounded-(--date-picker-header-button-radius)',
			'hovered:bg-(--date-picker-header-button-hover-bg)',
			'pressed:bg-(--date-picker-header-button-pressed-bg)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		headerCell: cn(
			'text-(--date-picker-grid-header-font-size)',
			'text-(--date-picker-grid-header-fg)',
			'font-(--date-picker-grid-header-font-weight)',
			'p-(--date-picker-grid-header-padding)',
		),
		headerIcon: cn('size-(--date-picker-header-button-icon-size)'),
		headerTitle: cn(
			'text-(--date-picker-header-title-font-size)',
			'font-(--date-picker-header-title-font-weight)',
			'text-(--date-picker-header-title-fg)',
		),
		popover: cn(
			'bg-(--date-picker-popover-bg)',
			'rounded-(--date-picker-popover-radius)',
			'shadow-(--date-picker-popover-shadow)',
			'border-(--date-picker-popover-border-width) border-(--date-picker-popover-border-color)',
			'p-(--date-picker-popover-padding)',
			'entering:animate-in entering:fade-in entering:zoom-in-(--date-picker-popover-animation-scale)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-(--date-picker-popover-animation-scale)',
			'placement-top:slide-in-from-bottom-(--date-picker-popover-animation-offset)',
			'placement-bottom:slide-in-from-top-(--date-picker-popover-animation-offset)',
		),
		rangeCalendar: cn(
			'flex gap-(--date-picker-range-calendar-gap)',
			'p-(--date-picker-calendar-padding)',
			'bg-(--date-picker-calendar-bg)',
			'rounded-(--date-picker-calendar-radius)',
		),
		root: cn( 'inline-flex items-center gap-(--date-picker-gap)', ),
		segment: cn(
			'px-(--date-picker-segment-px)',
			'rounded-(--date-picker-segment-radius)',
			'text-(--date-picker-segment-font-size)',
			'placeholder:text-(--date-picker-segment-placeholder-fg)',
			'focus:bg-(--date-picker-segment-focus-bg) focus:text-(--date-picker-segment-focus-fg)',
			'focus:outline-none',
		),
		time: cn( 'flex items-center gap-(--date-picker-time-gap)', ),
		timeInput: cn(
			'flex items-center gap-(--date-picker-field-gap)',
			'h-(--date-picker-field-height) px-(--date-picker-field-px)',
			'bg-(--date-picker-field-bg) text-(--date-picker-field-fg)',
			'border-(--date-picker-field-border-width) border-(--date-picker-field-border-color)',
			'rounded-(--date-picker-field-radius)',
			'focus-within:ring-(--focus-ring-width) focus-within:ring-(--focus-ring-color)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
		),
		timeLabel: cn(
			'text-(--date-picker-time-label-font-size)',
			'text-(--date-picker-time-label-fg)',
			'font-(--date-picker-time-label-font-weight)',
		),
		trigger: cn(
			'inline-flex items-center justify-center gap-(--date-picker-trigger-gap)',
			'size-(--date-picker-trigger-size)',
			'rounded-(--date-picker-trigger-radius)',
			'bg-(--date-picker-trigger-bg)',
			'border-(--date-picker-trigger-border-width) border-(--date-picker-trigger-border-color)',
			'hovered:bg-(--date-picker-trigger-hover-bg)',
			'pressed:bg-(--date-picker-trigger-pressed-bg)',
			'disabled:opacity-(--date-picker-disabled-opacity) disabled:pointer-events-none',
			'pending:pointer-events-none pending:opacity-(--date-picker-disabled-opacity)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		triggerIcon: cn('size-(--date-picker-trigger-icon-size) shrink-0'),
	}),
});
const DatePickerContext = createContext<DatePickerContextValue | null>(null);

// --- [ENTRY_POINT] -----------------------------------------------------------

const DatePickerRoot = <T extends DateValue>({
	children, className, color, granularity = 'day', size, variant, ...racProps }: DatePickerProps<T>): ReactNode => {
	const contextValue: DatePickerContextValue = useMemo(
		() => ({ color, granularity, size, variant }),
		[color, granularity, size, variant],
	);
	return (
		<RACDatePicker
			{...(racProps as RACDatePickerProps<T>)}
			className={composeTailwindRenderProps(className, B.slot.root)}
			data-color={color}
			data-granularity={granularity}
			data-size={size}
			data-slot="date-picker"
			data-variant={variant}
			granularity={granularity}
		>
			<DatePickerContext.Provider value={contextValue}> {children} </DatePickerContext.Provider>
		</RACDatePicker>
	);
};
const DatePickerGroup = ({ children, className, ref, }: DatePickerGroupProps): ReactNode => (
	<Group
		className={composeTailwindRenderProps(className, B.slot.group)}
		data-slot="date-picker-group"
		ref={ref}
	>
		{children}
	</Group>
);
const DatePickerPopover = ({ children, className, offset: offsetProp, }: DatePickerPopoverProps): ReactNode => {
	const nodeId = useFloatingNodeId();
	const ctx = useContext(DatePickerContext);
	const resolvedOffset = offsetProp ?? (readCssPx(B.cssVars.offset) || B.defaults.offset);
	return (
		<FloatingNode id={nodeId}>
			<Popover
				className={composeTailwindRenderProps(className, B.slot.popover)}
				data-color={ctx?.color}
				data-size={ctx?.size}
				data-slot="date-picker-popover"
				data-theme="date-picker"
				data-variant={ctx?.variant}
				offset={resolvedOffset}
			>
				<Dialog className="outline-none" data-slot="date-picker-dialog"> {children} </Dialog>
			</Popover>
		</FloatingNode>
	);
};
const DatePickerTrigger = ({
	asyncState, children, className, color: colorProp, gesture, icon, isDisabled,
	ref, size: sizeProp, tooltip, variant: variantProp, }: DatePickerTriggerProps): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	const slot = Slot.bind(asyncState);
	const elementRef = useRef<HTMLButtonElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'date-picker-trigger',
		ref: elementRef as React.RefObject<HTMLElement | null>,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, elementRef, tooltipProps.ref as Ref<HTMLButtonElement>]);
	const buttonProps = {
		...tooltipProps,
		...gestureProps,
		className: composeTailwindRenderProps(className, B.slot.trigger),
		'data-async-state': slot.attr,
		'data-color': color,
		'data-size': size,
		'data-slot': 'date-picker-trigger',
		'data-variant': variant,
		isDisabled: isDisabled || slot.pending,
		ref: mergedRef,
		style: gestureProps.style,
	} as unknown as RACButtonProps;
	return (
		<>
			<RACButton {...buttonProps}>
				{slot.render(icon, B.slot.triggerIcon)}
				{children}
			</RACButton>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};

// --- [FIELD] -----------------------------------------------------------------

const DatePickerSegment = ({ className, ref, segment, }: DatePickerSegmentProps): ReactNode => (
	<RACDateSegment
		className={composeTailwindRenderProps(className, B.slot.segment)}
		data-editable={segment.isEditable || undefined}
		data-placeholder={segment.isPlaceholder || undefined}
		data-slot="date-picker-segment"
		data-type={segment.type}
		ref={ref}
		segment={segment}
	/>
);
const DatePickerField = ({ className, color: colorProp, ref, size: sizeProp, variant: variantProp, }: DatePickerFieldProps): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACDateInput
			className={composeTailwindRenderProps(className, B.slot.field)}
			data-color={color}
			data-granularity={ctx?.granularity}
			data-size={size}
			data-slot="date-picker-field"
			data-variant={variant}
			ref={ref}
		>
			{(segment) => <DatePickerSegment segment={segment} />}
		</RACDateInput>
	);
};

// --- [CALENDAR] --------------------------------------------------------------

const DatePickerCell = ({ className, date, ref, }: DatePickerCellProps): ReactNode => (
	<RACCalendarCell
		className={composeTailwindRenderProps(className, B.slot.cell)}
		data-slot="date-picker-cell"
		date={date}
		ref={ref}
	/>
);
const DatePickerHeaderCell = ({ children, className, }: DatePickerHeaderCellProps): ReactNode => (
	<RACCalendarHeaderCell
		className={cn(B.slot.headerCell, className)}
		data-slot="date-picker-header-cell"
	>
		{children}
	</RACCalendarHeaderCell>
);
const DatePickerGrid = ({ children, className, ref, }: DatePickerGridProps): ReactNode => (
	<RACCalendarGrid
		className={cn(B.slot.grid, className)}
		data-slot="date-picker-grid"
		ref={ref}
	>
		<RACCalendarGridHeader>
			{(day) => <DatePickerHeaderCell>{day}</DatePickerHeaderCell>}
		</RACCalendarGridHeader>
		<RACCalendarGridBody>
			{children ?? ((date) => <DatePickerCell date={date} />)}
		</RACCalendarGridBody>
	</RACCalendarGrid>
);
const DatePickerHeader = ({ children, className, ref, }: DatePickerHeaderProps): ReactNode => {
	const ctx = useContext(DatePickerContext);
	return (
		<header
			className={cn(B.slot.header, className)}
			data-color={ctx?.color}
			data-size={ctx?.size}
			data-slot="date-picker-header"
			data-variant={ctx?.variant}
			ref={ref}
		>
			{children ?? (
				<>
					<RACButton
						className={B.slot.headerButton}
						data-slot="date-picker-prev-button"
						slot="previous"
					>
						{Slot.content(ChevronLeft, B.slot.headerIcon)}
					</RACButton>
					<RACHeading
						className={B.slot.headerTitle}
						data-slot="date-picker-heading"
					/>
					<RACButton
						className={B.slot.headerButton}
						data-slot="date-picker-next-button"
						slot="next"
					>
						{Slot.content(ChevronRight, B.slot.headerIcon)}
					</RACButton>
				</>
			)}
		</header>
	);
};
const DatePickerCalendar = <T extends DateValue>({
	className, color: colorProp, ref, size: sizeProp, variant: variantProp, ...racProps }: DatePickerCalendarProps<T>): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACCalendar
			{...(racProps as RACCalendarProps<T>)}
			className={composeTailwindRenderProps(className, B.slot.calendar)}
			data-color={color}
			data-size={size}
			data-slot="date-picker-calendar"
			data-variant={variant}
			ref={ref}
		>
			<DatePickerHeader />
			<DatePickerGrid />
		</RACCalendar>
	);
};

// --- [RANGE] -----------------------------------------------------------------

const DatePickerRangeCalendar = <T extends DateValue>({
	className, color: colorProp, ref, size: sizeProp, variant: variantProp, ...racProps }: DatePickerRangeCalendarProps<T>): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACRangeCalendar
			{...(racProps as RACRangeCalendarProps<T>)}
			className={composeTailwindRenderProps(className, B.slot.rangeCalendar)}
			data-color={color}
			data-size={size}
			data-slot="date-picker-range-calendar"
			data-variant={variant}
			ref={ref}
		>
			<DatePickerHeader />
			<DatePickerGrid />
		</RACRangeCalendar>
	);
};
const DatePickerRange = <T extends DateValue>({
	children, className, color, granularity = 'day', size, variant, ...racProps }: DatePickerRangeProps<T>): ReactNode => {
	const contextValue: DatePickerContextValue = useMemo(
		() => ({ color, granularity, size, variant }),
		[color, granularity, size, variant],
	);
	return (
		<RACDateRangePicker
			{...(racProps as RACDateRangePickerProps<T>)}
			className={composeTailwindRenderProps(className, B.slot.root)}
			data-color={color}
			data-granularity={granularity}
			data-size={size}
			data-slot="date-picker-range"
			data-variant={variant}
			granularity={granularity}
		>
			<DatePickerContext.Provider value={contextValue}>
				{children}
			</DatePickerContext.Provider>
		</RACDateRangePicker>
	);
};
const DatePickerRangeField = ({
	className, color: colorProp, ref, size: sizeProp, slot, variant: variantProp, }: DatePickerRangeFieldProps): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACDateInput
			className={composeTailwindRenderProps(className, B.slot.field)}
			data-color={color}
			data-granularity={ctx?.granularity}
			data-size={size}
			data-slot={`date-picker-range-field-${slot}`}
			data-variant={variant}
			ref={ref}
			slot={slot}
		>
			{(segment) => <DatePickerSegment segment={segment} />}
		</RACDateInput>
	);
};

// --- [TIME] ------------------------------------------------------------------

const DatePickerTime = <T extends TimeValue>({
	className, color: colorProp, label, ref, size: sizeProp, variant: variantProp, ...racProps }: DatePickerTimeProps<T>): ReactNode => {
	const ctx = useContext(DatePickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACTimeField
			{...(racProps as RACTimeFieldProps<T>)}
			className={composeTailwindRenderProps(className, B.slot.time)}
			data-color={color}
			data-size={size}
			data-slot="date-picker-time"
			data-variant={variant}
			ref={ref}
		>
			{label && (
				<RACLabel
					className={B.slot.timeLabel}
					data-slot="date-picker-time-label"
				>
					{label}
				</RACLabel>
			)}
			<RACDateInput
				className={composeTailwindRenderProps(undefined, B.slot.timeInput)}
				data-color={color}
				data-size={size}
				data-slot="date-picker-time-input"
				data-variant={variant}
			>
				{(segment) => <DatePickerSegment segment={segment} />}
			</RACDateInput>
		</RACTimeField>
	);
};

// --- [COMPOUND] --------------------------------------------------------------

const DatePicker = Object.assign(DatePickerRoot, {
	Calendar: DatePickerCalendar,
	Cell: DatePickerCell,
	Field: DatePickerField,
	Grid: DatePickerGrid,
	Group: DatePickerGroup,
	Header: DatePickerHeader,
	HeaderCell: DatePickerHeaderCell,
	Popover: DatePickerPopover,
	Range: DatePickerRange,
	RangeCalendar: DatePickerRangeCalendar,
	RangeField: DatePickerRangeField,
	Segment: DatePickerSegment,
	Time: DatePickerTime,
	Trigger: DatePickerTrigger,
	useContext: (): DatePickerContextValue | null => useContext(DatePickerContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { DatePicker };
export type { DatePickerContextValue, DatePickerProps, DatePickerRangeProps };
