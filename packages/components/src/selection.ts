/**
 * Selection components: render combobox, menu, select with filtering and sections.
 * Uses B, utilities, animStyle, createBuilderContext from schema.ts with React Stately state.
 */

import { Check } from 'lucide-react';
import type {
    CSSProperties,
    FC,
    ForwardedRef,
    ForwardRefExoticComponent,
    HTMLAttributes,
    ReactNode,
    RefAttributes,
} from 'react';
import { createElement, forwardRef, useLayoutEffect, useRef, useState } from 'react';
import {
    DismissButton,
    FocusScope,
    useButton,
    useComboBox,
    useFilter,
    useHiddenSelect,
    useListBox,
    useMenu,
    useMenuItem,
    useMenuTrigger,
    useOption,
    useOverlay,
    useSelect,
} from 'react-aria';
import type { Selection as AriaSelection, Key, ListState, Node, TreeState } from 'react-stately';
import { Item, Section, useComboBoxState, useMenuTriggerState, useSelectState, useTreeState } from 'react-stately';
import type { Inputs, ResolvedContext, TuningFor } from './schema.ts';
import {
    animStyle,
    B,
    createBuilderContext,
    merged,
    pick,
    stateCls,
    TUNING_KEYS,
    useCollectionEl,
    useForwardedRef,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type SelectionType = 'combobox' | 'context' | 'menu' | 'select';
type ItemData = { readonly disabled?: boolean; readonly key: Key; readonly label: ReactNode };
type SectionData = { readonly items: ReadonlyArray<ItemData>; readonly key: Key; readonly title?: ReactNode };
type MenuProps = HTMLAttributes<HTMLDivElement> & {
    readonly disabledKeys?: Iterable<Key>;
    readonly items: ReadonlyArray<ItemData | SectionData>;
    readonly label?: string;
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
type ContextOptionData = { readonly icon?: ReactNode; readonly key: Key; readonly label: string };
type ContextSelectorProps = HTMLAttributes<HTMLDivElement> & {
    readonly label: string;
    readonly onChange: (key: Key) => void;
    readonly options: ReadonlyArray<ContextOptionData>;
    readonly value: Key;
};
type SelectionInput<T extends SelectionType = 'menu'> = {
    readonly className?: string;
    readonly scale?: Inputs['scale'];
    readonly type?: T;
} & Partial<TuningFor<'menu'>>;
type SelectionComponentMap = {
    readonly combobox: ForwardRefExoticComponent<ComboboxProps & RefAttributes<HTMLDivElement>>;
    readonly context: ForwardRefExoticComponent<ContextSelectorProps & RefAttributes<HTMLDivElement>>;
    readonly menu: ForwardRefExoticComponent<MenuProps & RefAttributes<HTMLDivElement>>;
    readonly select: ForwardRefExoticComponent<SelectProps & RefAttributes<HTMLDivElement>>;
};
type Ctx = ResolvedContext<'animation' | 'behavior' | 'overlay'>;

// --- [CONSTANTS] -------------------------------------------------------------

const selectionCls = {
    comboboxButton: utilities.cls('border cursor-pointer px-2 rounded-l-none', B.menu.var.triggerR, B.menu.var.itemH),
    comboboxInput: utilities.cls(
        'flex-1 border border-r-0 outline-none rounded-r-none',
        B.menu.var.triggerR,
        B.menu.var.itemH,
        B.menu.var.itemPx,
    ),
    contextTrigger: utilities.cls(
        'inline-flex items-center cursor-pointer transition-colors',
        B.menu.var.itemG,
        B.menu.var.itemPx,
        B.menu.var.itemPy,
        B.menu.var.itemR,
    ),
    dropdown: utilities.cls(
        'absolute overflow-hidden overflow-y-auto list-none m-0 min-w-fit',
        B.menu.var.dropdownPos,
        B.menu.var.dropdownBg,
        B.menu.var.dropdownR,
        B.menu.var.dropdownShadow,
        B.menu.var.dropdownMaxH,
        B.menu.var.dropdownPad,
    ),
    itemIconWrapper: utilities.cls('flex items-center', B.menu.var.itemIconG),
    label: utilities.cls('block', B.menu.var.labelMb, B.menu.var.labelFs, B.menu.var.labelFw),
    menuItem: 'flex w-full items-center justify-between cursor-pointer outline-none transition-colors',
    sectionHeader: utilities.cls(
        B.menu.section.header,
        B.menu.var.headerColor,
        B.menu.var.headerFs,
        B.menu.var.headerPx,
        B.menu.var.headerPy,
    ),
    sectionList: 'list-none m-0 p-0',
    sectionSeparator: utilities.cls(B.menu.section.separator, B.menu.var.separatorBg, B.menu.var.separatorSp),
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const baseStyle = (ctx: Ctx, style?: CSSProperties): CSSProperties => ({
    ...animStyle(ctx.animation),
    ...style,
});

type OptionProps<T> = { readonly item: Node<T>; readonly state: ListState<T> };
const Option = <T>({ item, state }: OptionProps<T>) => {
    const { merge, ref } = useCollectionEl<HTMLLIElement>(B.menu.item.focus);
    const { isDisabled, isFocused, isSelected, optionProps } = useOption({ key: item.key }, state, ref);
    return createElement(
        'li',
        {
            ...merge(
                optionProps,
                B.menu.item.base,
                B.menu.var.itemR,
                B.menu.var.itemFs,
                B.menu.var.itemH,
                B.menu.var.itemPx,
                B.menu.var.itemPy,
                B.menu.var.itemText,
                B.menu.var.itemFocusedBg,
                B.menu.var.itemSelectedBg,
                B.menu.var.itemSelectedText,
                isDisabled && B.menu.item.disabled,
            ),
            'data-focused': isFocused || undefined,
            'data-selected': isSelected || undefined,
        },
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
    const isSelected = state.selectionManager.isSelected(item.key);
    return createElement(
        'li',
        {
            ...merge(
                menuItemProps,
                selectionCls.menuItem,
                B.menu.var.itemG,
                B.menu.var.itemPx,
                B.menu.var.itemPy,
                B.menu.var.itemR,
                B.menu.var.itemFs,
                B.menu.var.itemText,
                B.menu.var.itemFocusedBg,
                B.menu.var.itemSelectedBg,
                B.menu.var.itemSelectedText,
                isDisabled && B.menu.item.disabled,
            ),
            'data-focused': isFocused || undefined,
            'data-selected': isSelected || undefined,
        },
        createElement('span', { className: selectionCls.itemIconWrapper }, item.rendered),
        isSelected &&
            createElement(Check, {
                className: utilities.cls('shrink-0', B.menu.var.checkColor, B.menu.var.checkSize),
            }),
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
        section.rendered && createElement('div', { className: selectionCls.sectionHeader }, section.rendered),
        createElement(
            'ul',
            { className: selectionCls.sectionList },
            [...section.childNodes].map((item) =>
                createElement(MenuItemComp, { item, key: item.key, onClose, state, ...(onAction && { onAction }) }),
            ),
        ),
        createElement('div', { className: selectionCls.sectionSeparator }),
    );

const isSection = (item: ItemData | SectionData): item is SectionData => 'items' in item;
const buildItems = (items: ReadonlyArray<ItemData>) =>
    items.map((itemData) =>
        createElement(Item as FC<{ children: ReactNode; key: Key; textValue: string }>, {
            // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
            children: itemData.label,
            key: itemData.key,
            textValue: String(itemData.label),
        }),
    );
const buildSections = (items: ReadonlyArray<ItemData | SectionData>) =>
    items.flatMap((itemData) =>
        isSection(itemData)
            ? createElement(Section as FC<{ children: ReactNode; key: Key; title: ReactNode }>, {
                  // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                  children: buildItems(itemData.items),
                  key: itemData.key,
                  title: itemData.title,
              })
            : createElement(Item as FC<{ children: ReactNode; key: Key; textValue: string }>, {
                  // biome-ignore lint/correctness/noChildrenProp: react-stately + exactOptionalPropertyTypes
                  children: itemData.label,
                  key: itemData.key,
                  textValue: String(itemData.label),
              }),
    );

const createMenuComponent = (input: SelectionInput<'menu'>, ctx: Ctx) =>
    forwardRef((props: MenuProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            disabledKeys,
            items,
            label,
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
            menuRef = useRef<HTMLUListElement>(null),
            overlayRef = useRef<HTMLDivElement>(null);
        const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
        const menuState = useMenuTriggerState({});
        useLayoutEffect(() => {
            menuState.isOpen && triggerRef.current && setTriggerWidth(triggerRef.current.offsetWidth);
        }, [menuState.isOpen]);
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
        const { overlayProps } = useOverlay(
            { isDismissable: true, isOpen: menuState.isOpen, onClose: closeHandler, shouldCloseOnBlur: true },
            overlayRef,
        );
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative inline-block [contain:layout]',
                    stateCls.menu(ctx.behavior),
                    input.className,
                    className,
                ),
                ref,
                style: baseStyle(ctx, style),
            },
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: utilities.cls(B.menu.trigger.base, 'cursor-pointer'),
                    'data-state': menuState.isOpen ? 'open' : 'closed',
                    disabled: ctx.behavior.disabled,
                    ref: triggerRef,
                    type: 'button',
                },
                trigger,
            ),
            menuState.isOpen &&
                createElement(
                    FocusScope,
                    { contain: true, restoreFocus: true } as Parameters<typeof FocusScope>[0],
                    createElement(
                        'div',
                        { ...overlayProps, ref: overlayRef },
                        createElement(DismissButton, { onDismiss: closeHandler }),
                        createElement(
                            'ul',
                            {
                                ...menuProps,
                                ...triggerMenuProps,
                                className: utilities.cls(selectionCls.dropdown, B.menu.var.dropdownGap),
                                ref: menuRef,
                                style: {
                                    ...utilities.zStyle(ctx.overlay),
                                    top: '100%',
                                    width: triggerWidth ?? undefined,
                                },
                            },
                            label && createElement('li', { className: selectionCls.sectionHeader }, label),
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
                        createElement(DismissButton, { onDismiss: closeHandler }),
                    ),
                ),
        );
    });

const createSelectComponent = (input: SelectionInput<'select'>, ctx: Ctx) =>
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
        const { labelProps, triggerProps, valueProps } = useSelect(
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
        const { listBoxProps } = useListBox(
            { 'aria-label': label ? String(label) : 'Select options' },
            state,
            listBoxRef,
        );
        const triggerCls = utilities.cls(
            B.menu.trigger.base,
            B.menu.var.triggerR,
            B.menu.var.itemH,
            B.menu.var.triggerMinW,
            B.menu.var.itemPx,
            'border cursor-pointer w-full text-left',
            isInvalid && 'border-[var(--error-color)]',
        );
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative inline-flex',
                    stateCls.menu(ctx.behavior),
                    input.className,
                    className,
                ),
                ref,
                style: baseStyle(ctx, style),
            },
            label && createElement('label', { ...labelProps, className: selectionCls.label }, label),
            createElement('input', selectProps),
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: triggerCls,
                    'data-state': state.isOpen ? 'open' : 'closed',
                    disabled: ctx.behavior.disabled,
                    ref: triggerRef,
                    type: 'button',
                },
                createElement(
                    'span',
                    { ...valueProps, className: utilities.cls(!state.selectedItem && 'opacity-50') },
                    state.selectedItem?.rendered ?? placeholder,
                ),
                createElement('span', { className: B.menu.trigger.indicator }, '\u25BC'),
            ),
            state.isOpen &&
                createElement(
                    'ul',
                    {
                        ...listBoxProps,
                        className: utilities.cls(selectionCls.dropdown, B.menu.var.dropdownGap),
                        ref: listBoxRef,
                        style: { ...utilities.zStyle(ctx.overlay), top: '100%' },
                    },
                    [...state.collection].map((item) => createElement(Option, { item, key: item.key, state })),
                ),
            isInvalid &&
                errorMessage &&
                createElement('div', { className: 'text-[var(--error-color)] text-sm mt-1' }, errorMessage),
        );
    });

const createComboboxComponent = (input: SelectionInput<'combobox'>, ctx: Ctx) =>
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
        const { buttonProps, inputProps, labelProps } = useComboBox(
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
        const { listBoxProps } = useListBox(
            { 'aria-label': label ? String(label) : 'Combobox options' },
            state,
            listBoxRef,
        );
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative inline-flex',
                    stateCls.menu(ctx.behavior),
                    input.className,
                    className,
                ),
                ref,
                style: baseStyle(ctx, style),
            },
            label && createElement('label', { ...labelProps, className: selectionCls.label }, label),
            createElement(
                'div',
                { className: 'flex' },
                createElement('input', {
                    ...inputProps,
                    className: selectionCls.comboboxInput,
                    disabled: ctx.behavior.disabled,
                    placeholder,
                    ref: inputRef,
                }),
                createElement(
                    'button',
                    {
                        ...buttonProps,
                        className: selectionCls.comboboxButton,
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
                        className: utilities.cls(selectionCls.dropdown, B.menu.var.dropdownGap),
                        ref: popoverRef,
                        style: { ...utilities.zStyle(ctx.overlay), top: '100%' },
                    },
                    createElement(
                        'ul',
                        { ...listBoxProps, className: 'outline-none', ref: listBoxRef },
                        [...state.collection].map((item) => createElement(Option, { item, key: item.key, state })),
                    ),
                ),
        );
    });

const createContextSelectorComponent = (input: SelectionInput<'context'>, ctx: Ctx) =>
    forwardRef((props: ContextSelectorProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, label, onChange, options, style, value, ...rest } = props;
        const ref = useForwardedRef(fRef),
            triggerRef = useRef<HTMLButtonElement>(null),
            menuRef = useRef<HTMLUListElement>(null),
            overlayRef = useRef<HTMLDivElement>(null);
        const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
        const menuState = useMenuTriggerState({});
        useLayoutEffect(() => {
            menuState.isOpen && triggerRef.current && setTriggerWidth(triggerRef.current.offsetWidth);
        }, [menuState.isOpen]);
        const selected = options.find((o) => o.key === value) ?? options[0];
        const items = options.map((opt) => ({
            key: opt.key,
            label: createElement('span', { className: selectionCls.itemIconWrapper }, opt.icon, opt.label),
        }));
        const { menuProps: triggerMenuProps, menuTriggerProps } = useMenuTrigger({}, menuState, triggerRef);
        const treeState = useTreeState({
            children: buildSections(items),
            selectedKeys: new Set([value]),
            selectionMode: 'single',
        });
        const { menuProps } = useMenu(
            { 'aria-label': label, onAction: (key) => onChange(key), onClose: menuState.close },
            treeState,
            menuRef,
        );
        const { buttonProps } = useButton(menuTriggerProps, triggerRef);
        const { overlayProps } = useOverlay(
            { isDismissable: true, isOpen: menuState.isOpen, onClose: menuState.close, shouldCloseOnBlur: true },
            overlayRef,
        );
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative inline-block [contain:layout]',
                    stateCls.menu(ctx.behavior),
                    input.className,
                    className,
                ),
                ref,
                style: baseStyle(ctx, style),
            },
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: selectionCls.contextTrigger,
                    'data-state': menuState.isOpen ? 'open' : 'closed',
                    disabled: ctx.behavior.disabled,
                    ref: triggerRef,
                    type: 'button',
                },
                selected?.icon &&
                    createElement(
                        'span',
                        { className: utilities.cls('inline-flex items-center', B.menu.var.triggerLabelColor) },
                        selected.icon,
                    ),
                createElement(
                    'span',
                    { className: utilities.cls(B.menu.var.labelFs, B.menu.var.triggerLabelColor) },
                    label,
                ),
                createElement(
                    'span',
                    { className: utilities.cls(B.menu.var.itemFs, B.menu.var.triggerValueColor) },
                    selected?.label,
                ),
                createElement(
                    'span',
                    {
                        className: utilities.cls(
                            'inline-flex items-center',
                            B.menu.trigger.indicator,
                            B.menu.var.triggerLabelColor,
                        ),
                    },
                    '\u25BC',
                ),
            ),
            menuState.isOpen &&
                createElement(
                    FocusScope,
                    { contain: true, restoreFocus: true } as Parameters<typeof FocusScope>[0],
                    createElement(
                        'div',
                        { ...overlayProps, ref: overlayRef },
                        createElement(DismissButton, { onDismiss: menuState.close }),
                        createElement(
                            'ul',
                            {
                                ...menuProps,
                                ...triggerMenuProps,
                                className: utilities.cls(selectionCls.dropdown, B.menu.var.dropdownGap),
                                ref: menuRef,
                                style: {
                                    ...utilities.zStyle(ctx.overlay),
                                    top: '100%',
                                    width: triggerWidth ?? undefined,
                                },
                            },
                            [...treeState.collection].map((item) =>
                                createElement(MenuItemComp, {
                                    item,
                                    key: item.key,
                                    onClose: menuState.close,
                                    state: treeState,
                                }),
                            ),
                        ),
                        createElement(DismissButton, { onDismiss: menuState.close }),
                    ),
                ),
        );
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    combobox: createComboboxComponent,
    context: createContextSelectorComponent,
    menu: createMenuComponent,
    select: createSelectComponent,
} as const;

const createSelectionComponent = <T extends SelectionType>(input: SelectionInput<T>): SelectionComponentMap[T] => {
    const ctx = createBuilderContext('menu', ['animation', 'behavior', 'overlay'] as const, input);
    const selectionType = (input.type ?? 'menu') as T;
    const builder = builderHandlers[selectionType];
    const component = (builder as unknown as (input: SelectionInput<T>, ctx: Ctx) => SelectionComponentMap[T])(
        input,
        ctx,
    );
    component.displayName = `Selection(${selectionType})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createSelection = (tuning?: TuningFor<'menu'>) =>
    Object.freeze({
        Combobox: createSelectionComponent({
            type: 'combobox',
            ...pick(tuning, TUNING_KEYS.menu),
        } as SelectionInput<'combobox'>),
        ContextSelector: createSelectionComponent({
            type: 'context',
            ...pick(tuning, TUNING_KEYS.menu),
        } as SelectionInput<'context'>),
        create: <T extends SelectionType>(input: SelectionInput<T>) =>
            createSelectionComponent({
                ...input,
                ...merged(tuning, input, TUNING_KEYS.menu),
            } as SelectionInput<T>),
        Menu: createSelectionComponent({
            type: 'menu',
            ...pick(tuning, TUNING_KEYS.menu),
        } as SelectionInput<'menu'>),
        Select: createSelectionComponent({
            type: 'select',
            ...pick(tuning, TUNING_KEYS.menu),
        } as SelectionInput<'select'>),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createSelection };
export type {
    ComboboxProps,
    ContextOptionData,
    ContextSelectorProps,
    ItemData,
    MenuProps,
    SectionData,
    SelectionInput,
    SelectionType,
    SelectProps,
};
