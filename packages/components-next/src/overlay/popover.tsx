/**
 * Popover compound component with CVA variants and Motion animations.
 * Grounding: Compound pattern with React Aria accessibility.
 */
import type { HTMLMotionProps } from 'motion/react';
import { AnimatePresence, motion } from 'motion/react';
import {
    type CSSProperties,
    createContext,
    createElement,
    type FC,
    type ReactNode,
    type RefObject,
    useContext,
    useRef,
} from 'react';
import { DismissButton, mergeProps, useOverlay, usePopover } from 'react-aria';
import { useOverlayTriggerState } from 'react-stately';
import { cn } from '../core/variants.ts';
import {
    type PopoverPadding,
    type PopoverSide,
    popoverArrowVariants,
    popoverContentVariants,
} from './popover.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type PopoverContextValue = {
    readonly close: () => void;
    readonly isOpen: boolean;
    readonly toggle: () => void;
    readonly triggerRef: RefObject<HTMLButtonElement | null>;
};
type PopoverRootProps = {
    readonly children?: ReactNode;
    readonly defaultOpen?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
};
type PopoverTriggerProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type PopoverContentProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly padding?: PopoverPadding;
    readonly showArrow?: boolean;
    readonly side?: PopoverSide;
};
type PopoverCloseProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    content: {
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.95, y: -4 },
        initial: { opacity: 0, scale: 0.95, y: -4 },
        transition: { duration: 0.15, ease: 'easeOut' },
    },
    offset: 8,
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

const PopoverContext = createContext<PopoverContextValue | null>(null);
const usePopoverContext = (): PopoverContextValue => {
    const ctx = useContext(PopoverContext);
    if (!ctx) throw new Error('Popover.* must be used within Popover');
    return ctx;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toMotionDivProps = <T extends { style?: CSSProperties | undefined }>(props: T): HTMLMotionProps<'div'> => {
    const { style, ...rest } = props;
    return {
        ...rest,
        ...(style === undefined ? {} : { style }),
    } as HTMLMotionProps<'div'>;
};

// --- [COMPONENTS] ------------------------------------------------------------

const PopoverRoot: FC<PopoverRootProps> = ({ children, defaultOpen = false, onOpenChange, open }) => {
    const state = useOverlayTriggerState({
        defaultOpen,
        ...(open === undefined ? {} : { isOpen: open }),
        ...(onOpenChange === undefined ? {} : { onOpenChange }),
    });
    const triggerRef = useRef<HTMLButtonElement>(null);
    return createElement(
        PopoverContext.Provider,
        { value: { close: state.close, isOpen: state.isOpen, toggle: state.toggle, triggerRef } },
        createElement('div', { className: 'relative inline-block' }, children),
    );
};
PopoverRoot.displayName = 'Popover';

const PopoverTrigger: FC<PopoverTriggerProps> = ({ children, className }) => {
    const { isOpen, toggle, triggerRef } = usePopoverContext();
    return createElement(
        'button',
        {
            'aria-expanded': isOpen,
            'aria-haspopup': 'dialog',
            className,
            'data-state': isOpen ? 'open' : 'closed',
            onClick: toggle,
            ref: triggerRef,
            type: 'button',
        },
        children,
    );
};
PopoverTrigger.displayName = 'Popover.Trigger';

const PopoverContent: FC<PopoverContentProps> = ({
    children,
    className,
    padding,
    showArrow = false,
    side = 'bottom',
}) => {
    const { close, isOpen, triggerRef } = usePopoverContext();
    const ref = useRef<HTMLDivElement>(null);
    const { overlayProps } = useOverlay({ isDismissable: true, isOpen, onClose: close, shouldCloseOnBlur: true }, ref);
    const { popoverProps } = usePopover(
        { offset: B.offset, popoverRef: ref, triggerRef },
        { close, isOpen, open: () => {}, setOpen: () => {}, toggle: () => {} },
    );
    const sideStyles = {
        bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
        left: 'right-full top-1/2 -translate-y-1/2 mr-2',
        right: 'left-full top-1/2 -translate-y-1/2 ml-2',
        top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    } as const;
    // Transform props for motion compatibility
    const mergedProps = mergeProps(overlayProps, popoverProps);
    const motionProps = toMotionDivProps(mergedProps);
    return createElement(
        AnimatePresence,
        null,
        isOpen &&
            createElement(
                motion.div,
                {
                    ...motionProps,
                    ...B.content,
                    className: cn('absolute', sideStyles[side], popoverContentVariants({ padding, side }), className),
                    ref,
                } as HTMLMotionProps<'div'>,
                createElement(DismissButton, { onDismiss: close }),
                showArrow && createElement('div', { className: popoverArrowVariants({ side }) }),
                children,
                createElement(DismissButton, { onDismiss: close }),
            ),
    );
};
PopoverContent.displayName = 'Popover.Content';

const PopoverClose: FC<PopoverCloseProps> = ({ children, className }) => {
    const { close } = usePopoverContext();
    return createElement(
        'button',
        {
            className: cn('shrink-0', className),
            onClick: close,
            type: 'button',
        },
        children ??
            createElement(
                'svg',
                { className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                createElement('path', {
                    d: 'M6 18L18 6M6 6l12 12',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: 2,
                }),
            ),
    );
};
PopoverClose.displayName = 'Popover.Close';

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Popover = Object.assign(PopoverRoot, {
    Close: PopoverClose,
    Content: PopoverContent,
    Trigger: PopoverTrigger,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern
export { Popover, PopoverClose, PopoverContent, PopoverRoot, PopoverTrigger };
// biome-ignore lint/style/useComponentExportOnlyModules: Type exports for compound component
export type { PopoverCloseProps, PopoverContentProps, PopoverRootProps, PopoverTriggerProps };
