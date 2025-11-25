import type { CSSProperties, FC, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import {
    useButton,
    useComboBox,
    useFilter,
    useHiddenSelect,
    useMenu,
    useMenuItem,
    useMenuTrigger,
    useOption,
    useSelect,
} from 'react-aria';
import type { Selection as AriaSelection, Key, ListState, Node, TreeState } from 'react-stately';
import { Item, Section, useComboBoxState, useMenuTriggerState, useSelectState, useTreeState } from 'react-stately';
import type { MenuTuning, Overlay, ResolvedContext, ScaleInput } from './schema.ts';
import {
    animStyle,
    B,
    cls,
    createBuilderContext,
    merged,
    pick,
    stateCls,
    useCollectionEl,
    useForwardedRef,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type SelectionType = 'combobox' | 'menu' | 'select';
type ItemData = { readonly disabled?: boolean; readonly key: Key; readonly label: ReactNode };
type SectionData = { readonly items: ReadonlyArray<ItemData>; readonly key: Key; readonly title?: ReactNode };
type MenuProps = HTMLAttributes<HTMLDivElement> & {
    readonly disabledKeys?: Iterable<Key>;
    readonly items: ReadonlyArray<ItemData | SectionData>;
    readonly onAction?: (key: Key) => void;
    readonly onClose?: () => void;
    readonly onSelectionChange?: (keys: AriaSelection) => void;
    readonly selectedKeys?: AriaSelection;
    readonly selectionMode?: 'multiple' | 'none' | 'single';
    readonly trigger: ReactNode;
};
type SelectProps = HTMLAttributes<HTMLDivElement> & {
    readonly defaultSelectedKey?: Key;
    readonly disabledKeys?: Iterable<Key>;
    readonly errorMessage?: ReactNode;
    readonly isInvalid?: boolean;
    readonly isRequired?: boolean;
    readonly items: ReadonlyArray<ItemData>;
    readonly label?: ReactNode;
    readonly name?: string;
    readonly onSelectionChange?: (key: Key | null) => void;
    readonly placeholder?: string;
    readonly selectedKey?: Key | null;
};
type ComboboxProps = HTMLAttributes<HTMLDivElement> & {
    readonly allowsCustomValue?: boolean;
    readonly defaultInputValue?: string;
    readonly disabledKeys?: Iterable<Key>;
    readonly inputValue?: string;
    readonly items: ReadonlyArray<ItemData>;
    readonly label?: ReactNode;
    readonly onInputChange?: (value: string) => void;
    readonly onSelectionChange?: (key: Key | null) => void;
    readonly placeholder?: string;
    readonly selectedKey?: Key | null;
};
type SelectionInput<T extends SelectionType = 'menu'> = {
    readonly className?: string;
    readonly scale?: ScaleInput;
    readonly type?: T;
} & Partial<MenuTuning>;
type Ctx = ResolvedContext<'animation' | 'behavior' | 'overlay'>;

// --- Shared Sub-Components --------------------------------------------------

type OptionProps<T> = { readonly item: Node<T>; readonly state: ListState<T> };
const Option = <T>({ item, state }: OptionProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLLIElement>(B.menu.item.focus);
    const { isDisabled, isFocused, isSelected, optionProps } = useOption({ key: item.key }, state, ref);
    return createElement(
        'li',
        merge(
            optionProps,
            B.menu.item.base,
            B.menu.var.itemH,
            B.menu.var.itemPx,
            B.menu.var.itemPy,
            isDisabled && B.menu.item.disabled,
            isFocused && B.menu.item.hover,
            isSelected && B.menu.item.selected,
        ),
        item.rendered,
    );
};

type MenuItemCompProps<T> = {
    readonly item: Node<T>;
    readonly onAction?: (key: Key) => void;
    readonly onClose: () => void;
    readonly state: TreeState<T>;
};
const MenuItemComp = <T>({ item, onAction, onClose, state }: MenuItemCompProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLLIElement>(B.menu.item.focus);
    const { isDisabled, isFocused, menuItemProps } = useMenuItem(
        { key: item.key, onClose, ...(onAction && { onAction }) },
        state,
        ref,
    );
    return createElement(
        'li',
        merge(
            menuItemProps,
            B.menu.item.base,
            B.menu.var.itemH,
            B.menu.var.itemPx,
            B.menu.var.itemPy,
            isDisabled && B.menu.item.disabled,
            isFocused && B.menu.item.hover,
        ),
        item.rendered,
    );
};

type SectionCompProps<T> = {
    readonly onAction?: (key: Key) => void;
    readonly onClose: () => void;
    readonly section: Node<T>;
    readonly state: TreeState<T>;
};
const SectionComp = <T>({ onAction, onClose, section, state }: SectionCompProps<T>) =>
    createElement(
        'li',
        { key: section.key },
        section.rendered &&
            createElement(
                'div',
                { className: cls(B.menu.section.header, B.menu.var.itemPx, B.menu.var.itemPy) },
                section.rendered,
            ),
        createElement(
            'ul',
            null,
            [...section.childNodes].map((item) =>
                createElement(MenuItemComp, { item, key: item.key, onClose, state, ...(onAction && { onAction }) }),
            ),
        ),
        createElement('div', { className: cls(B.menu.section.separator, B.menu.var.separatorSp) }),
    );

// --- Pure Utility Functions -------------------------------------------------

const isSection = (item: ItemData | SectionData): item is SectionData => 'items' in item;
const buildItems = (items: ReadonlyArray<ItemData>) =>
    items.map((it) =>
        createElement(Item as FC<{ children: ReactNode; key: Key; textValue: string }>, {
            // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
            children: it.label,
            key: it.key,
            textValue: String(it.label),
        }),
    );
const buildSections = (items: ReadonlyArray<ItemData | SectionData>) =>
    items.flatMap((it) =>
        isSection(it)
            ? createElement(Section as FC<{ children: ReactNode; key: Key; title: ReactNode }>, {
                  // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                  children: buildItems(it.items),
                  key: it.key,
                  title: it.title,
              })
            : createElement(Item as FC<{ children: ReactNode; key: Key; textValue: string }>, {
                  // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                  children: it.label,
                  key: it.key,
                  textValue: String(it.label),
              }),
    );
const zStyle = (o: Overlay): CSSProperties => ({ zIndex: o.zIndex });
const dropdownCls = cls(
    'absolute left-0 w-full shadow-lg border rounded-md overflow-hidden',
    B.menu.var.dropdownMaxH,
    'overflow-y-auto',
);
const baseStyle = (ctx: Ctx, style?: CSSProperties): CSSProperties => ({
    ...ctx.vars,
    ...animStyle(ctx.animation),
    ...style,
});

// --- Component Builders -----------------------------------------------------

const mkMenu = (i: SelectionInput<'menu'>, ctx: Ctx) =>
    forwardRef((props: MenuProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            disabledKeys,
            items,
            onAction,
            onClose,
            onSelectionChange,
            selectedKeys,
            selectionMode = 'none',
            style,
            trigger,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef),
            triggerRef = useRef<HTMLButtonElement>(null),
            menuRef = useRef<HTMLUListElement>(null);
        const menuState = useMenuTriggerState({});
        const closeHandler = onClose ?? menuState.close;
        const { menuProps: triggerMenuProps, menuTriggerProps } = useMenuTrigger({}, menuState, triggerRef);
        const treeState = useTreeState({
            children: buildSections(items),
            disabledKeys: disabledKeys as Iterable<Key>,
            selectionMode,
            ...(selectedKeys !== undefined && { selectedKeys }),
            ...(onSelectionChange && { onSelectionChange }),
        });
        const { menuProps } = useMenu(
            { 'aria-label': 'Menu', onClose: closeHandler, ...(onAction && { onAction }) },
            treeState,
            menuRef,
        );
        const { buttonProps } = useButton(menuTriggerProps, triggerRef);
        return createElement(
            'div',
            {
                ...rest,
                className: cls('relative inline-block', stateCls.menu(ctx.behavior), i.className, className),
                ref,
                style: baseStyle(ctx, style),
            },
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: cls(B.menu.trigger.base, B.menu.var.triggerMinW, 'cursor-pointer'),
                    'data-state': menuState.isOpen ? 'open' : 'closed',
                    disabled: ctx.behavior.disabled,
                    ref: triggerRef,
                    type: 'button',
                },
                trigger,
                createElement('span', { className: B.menu.trigger.indicator }, '\u25BC'),
            ),
            menuState.isOpen &&
                createElement(
                    'ul',
                    {
                        ...menuProps,
                        ...triggerMenuProps,
                        className: dropdownCls,
                        ref: menuRef,
                        style: { ...zStyle(ctx.overlay), marginTop: ctx.computed.dropdownGap, top: '100%' },
                    },
                    [...treeState.collection].map((item) =>
                        item.type === 'section'
                            ? createElement(SectionComp, {
                                  key: item.key,
                                  onClose: closeHandler,
                                  section: item,
                                  state: treeState,
                                  ...(onAction && { onAction }),
                              })
                            : createElement(MenuItemComp, {
                                  item,
                                  key: item.key,
                                  onClose: closeHandler,
                                  state: treeState,
                                  ...(onAction && { onAction }),
                              }),
                    ),
                ),
        );
    });

const mkSelect = (i: SelectionInput<'select'>, ctx: Ctx) =>
    forwardRef((props: SelectProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            defaultSelectedKey,
            disabledKeys,
            errorMessage,
            isInvalid,
            isRequired,
            items,
            label,
            name,
            onSelectionChange,
            placeholder = 'Select...',
            selectedKey,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef),
            triggerRef = useRef<HTMLButtonElement>(null),
            listBoxRef = useRef<HTMLUListElement>(null);
        const state = useSelectState({
            children: buildItems(items),
            disabledKeys: disabledKeys as Iterable<Key>,
            isDisabled: ctx.behavior.disabled,
            ...(isRequired !== undefined && { isRequired }),
            ...(defaultSelectedKey !== undefined && { defaultSelectedKey }),
            ...(selectedKey !== undefined && { selectedKey }),
            ...(onSelectionChange && { onSelectionChange: (k: Key | null) => onSelectionChange(k) }),
        });
        const { labelProps, menuProps, triggerProps, valueProps } = useSelect(
            {
                'aria-label': label ? String(label) : 'Select',
                isDisabled: ctx.behavior.disabled,
                ...(isRequired !== undefined && { isRequired }),
                ...(name !== undefined && { name }),
            },
            state,
            triggerRef,
        );
        const { buttonProps } = useButton(triggerProps, triggerRef);
        const { selectProps } = useHiddenSelect(
            { isDisabled: ctx.behavior.disabled, ...(name !== undefined && { name }) },
            state,
            triggerRef,
        );
        return createElement(
            'div',
            {
                ...rest,
                className: cls('relative inline-block', stateCls.menu(ctx.behavior), i.className, className),
                ref,
                style: baseStyle(ctx, style),
            },
            label && createElement('label', { ...labelProps, className: 'block mb-1 text-sm font-medium' }, label),
            createElement('input', selectProps),
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: cls(
                        B.menu.trigger.base,
                        B.menu.var.triggerMinW,
                        B.menu.var.itemH,
                        B.menu.var.itemPx,
                        'border rounded-md cursor-pointer w-full text-left',
                        isInvalid && 'border-red-500',
                    ),
                    'data-state': state.isOpen ? 'open' : 'closed',
                    disabled: ctx.behavior.disabled,
                    ref: triggerRef,
                    type: 'button',
                },
                createElement(
                    'span',
                    { ...valueProps, className: cls(!state.selectedItem && 'opacity-50') },
                    state.selectedItem?.rendered ?? placeholder,
                ),
                createElement('span', { className: B.menu.trigger.indicator }, '\u25BC'),
            ),
            state.isOpen &&
                createElement(
                    'ul',
                    {
                        ...menuProps,
                        className: dropdownCls,
                        ref: listBoxRef,
                        style: { ...zStyle(ctx.overlay), marginTop: ctx.computed.dropdownGap, top: '100%' },
                    },
                    [...state.collection].map((item) => createElement(Option, { item, key: item.key, state })),
                ),
            isInvalid && errorMessage && createElement('div', { className: 'text-red-500 text-sm mt-1' }, errorMessage),
        );
    });

const mkCombobox = (i: SelectionInput<'combobox'>, ctx: Ctx) =>
    forwardRef((props: ComboboxProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            allowsCustomValue,
            className,
            defaultInputValue,
            disabledKeys,
            inputValue,
            items,
            label,
            onInputChange,
            onSelectionChange,
            placeholder = 'Search...',
            selectedKey,
            style,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef),
            inputRef = useRef<HTMLInputElement>(null),
            listBoxRef = useRef<HTMLUListElement>(null),
            buttonRef = useRef<HTMLButtonElement>(null),
            popoverRef = useRef<HTMLDivElement>(null);
        const { contains } = useFilter({ sensitivity: 'base' });
        const state = useComboBoxState({
            children: buildItems(items),
            defaultFilter: contains,
            disabledKeys: disabledKeys as Iterable<Key>,
            isDisabled: ctx.behavior.disabled,
            items,
            ...(allowsCustomValue !== undefined && { allowsCustomValue }),
            ...(defaultInputValue !== undefined && { defaultInputValue }),
            ...(inputValue !== undefined && { inputValue }),
            ...(selectedKey !== undefined && { selectedKey }),
            ...(onInputChange && { onInputChange }),
            ...(onSelectionChange && { onSelectionChange: (k: Key | null) => onSelectionChange(k) }),
        });
        const { buttonProps, inputProps, labelProps, listBoxProps } = useComboBox(
            {
                'aria-label': label ? String(label) : 'Combobox',
                buttonRef,
                inputRef,
                isDisabled: ctx.behavior.disabled,
                listBoxRef,
                popoverRef,
            },
            state,
        );
        return createElement(
            'div',
            {
                ...rest,
                className: cls('relative inline-block', stateCls.menu(ctx.behavior), i.className, className),
                ref,
                style: baseStyle(ctx, style),
            },
            label && createElement('label', { ...labelProps, className: 'block mb-1 text-sm font-medium' }, label),
            createElement(
                'div',
                { className: 'flex' },
                createElement('input', {
                    ...inputProps,
                    className: cls(
                        'flex-1 border border-r-0 rounded-l-md outline-none',
                        B.menu.var.itemH,
                        B.menu.var.itemPx,
                    ),
                    disabled: ctx.behavior.disabled,
                    placeholder,
                    ref: inputRef,
                }),
                createElement(
                    'button',
                    {
                        ...buttonProps,
                        className: cls('border rounded-r-md cursor-pointer px-2', B.menu.var.itemH),
                        disabled: ctx.behavior.disabled,
                        ref: buttonRef,
                        type: 'button',
                    },
                    '\u25BC',
                ),
            ),
            state.isOpen &&
                createElement(
                    'div',
                    {
                        className: dropdownCls,
                        ref: popoverRef,
                        style: { ...zStyle(ctx.overlay), marginTop: ctx.computed.dropdownGap, top: '100%' },
                    },
                    createElement(
                        'ul',
                        { ...listBoxProps, className: 'outline-none', ref: listBoxRef },
                        [...state.collection].map((item) => createElement(Option, { item, key: item.key, state })),
                    ),
                ),
        );
    });

// --- Dispatch Table ---------------------------------------------------------

const K: ReadonlyArray<'animation' | 'behavior' | 'overlay' | 'scale'> = ['animation', 'behavior', 'overlay', 'scale'];
const builders = { combobox: mkCombobox, menu: mkMenu, select: mkSelect } as const;

const createSel = <T extends SelectionType>(i: SelectionInput<T>) => {
    const ctx = createBuilderContext('menu', ['animation', 'behavior', 'overlay'] as const, i);
    const builder = builders[i.type ?? 'menu'];
    const comp = (builder as unknown as (i: SelectionInput<T>, ctx: Ctx) => ReturnType<typeof forwardRef>)(i, ctx);
    comp.displayName = `Selection(${i.type ?? 'menu'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createSelection = (tuning?: MenuTuning) =>
    Object.freeze({
        Combobox: createSel({ type: 'combobox', ...pick(tuning, K) } as SelectionInput<'combobox'>),
        create: <T extends SelectionType>(i: SelectionInput<T>) =>
            createSel({ ...i, ...merged(tuning, i, K) } as SelectionInput<T>),
        Menu: createSel({ type: 'menu', ...pick(tuning, K) } as SelectionInput<'menu'>),
        Select: createSel({ type: 'select', ...pick(tuning, K) } as SelectionInput<'select'>),
    });

// --- Export -----------------------------------------------------------------

export { createSelection };
export type { ComboboxProps, ItemData, MenuProps, SectionData, SelectionInput, SelectionType, SelectProps };
