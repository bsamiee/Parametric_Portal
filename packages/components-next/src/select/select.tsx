/**
 * Select compound component with CVA variants and Motion animations.
 * Grounding: Compound pattern with React Aria/Stately accessibility.
 */

import type { HTMLMotionProps } from 'motion/react';
import { AnimatePresence, motion } from 'motion/react';
import {
    type CSSProperties,
    createContext,
    createElement,
    type FC,
    forwardRef,
    type Key,
    type ReactNode,
    type RefObject,
    useContext,
    useRef,
} from 'react';
import type { AriaSelectOptions } from 'react-aria';
import { HiddenSelect, mergeProps, useButton, useFocusRing, useListBox, useOption, useSelect } from 'react-aria';
import type { SelectState } from 'react-stately';
import { useSelectState } from 'react-stately';
import { getMotionConfig } from '../core/motion.ts';
import { cn } from '../core/variants.ts';
import {
    type SelectSize,
    selectContentVariants,
    selectItemVariants,
    selectTriggerVariants,
} from './select.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type SelectContextValue<T extends object = object> = {
    readonly listBoxRef: RefObject<HTMLUListElement | null>;
    readonly size: SelectSize;
    readonly state: SelectState<T>;
    readonly triggerRef: RefObject<HTMLButtonElement | null>;
};
type SelectRootProps<T extends object = object> = AriaSelectOptions<T> & {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly size?: SelectSize;
};
type SelectTriggerProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly placeholder?: string;
};
type SelectContentProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type SelectItemProps<T extends object = object> = {
    readonly className?: string;
    readonly item: { key: Key; rendered: ReactNode; textValue?: string } & T;
};
type SelectValueProps = {
    readonly className?: string;
    readonly placeholder?: string;
};
type SelectIconProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};

// --- [CONTEXT] ---------------------------------------------------------------

const SelectContext = createContext<SelectContextValue | null>(null);
const useSelectContext = <T extends object = object>(): SelectContextValue<T> => {
    const ctx = useContext(SelectContext);
    if (!ctx) throw new Error('Select.* must be used within Select.Root');
    return ctx as SelectContextValue<T>;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toMotionListProps = <T extends { style?: CSSProperties | undefined }>(props: T): HTMLMotionProps<'ul'> => {
    const { style, ...rest } = props;
    return {
        ...rest,
        ...(style === undefined ? {} : { style }),
    } as HTMLMotionProps<'ul'>;
};

// --- [COMPONENTS] ------------------------------------------------------------

const SelectRoot = <T extends object>({
    children,
    className,
    size = 'md',
    ...ariaProps
}: SelectRootProps<T>): ReactNode => {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);
    const state = useSelectState(ariaProps);
    const hiddenSelectProps = {
        isDisabled: ariaProps.isDisabled ?? false,
        label: ariaProps.label,
        state,
        triggerRef,
        ...(ariaProps.name === undefined ? {} : { name: ariaProps.name }),
    };
    return createElement(
        SelectContext.Provider,
        { value: { listBoxRef, size, state, triggerRef } as SelectContextValue },
        createElement(
            'div',
            { className: cn('relative', className) },
            createElement(HiddenSelect, hiddenSelectProps),
            children,
        ),
    );
};

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
    ({ children, className, placeholder = 'Select...' }, forwardedRef) => {
        const { size, state, triggerRef } = useSelectContext();
        const resolvedRef = (forwardedRef ?? triggerRef) as RefObject<HTMLButtonElement>;
        const { triggerProps } = useSelect({}, state, resolvedRef);
        const { buttonProps } = useButton(triggerProps, resolvedRef);
        const { focusProps, isFocusVisible } = useFocusRing();
        const selectedKey = state.selectionManager.firstSelectedKey;
        const selectedItem = selectedKey === null ? null : state.collection.getItem(selectedKey);
        return createElement(
            'button',
            {
                ...mergeProps(buttonProps, focusProps),
                className: cn(selectTriggerVariants({ size }), className),
                'data-focus-visible': isFocusVisible || undefined,
                'data-state': state.isOpen ? 'open' : 'closed',
                ref: resolvedRef,
                type: 'button',
            },
            children ??
                createElement(
                    'span',
                    { className: selectedItem ? '' : 'text-[var(--color-text-200)]/50' },
                    selectedItem ? selectedItem.rendered : placeholder,
                ),
            createElement(
                'span',
                {
                    className: 'shrink-0 transition-transform data-[state=open]:rotate-180',
                    'data-state': state.isOpen ? 'open' : 'closed',
                },
                createElement(
                    'svg',
                    { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                    createElement('path', {
                        d: 'M6 9l6 6 6-6',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: 2,
                    }),
                ),
            ),
        );
    },
);
SelectTrigger.displayName = 'Select.Trigger';

const SelectContent: FC<SelectContentProps> = ({ children, className }) => {
    const { listBoxRef, state } = useSelectContext();
    const { listBoxProps } = useListBox({}, state, listBoxRef);
    const motionConfig = getMotionConfig('slideDown', 'fast');
    const baseProps = toMotionListProps({
        ...listBoxProps,
        className: cn(selectContentVariants(), 'p-1', className),
        ref: listBoxRef,
    });
    return createElement(
        AnimatePresence,
        null,
        state.isOpen &&
            createElement(
                motion.ul,
                {
                    ...baseProps,
                    animate: motionConfig.animate,
                    exit: motionConfig.exit,
                    initial: motionConfig.initial,
                    transition: motionConfig.transition,
                } as HTMLMotionProps<'ul'>,
                children ??
                    [...state.collection].map((item) => createElement(SelectItem, { item, key: String(item.key) })),
            ),
    );
};
SelectContent.displayName = 'Select.Content';

const SelectItem = <T extends object>({ className, item }: SelectItemProps<T>): ReactNode => {
    const { size, state } = useSelectContext<T>();
    const ref = useRef<HTMLLIElement>(null);
    const keyValue = typeof item.key === 'bigint' ? String(item.key) : item.key;
    const { optionProps, isSelected, isFocused, isDisabled } = useOption({ key: keyValue }, state, ref);
    return createElement(
        'li',
        {
            ...optionProps,
            className: cn(selectItemVariants({ size }), className),
            'data-disabled': isDisabled || undefined,
            'data-focused': isFocused || undefined,
            'data-selected': isSelected || undefined,
            ref,
        },
        item.rendered,
        isSelected &&
            createElement(
                'span',
                { className: 'absolute right-2' },
                createElement(
                    'svg',
                    { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                    createElement('path', {
                        d: 'M5 13l4 4L19 7',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: 2,
                    }),
                ),
            ),
    );
};

const SelectValue: FC<SelectValueProps> = ({ className, placeholder = 'Select...' }) => {
    const { state } = useSelectContext();
    const selectedKey = state.selectionManager.firstSelectedKey;
    const selectedItem = selectedKey === null ? null : state.collection.getItem(selectedKey);
    return createElement(
        'span',
        { className: cn(selectedItem ? '' : 'text-[var(--color-text-200)]/50', className) },
        selectedItem ? selectedItem.rendered : placeholder,
    );
};
SelectValue.displayName = 'Select.Value';

const SelectIcon: FC<SelectIconProps> = ({ children, className }) => {
    const { state } = useSelectContext();
    return createElement(
        'span',
        {
            className: cn('shrink-0 transition-transform', state.isOpen && 'rotate-180', className),
            'data-state': state.isOpen ? 'open' : 'closed',
        },
        children ??
            createElement(
                'svg',
                { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                createElement('path', {
                    d: 'M6 9l6 6 6-6',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: 2,
                }),
            ),
    );
};
SelectIcon.displayName = 'Select.Icon';

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Select = Object.assign(SelectRoot, {
    Content: SelectContent,
    Icon: SelectIcon,
    Item: SelectItem,
    Trigger: SelectTrigger,
    Value: SelectValue,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
export { Select, SelectContent, SelectIcon, SelectItem, SelectRoot, SelectTrigger, SelectValue };

export type {
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectContentProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectIconProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectItemProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectRootProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectTriggerProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SelectValueProps,
};
