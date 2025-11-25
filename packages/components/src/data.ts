import type { CSSProperties, ForwardedRef, HTMLAttributes, ImgHTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { Computed, ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, merge, resolveScale } from './schema.ts';

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
    readonly renderItem: (item: T, index: number) => ReactNode;
};
type TableProps<T> = HTMLAttributes<HTMLTableElement> & {
    readonly columns: ReadonlyArray<{ readonly header: string; readonly key: keyof T }>;
    readonly data: ReadonlyArray<T>;
};
type DataInput<T extends DataType = 'card'> = {
    readonly className?: string;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    var: {
        g: 'gap-[var(--data-gap)]',
        px: 'px-[var(--data-padding-x)]',
        py: 'py-[var(--data-padding-y)]',
        r: 'rounded-[var(--data-radius)]',
    },
} as const);

// --- Component Builders -----------------------------------------------------

const mkAvatar = (i: DataInput<'avatar'>, c: Computed) =>
    forwardRef((props: AvatarProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { alt, className, fallback, src, style, ...rest } = props;
        const intRef = useRef<HTMLSpanElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLSpanElement>;
        return createElement(
            'span',
            {
                ...rest,
                className: cls(
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
        const intRef = useRef<HTMLSpanElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLSpanElement>;
        return createElement(
            'span',
            {
                ...rest,
                className: cls(
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

const mkCard = (i: DataInput<'card'>, v: Record<string, string>) =>
    forwardRef((props: CardProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, footer, header, style, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(B.var.r, 'border shadow-sm overflow-hidden', i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            header
                ? createElement('div', { className: cls('border-b font-semibold', B.var.px, B.var.py) }, header)
                : null,
            createElement('div', { className: cls(B.var.px, B.var.py) }, children),
            footer ? createElement('div', { className: cls('border-t', B.var.px, B.var.py) }, footer) : null,
        );
    });

const mkList = <T>(i: DataInput<'list'>, v: Record<string, string>) =>
    forwardRef((props: ListProps<T>, fRef: ForwardedRef<HTMLUListElement>) => {
        const { className, items, renderItem, style, ...rest } = props;
        const intRef = useRef<HTMLUListElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLUListElement>;
        return createElement(
            'ul',
            {
                ...rest,
                className: cls('space-y-1', i.className, className),
                ref,
                role: 'list',
                style: { ...v, ...style } as CSSProperties,
            },
            items.map((item, idx) => createElement('li', { key: idx }, renderItem(item, idx))),
        );
    });

const mkTable = <T extends Record<string, unknown>>(i: DataInput<'table'>, v: Record<string, string>) =>
    forwardRef((props: TableProps<T>, fRef: ForwardedRef<HTMLTableElement>) => {
        const { className, columns, data, style, ...rest } = props;
        const intRef = useRef<HTMLTableElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLTableElement>;
        return createElement(
            'table',
            {
                ...rest,
                className: cls('w-full border-collapse text-sm', i.className, className),
                ref,
                style: { ...v, ...style } as CSSProperties,
            },
            createElement(
                'thead',
                { className: 'border-b' },
                createElement(
                    'tr',
                    null,
                    columns.map((col) =>
                        createElement(
                            'th',
                            { className: cls('text-left font-semibold', B.var.px, B.var.py), key: String(col.key) },
                            col.header,
                        ),
                    ),
                ),
            ),
            createElement(
                'tbody',
                { className: 'divide-y' },
                data.map((row, idx) =>
                    createElement(
                        'tr',
                        { key: idx },
                        columns.map((col) =>
                            createElement(
                                'td',
                                { className: cls(B.var.px, B.var.py), key: String(col.key) },
                                String(row[col.key] ?? ''),
                            ),
                        ),
                    ),
                ),
            ),
        );
    });

// --- Dispatch Table ---------------------------------------------------------

const builders = { avatar: mkAvatar, badge: mkBadge, card: mkCard, list: mkList, table: mkTable } as const;

const createData = <T extends DataType>(i: DataInput<T>) => {
    const s = resolveScale(i.scale);
    const c = computeScale(s);
    const v = cssVars(c, 'data');
    const builder = builders[i.type ?? 'card'];
    const comp = (
        builder as (i: DataInput<T>, c: Computed, v: Record<string, string>) => ReturnType<typeof forwardRef>
    )(i, c, v);
    comp.displayName = `Data(${i.type ?? 'card'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createDataComponents = (tuning?: { scale?: ScaleInput }) =>
    Object.freeze({
        Avatar: createData({ type: 'avatar', ...(tuning?.scale && { scale: tuning.scale }) }),
        Badge: createData({ type: 'badge', ...(tuning?.scale && { scale: tuning.scale }) }),
        Card: createData({ type: 'card', ...(tuning?.scale && { scale: tuning.scale }) }),
        create: <T extends DataType>(i: DataInput<T>) =>
            createData({ ...i, ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }) }),
        List: createData({ type: 'list', ...(tuning?.scale && { scale: tuning.scale }) }),
        Table: createData({ type: 'table', ...(tuning?.scale && { scale: tuning.scale }) }),
    });

// --- Export -----------------------------------------------------------------

export { B as DATA_TUNING, createDataComponents };
export type { AvatarProps, BadgeProps, CardProps, DataInput, DataType, ListProps, TableProps, Variant };
