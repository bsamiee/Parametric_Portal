import type { CSSProperties, FC, ForwardedRef, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
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
import type { Computed, Inputs, Resolved, TuningFor } from './schema.ts';
import { B, fn, merged, pick, resolve, stateCls, TUNING_KEYS, useCollectionEl, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type DataType = 'avatar' | 'badge' | 'card' | 'list' | 'table';
type Variant = string;
type CardProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly footer?: ReactNode;
    readonly header?: ReactNode;
};
type BadgeProps = HTMLAttributes<HTMLSpanElement> & { readonly children?: ReactNode; readonly variant?: Variant };
type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
    readonly fallback?: string;
    readonly src?: string;
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

// --- Shared Constants (Destructured) ----------------------------------------

const { px, py, r: dRadius } = B.data.var;

// --- Component Builders -----------------------------------------------------

const mkAvatar = (i: DataInput<'avatar'>, c: Computed) =>
    forwardRef((props: AvatarProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { alt, className, fallback, src, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'span',
            {
                ...rest,
                className: fn.cls(
                    'inline-flex items-center justify-center overflow-hidden rounded-full',
                    i.className,
                    className,
                ),
                ref,
                style: { height: c.height, width: c.height, ...style } as CSSProperties,
            },
            src
                ? createElement('img', { alt, className: 'h-full w-full object-cover', src })
                : createElement(
                      'span',
                      { className: 'text-sm font-medium' },
                      fallback ?? alt?.charAt(0).toUpperCase() ?? '?',
                  ),
        );
    });

const mkBadge = (i: DataInput<'badge'>, v: Record<string, string>) =>
    forwardRef((props: BadgeProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { children, className, style, variant, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'span',
            {
                ...rest,
                className: fn.cls(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    i.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            children,
        );
    });

const mkCard = (i: DataInput<'card'>, v: Record<string, string>, b: Resolved['behavior']) =>
    forwardRef((props: CardProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, footer, header, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': b.loading || undefined,
                'aria-disabled': b.disabled || undefined,
                className: fn.cls(
                    dRadius,
                    'border shadow-sm overflow-hidden',
                    stateCls.data(b),
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            header ? createElement('div', { className: fn.cls('border-b font-semibold', px, py) }, header) : null,
            createElement('div', { className: fn.cls(px, py) }, children),
            footer ? createElement('div', { className: fn.cls('border-t', px, py) }, footer) : null,
        );
    });

const mkList = <T>(i: DataInput<'list'>, v: Record<string, string>, b: Resolved['behavior']) =>
    forwardRef((props: ListProps<T>, fRef: ForwardedRef<HTMLUListElement>) => {
        const { className, items, keyExtractor, renderItem, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'ul',
            {
                ...rest,
                'aria-busy': b.loading || undefined,
                'aria-disabled': b.disabled || undefined,
                className: fn.cls('space-y-1', stateCls.data(b), i.className, className),
                ref,
                role: 'list',
                style: { ...v, ...style } as CSSProperties,
            },
            items.map((item, idx) => createElement('li', { key: keyExtractor(item, idx) }, renderItem(item, idx))),
        );
    });

// --- Table Sub-Components (react-aria) --------------------------------------

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
            'text-left font-semibold',
            px,
            py,
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
    return createElement('td', merge(gridCellProps, px, py), cell.rendered);
};

// --- Table Builder ----------------------------------------------------------

const mkTable = <T extends Record<string, unknown>>(
    i: DataInput<'table'>,
    v: Record<string, string>,
    b: Resolved['behavior'],
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
                Column as FC<{ allowsSorting: boolean; children: ReactNode; isRowHeader: boolean; key: string }>,
                {
                    allowsSorting: col.allowsSorting ?? false,
                    // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                    children: col.header,
                    isRowHeader: col.isRowHeader ?? false,
                    key: String(col.key),
                },
            ),
        );
        const bodyCells = (item: T) =>
            columns.map((col) =>
                createElement(Cell as FC<{ children: ReactNode; key: string }>, {
                    // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                    children: String(item[col.key] ?? ''),
                    key: String(col.key),
                }),
            );
        const pageOffset = currentPage !== undefined && pageSize !== undefined ? (currentPage - 1) * pageSize : 0;
        const bodyRows = displayData.map((item, idx) =>
            createElement(Row as FC<{ children: ReactNode; key: Key }>, {
                // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                children: bodyCells(item),
                key: rowKey(item, pageOffset + idx),
            }),
        );
        const tableHeader = createElement(TableHeader as FC<{ children: ReactNode; key: string }>, {
            // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
            children: headerCols,
            key: 'header',
        });
        const tableBody = createElement(TableBody as FC<{ children: ReactNode; key: string }>, {
            // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
            children: bodyRows,
            key: 'body',
        });
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
            ...(disabledKeys && { disabledKeys: disabledKeys as Iterable<Key> }),
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
                'aria-busy': b.loading || undefined,
                'aria-disabled': b.disabled || undefined,
                className: fn.cls('w-full border-collapse text-sm', stateCls.data(b), i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
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

// --- Dispatch Table ---------------------------------------------------------

const builders = { avatar: mkAvatar, badge: mkBadge, card: mkCard, list: mkList, table: mkTable } as const;

const createDT = <T extends DataType>(i: DataInput<T>) => {
    const s = resolve('scale', i.scale);
    const b = resolve('behavior', i.behavior);
    const c = fn.computeScale(s);
    const v = fn.cssVars(c, 'data');
    const builder = builders[i.type ?? 'card'];
    const comp = (
        builder as (
            i: DataInput<T>,
            v: Record<string, string>,
            b: Resolved['behavior'],
        ) => ReturnType<typeof forwardRef>
    )(i, v, b);
    comp.displayName = `Data(${i.type ?? 'card'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createData = (tuning?: TuningFor<'data'>) =>
    Object.freeze({
        Avatar: createDT({ type: 'avatar', ...pick(tuning, ['scale']) }),
        Badge: createDT({ type: 'badge', ...pick(tuning, ['scale']) }),
        Card: createDT({ type: 'card', ...pick(tuning, TUNING_KEYS.data) }),
        create: <T extends DataType>(i: DataInput<T>) => createDT({ ...i, ...merged(tuning, i, TUNING_KEYS.data) }),
        List: createDT({ type: 'list', ...pick(tuning, TUNING_KEYS.data) }),
        Table: createDT({ type: 'table', ...pick(tuning, TUNING_KEYS.data) }),
    });

// --- Export -----------------------------------------------------------------

export { createData };
export type { AvatarProps, BadgeProps, CardProps, DataInput, DataType, ListProps, TableProps, Variant };
