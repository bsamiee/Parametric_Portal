/**
 * Panel compound component with collapsible animation.
 * Grounding: Compound pattern with Motion AnimatePresence.
 */
import { AnimatePresence, motion } from 'motion/react';
import { createContext, createElement, type FC, type ReactNode, useContext } from 'react';
import { cn } from '../core/variants.ts';
import { panelContentVariants, panelHeaderVariants, panelRootVariants } from './panel.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type PanelContextValue = {
    readonly isOpen: boolean;
    readonly onToggle: () => void;
};
type PanelRootProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly defaultOpen?: boolean;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
    readonly rounded?: boolean;
};
type PanelHeaderProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly size?: 'sm' | 'md' | 'lg';
};
type PanelContentProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly padding?: 'sm' | 'md' | 'lg' | boolean;
};
type PanelChevronProps = {
    readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    chevron: {
        closed: { rotate: 0 },
        open: { rotate: 180 },
        transition: { duration: 0.2 },
    },
    content: {
        animate: { height: 'auto', opacity: 1 },
        exit: { height: 0, opacity: 0 },
        initial: { height: 0, opacity: 0 },
        transition: { duration: 0.2, ease: 'easeOut' },
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

const PanelContext = createContext<PanelContextValue | null>(null);
const usePanelContext = (): PanelContextValue => {
    const ctx = useContext(PanelContext);
    if (!ctx) throw new Error('Panel.* must be used within Panel');
    return ctx;
};

// --- [COMPONENTS] ------------------------------------------------------------

const PanelRoot: FC<PanelRootProps> = ({ children, className, defaultOpen = false, onOpenChange, open, rounded }) => {
    const isControlled = open !== undefined;
    const isOpen = isControlled ? open : defaultOpen;
    const onToggle = () => onOpenChange?.(!isOpen);
    return createElement(
        PanelContext.Provider,
        { value: { isOpen, onToggle } },
        createElement(
            'div',
            {
                className: cn(panelRootVariants({ rounded }), className),
                'data-state': isOpen ? 'open' : 'closed',
            },
            children,
        ),
    );
};
const PanelHeader: FC<PanelHeaderProps> = ({ children, className, size }) => {
    const { isOpen, onToggle } = usePanelContext();
    return createElement(
        'button',
        {
            'aria-expanded': isOpen,
            className: cn(panelHeaderVariants({ size }), className),
            'data-state': isOpen ? 'open' : 'closed',
            onClick: onToggle,
            type: 'button',
        },
        children,
        createElement(PanelChevron, null),
    );
};
const PanelContent: FC<PanelContentProps> = ({ children, className, padding }) => {
    const { isOpen } = usePanelContext();
    return createElement(
        AnimatePresence,
        { initial: false },
        isOpen &&
            createElement(
                motion.div,
                {
                    animate: B.content.animate,
                    className: 'overflow-hidden',
                    exit: B.content.exit,
                    initial: B.content.initial,
                    transition: B.content.transition,
                },
                createElement('div', { className: cn(panelContentVariants({ padding }), className) }, children),
            ),
    );
};
const PanelChevron: FC<PanelChevronProps> = ({ className }) => {
    const { isOpen } = usePanelContext();
    return createElement(
        motion.span,
        {
            animate: isOpen ? B.chevron.open : B.chevron.closed,
            className: cn('shrink-0', className),
            transition: B.chevron.transition,
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
    );
};

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Panel = Object.assign(PanelRoot, {
    Chevron: PanelChevron,
    Content: PanelContent,
    Header: PanelHeader,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern
export { Panel, PanelChevron, PanelContent, PanelHeader, PanelRoot };
// biome-ignore lint/style/useComponentExportOnlyModules: Type exports for compound component
export type { PanelChevronProps, PanelContentProps, PanelHeaderProps, PanelRootProps };
