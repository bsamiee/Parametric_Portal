/**
 * Data display components: render avatar, badge, card, list, table, thumb with sorting.
 * Uses B, utilities, stateCls, useCollectionEl from schema.ts with React Stately state.
 * Thumbnails use unified useTooltipState + renderTooltipPortal from schema.ts.
 */
import type {
    CSSProperties,
    FC,
    ForwardedRef,
    ForwardRefExoticComponent,
    HTMLAttributes,
    ImgHTMLAttributes,
    ReactNode,
    RefAttributes,
} from 'react';
import { createElement, forwardRef, useRef } from 'react';
import {
    useTable,
    useTableCell,
    useTableColumnHeader,
    useTableHeaderRow,
    useTableRow,
    useTableRowGroup,
} from 'react-aria';
import type { Key, Node, SortDescriptor, TableState, TableStateProps } from 'react-stately';
import { Cell, Column, Row, TableBody, TableHeader, useTableState } from 'react-stately';
import type { Computed, Inputs, Resolved, TooltipSide, TuningFor } from './schema.ts';
import {
    B,
    computeOffsetPx,
    merged,
    pick,
    renderTooltipPortal,
    resolve,
    stateCls,
    TUNING_KEYS,
    useCollectionEl,
    useForwardedRef,
    useTooltipState,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type DataType = 'avatar' | 'badge' | 'card' | 'list' | 'listitem' | 'table' | 'thumb';
type CardProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly footer?: ReactNode;
    readonly header?: ReactNode;
};
type BadgeProps = HTMLAttributes<HTMLSpanElement> & { readonly children?: ReactNode; readonly variant?: string };
type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
    readonly fallback?: string;
    readonly src?: string;
};
type ThumbProps = HTMLAttributes<HTMLDivElement> & {
    readonly action?: ReactNode;
    readonly children?: ReactNode;
    readonly onAction?: () => void;
    readonly tooltip?: string;
    readonly tooltipSide?: TooltipSide;
};
type ListItemProps = HTMLAttributes<HTMLButtonElement> & {
    readonly action?: ReactNode;
    readonly badge?: ReactNode;
    readonly children?: ReactNode;
    readonly isSelected?: boolean;
    readonly onAction?: () => void;
    readonly thumbnail?: ReactNode;
};
type ListProps<T> = HTMLAttributes<HTMLUListElement> & {
    readonly items: ReadonlyArray<T>;
    readonly keyExtractor: (item: T, index: number) => Key;
    readonly renderItem: (item: T, index: number) => ReactNode;
};
type Selection = 'all' | Set<Key>;
type SelectionMode = 'multiple' | 'none' | 'single';
type TableColumnDef<T> = {
    readonly allowsSorting?: boolean;
    readonly header: string;
    readonly isRowHeader?: boolean;
    readonly key: keyof T;
};
type TableProps<T> = HTMLAttributes<HTMLTableElement> & {
    readonly columns: ReadonlyArray<TableColumnDef<T>>;
    readonly currentPage?: number;
    readonly data: ReadonlyArray<T>;
    readonly defaultSelectedKeys?: Selection;
    readonly defaultSortDescriptor?: SortDescriptor;
    readonly disabledKeys?: Iterable<Key>;
    readonly onSelectionChange?: (keys: Selection) => void;
    readonly onSortChange?: (descriptor: SortDescriptor) => void;
    readonly pageSize?: number;
    readonly rowKey: (row: T, index: number) => Key;
    readonly selectedKeys?: Selection;
    readonly selectionMode?: SelectionMode;
    readonly sortDescriptor?: SortDescriptor;
};
type DataInput<T extends DataType = 'card'> = {
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly className?: string;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};
type DataComponentMap = {
    readonly avatar: ForwardRefExoticComponent<AvatarProps & RefAttributes<HTMLSpanElement>>;
    readonly badge: ForwardRefExoticComponent<BadgeProps & RefAttributes<HTMLSpanElement>>;
    readonly card: ForwardRefExoticComponent<CardProps & RefAttributes<HTMLDivElement>>;
    readonly list: ForwardRefExoticComponent<ListProps<unknown> & RefAttributes<HTMLUListElement>>;
    readonly listitem: ForwardRefExoticComponent<ListItemProps & RefAttributes<HTMLButtonElement>>;
    readonly table: ForwardRefExoticComponent<TableProps<Record<string, unknown>> & RefAttributes<HTMLTableElement>>;
    readonly thumb: ForwardRefExoticComponent<ThumbProps & RefAttributes<HTMLDivElement>>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const dataCls = {
    cell: utilities.cls(B.data.var.px, B.data.var.py),
} as const;

const createAvatarComponent = (input: DataInput<'avatar'>, computed: Computed) =>
    forwardRef((props: AvatarProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { alt, className, fallback, src, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'span',
            {
                ...rest,
                className: utilities.cls(B.data.avatar.base, input.className, className),
                ref,
                style: { height: computed.height, width: computed.height, ...style } as CSSProperties,
            },
            src
                ? createElement('img', { alt, className: B.data.avatar.image, src })
                : createElement(
                      'span',
                      { className: B.data.avatar.fallback },
                      fallback ?? alt?.charAt(0).toUpperCase() ?? '?',
                  ),
        );
    });

const createBadgeComponent = (input: DataInput<'badge'>, vars: Record<string, string>) =>
    forwardRef((props: BadgeProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { children, className, style, variant, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'span',
            {
                ...rest,
                className: utilities.cls(
                    B.data.badge.base,
                    B.data.var.badgePx,
                    B.data.var.badgePy,
                    input.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                style: { ...vars, ...style } as CSSProperties,
            },
            children,
        );
    });

const createCardComponent = (
    input: DataInput<'card'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
    computed: Computed,
) =>
    forwardRef((props: CardProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, footer, header, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': behavior.loading || undefined,
                'aria-disabled': behavior.disabled || undefined,
                className: utilities.cls(B.data.card.base, stateCls.data(behavior), input.className, className),
                ref,
                style: { borderRadius: computed.radius, ...vars, ...style } as CSSProperties,
            },
            header
                ? createElement(
                      'div',
                      { className: utilities.cls('border-b', B.data.card.heading, dataCls.cell) },
                      header,
                  )
                : null,
            createElement('div', { className: dataCls.cell }, children),
            footer ? createElement('div', { className: utilities.cls('border-t', dataCls.cell) }, footer) : null,
        );
    });

const createListComponent = <T>(
    input: DataInput<'list'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
) =>
    forwardRef((props: ListProps<T>, fRef: ForwardedRef<HTMLUListElement>) => {
        const { className, items, keyExtractor, renderItem, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'ul',
            {
                ...rest,
                'aria-busy': behavior.loading || undefined,
                'aria-disabled': behavior.disabled || undefined,
                className: utilities.cls('space-y-1', stateCls.data(behavior), input.className, className),
                ref,
                role: 'list',
                style: { ...vars, ...style } as CSSProperties,
            },
            items.map((item, idx) => createElement('li', { key: keyExtractor(item, idx) }, renderItem(item, idx))),
        );
    });

const createThumbComponent = (
    input: DataInput<'thumb'>,
    vars: Record<string, string>,
    _behavior: Resolved['behavior'],
    computed: Computed,
    scale: Resolved['scale'],
) =>
    forwardRef((props: ThumbProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { action, children, className, onAction, style, tooltip, tooltipSide = 'top', ...rest } = props;
        const ref = useForwardedRef(fRef);
        const triggerRef = useRef<HTMLDivElement>(null);
        const tooltipOffsetPx = computeOffsetPx(scale, B.algo.tooltipOffMul);
        const tooltipState = useTooltipState(triggerRef, {
            ...(tooltip !== undefined && { content: tooltip }),
            offsetPx: tooltipOffsetPx,
            side: tooltipSide,
        });
        return createElement(
            'div',
            {
                ...rest,
                ...tooltipState.triggerProps,
                className: utilities.cls(B.data.thumb.base, input.className, className),
                ref: (node: HTMLDivElement | null) => {
                    (ref as { current: HTMLDivElement | null }).current = node;
                    (triggerRef as { current: HTMLDivElement | null }).current = node;
                    tooltipState.refs.setReference(node);
                },
                style: { height: computed.height, width: computed.height, ...vars, ...style } as CSSProperties,
            },
            createElement('div', { className: B.data.thumb.content }, children),
            action &&
                createElement(
                    'button',
                    {
                        'aria-label': tooltip ? `Remove ${tooltip}` : 'Remove',
                        className: B.data.thumb.action,
                        onClick: onAction,
                        type: 'button',
                    },
                    action,
                ),
            renderTooltipPortal(tooltipState),
        );
    });

const createListItemComponent = (input: DataInput<'listitem'>, vars: Record<string, string>, _computed: Computed) =>
    forwardRef((props: ListItemProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const { action, badge, children, className, isSelected, onAction, style, thumbnail, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'button',
            {
                ...rest,
                className: utilities.cls(
                    B.data.listItem.base,
                    B.data.listItem.hover,
                    B.data.var.listItemG,
                    B.data.var.listItemPx,
                    B.data.var.listItemPy,
                    isSelected && B.data.listItem.selected,
                    input.className,
                    className,
                ),
                'data-selected': isSelected || undefined,
                ref,
                style: { gap: 'var(--data-listitem-gap)', ...vars, ...style } as CSSProperties,
                type: 'button',
            },
            thumbnail &&
                createElement(
                    'div',
                    {
                        className: utilities.cls(B.data.listItem.thumb, B.data.var.listItemThumbSize),
                        style: {
                            height: 'var(--data-listitem-thumb-size)',
                            width: 'var(--data-listitem-thumb-size)',
                        },
                    },
                    thumbnail,
                ),
            createElement('div', { className: B.data.listItem.content }, children),
            (badge ?? action) &&
                createElement(
                    'div',
                    { className: utilities.cls(B.data.listItem.action, B.data.var.g) },
                    badge,
                    action &&
                        createElement(
                            'span',
                            {
                                className: 'cursor-pointer',
                                onClick: (e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    onAction?.();
                                },
                                onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && onAction?.(),
                                role: 'button',
                                tabIndex: 0,
                            },
                            action,
                        ),
                ),
        );
    });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

type TColHeaderProps<T> = { readonly column: Node<T>; readonly state: TableState<T> };
const sortDirMap = { ascending: 'asc', descending: 'desc' } as const;
const TColHeader = <T>({ column, state }: TColHeaderProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLTableCellElement>(B.data.table.cell.focus);
    const { columnHeaderProps } = useTableColumnHeader({ node: column }, state, ref);
    const rawDir = state.sortDescriptor?.column === column.key ? state.sortDescriptor.direction : undefined;
    const dir = rawDir ? sortDirMap[rawDir] : 'none';
    return createElement(
        'th',
        merge(
            columnHeaderProps,
            B.data.table.header.base,
            dataCls.cell,
            column.props?.allowsSorting && B.data.table.header.sortable,
        ),
        column.rendered,
        column.props?.allowsSorting &&
            createElement('span', { className: B.data.table.header.sortIcon }, B.data.table.sort[dir]),
    );
};

type THeaderRowProps<T> = { readonly item: Node<T>; readonly state: TableState<T> };
const THeaderRow = <T>({ item, state }: THeaderRowProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLTableRowElement>();
    const { rowProps } = useTableHeaderRow({ node: item }, state, ref);
    return createElement(
        'tr',
        merge(rowProps),
        [...item.childNodes].map((col) => createElement(TColHeader, { column: col, key: col.key, state })),
    );
};

type TRowProps<T> = { readonly item: Node<T>; readonly state: TableState<T> };
const TRow = <T>({ item, state }: TRowProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLTableRowElement>(B.data.table.row.focus);
    const isSelected = state.selectionManager.isSelected(item.key);
    const { rowProps } = useTableRow({ node: item }, state, ref);
    return createElement(
        'tr',
        merge(rowProps, B.data.table.row.hover, isSelected && B.data.table.row.selected),
        [...item.childNodes].map((cell) => createElement(TCell, { cell, key: cell.key, state })),
    );
};

type TCellProps<T> = { readonly cell: Node<T>; readonly state: TableState<T> };
const TCell = <T>({ cell, state }: TCellProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLTableCellElement>(B.data.table.cell.focus);
    const { gridCellProps } = useTableCell({ node: cell }, state, ref);
    return createElement('td', merge(gridCellProps, dataCls.cell), cell.rendered);
};

const createTableComponent = <T extends Record<string, unknown>>(
    input: DataInput<'table'>,
    vars: Record<string, string>,
    behavior: Resolved['behavior'],
    computed: Computed,
) =>
    forwardRef((props: TableProps<T>, fRef: ForwardedRef<HTMLTableElement>) => {
        const {
            className,
            columns,
            currentPage,
            data,
            defaultSelectedKeys,
            defaultSortDescriptor,
            disabledKeys,
            onSelectionChange,
            onSortChange,
            pageSize,
            rowKey,
            selectedKeys,
            selectionMode = 'none',
            sortDescriptor,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        // Pagination: slice data if currentPage and pageSize are provided
        const displayData =
            currentPage !== undefined && pageSize !== undefined
                ? data.slice((currentPage - 1) * pageSize, currentPage * pageSize)
                : data;
        // Build react-stately collection - children prop required for exactOptionalPropertyTypes
        const headerCols = columns.map((col) =>
            createElement(
                Column as FC<{ allowsSorting: boolean; children?: ReactNode; isRowHeader: boolean; key: string }>,
                {
                    allowsSorting: col.allowsSorting ?? false,
                    isRowHeader: col.isRowHeader ?? false,
                    key: String(col.key),
                },
                col.header,
            ),
        );
        const bodyCells = (item: T) =>
            columns.map((col) =>
                createElement(
                    Cell as FC<{ children?: ReactNode; key: string }>,
                    { key: String(col.key) },
                    typeof item[col.key] === 'object' && item[col.key] !== null
                        ? JSON.stringify(item[col.key])
                        : String(item[col.key] ?? ''),
                ),
            );
        const pageOffset = currentPage !== undefined && pageSize !== undefined ? (currentPage - 1) * pageSize : 0;
        const bodyRows = displayData.map((item, idx) =>
            createElement(
                Row as FC<{ children?: ReactNode; key: Key }>,
                { key: rowKey(item, pageOffset + idx) },
                bodyCells(item),
            ),
        );
        const tableHeader = createElement(
            TableHeader as FC<{ children?: ReactNode; key: string }>,
            { key: 'header' },
            headerCols,
        );
        const tableBody = createElement(
            TableBody as FC<{ children?: ReactNode; key: string }>,
            { key: 'body' },
            bodyRows,
        );
        // Cast to TableStateProps to satisfy exactOptionalPropertyTypes with react-stately
        const tableStateProps = {
            children: [tableHeader, tableBody],
            selectionMode,
            ...(defaultSelectedKeys !== undefined && {
                defaultSelectedKeys: defaultSelectedKeys === 'all' ? 'all' : (defaultSelectedKeys as Iterable<Key>),
            }),
            ...(selectedKeys !== undefined && {
                selectedKeys: selectedKeys === 'all' ? 'all' : (selectedKeys as Iterable<Key>),
            }),
            ...(defaultSortDescriptor && { defaultSortDescriptor }),
            ...(sortDescriptor && { sortDescriptor }),
            ...(disabledKeys && { disabledKeys }),
            ...(onSelectionChange && { onSelectionChange: onSelectionChange as (keys: 'all' | Set<Key>) => void }),
            ...(onSortChange && { onSortChange }),
        } as TableStateProps<object>;
        const state = useTableState(tableStateProps);
        const { gridProps } = useTable({ 'aria-label': 'Data table' }, state, ref);
        const { rowGroupProps: theadProps } = useTableRowGroup();
        const { rowGroupProps: tbodyProps } = useTableRowGroup();
        return createElement(
            'table',
            {
                ...rest,
                ...gridProps,
                'aria-busy': behavior.loading || undefined,
                'aria-disabled': behavior.disabled || undefined,
                className: utilities.cls('w-full border-collapse', stateCls.data(behavior), input.className, className),
                ref,
                style: { fontSize: computed.smallFontSize, ...vars, ...style } as CSSProperties,
            },
            createElement(
                'thead',
                { ...theadProps, className: 'border-b' },
                [...state.collection.headerRows].map((row) =>
                    createElement(THeaderRow, { item: row, key: row.key, state }),
                ),
            ),
            createElement(
                'tbody',
                { ...tbodyProps, className: 'divide-y' },
                [...state.collection.body.childNodes].map((row) =>
                    createElement(TRow, { item: row, key: row.key, state }),
                ),
            ),
        );
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    avatar: createAvatarComponent,
    badge: createBadgeComponent,
    card: createCardComponent,
    list: createListComponent,
    listitem: createListItemComponent,
    table: createTableComponent,
    thumb: createThumbComponent,
} as const;

const createDataComponent = <T extends DataType>(input: DataInput<T>): DataComponentMap[T] => {
    const scale = resolve('scale', input.scale);
    const behavior = resolve('behavior', input.behavior);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'data');
    const builder = builderHandlers[input.type ?? 'card'];
    const component = (
        builder as unknown as (
            input: DataInput<T>,
            vars: Record<string, string>,
            behavior: Resolved['behavior'],
            computed: Computed,
            scale: Resolved['scale'],
        ) => DataComponentMap[T]
    )(input, vars, behavior, computed, scale);
    component.displayName = `Data(${input.type ?? 'card'})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createData = (tuning?: TuningFor<'data'>) =>
    Object.freeze({
        Avatar: createDataComponent({ type: 'avatar', ...pick(tuning, ['scale']) }),
        Badge: createDataComponent({ type: 'badge', ...pick(tuning, ['scale']) }),
        Card: createDataComponent({ type: 'card', ...pick(tuning, TUNING_KEYS.data) }),
        create: <T extends DataType>(input: DataInput<T>) =>
            createDataComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.data) }),
        List: createDataComponent({ type: 'list', ...pick(tuning, TUNING_KEYS.data) }),
        ListItem: createDataComponent({ type: 'listitem', ...pick(tuning, ['scale']) }),
        Table: createDataComponent({ type: 'table', ...pick(tuning, TUNING_KEYS.data) }),
        Thumb: createDataComponent({ type: 'thumb', ...pick(tuning, ['scale']) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createData };
export type {
    AvatarProps,
    BadgeProps,
    CardProps,
    DataInput,
    DataType,
    ListItemProps,
    ListProps,
    TableProps,
    ThumbProps,
};
