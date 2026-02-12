/**
 * Hierarchical navigation with expand/collapse and lazy loading.
 * Compound component: Tree.Item, Tree.ItemContent, Tree.Group.
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { ChevronRight } from 'lucide-react';
import { createContext, type FC, type ReactNode, type Ref, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Key, TreeProps as RACTreeProps, TreeItemProps as RACTreeItemProps, TreeItemContentProps as RACTreeItemContentProps, TreeItemRenderProps as RACTreeItemRenderProps } from 'react-aria-components';
import { Collection, Tree as RACTree, TreeItem as RACTreeItem, TreeItemContent as RACTreeItemContentInner } from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import type { SlotInput } from '../core/utils';
import { cn, composeTailwindRenderProps, defined, Slot } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type TreeContextValue = { readonly color: string | undefined; readonly size: string | undefined; readonly variant: string | undefined; };
type TreeProps<T extends object> = Omit<RACTreeProps<T>, 'children'> & {
    readonly children: ReactNode | ((item: T) => ReactNode);
    readonly color?: string;
    readonly size?: string;
    readonly variant?: string;
};
type TreeItemProps<T extends object = object> = Omit<RACTreeItemProps<T>, 'children' | 'id' | 'textValue'> & {
    readonly children?: ReactNode;                    // Narrowed from RAC's union type
    readonly id: Key;                                 // Required (RAC has optional)
    readonly textValue?: string;                      // Optional (RAC has required, we auto-derive from title)
    // Our additions only:
    readonly actions?: SlotInput<ReactNode>;
    readonly asyncState?: AsyncState;
    readonly gesture?: GestureProps;
    readonly hideIndicator?: boolean;
    readonly indicator?: SlotInput;
    readonly prefix?: SlotInput;
    readonly title?: ReactNode;
    readonly tooltip?: TooltipConfig;
};
type TreeItemStateContextValue = {
    readonly hasChildren: boolean;
    readonly isDisabled: boolean;
    readonly isExpanded: boolean;
    readonly isFocusVisible: boolean;
    readonly isSelected: boolean;
};
type TreeItemContentProps = Omit<RACTreeItemContentProps, 'children'> & {
    readonly actions?: SlotInput<ReactNode>;
    readonly asyncState?: AsyncState;
    readonly children?: SlotInput<ReactNode>;
    readonly className?: string;
    readonly color?: string;
    readonly gesture?: GestureProps;
    readonly hasChildren?: boolean;
    readonly hideIndicator?: boolean;
    readonly indicator?: SlotInput;
    readonly prefix?: SlotInput;
    readonly ref?: Ref<HTMLDivElement>;
    readonly size?: string;
    readonly tooltip?: TooltipConfig;
    readonly variant?: string;
};
type TreeGroupProps<T extends object = object> = {
    readonly children: ReactNode | ((item: T) => ReactNode);
    readonly className?: string;
    readonly items?: Iterable<T>;
    readonly lazy?: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    slot: {
        actions: cn(
            'ml-auto flex items-center gap-(--tree-item-content-actions-gap)',
            'opacity-0 transition-opacity duration-(--tree-animation-duration)',
            'group-hovered/tree-content:opacity-100 group-focus-visible/tree-content:opacity-100',
        ),
        content: cn(
            'group/tree-content inline-flex items-center flex-1 cursor-pointer outline-none',
            'h-(--tree-item-content-height) px-(--tree-item-content-px) gap-(--tree-item-content-gap)',
            'text-(--tree-item-content-font-size) font-(--tree-item-content-font-weight)',
            'bg-(--tree-item-content-bg) text-(--tree-item-content-fg)',
            'rounded-(--tree-item-content-radius)',
            'transition-colors duration-(--tree-animation-duration) ease-(--tree-animation-easing)',
            'hovered:bg-(--tree-item-content-hover-bg)',
            'pressed:bg-(--tree-item-content-pressed-bg)',
            'selected:bg-(--tree-item-content-selected-bg) selected:text-(--tree-item-content-selected-fg)',
            'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color) focus-visible:ring-offset-(--focus-ring-offset)',
            'disabled:pointer-events-none disabled:opacity-(--tree-item-content-disabled-opacity)',
        ),
        group: cn(
            'flex flex-col',
            'pl-(--tree-indent)',
        ),
        indicator: cn(
            'size-(--tree-item-content-indicator-size) shrink-0',
            'transition-transform duration-(--tree-animation-duration) ease-(--tree-animation-easing)',
            'text-(--tree-item-content-indicator-color)',
            'group-data-[expanded]/tree-item:rotate-(--tree-item-content-indicator-rotation)',
        ),
        item: cn(
            'group/tree-item',
            'outline-none',
        ),
        label: cn('flex-1 truncate text-left'),
        prefix: cn('size-(--tree-item-content-icon-size) shrink-0'),
        root: cn(
            'flex flex-col w-full',
            'gap-(--tree-gap)',
            'text-(--tree-font-size)',
        ),
    },
} as const;
const TreeContext = createContext<TreeContextValue | null>(null);
const TreeItemStateContext = createContext<TreeItemStateContextValue | null>(null);

// --- [SUB-COMPONENTS] --------------------------------------------------------

const TreeItemContent: FC<TreeItemContentProps> = ({
    actions, asyncState, children, className, color, gesture, hasChildren: hasChildrenProp, hideIndicator, indicator, prefix, ref,
    size, tooltip, variant, }) => {
    const ctx = useContext(TreeContext);
    const itemState = useContext(TreeItemStateContext);
    const slot = Slot.bind(asyncState);
    const contentRef = useRef<HTMLDivElement>(null);
    const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
    const { props: gestureProps } = useGesture({
        isDisabled: itemState?.isDisabled ?? false,
        prefix: 'tree-item',
        ref: contentRef,
        ...gesture,
        ...(gesture?.longPress && { longPress: { haptic: true, ...gesture.longPress } }),
    });
    const mergedRef = useMergeRefs([ref, contentRef, tooltipProps.ref as Ref<HTMLDivElement>]);
    const hasChildren = hasChildrenProp ?? itemState?.hasChildren ?? false;
    const isExpanded = itemState?.isExpanded ?? false;
    const isSelected = itemState?.isSelected ?? false;
    const isDisabled = itemState?.isDisabled ?? false;
    const isFocusVisible = itemState?.isFocusVisible ?? false;
    return (
        <>
            <div
                {...(tooltipProps as object)}
                {...(gestureProps as object)}
                className={cn(_B.slot.content, className)}
                data-async-state={slot.attr}
                data-color={color ?? ctx?.color}
                data-disabled={isDisabled || undefined}
                data-expanded={isExpanded || undefined}
                data-focus-visible={isFocusVisible || undefined}
                data-has-children={hasChildren || undefined}
                data-selected={isSelected || undefined}
                data-size={size ?? ctx?.size}
                data-slot="tree-item-content"
                data-variant={variant ?? ctx?.variant}
                ref={mergedRef}
            >
                {!hideIndicator && hasChildren && (
                    <span
                        aria-hidden="true"
                        className={_B.slot.indicator}
                        data-expanded={isExpanded || undefined}
                    >
                        {Slot.content(Slot.resolve(indicator, asyncState)) ?? <ChevronRight />}
                    </span>
                )}
                {!hideIndicator && !hasChildren && (
                    <span aria-hidden="true" className={_B.slot.indicator} style={{ visibility: 'hidden' }} />
                )}
                {slot.render(prefix, _B.slot.prefix)}
                <span className={_B.slot.label}>{slot.resolve(children)}</span>
                {actions && <span className={_B.slot.actions}>{slot.resolve(actions)}</span>}
            </div>
            {renderTooltip?.()}
            <AsyncAnnouncer asyncState={asyncState} />
        </>
    );
};
const TreeItemStateProviderInner: FC<{ readonly children: ReactNode; readonly renderProps: RACTreeItemRenderProps }> = ({ children, renderProps }) => {
    const value = useMemo(() => ({
        hasChildren: renderProps.hasChildItems,
        isDisabled: renderProps.isDisabled,
        isExpanded: renderProps.isExpanded,
        isFocusVisible: renderProps.isFocusVisible,
        isSelected: renderProps.isSelected,
    }), [renderProps.hasChildItems, renderProps.isDisabled, renderProps.isExpanded, renderProps.isFocusVisible, renderProps.isSelected]);
    return <TreeItemStateContext.Provider value={value}>{children}</TreeItemStateContext.Provider>;
};
const TreeItemStateProvider: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <RACTreeItemContentInner>
        {(renderProps: RACTreeItemRenderProps) => ( <TreeItemStateProviderInner renderProps={renderProps}>{children}</TreeItemStateProviderInner> )}
    </RACTreeItemContentInner>
);
const TreeItem = <T extends object = object>({
    actions, asyncState, children, className, gesture, hideIndicator, id, indicator, isDisabled,
    prefix, textValue, title, tooltip, ...rest }: TreeItemProps<T>): ReactNode => {
    const ctx = useContext(TreeContext);
    const resolvedTextValue = textValue ?? (typeof title === 'string' ? title : String(id));
    return (
        <RACTreeItem<T>
            {...(rest as object)}
            className={composeTailwindRenderProps(className, _B.slot.item)}
            data-color={ctx?.color}
            data-size={ctx?.size}
            data-slot="tree-item"
            data-variant={ctx?.variant}
            id={id}
            {...defined({ isDisabled })}
            textValue={resolvedTextValue}
        >
            <TreeItemStateProvider>
                {title !== undefined && (
                    <TreeItemContent
                        {...defined({ actions, asyncState, gesture, hideIndicator, indicator, prefix, tooltip })}
                    >
                        {title}
                    </TreeItemContent>
                )}
                {children}
            </TreeItemStateProvider>
        </RACTreeItem>
    );
};
const TreeGroup = <T extends object = object>({ children, className, items, lazy = true }: TreeGroupProps<T>): ReactNode => {
    const itemState = useContext(TreeItemStateContext);
    const isExpanded = itemState?.isExpanded ?? true;
    const [hasExpanded, setHasExpanded] = useState(!lazy || isExpanded);
    useEffect(() => { isExpanded && !hasExpanded && setHasExpanded(true); }, [isExpanded, hasExpanded]);
    const content = items === undefined
        ? children as ReactNode
        : <Collection items={items}>{children as (item: T) => ReactNode}</Collection>;
    return (
        <div className={cn(_B.slot.group, className)} data-slot="tree-group">
            {hasExpanded ? content : null}
        </div>
    );
};

// --- [ROOT COMPONENT] --------------------------------------------------------

const TreeRoot = <T extends object>({ children, className, color, size, variant, ...rest }: TreeProps<T>): ReactNode => {
    const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
    return (
        <TreeContext.Provider value={contextValue}>
            <RACTree<T>
                {...(rest as RACTreeProps<T>)}
                className={composeTailwindRenderProps(className, _B.slot.root)}
                data-color={color}
                data-size={size}
                data-slot="tree"
                data-variant={variant}
            >
                {children}
            </RACTree>
        </TreeContext.Provider>
    );
};

// --- [COMPOUND COMPONENT] ----------------------------------------------------

const Tree = Object.assign(TreeRoot, {
    Group: TreeGroup,
    Item: TreeItem,
    ItemContent: TreeItemContent,
    useContext: (): TreeContextValue | null => useContext(TreeContext),
    useItemState: (): TreeItemStateContextValue | null => useContext(TreeItemStateContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Tree };
export type { TreeGroupProps, TreeItemContentProps, TreeItemProps, TreeProps };
