/**
 * Date/datetime/range selection with calendar popover.
 * Requires size prop. Mode: single (default) or range. Granularity: day/hour/minute/second.
 */
import { FloatingNode, useMergeRefs, useFloatingNodeId } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { readCssPx } from '@parametric-portal/runtime/runtime';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { createContext, useContext, useMemo, useRef } from 'react';
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
import { Option, pipe } from 'effect';
import { cn, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DatePickerMode = 'range' | 'single';
type DatePickerGranularity = 'day' | 'hour' | 'minute' | 'second';
type FirstDayOfWeek = 'fri' | 'mon' | 'sat' | 'sun' | 'thu' | 'tue' | 'wed';
type HourCycle = 12 | 24;
type LocaleWithWeekInfo = Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
type TriggerProps = { readonly asyncState?: AsyncState<unknown, unknown>; readonly gesture?: GestureProps; readonly icon?: SlotInput; readonly tooltip?: TooltipConfig };
type ContextValue = {
    readonly calendarLabel: string | undefined;
    readonly cellTooltip: ((date: DateValue) => string) | boolean | undefined;
    readonly color: string | undefined;
    readonly firstDayOfWeek: FirstDayOfWeek;
    readonly granularity: DatePickerGranularity;
    readonly hourCycle: HourCycle;
    readonly isDisabled: boolean;
    readonly isReadOnly: boolean;
    readonly nextButtonLabel: string | undefined;
    readonly prevButtonLabel: string | undefined;
    readonly size: string;
    readonly variant: string | undefined;
};
type DatePickerProps<T extends DateValue> = Omit<RACDatePickerProps<T> & RACDateRangePickerProps<T>, 'children' | 'firstDayOfWeek' | 'granularity' | 'hourCycle'> & {
    readonly calendarLabel?: string;
    readonly cellTooltip?: ((date: DateValue) => string) | boolean;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly color?: string;
    readonly description?: ReactNode;
    readonly errorMessage?: ReactNode | ((v: ValidationResult) => ReactNode);
    readonly firstDayOfWeek?: 'auto' | FirstDayOfWeek;
    readonly granularity?: DatePickerGranularity;
    readonly hourCycle?: 'auto' | HourCycle;
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

const FIRST_DAY: readonly FirstDayOfWeek[] = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const getLocaleFirstDayOfWeek = (): FirstDayOfWeek => pipe(
    Option.liftThrowable(() => new Intl.Locale(navigator.language) as LocaleWithWeekInfo)(),
    Option.flatMap((locale) => Option.fromNullable(locale.weekInfo ?? locale.getWeekInfo?.())),
    Option.flatMap(({ firstDay }) => Option.fromNullable(FIRST_DAY[firstDay])),
    Option.getOrElse((): FirstDayOfWeek => 'sun'),
);
const getLocaleHourCycle = (): HourCycle => pipe(
    Option.liftThrowable(() => new Intl.DateTimeFormat(navigator.language, { hour: 'numeric' }).resolvedOptions())(),
    Option.map(({ hourCycle }): HourCycle => hourCycle === 'h23' || hourCycle === 'h24' ? 24 : 12),
    Option.getOrElse((): HourCycle => 12),
);
const _B = {
    cssVars: { offset: '--date-picker-popover-offset' },
    defaults: { firstDayOfWeek: 'auto' as const, granularity: 'day' as DatePickerGranularity, hourCycle: 'auto' as const, mode: 'single' as DatePickerMode, offset: 8, rangeSeparator: '-' },
    granularity: { time: ['hour', 'minute', 'second'] as const },
    icon: { next: ChevronRight, prev: ChevronLeft },
    slot: {
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
    },
} as const;
const Ctx = createContext<ContextValue | null>(null);

// --- [INTERNAL_COMPONENTS] ---------------------------------------------------

const Segment: FC<{ readonly segment: RACDateSegmentProps['segment'] }> = ({ segment }) => (
    <RACDateSegment
        className={_B.slot.segment}
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
            className={_B.slot.field}
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
                className={_B.slot.trigger}
                data-async-state={slot.attr}
                data-color={ctx?.color}
                data-size={ctx?.size}
                data-slot='date-picker-trigger'
                data-variant={ctx?.variant}
                isDisabled={isDisabled}
                isPending={slot.pending}
                ref={mergedRef}
            >
                {slot.render(icon, _B.slot.triggerIcon)}
            </RACButton>
            <AsyncAnnouncer asyncState={asyncState} />
            {renderTooltip?.()}
        </>
    );
};
const CalendarHeader: FC = () => {
    const ctx = useContext(Ctx);
    return (
        <header className={_B.slot.header} data-slot='date-picker-header'>
            <RACButton className={_B.slot.headerButton} data-slot='date-picker-prev-button' slot='previous' {...defined({ 'aria-label': ctx?.prevButtonLabel })}>
                {Slot.render(_B.icon.prev, undefined, _B.slot.headerIcon)}
            </RACButton>
            <RACHeading className={_B.slot.headerTitle} data-slot='date-picker-heading' />
            <RACButton className={_B.slot.headerButton} data-slot='date-picker-next-button' slot='next' {...defined({ 'aria-label': ctx?.nextButtonLabel })}>
                {Slot.render(_B.icon.next, undefined, _B.slot.headerIcon)}
            </RACButton>
        </header>
    );
};
const Cell: FC<{ readonly date: RACCalendarCellProps['date'] }> = ({ date }) => {
    const ctx = useContext(Ctx);
    const tooltipConfig = pipe(
        Option.fromNullable(ctx?.cellTooltip),
        Option.map((cfg): TooltipConfig => ({
            content: typeof cfg === 'function' ? cfg(date as DateValue) : date.toDate('UTC').toLocaleDateString(undefined, { dateStyle: 'full' }),
        })),
        Option.getOrUndefined,
    );
    const { props: { ref: tooltipRef, ...tooltipProps }, render: renderTooltip } = useTooltip(tooltipConfig);
    return (
        <>
            <RACCalendarCell {...tooltipProps} ref={tooltipRef as Ref<HTMLTableCellElement>} className={_B.slot.cell} data-slot='date-picker-cell' date={date} />
            {renderTooltip?.()}
        </>
    );
};
const CalendarGrid: FC = () => (
    <RACCalendarGrid className={_B.slot.grid} data-slot='date-picker-grid'>
        <RACCalendarGridHeader>
            {(day) => <RACCalendarHeaderCell className={_B.slot.headerCell} data-slot='date-picker-header-cell'>{day}</RACCalendarHeaderCell>}
        </RACCalendarGridHeader>
        <RACCalendarGridBody>
            {(date: RACCalendarCellProps['date']) => <Cell date={date} />}
        </RACCalendarGridBody>
    </RACCalendarGrid>
);
const Calendar: FC<{ readonly isRange: boolean }> = ({ isRange }) => {
    const ctx = useContext(Ctx);
    const dataProps = { 'data-color': ctx?.color, 'data-size': ctx?.size, 'data-variant': ctx?.variant };
    return isRange ? (
        <RACRangeCalendar {...dataProps} className={_B.slot.rangeCalendar} data-slot='date-picker-range-calendar' {...defined({ 'aria-label': ctx?.calendarLabel, firstDayOfWeek: ctx?.firstDayOfWeek })}>
            <CalendarHeader />
            <CalendarGrid />
        </RACRangeCalendar>
    ) : (
        <RACCalendar {...dataProps} className={_B.slot.calendar} data-slot='date-picker-calendar' {...defined({ 'aria-label': ctx?.calendarLabel, firstDayOfWeek: ctx?.firstDayOfWeek })}>
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
    const timeGranularity = _B.granularity.time.includes(ctx?.granularity as (typeof _B.granularity.time)[number])
        ? (ctx?.granularity as 'hour' | 'minute' | 'second')
        : undefined;
    const hourCycle = ctx?.hourCycle;
    return hasTime ? (
        <RACTimeField
            className={_B.slot.time}
            data-color={ctx?.color}
            data-size={ctx?.size}
            data-slot='date-picker-time'
            data-variant={ctx?.variant}
            onChange={handleChange as NonNullable<RACTimeFieldProps<TimeValue>['onChange']>}
            value={autoValue}
            {...(hourCycle !== undefined && { hourCycle })}
            {...defined({ granularity: timeGranularity, slot })}
        >
            {config.label && <RACLabel className={_B.slot.timeLabel} data-slot='date-picker-time-label'>{config.label}</RACLabel>}
            <RACDateInput className={_B.slot.timeInput} data-color={ctx?.color} data-size={ctx?.size} data-slot='date-picker-time-input' data-variant={ctx?.variant}>
                {(seg) => <Segment segment={seg} />}
            </RACDateInput>
            {config.description && <Text className={_B.slot.description} data-slot='date-picker-time-description' slot='description'>{config.description}</Text>}
        </RACTimeField>
    ) : null;
};
const PopoverContent: FC<{ readonly children: ReactNode; readonly offset: number | undefined }> = ({ children, offset }) => {
    const nodeId = useFloatingNodeId();
    const ctx = useContext(Ctx);
    const resolvedOffset = offset ?? (readCssPx(_B.cssVars.offset) || _B.defaults.offset);
    return (
        <FloatingNode id={nodeId}>
            <Popover
                className={_B.slot.popover}
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
        calendarLabel, cellTooltip, children, className, color, description, errorMessage, firstDayOfWeek: firstDayProp, granularity: granularityProp, hourCycle: hourCycleProp, isDisabled = false, isReadOnly = false,
        label, mode: modeProp, nextButtonLabel, popoverOffset, prevButtonLabel, rangeSeparator, ref, size, time, tooltip, triggerAsyncState,
        triggerGesture, triggerIcon, triggerTooltip, variant, ...racProps } = props;
    const { render: renderTooltip } = useTooltip(tooltip);
    const mode = modeProp ?? _B.defaults.mode;
    const granularity = granularityProp ?? _B.defaults.granularity;
    const firstDayOfWeek = firstDayProp === 'auto' || firstDayProp === undefined ? getLocaleFirstDayOfWeek() : firstDayProp;
    const hourCycle = hourCycleProp === 'auto' || hourCycleProp === undefined ? getLocaleHourCycle() : hourCycleProp;
    const isRange = mode === 'range';
    const separator = rangeSeparator === false ? null : rangeSeparator ?? _B.defaults.rangeSeparator;
    const isDefaultSeparator = rangeSeparator === undefined;
    const showTime = time === true || (typeof time === 'object') || _B.granularity.time.includes(granularity as (typeof _B.granularity.time)[number]);
    const timeConfig = typeof time === 'object' ? time : {};
    const ctxValue = useMemo<ContextValue>(() => ({ calendarLabel, cellTooltip, color, firstDayOfWeek, granularity, hourCycle, isDisabled, isReadOnly, nextButtonLabel, prevButtonLabel, size, variant }), [calendarLabel, cellTooltip, color, firstDayOfWeek, granularity, hourCycle, isDisabled, isReadOnly, nextButtonLabel, prevButtonLabel, size, variant]);
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
            <Group className={_B.slot.group} data-slot='date-picker-group'>
                {isRange ? (
                    <>
                        <Field slot='start' />
                        {separator && <span aria-hidden={isDefaultSeparator || undefined} className={_B.slot.rangeSeparator} data-slot='date-picker-range-separator'>{separator}</span>}
                        <Field slot='end' />
                    </>
                ) : (
                    <Field />
                )}
                <Trigger {...{ asyncState: triggerAsyncState, gesture: triggerGesture, icon: triggerIcon, tooltip: triggerTooltip } as TriggerProps} />
            </Group>
            {description && <Text className={_B.slot.description} data-slot='date-picker-description' slot='description'>{description}</Text>}
            <FieldError className={_B.slot.error} data-slot='date-picker-error'>{errorMessage}</FieldError>
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
                        className={cn(_B.slot.root, className)}
                        granularity={granularity}
                        isDisabled={isDisabled}
                        isReadOnly={isReadOnly}
                        ref={ref}
                    >
                        {label && <RACLabel className={_B.slot.label} data-slot='date-picker-label'>{label}</RACLabel>}
                        {content}
                    </RACDateRangePicker>
                ) : (
                    <RACDatePicker
                        {...(racProps as Omit<RACDatePickerProps<T>, 'children' | 'granularity'>)}
                        {...dataProps}
                        className={cn(_B.slot.root, className)}
                        granularity={granularity}
                        isDisabled={isDisabled}
                        isReadOnly={isReadOnly}
                        ref={ref}
                    >
                        {label && <RACLabel className={_B.slot.label} data-slot='date-picker-label'>{label}</RACLabel>}
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
