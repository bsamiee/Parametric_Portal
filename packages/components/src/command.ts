/**
 * Command palette components: render dialog, inline, and palette command interfaces.
 * Uses B, utilities, animStyle, stateCls, createBuilderContext from schema.ts.
 */
import { Command as Cmdk, useCommandState } from 'cmdk';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useCallback, useMemo, useState } from 'react';
import type { Inputs, Resolved, ResolvedContext, TuningFor } from './schema.ts';
import {
    animStyle,
    B,
    createBuilderContext,
    merged,
    pick,
    stateCls,
    TUNING_KEYS,
    useForwardedRef,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const commandHelpers = {
    baseStyle: (ctx: Ctx, style?: CSSProperties): CSSProperties => ({
        ...ctx.vars,
        ...animStyle(ctx.animation),
        ...style,
    }),
    dispatchKey: (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key })),
    enhance:
        (pages: ReadonlyArray<PageData> | undefined, push: ((key: string) => void) | undefined) =>
        (item: ItemData | SeparatorData): ItemData | SeparatorData =>
            commandHelpers.isSeparator(item) || !push
                ? item
                : {
                      ...item,
                      onSelect: item.onSelect ?? (() => pages?.some((page) => page.key === item.key) && push(item.key)),
                  },
    isSeparator: (item: ItemData | SeparatorData): item is SeparatorData => 'type' in item && item.type === 'separator',
    itemCls: (disabled?: boolean) =>
        utilities.cls(
            B.cmd.item.base,
            B.cmd.var.itemH,
            B.cmd.var.px,
            B.cmd.var.py,
            disabled && B.cmd.item.disabled,
            B.cmd.item.selected,
        ),
    listStyle: (animation: Resolved['animation']): CSSProperties => ({
        height: `var(${B.cmd.list.heightVar})`,
        transition: animation.enabled ? `height ${animation.duration}ms ${animation.easing}` : undefined,
    }),
    prevent: (event: React.KeyboardEvent, action: () => void) => {
        event.preventDefault();
        action();
    },
} as const;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const wrappers = { dialog: Cmdk.Dialog, inline: Cmdk, palette: Cmdk } as const;

const rootStyles = {
    dialog: (ctx: Ctx, style?: CSSProperties) => ({
        ...commandHelpers.baseStyle(ctx, style),
        ...utilities.zStyle(ctx.overlay),
    }),
    inline: commandHelpers.baseStyle,
    palette: commandHelpers.baseStyle,
} as { readonly [K in CommandType]: (ctx: Ctx, style?: CSSProperties) => CSSProperties };

const dialogPropsFor = {
    dialog: (
        overlayCls?: string,
        container?: HTMLElement | null,
        onOpenChange?: (isOpen: boolean) => void,
        open?: boolean,
    ) => ({
        contentClassName: utilities.cls(B.cmd.dialog.content, B.cmd.root),
        overlayClassName: utilities.cls(B.ov.pos.fixed, B.ov.backdrop, overlayCls),
        ...(container && { container }),
        ...(onOpenChange && { onOpenChange }),
        ...(open !== undefined && { open }),
    }),
    inline: () => ({}),
    palette: () => ({}),
} as const;

const renderHandlers = {
    group: (group: GroupData) =>
        createElement(
            Cmdk.Group,
            {
                className: B.cmd.group.base,
                key: group.key,
                ...utilities.optProps({
                    forceMount: group.forceMount,
                    heading: group.heading
                        ? createElement(
                              'div',
                              {
                                  className: utilities.cls(
                                      B.cmd.group.heading.base,
                                      B.cmd.var.headingPx,
                                      B.cmd.var.headingPy,
                                      B.cmd.var.xsFs,
                                  ),
                              },
                              group.heading,
                          )
                        : undefined,
                }),
            },
            group.items.map(renderHandlers.item),
        ),
    item: (item: ItemData | SeparatorData) =>
        commandHelpers.isSeparator(item)
            ? createElement(Cmdk.Separator, { className: B.cmd.separator, key: item.key })
            : createElement(
                  Cmdk.Item,
                  {
                      className: commandHelpers.itemCls(item.disabled),
                      key: item.key,
                      value: item.value ?? String(item.label),
                      ...(item.disabled !== undefined && { disabled: item.disabled }),
                      ...(item.forceMount !== undefined && { forceMount: item.forceMount }),
                      ...(item.keywords && { keywords: [...item.keywords] }),
                      ...(item.onSelect && { onSelect: item.onSelect }),
                  },
                  item.icon && createElement('span', { className: B.cmd.item.icon }, item.icon),
                  createElement('span', null, item.label),
                  item.shortcut &&
                      createElement(
                          'kbd',
                          { className: utilities.cls(B.cmd.item.shortcut.base, B.cmd.var.xsFs) },
                          item.shortcut.split(' ').map((keyChar) =>
                              createElement(
                                  'span',
                                  {
                                      className: utilities.cls(
                                          B.cmd.item.shortcut.key,
                                          B.cmd.var.shortcutPx,
                                          B.cmd.var.shortcutPy,
                                      ),
                                      key: keyChar,
                                  },
                                  keyChar,
                              ),
                          ),
                      ),
              ),
} as const;

const usePageNavigation = (vimBindingsEnabled?: boolean) => {
    const [search, setSearch] = useState('');
    const [stack, setStack] = useState<ReadonlyArray<string>>([B.cmd.initialPage]);
    const pop = useCallback(
        () => setStack((currentStack) => (currentStack.length > 1 ? currentStack.slice(0, -1) : currentStack)),
        [],
    );
    const push = useCallback((page: string) => {
        setStack((currentStack) => [...currentStack, page]);
        setSearch('');
    }, []);
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            const shouldGoBack = stack.length > 1 && (event.key === 'Escape' || (event.key === 'Backspace' && !search));
            shouldGoBack && commandHelpers.prevent(event, pop);
            vimBindingsEnabled &&
                event.ctrlKey &&
                event.key === 'j' &&
                commandHelpers.prevent(event, () => commandHelpers.dispatchKey('ArrowDown'));
            vimBindingsEnabled &&
                event.ctrlKey &&
                event.key === 'k' &&
                commandHelpers.prevent(event, () => commandHelpers.dispatchKey('ArrowUp'));
        },
        [stack.length, search, pop, vimBindingsEnabled],
    );
    return { activePage: stack[stack.length - 1] ?? B.cmd.initialPage, handleKeyDown, push, search, setSearch };
};

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
    readonly push?: ((key: string) => void) | undefined;
}) => {
    const enhance = useMemo(() => commandHelpers.enhance(pages, push), [pages, push]);
    return createElement(
        Cmdk.List,
        {
            className: utilities.cls(B.cmd.list.base, B.cmd.var.listMinH, B.cmd.var.listMaxH),
            style: commandHelpers.listStyle(ctx.animation),
        },
        loading &&
            createElement(
                Cmdk.Loading,
                {
                    className: utilities.cls(B.cmd.loading.base, B.cmd.var.emptyPy),
                    ...(loadingLabel && { label: loadingLabel }),
                    ...(progress !== undefined && { progress }),
                },
                loadingContent ?? 'Loading...',
            ),
        createElement(
            Cmdk.Empty,
            { className: utilities.cls(B.cmd.empty.base, B.cmd.var.emptyPy, B.cmd.var.smFs) },
            'No results found.',
        ),
        page?.groups?.map(renderHandlers.group),
        page?.items?.map((item) => renderHandlers.item(enhance(item))),
    );
};

const createCommandFactory = <T extends CommandType>(commandType: T, input: CommandInput<T>, ctx: Ctx) => {
    const config = B.cmd.defaults[commandType];
    const Wrapper = wrappers[commandType];
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
            placeholder = config.placeholder,
            progress,
            shouldFilter = B.algo.cmdShouldFilter,
            style,
            vimBindings,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const navigation = usePageNavigation(vimBindings);
        const [simpleSearch, setSimpleSearch] = useState('');
        const [search, setSearch] = config.useNav
            ? [navigation.search, navigation.setSearch]
            : [simpleSearch, setSimpleSearch];
        const page = useMemo(
            () => (config.useNav ? pages?.find((pageData) => pageData.key === navigation.activePage) : pages?.[0]),
            [pages, navigation.activePage],
        );
        return createElement(
            Wrapper,
            {
                ...rest,
                className: utilities.cls(B.cmd.root, stateCls.cmd(ctx.behavior), input.className, className),
                label,
                loop,
                ref,
                shouldFilter,
                style: rootStyles[commandType](ctx, style),
                ...utilities.optProps({
                    defaultValue: props.defaultValue,
                    disablePointerSelection: props.disablePointerSelection,
                    filter: props.filter,
                    onValueChange: props.onValueChange,
                    value: props.value,
                }),
                ...(config.useNav && { onKeyDown: navigation.handleKeyDown }),
                ...dialogPropsFor[commandType](overlayClassName, container, onOpenChange, open),
            },
            createElement(Cmdk.Input, {
                className: utilities.cls(B.cmd.input.base, B.cmd.var.inputH, B.cmd.var.px),
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
                push: config.useNav ? navigation.push : undefined,
            }),
        );
    };
    return forwardRef(Component) as T extends 'dialog'
        ? ReturnType<typeof forwardRef<HTMLDivElement, DialogProps>>
        : ReturnType<typeof forwardRef<HTMLDivElement, BaseProps>>;
};

const createCommandComponent = <T extends CommandType>(input: CommandInput<T>) => {
    const ctx = createBuilderContext('cmd', ['animation', 'behavior', 'overlay'] as const, input);
    const commandType = (input.type ?? 'palette') as T;
    const component = createCommandFactory(commandType, input, ctx);
    component.displayName = `Command(${commandType})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createCommand = (tuning?: TuningFor<'cmd'>) =>
    Object.freeze({
        create: <T extends CommandType>(input: CommandInput<T>) =>
            createCommandComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.cmd) } as CommandInput<T>),
        Dialog: createCommandComponent({ type: 'dialog', ...pick(tuning, TUNING_KEYS.cmd) } as CommandInput<'dialog'>),
        Inline: createCommandComponent({ type: 'inline', ...pick(tuning, TUNING_KEYS.cmd) } as CommandInput<'inline'>),
        Palette: createCommandComponent({
            type: 'palette',
            ...pick(tuning, TUNING_KEYS.cmd),
        } as CommandInput<'palette'>),
    });

// --- [EXPORT] ----------------------------------------------------------------

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
