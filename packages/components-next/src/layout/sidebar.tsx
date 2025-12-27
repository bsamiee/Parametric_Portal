/**
 * Sidebar compound component with Rail + Drawer pattern.
 * Grounding: Compound pattern with Motion AnimatePresence.
 */
import { AnimatePresence, motion } from 'motion/react';
import { createContext, createElement, type FC, type ReactNode, useContext } from 'react';
import { cn } from '../core/variants.ts';
import {
    SIDEBAR_TUNING,
    sidebarDrawerContentVariants,
    sidebarDrawerHeaderVariants,
    sidebarDrawerVariants,
    sidebarRailVariants,
    sidebarRootVariants,
} from './sidebar.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type SidebarContextValue = {
    readonly isOpen: boolean;
};
type SidebarRootProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly open?: boolean;
};
type SidebarRailProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly gap?: 'sm' | 'md' | 'lg';
};
type SidebarDrawerProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly title?: string;
};
type SidebarDrawerHeaderProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};
type SidebarDrawerContentProps = {
    readonly children?: ReactNode;
    readonly className?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    drawer: {
        animate: { opacity: 1, width: SIDEBAR_TUNING.drawer.width, x: 0 },
        exit: { opacity: 0, width: 0, x: -16 },
        initial: { opacity: 0, width: 0, x: -16 },
        transition: { duration: 0.2, ease: 'easeOut' },
    },
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

const SidebarContext = createContext<SidebarContextValue | null>(null);
const useSidebarContext = (): SidebarContextValue => {
    const ctx = useContext(SidebarContext);
    if (!ctx) throw new Error('Sidebar.* must be used within Sidebar');
    return ctx;
};

// --- [COMPONENTS] ------------------------------------------------------------

const SidebarRoot: FC<SidebarRootProps> = ({ children, className, open = false }) =>
    createElement(
        SidebarContext.Provider,
        { value: { isOpen: open } },
        createElement(
            'aside',
            {
                className: cn(sidebarRootVariants(), className),
                'data-state': open ? 'open' : 'closed',
            },
            children,
        ),
    );
const SidebarRail: FC<SidebarRailProps> = ({ children, className, gap }) =>
    createElement(
        'div',
        {
            className: cn(sidebarRailVariants({ gap }), className),
            style: { width: SIDEBAR_TUNING.rail.width },
        },
        children,
    );
const SidebarDrawer: FC<SidebarDrawerProps> = ({ children, className, title }) => {
    const { isOpen } = useSidebarContext();
    return createElement(
        AnimatePresence,
        { initial: false },
        isOpen &&
            createElement(
                motion.div,
                {
                    animate: B.drawer.animate,
                    className: cn(sidebarDrawerVariants(), className),
                    exit: B.drawer.exit,
                    initial: B.drawer.initial,
                    transition: B.drawer.transition,
                },
                title !== undefined && createElement(SidebarDrawerHeader, null, title),
                children,
            ),
    );
};
const SidebarDrawerHeader: FC<SidebarDrawerHeaderProps> = ({ children, className }) =>
    createElement('div', { className: cn(sidebarDrawerHeaderVariants(), className) }, children);
const SidebarDrawerContent: FC<SidebarDrawerContentProps> = ({ children, className }) =>
    createElement('div', { className: cn(sidebarDrawerContentVariants(), className) }, children);

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Sidebar = Object.assign(SidebarRoot, {
    Drawer: Object.assign(SidebarDrawer, {
        Content: SidebarDrawerContent,
        Header: SidebarDrawerHeader,
    }),
    Rail: SidebarRail,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern
export { Sidebar, SidebarDrawer, SidebarDrawerContent, SidebarDrawerHeader, SidebarRail, SidebarRoot };
export type {
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SidebarDrawerContentProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SidebarDrawerHeaderProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SidebarDrawerProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SidebarRailProps,
    // biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
    SidebarRootProps,
};
