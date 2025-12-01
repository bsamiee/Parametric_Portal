import { Command as Cmdk, useCommandState } from 'cmdk';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useCallback, useMemo, useState } from 'react';
import type { Inputs, Resolved, ResolvedContext, TuningFor } from './schema.ts';
import {
    animStyle,
    B,
    createBuilderContext,
    fn,
    merged,
    pick,
    stateCls,
    TUNING_KEYS,
    useForwardedRef,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type CommandType = 'dialog' | 'inline' | 'palette';
type SeparatorData = { readonly key: string; readonly type: 'separator' };
type ItemData = {
    readonly disabled?: boolean;
    readonly forceMount?: boolean;
    readonly icon?: ReactNode;
    readonly key: string;
    readonly keywords?: ReadonlyArray<string>;
    readonly label: ReactNode;
    readonly onSelect?: () => void;
    readonly shortcut?: string;
    readonly value?: string;
};
type GroupData = {
    readonly forceMount?: boolean;
    readonly heading?: ReactNode;
    readonly items: ReadonlyArray<ItemData | SeparatorData>;
    readonly key: string;
};
type PageData = {
    readonly groups?: ReadonlyArray<GroupData>;
    readonly items?: ReadonlyArray<ItemData | SeparatorData>;
    readonly key: string;
    readonly placeholder?: string;
};
type BaseProps = HTMLAttributes<HTMLDivElement> & {
    readonly defaultValue?: string;
    readonly disablePointerSelection?: boolean;
    readonly filter?: (value: string, search: string, keywords?: ReadonlyArray<string>) => number;
    readonly label?: string;
    readonly loading?: boolean;
    readonly loadingContent?: ReactNode;
    readonly loadingLabel?: string;
    readonly loop?: boolean;
    readonly onValueChange?: (value: string) => void;
    readonly pages?: ReadonlyArray<PageData>;
    readonly placeholder?: string;
    readonly progress?: number;
    readonly shouldFilter?: boolean;
    readonly value?: string;
    readonly vimBindings?: boolean;
};
type DialogProps = BaseProps & {
    readonly container?: HTMLElement | null;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
    readonly overlayClassName?: string;
};
type CommandInput<T extends CommandType = 'palette'> = Partial<TuningFor<'cmd'>> & {
    readonly className?: string;
    readonly scale?: Inputs['scale'];
    readonly type?: T;
};
type Ctx = ResolvedContext<'animation' | 'behavior' | 'overlay'>;

// --- Unified cmd Namespace (All Pure Functions) -----------------------------

const cmd = {
    baseStyle: (ctx: Ctx, s?: CSSProperties): CSSProperties => ({ ...ctx.vars, ...animStyle(ctx.animation), ...s }),
    dispatchKey: (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k })),
    enhance:
        (pages: ReadonlyArray<PageData> | undefined, push: ((k: string) => void) | undefined) =>
        (x: ItemData | SeparatorData): ItemData | SeparatorData =>
            cmd.isSep(x) || !push
                ? x
                : { ...x, onSelect: x.onSelect ?? (() => pages?.some((p) => p.key === x.key) && push(x.key)) },
    isSep: (x: ItemData | SeparatorData): x is SeparatorData => 'type' in x && x.type === 'separator',
    itemCls: (d?: boolean) =>
        fn.cls(
            B.cmd.item.base,
            B.cmd.var.itemH,
            B.cmd.var.px,
            B.cmd.var.py,
            d && B.cmd.item.disabled,
            B.cmd.item.selected,
        ),
    listStyle: (a: Resolved['animation']): CSSProperties => ({
        height: `var(${B.cmd.list.heightVar})`,
        transition: a.enabled ? `height ${a.duration}ms ${a.easing}` : undefined,
    }),
    prevent: (e: React.KeyboardEvent, a: () => void) => {
        e.preventDefault();
        a();
    },
} as const;

// --- Dispatch Tables --------------------------------------------------------

const wrappers = { dialog: Cmdk.Dialog, inline: Cmdk, palette: Cmdk } as const;

const rootStyles = {
    dialog: (ctx: Ctx, s?: CSSProperties) => ({ ...cmd.baseStyle(ctx, s), ...fn.zStyle(ctx.overlay) }),
    inline: cmd.baseStyle,
    palette: cmd.baseStyle,
} as { readonly [K in CommandType]: (ctx: Ctx, s?: CSSProperties) => CSSProperties };

const dialogPropsFor = {
    dialog: (oCls?: string, container?: HTMLElement | null, onOpenChange?: (o: boolean) => void, open?: boolean) => ({
        contentClassName: fn.cls(B.cmd.dialog.content, B.cmd.root),
        overlayClassName: fn.cls(B.ov.pos.fixed, B.ov.backdrop, oCls),
        ...(container && { container }),
        ...(onOpenChange && { onOpenChange }),
        ...(open !== undefined && { open }),
    }),
    inline: () => ({}),
    palette: () => ({}),
} as const;

// --- Render Dispatch --------------------------------------------------------

const render = {
    group: (g: GroupData) =>
        createElement(
            Cmdk.Group,
            {
                className: B.cmd.group.base,
                key: g.key,
                ...fn.optProps({
                    forceMount: g.forceMount,
                    heading: g.heading
                        ? createElement(
                              'div',
                              {
                                  className: fn.cls(
                                      B.cmd.group.heading.base,
                                      B.cmd.var.headingPx,
                                      B.cmd.var.headingPy,
                                      B.cmd.var.xsFs,
                                  ),
                              },
                              g.heading,
                          )
                        : undefined,
                }),
            },
            g.items.map(render.item),
        ),
    item: (x: ItemData | SeparatorData) =>
        cmd.isSep(x)
            ? createElement(Cmdk.Separator, { className: B.cmd.separator, key: x.key })
            : createElement(
                  Cmdk.Item,
                  {
                      className: cmd.itemCls(x.disabled),
                      key: x.key,
                      value: x.value ?? String(x.label),
                      ...(x.disabled !== undefined && { disabled: x.disabled }),
                      ...(x.forceMount !== undefined && { forceMount: x.forceMount }),
                      ...(x.keywords && { keywords: [...x.keywords] }),
                      ...(x.onSelect && { onSelect: x.onSelect }),
                  },
                  x.icon && createElement('span', { className: B.cmd.item.icon }, x.icon),
                  createElement('span', null, x.label),
                  x.shortcut &&
                      createElement(
                          'kbd',
                          { className: fn.cls(B.cmd.item.shortcut.base, B.cmd.var.xsFs) },
                          x.shortcut.split(' ').map((k, i) =>
                              createElement(
                                  'span',
                                  {
                                      className: fn.cls(
                                          B.cmd.item.shortcut.key,
                                          B.cmd.var.shortcutPx,
                                          B.cmd.var.shortcutPy,
                                      ),
                                      key: i,
                                  },
                                  k,
                              ),
                          ),
                      ),
              ),
} as const;

// --- Hooks ------------------------------------------------------------------

const usePageNav = (vim?: boolean) => {
    const [search, setSearch] = useState('');
    const [stack, setStack] = useState<ReadonlyArray<string>>([B.cmd.initialPage]);
    const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
    const push = useCallback((p: string) => {
        setStack((s) => [...s, p]);
        setSearch('');
    }, []);
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const back = stack.length > 1 && (e.key === 'Escape' || (e.key === 'Backspace' && !search));
            back && cmd.prevent(e, pop);
            vim && e.ctrlKey && e.key === 'j' && cmd.prevent(e, () => cmd.dispatchKey('ArrowDown'));
            vim && e.ctrlKey && e.key === 'k' && cmd.prevent(e, () => cmd.dispatchKey('ArrowUp'));
        },
        [stack.length, search, pop, vim],
    );
    return { activePage: stack[stack.length - 1] ?? B.cmd.initialPage, handleKeyDown, push, search, setSearch };
};

// --- List Content -----------------------------------------------------------

const ListContent = ({
    ctx,
    page,
    loading,
    loadingContent,
    loadingLabel,
    progress,
    pages,
    push,
}: {
    readonly ctx: Ctx;
    readonly page?: PageData | undefined;
    readonly loading?: boolean | undefined;
    readonly loadingContent?: ReactNode;
    readonly loadingLabel?: string | undefined;
    readonly progress?: number | undefined;
    readonly pages?: ReadonlyArray<PageData> | undefined;
    readonly push?: ((k: string) => void) | undefined;
}) => {
    const enhance = useMemo(() => cmd.enhance(pages, push), [pages, push]);
    return createElement(
        Cmdk.List,
        {
            className: fn.cls(B.cmd.list.base, B.cmd.var.listMinH, B.cmd.var.listMaxH),
            style: cmd.listStyle(ctx.animation),
        },
        loading &&
            createElement(
                Cmdk.Loading,
                {
                    className: fn.cls(B.cmd.loading.base, B.cmd.var.emptyPy),
                    ...(loadingLabel && { label: loadingLabel }),
                    ...(progress !== undefined && { progress }),
                },
                loadingContent ?? 'Loading...',
            ),
        createElement(
            Cmdk.Empty,
            { className: fn.cls(B.cmd.empty.base, B.cmd.var.emptyPy, B.cmd.var.smFs) },
            'No results found.',
        ),
        page?.groups?.map(render.group),
        page?.items?.map((x) => render.item(enhance(x))),
    );
};

// --- Builder ----------------------------------------------------------------

const mkCmd = <T extends CommandType>(t: T, i: CommandInput<T>, ctx: Ctx) => {
    const cfg = B.cmd.defaults[t];
    const Wrapper = wrappers[t];
    const Component = (props: DialogProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            container,
            label = B.cmd.label,
            loading,
            loadingContent,
            loadingLabel,
            loop = B.algo.cmdLoop,
            onOpenChange,
            open,
            overlayClassName,
            pages,
            placeholder = cfg.placeholder,
            progress,
            shouldFilter = B.algo.cmdShouldFilter,
            style,
            vimBindings,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const nav = usePageNav(vimBindings);
        const [simpleSearch, setSimpleSearch] = useState('');
        const [search, setSearch] = cfg.useNav ? [nav.search, nav.setSearch] : [simpleSearch, setSimpleSearch];
        const page = useMemo(
            () => (cfg.useNav ? pages?.find((p) => p.key === nav.activePage) : pages?.[0]),
            [pages, nav.activePage],
        );
        return createElement(
            Wrapper,
            {
                ...rest,
                className: fn.cls(B.cmd.root, stateCls.cmd(ctx.behavior), i.className, className),
                label,
                loop,
                ref,
                shouldFilter,
                style: rootStyles[t](ctx, style),
                ...fn.optProps({
                    defaultValue: props.defaultValue,
                    disablePointerSelection: props.disablePointerSelection,
                    filter: props.filter,
                    onValueChange: props.onValueChange,
                    value: props.value,
                }),
                ...(cfg.useNav && { onKeyDown: nav.handleKeyDown }),
                ...dialogPropsFor[t](overlayClassName, container, onOpenChange, open),
            },
            createElement(Cmdk.Input, {
                className: fn.cls(B.cmd.input.base, B.cmd.var.inputH, B.cmd.var.px),
                onValueChange: setSearch,
                placeholder: page?.placeholder ?? placeholder,
                value: search,
            }),
            createElement(ListContent, {
                ctx,
                loading,
                loadingContent,
                loadingLabel,
                page,
                pages,
                progress,
                push: cfg.useNav ? nav.push : undefined,
            }),
        );
    };
    return forwardRef(Component) as T extends 'dialog'
        ? ReturnType<typeof forwardRef<HTMLDivElement, DialogProps>>
        : ReturnType<typeof forwardRef<HTMLDivElement, BaseProps>>;
};

const createCmd = <T extends CommandType>(i: CommandInput<T>) => {
    const ctx = createBuilderContext('cmd', ['animation', 'behavior', 'overlay'] as const, i);
    const t = (i.type ?? 'palette') as T;
    const comp = mkCmd(t, i, ctx);
    comp.displayName = `Command(${t})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createCommand = (tuning?: TuningFor<'cmd'>) =>
    Object.freeze({
        create: <T extends CommandType>(i: CommandInput<T>) =>
            createCmd({ ...i, ...merged(tuning, i, TUNING_KEYS.cmd) } as CommandInput<T>),
        Dialog: createCmd({ type: 'dialog', ...pick(tuning, TUNING_KEYS.cmd) } as CommandInput<'dialog'>),
        Inline: createCmd({ type: 'inline', ...pick(tuning, TUNING_KEYS.cmd) } as CommandInput<'inline'>),
        Palette: createCmd({ type: 'palette', ...pick(tuning, TUNING_KEYS.cmd) } as CommandInput<'palette'>),
    });

// --- Export -----------------------------------------------------------------

export { createCommand, useCommandState };
export type {
    BaseProps as CommandProps,
    CommandInput,
    CommandType,
    DialogProps,
    GroupData,
    ItemData,
    PageData,
    SeparatorData,
};
