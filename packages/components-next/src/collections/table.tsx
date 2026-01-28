/**
 * Data table with sorting, selection, and column resizing.
 * Compound component: Table.Header, Table.Body, Table.Row, Table.Cell, Table.Column.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { ArrowUp } from 'lucide-react';
import { createContext, useContext, useMemo, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import type {
	CellProps as RACCellProps, CheckboxProps as RACCheckboxProps, ColumnProps as RACColumnProps, ColumnRenderProps as RACColumnRenderProps,
	ColumnResizerProps as RACColumnResizerProps, Key, ResizableTableContainerProps as RACResizableTableContainerProps,
	RowProps as RACRowProps, TableBodyProps as RACTableBodyProps, TableHeaderProps as RACTableHeaderProps, TableProps as RACTableProps,
} from 'react-aria-components';
import {
	Cell as RACCell, Checkbox as RACCheckbox, Column as RACColumn, ColumnResizer as RACColumnResizer, ResizableTableContainer as RACResizableTableContainer,
	Row as RACRow, Table as RACTable, TableBody as RACTableBody, TableHeader as RACTableHeader,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, composeTailwindRenderProps, defined, Slot, type SlotInput } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type TableContextValue = { readonly color: string | undefined; readonly size: string | undefined; readonly variant: string | undefined; };
type TableProps = Omit<RACTableProps, 'children'> & {
	readonly children: ReactNode;
	readonly color?: string;
	readonly size?: string;
	readonly variant?: string;
};
type TableHeaderProps<T extends object> = Omit<RACTableHeaderProps<T>, 'children'> & {
	readonly children: RACTableHeaderProps<T>['children'];
	readonly className?: string;
};
type TableBodyProps<T extends object> = Omit<RACTableBodyProps<T>, 'children'> & {
	readonly children: RACTableBodyProps<T>['children'];
	readonly className?: string;
	readonly emptyState?: ReactNode;
};
type TableRowProps<T extends object = object> = Omit<RACRowProps<T>, 'children' | 'id'> & {
	readonly asyncState?: AsyncState;
	readonly children: ReactNode;
	readonly className?: string;
	readonly gesture?: GestureProps;
	readonly id: Key;
	readonly ref?: Ref<HTMLTableRowElement>;
	readonly tooltip?: TooltipConfig;
};
type TableCellProps = Omit<RACCellProps, 'children'> & {
	readonly asyncState?: AsyncState;
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly ref?: Ref<HTMLTableCellElement>;
	readonly tooltip?: TooltipConfig;
};
type TableColumnProps = Omit<RACColumnProps, 'children'> & {
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly id: Key;
	readonly ref?: Ref<HTMLTableCellElement>;
	readonly sortIndicator?: SlotInput;
	readonly tooltip?: TooltipConfig;
};
type ResizableTableContainerProps = Omit<RACResizableTableContainerProps, 'children'> & {
	readonly children: ReactNode;
	readonly className?: string;
};
type ColumnResizerProps = Omit<RACColumnResizerProps, 'children'> & {
	readonly children?: SlotInput<ReactNode>;
	readonly className?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type TableRowCheckboxProps = Omit<RACCheckboxProps, 'slot' | 'children'> & {
	readonly children?: ReactNode;
	readonly className?: string;
};
const TableContext = createContext<TableContextValue | null>(null);

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	slot: {
		body: cn('bg-(--table-body-bg)'),
		cell: cn(
			'px-(--table-cell-px) py-(--table-cell-py)',
			'text-(--table-cell-font-size)',
			'text-left align-middle truncate',
		),
		checkbox: cn(
			'size-(--table-checkbox-size)',
			'border border-(--table-checkbox-border-color) rounded-(--table-checkbox-radius)',
			'bg-transparent',
			'transition-colors duration-(--table-animation-duration) ease-(--table-animation-easing)',
			'selected:bg-(--table-checkbox-checked-bg) selected:border-(--table-checkbox-checked-bg) selected:text-(--table-checkbox-checked-fg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
			'disabled:opacity-(--table-row-disabled-opacity) disabled:cursor-not-allowed',
			'indeterminate:bg-(--table-checkbox-checked-bg) indeterminate:border-(--table-checkbox-checked-bg)',
		),
		checkboxCell: cn(
			'w-(--table-checkbox-size) px-(--table-cell-px) py-(--table-cell-py)',
			'align-middle',
		),
		column: cn(
			'group/table-column outline-none cursor-default select-none',
			'px-(--table-column-px) py-(--table-column-py)',
			'text-(--table-column-font-size) font-(--table-column-font-weight)',
			'text-left align-middle',
			'transition-colors duration-(--table-animation-duration) ease-(--table-animation-easing)',
			'data-[allows-sorting]:cursor-pointer',
			'hovered:bg-(--table-column-hover-bg)',
			'focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		columnContent: cn('inline-flex items-center gap-(--table-column-gap)'),
		columnResizer: cn(
			'absolute top-0 right-0 h-full cursor-col-resize touch-none',
			'w-(--table-resizer-width)',
			'bg-(--table-resizer-bg)',
			'transition-colors duration-(--table-animation-duration) ease-(--table-animation-easing)',
			'hovered:bg-(--table-resizer-hover-bg)',
			'focus-visible:bg-(--table-resizer-hover-bg)',
			'data-[resizing]:bg-(--table-resizer-active-bg)',
		),
		emptyState: cn(
			'py-(--table-empty-py) text-center',
			'text-(--table-empty-fg)',
		),
		header: cn(
			'bg-(--table-header-bg) text-(--table-header-fg)',
			'[border-bottom:var(--table-header-border-width,1px)_solid_var(--table-header-border-color,currentColor)]',
		),
		resizableContainer: cn('relative w-full overflow-(--table-resizable-overflow)'),
		root: cn(
			'w-full border-collapse',
			'text-(--table-font-size) font-(--table-font-weight)',
			'bg-(--table-bg) text-(--table-fg)',
			'[border-color:var(--table-border-color,transparent)] [border-width:var(--table-border-width,0)]',
			'rounded-(--table-radius)',
		),
		row: cn(
			'group/table-row outline-none',
			'bg-(--table-row-bg)',
			'[border-bottom:var(--table-row-border-width,1px)_solid_var(--table-row-border-color,transparent)]',
			'transition-colors duration-(--table-animation-duration) ease-(--table-animation-easing)',
			'hovered:bg-(--table-row-hover-bg)',
			'selected:bg-(--table-row-selected-bg) selected:text-(--table-row-selected-fg)',
			'focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
			'disabled:pointer-events-none disabled:opacity-(--table-row-disabled-opacity)',
		),
		sortIndicator: cn(
			'size-(--table-sort-indicator-size) shrink-0',
			'text-(--table-sort-indicator-color)',
			'transition-transform duration-(--table-animation-duration) ease-(--table-animation-easing)',
			'opacity-0 group-data-[allows-sorting]/table-column:opacity-50',
			'group-data-[sorted]/table-column:opacity-100',
			'group-data-[sort-direction=descending]/table-column:rotate-180',
		),
	},
} as const;

// --- [SUB-COMPONENTS] --------------------------------------------------------

const TableHeader = <T extends object>({ children, className, ...racProps }: TableHeaderProps<T>): ReactNode => {
	const ctx = useContext(TableContext);
	return (
		<RACTableHeader
			{...(racProps as RACTableHeaderProps<T>)}
			className={composeTailwindRenderProps(className, _B.slot.header)}
			data-color={ctx?.color}
			data-size={ctx?.size}
			data-slot="table-header"
			data-variant={ctx?.variant}
		>
			{children}
		</RACTableHeader>
	);
};
const TableBody = <T extends object>({ children, className, emptyState, ...racProps }: TableBodyProps<T>): ReactNode => {
	const ctx = useContext(TableContext);
	return (
		<RACTableBody
			{...(racProps as RACTableBodyProps<T>)}
			className={composeTailwindRenderProps(className, _B.slot.body)}
			data-color={ctx?.color}
			data-size={ctx?.size}
			data-slot="table-body"
			data-variant={ctx?.variant}
			{...(emptyState !== undefined && {
				renderEmptyState: () => <div className={_B.slot.emptyState}>{emptyState}</div>,
			})}
		>
			{children}
		</RACTableBody>
	);
};
const TableRow = <T extends object = object>({ asyncState, children, className, gesture, id, isDisabled, ref, tooltip, ...racProps }: TableRowProps<T>): ReactNode => {
	const ctx = useContext(TableContext);
	const slot = Slot.bind(asyncState);
	const rowRef = useRef<HTMLTableRowElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: gestureProps } = useGesture({
		isDisabled: isDisabled || slot.pending,
		prefix: 'table-row',
		ref: rowRef,
		...gesture,
		...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
	});
	const mergedRef = useMergeRefs([ref, rowRef, tooltipProps.ref as Ref<HTMLTableRowElement>]);
	const { ref: _tooltipRef, ...tooltipPropsWithoutRef } = tooltipProps;
	const { style: gestureStyle, ...gesturePropsWithoutRef } = gestureProps;
	return (
		<>
			<RACRow
				{...(racProps as RACRowProps<T>)}
				{...(tooltipPropsWithoutRef as object)}
				{...(gesturePropsWithoutRef as object)}
				className={composeTailwindRenderProps(className, _B.slot.row)}
				data-async-state={slot.attr}
				data-color={ctx?.color}
				data-size={ctx?.size}
				data-slot="table-row"
				data-variant={ctx?.variant}
				id={id}
				isDisabled={isDisabled || slot.pending}
				ref={mergedRef}
				{...(gestureStyle && { style: gestureStyle })}
			>
				{children}
			</RACRow>
			<AsyncAnnouncer asyncState={asyncState} />
			{renderTooltip?.()}
		</>
	);
};
const TableRowCheckbox = ({ children, className, ...racProps }: TableRowCheckboxProps): ReactNode => (
	<RACCheckbox
		{...racProps}
		className={composeTailwindRenderProps(className, _B.slot.checkbox)}
		slot="selection"
	>
		{children}
	</RACCheckbox>
);
const TableColumn = ({
	allowsSorting, children, className, defaultWidth, id, isRowHeader, maxWidth, minWidth, ref,
	sortIndicator, tooltip, width, ...racProps }: TableColumnProps): ReactNode => {
	const ctx = useContext(TableContext);
	const columnRef = useRef<HTMLTableCellElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, columnRef, tooltipProps.ref as Ref<HTMLTableCellElement>]);
	return (
		<RACColumn
			{...(racProps as RACColumnProps)}
			{...defined({ allowsSorting, defaultWidth, isRowHeader, maxWidth, minWidth, width })}
			className={composeTailwindRenderProps(className, _B.slot.column)}
			id={id}
		>
			{(renderProps: RACColumnRenderProps) => {
				const { allowsSorting: isSortable, sortDirection } = renderProps;
				const isSorted = sortDirection !== undefined;
				return (
					<>
						<div
							{...(tooltipProps as object)}
							className={_B.slot.columnContent}
							data-allows-sorting={isSortable || undefined}
							data-color={ctx?.color}
							data-size={ctx?.size}
							data-slot="table-column"
							data-sort-direction={sortDirection}
							data-sorted={isSorted || undefined}
							data-variant={ctx?.variant}
							ref={mergedRef}
						>
							<span className="truncate">{Slot.content(Slot.resolve(children, undefined))}</span>
							{isSortable && (
								<span
									aria-hidden="true"
									className={cn(
										_B.slot.sortIndicator,
										isSorted && 'opacity-100',
										sortDirection === 'descending' && 'rotate-180',
									)}
									data-sort-direction={sortDirection}
								>
									{Slot.content(Slot.resolve(sortIndicator, undefined)) ?? <ArrowUp />}
								</span>
							)}
						</div>
						{renderTooltip?.()}
					</>
				);
			}}
		</RACColumn>
	);
};
const TableCell = ({ asyncState, children, className, ref, tooltip, ...racProps }: TableCellProps): ReactNode => {
	const ctx = useContext(TableContext);
	const slot = Slot.bind(asyncState);
	const cellRef = useRef<HTMLTableCellElement>(null);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const mergedRef = useMergeRefs([ref, cellRef, tooltipProps.ref as Ref<HTMLTableCellElement>]);
	return (
		<RACCell
			{...(racProps as RACCellProps)}
			{...(tooltipProps as object)}
			className={composeTailwindRenderProps(className, _B.slot.cell)}
			data-async-state={slot.attr}
			data-color={ctx?.color}
			data-size={ctx?.size}
			data-slot="table-cell"
			data-variant={ctx?.variant}
			ref={mergedRef}
		>
			{slot.render(children)}
			{renderTooltip?.()}
		</RACCell>
	);
};
const ResizableTableContainer = ({ children, className, ...racProps }: ResizableTableContainerProps): ReactNode => (
	<RACResizableTableContainer
		{...(racProps as RACResizableTableContainerProps)}
		className={cn(_B.slot.resizableContainer, className)}
		data-slot="table-resizable-container"
	>
		{children}
	</RACResizableTableContainer>
);
const ColumnResizer = ({ children, className, ref, ...racProps }: ColumnResizerProps): ReactNode => {
	const resizerRef = useRef<HTMLDivElement>(null);
	const mergedRef = useMergeRefs([ref, resizerRef]);
	return (
		<RACColumnResizer
			{...(racProps as RACColumnResizerProps)}
			className={composeTailwindRenderProps(className, _B.slot.columnResizer)}
			data-slot="table-column-resizer"
			ref={mergedRef}
		>
			{Slot.content(Slot.resolve(children, undefined))}
		</RACColumnResizer>
	);
};

// --- [ROOT COMPONENT] --------------------------------------------------------

const TableRoot = ({ children, className, color, size, variant, ...racProps }: TableProps): ReactNode => {
	const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
	return (
		<TableContext.Provider value={contextValue}>
			<RACTable
				{...(racProps as RACTableProps)}
				className={composeTailwindRenderProps(className, _B.slot.root)}
				data-color={color}
				data-size={size}
				data-slot="table"
				data-variant={variant}
			>
				{children}
			</RACTable>
		</TableContext.Provider>
	);
};

// --- [COMPOUND COMPONENT] ----------------------------------------------------

const Table = Object.assign(TableRoot, {
	Body: TableBody,
	Cell: TableCell,
	Column: TableColumn,
	ColumnResizer,
	Header: TableHeader,
	ResizableContainer: ResizableTableContainer,
	Row: TableRow,
	RowCheckbox: TableRowCheckbox,
	useContext: (): TableContextValue | null => useContext(TableContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Table };
export type {
	ColumnResizerProps, ResizableTableContainerProps, TableBodyProps, TableCellProps,
	TableColumnProps, TableContextValue, TableHeaderProps, TableProps, TableRowCheckboxProps, TableRowProps,
};
