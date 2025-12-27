/**
 * Dialog compound component with CVA variants and Motion animations.
 * Grounding: Compound pattern with React Aria accessibility.
 */
import type { HTMLMotionProps } from 'motion/react';
import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, createContext, createElement, type FC, type ReactNode, useContext, useRef } from 'react';
import { mergeProps, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import { useOverlayTriggerState } from 'react-stately';
import { cn } from '../core/variants.ts';
import {
    type DialogPosition,
    type DialogSize,
    dialogBackdropVariants,
    dialogContentVariants,
    dialogDescriptionVariants,
    dialogFooterVariants,
    dialogHeaderVariants,
    dialogTitleVariants,
} from './dialog.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type DialogContextValue = {
    readonly close: () => void;
    readonly isOpen: boolean;
    readonly titleId: string;
};
type DialogRootProps = {
    readonly children?: ReactNode;
    readonly defaultOpen?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
};
type DialogTriggerProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type DialogContentProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly position?: DialogPosition;
    readonly size?: DialogSize;
};
type DialogHeaderProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type DialogTitleProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type DialogDescriptionProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type DialogFooterProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type DialogCloseProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    backdrop: {
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        initial: { opacity: 0 },
        transition: { duration: 0.15 },
    },
    content: {
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        initial: { opacity: 0, scale: 0.95 },
        transition: { duration: 0.2, ease: 'easeOut' },
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

const DialogContext = createContext<DialogContextValue | null>(null);
const useDialogContext = (): DialogContextValue => {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('Dialog.* must be used within Dialog');
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

const DialogRoot: FC<DialogRootProps> = ({ children, defaultOpen = false, onOpenChange, open }) => {
    const state = useOverlayTriggerState({
        defaultOpen,
        ...(open === undefined ? {} : { isOpen: open }),
        ...(onOpenChange === undefined ? {} : { onOpenChange }),
    });
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 9)}`;
    return createElement(
        DialogContext.Provider,
        { value: { close: state.close, isOpen: state.isOpen, titleId } },
        children,
    );
};
DialogRoot.displayName = 'Dialog';

const DialogTrigger: FC<DialogTriggerProps> = ({ children, className }) => {
    const ctx = useContext(DialogContext);
    const isOpen = ctx?.isOpen ?? false;
    return createElement(
        'button',
        {
            className,
            'data-state': isOpen ? 'open' : 'closed',
            onClick: () => ctx && !ctx.isOpen,
            type: 'button',
        },
        children,
    );
};
DialogTrigger.displayName = 'Dialog.Trigger';

const DialogContent: FC<DialogContentProps> = ({ children, className, position, size }) => {
    const { close, isOpen, titleId } = useDialogContext();
    const ref = useRef<HTMLDivElement>(null);
    const { overlayProps, underlayProps } = useOverlay({ isDismissable: true, isOpen, onClose: close }, ref);
    const { modalProps } = useModal();
    const { dialogProps } = useDialog({ 'aria-labelledby': titleId }, ref);
    usePreventScroll({ isDisabled: !isOpen });
    // Transform props for motion compatibility
    const underlayMotionProps = toMotionDivProps(underlayProps);
    const mergedDialogProps = mergeProps(overlayProps, modalProps, dialogProps);
    const dialogMotionProps = toMotionDivProps(mergedDialogProps);
    return createElement(
        AnimatePresence,
        null,
        isOpen &&
            createElement(
                'div',
                { className: 'fixed inset-0 z-50' },
                createElement(motion.div, {
                    ...underlayMotionProps,
                    ...B.backdrop,
                    className: cn(dialogBackdropVariants(), 'cursor-pointer'),
                    onClick: close,
                } as HTMLMotionProps<'div'>),
                createElement(
                    motion.div,
                    {
                        ...dialogMotionProps,
                        ...B.content,
                        className: cn(dialogContentVariants({ position, size }), className),
                        ref,
                    } as HTMLMotionProps<'div'>,
                    children,
                ),
            ),
    );
};
DialogContent.displayName = 'Dialog.Content';

const DialogHeader: FC<DialogHeaderProps> = ({ children, className }) =>
    createElement('div', { className: cn(dialogHeaderVariants(), className) }, children);
DialogHeader.displayName = 'Dialog.Header';

const DialogTitle: FC<DialogTitleProps> = ({ children, className }) => {
    const { titleId } = useDialogContext();
    return createElement('h2', { className: cn(dialogTitleVariants(), className), id: titleId }, children);
};
DialogTitle.displayName = 'Dialog.Title';

const DialogDescription: FC<DialogDescriptionProps> = ({ children, className }) =>
    createElement('p', { className: cn(dialogDescriptionVariants(), className) }, children);
DialogDescription.displayName = 'Dialog.Description';

const DialogFooter: FC<DialogFooterProps> = ({ children, className }) =>
    createElement('div', { className: cn(dialogFooterVariants(), className) }, children);
DialogFooter.displayName = 'Dialog.Footer';

const DialogClose: FC<DialogCloseProps> = ({ children, className }) => {
    const { close } = useDialogContext();
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
DialogClose.displayName = 'Dialog.Close';

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Dialog = Object.assign(DialogRoot, {
    Close: DialogClose,
    Content: DialogContent,
    Description: DialogDescription,
    Footer: DialogFooter,
    Header: DialogHeader,
    Title: DialogTitle,
    Trigger: DialogTrigger,
});

// --- [EXPORT] ----------------------------------------------------------------

export {
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogRoot,
    DialogTitle,
    DialogTrigger,
};
export type {
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogCloseProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogContentProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogDescriptionProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogFooterProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogHeaderProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogRootProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogTitleProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    DialogTriggerProps,
};
