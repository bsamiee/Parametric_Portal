/**
 * Application shell: Sidebar rail + centered workspace (CommandBar + Stage).
 * Mirrors the Arsenal architecture: rail icons, collapsible drawer, centered content.
 */
import { RuntimeProvider } from '@parametric-portal/runtime/runtime';
import type { ReactNode } from 'react';
import { OverlayProvider } from 'react-aria';
import { appRuntime, useAuthInit } from '../infrastructure.ts';
import { Flex } from '../ui.ts';
import { AccountOverlay } from './account.tsx';
import { AuthOverlay } from './auth.tsx';
import { ExportDialog, useExportDialog } from './overlays.tsx';
import { CommandBar, Sidebar, Stage } from './panels.tsx';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    styles: {
        main: 'relative flex-1 h-full overflow-hidden flex flex-col',
        root: 'h-screen w-screen overflow-hidden flex bg-(--panel-bg-medium) text-(--panel-text-primary)',
        workspace: 'w-full h-full flex flex-col items-center gap-6 px-12 pt-12 max-w-[1920px] mx-auto',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AppContent = (): ReactNode => {
    useAuthInit();
    const exportDialog = useExportDialog();
    return (
        <>
            <AccountOverlay />
            <AuthOverlay />
            <ExportDialog {...exportDialog} />
            <Flex className={B.styles.root}>
                {/* 1. SIDEBAR (Left Rail + Drawer) */}
                <div className='shrink-0 h-full z-50'>
                    <Sidebar />
                </div>
                {/* 2. MAIN WORKSPACE */}
                <div className={B.styles.main}>
                    <div className={B.styles.workspace}>
                        {/* Command Input Section */}
                        <div className='w-full z-40'>
                            <CommandBar />
                        </div>
                        {/* Preview Stage */}
                        <div className='w-full flex-1 z-30'>
                            <Stage />
                        </div>
                    </div>
                </div>
            </Flex>
        </>
    );
};
const App = (): ReactNode => (
    <RuntimeProvider runtime={appRuntime}>
        <OverlayProvider>
            <AppContent />
        </OverlayProvider>
    </RuntimeProvider>
);

// --- [EXPORT] ----------------------------------------------------------------

export { App };
