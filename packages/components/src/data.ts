import { cva } from 'class-variance-authority';
import { Effect } from 'effect';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ImgHTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { DimensionConfig, FeedbackVariant } from './schema.ts';
import { cls, computeDimensions, createDimensionDefaults, createVars, resolveDimensions } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type DataType = 'avatar' | 'badge' | 'card' | 'list' | 'table';
type CardProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly footer?: ReactNode;
    readonly header?: ReactNode;
};
type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
    readonly children?: ReactNode;
    readonly variant?: FeedbackVariant;
};
type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
    readonly fallback?: string;
    readonly src?: string | undefined;
};
type ListProps<T> = HTMLAttributes<HTMLUListElement> & {
    readonly items: ReadonlyArray<T>;
    readonly renderItem: (item: T, index: number) => ReactNode;
};
type TableProps<T> = HTMLAttributes<HTMLTableElement> & {
    readonly columns: ReadonlyArray<{ readonly header: string; readonly key: keyof T }>;
    readonly data: ReadonlyArray<T>;
};
type DataInput<T extends DataType> = {
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly type: T;
};

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    badge: {
        error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    } as { readonly [K in FeedbackVariant]: string },
    defaults: { dimensions: createDimensionDefaults() },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const vars = createVars('data');

const resolveDims = (dim?: Partial<DimensionConfig>): DimensionConfig =>
    Effect.runSync(resolveDimensions(dim, B.defaults.dimensions));

const cardVariants = cva(
    ['rounded-[var(--data-radius)] border bg-white dark:bg-gray-900', 'shadow-sm overflow-hidden'].join(' '),
    { defaultVariants: {}, variants: {} },
);

const badgeVariants = cva(['inline-flex items-center rounded-full px-2 py-0.5', 'text-xs font-medium'].join(' '), {
    defaultVariants: { variant: 'info' },
    variants: { variant: B.badge },
});

const avatarVariants = cva(
    [
        'inline-flex items-center justify-center overflow-hidden rounded-full',
        'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    ].join(' '),
    { defaultVariants: {}, variants: {} },
);

const tableVariants = cva('w-full border-collapse text-sm', { defaultVariants: {}, variants: {} });

const listVariants = cva('space-y-1', { defaultVariants: {}, variants: {} });

// --- Component Factories ----------------------------------------------------

const createCard = (i: DataInput<'card'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = cardVariants({});
    const Component = forwardRef((props: CardProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, footer, header, style, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                style: { ...cssVars, ...style } as CSSProperties,
            },
            header ? createElement('div', { className: 'border-b px-4 py-3 font-semibold' }, header) : null,
            createElement('div', { className: 'px-4 py-3' }, children),
            footer
                ? createElement('div', { className: 'border-t px-4 py-3 bg-gray-50 dark:bg-gray-800' }, footer)
                : null,
        );
    });
    Component.displayName = 'Data(card)';
    return Component;
};

const createBadge = (i: DataInput<'badge'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const Component = forwardRef((props: BadgeProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { children, className, style, variant = 'info', ...rest } = props;
        const internalRef = useRef<HTMLSpanElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLSpanElement>;
        const base = badgeVariants({ variant });
        return createElement(
            'span',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                style: { ...cssVars, ...style } as CSSProperties,
            },
            children,
        );
    });
    Component.displayName = 'Data(badge)';
    return Component;
};

const createAvatar = (i: DataInput<'avatar'>) => {
    const dims = resolveDims(i.dimensions);
    const computed = Effect.runSync(computeDimensions(dims));
    const base = avatarVariants({});
    const Component = forwardRef((props: AvatarProps, fRef: ForwardedRef<HTMLSpanElement>) => {
        const { alt, className, fallback, src, style, ...rest } = props;
        const internalRef = useRef<HTMLSpanElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLSpanElement>;
        const size = { height: computed.height, width: computed.height };
        const initials = fallback ?? alt?.charAt(0).toUpperCase() ?? '?';
        return createElement(
            'span',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                style: { ...size, ...style } as CSSProperties,
            },
            src
                ? createElement('img', { alt, className: 'h-full w-full object-cover', src })
                : createElement('span', { className: 'text-sm font-medium' }, initials),
        );
    });
    Component.displayName = 'Data(avatar)';
    return Component;
};

const createList = <T>(i: DataInput<'list'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = listVariants({});
    const Component = forwardRef((props: ListProps<T>, fRef: ForwardedRef<HTMLUListElement>) => {
        const { className, items, renderItem, style, ...rest } = props;
        const internalRef = useRef<HTMLUListElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLUListElement>;
        return createElement(
            'ul',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                role: 'list',
                style: { ...cssVars, ...style } as CSSProperties,
            },
            items.map((item, idx) => createElement('li', { key: idx }, renderItem(item, idx))),
        );
    });
    Component.displayName = 'Data(list)';
    return Component;
};

const createTable = <T extends Record<string, unknown>>(i: DataInput<'table'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = tableVariants({});
    const Component = forwardRef((props: TableProps<T>, fRef: ForwardedRef<HTMLTableElement>) => {
        const { className, columns, data, style, ...rest } = props;
        const internalRef = useRef<HTMLTableElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLTableElement>;
        return createElement(
            'table',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                style: { ...cssVars, ...style } as CSSProperties,
            },
            createElement(
                'thead',
                { className: 'border-b bg-gray-50 dark:bg-gray-800' },
                createElement(
                    'tr',
                    null,
                    columns.map((col) =>
                        createElement(
                            'th',
                            { className: 'px-4 py-3 text-left font-semibold', key: String(col.key) },
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
                        { className: 'hover:bg-gray-50 dark:hover:bg-gray-800', key: idx },
                        columns.map((col) =>
                            createElement(
                                'td',
                                { className: 'px-4 py-3', key: String(col.key) },
                                String(row[col.key] ?? ''),
                            ),
                        ),
                    ),
                ),
            ),
        );
    });
    Component.displayName = 'Data(table)';
    return Component;
};

// --- Factory ----------------------------------------------------------------

const createData = (tuning?: { defaults?: { dimensions?: Partial<DimensionConfig> } }) => {
    const defs = { dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions } };
    return Object.freeze({
        Avatar: createAvatar({ dimensions: defs.dimensions, type: 'avatar' }),
        Badge: createBadge({ dimensions: defs.dimensions, type: 'badge' }),
        Card: createCard({ dimensions: defs.dimensions, type: 'card' }),
        create: {
            avatar: (i: Omit<DataInput<'avatar'>, 'type'>) =>
                createAvatar({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'avatar' }),
            badge: (i: Omit<DataInput<'badge'>, 'type'>) =>
                createBadge({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'badge' }),
            card: (i: Omit<DataInput<'card'>, 'type'>) =>
                createCard({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'card' }),
            list: <T>(i: Omit<DataInput<'list'>, 'type'>) =>
                createList<T>({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'list' }),
            table: <T extends Record<string, unknown>>(i: Omit<DataInput<'table'>, 'type'>) =>
                createTable<T>({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'table' }),
        },
        List: createList({ dimensions: defs.dimensions, type: 'list' }),
        Table: createTable({ dimensions: defs.dimensions, type: 'table' }),
    });
};

// --- Export -----------------------------------------------------------------

export { B as DATA_TUNING, createData };
