/**
 * Application shell: Sidebar rail + centered workspace (CommandBar + Stage).
 * Mirrors the Arsenal architecture: rail icons, collapsible drawer, centered content.
 */
import { type ReactNode, useMemo } from 'react';
import { OverlayProvider } from 'react-aria';
import { appRuntime, RuntimeProvider, useAuthInit, usePersist } from '../core.ts';
import {
    chatSlice,
    contextSlice,
    historySlice,
    type LibraryState,
    librarySlice,
    previewSlice,
    uiSlice,
} from '../stores.ts';
import { Flex } from '../ui.ts';
import { AccountOverlay } from './account.tsx';
import { AuthOverlay } from './auth.tsx';
import { ExportDialog, useExportDialog } from './overlays.tsx';
import { CommandBar, Sidebar, Stage } from './panels.tsx';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    persist: {
        chat: 'parametric-icons:chat',
        context: 'parametric-icons:context',
        history: 'parametric-icons:history',
        library: 'parametric-icons:library',
        preview: 'parametric-icons:preview',
        ui: 'parametric-icons:ui',
    },
    styles: {
        main: 'relative flex-1 h-full overflow-hidden flex flex-col',
        root: 'h-screen w-screen overflow-hidden flex bg-(--panel-bg-medium) text-(--panel-text-primary)',
        workspace: 'w-full h-full flex flex-col items-center gap-6 px-12 pt-12 max-w-[1920px] mx-auto',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const AppContent = (): ReactNode => {
    useAuthInit();

    const libraryPersist = useMemo(
        () => ({
            migrate: (stored: unknown, initialState: LibraryState): LibraryState => {
                const state =
                    stored && typeof stored === 'object'
                        ? (stored as Partial<LibraryState> & { savedIds?: ReadonlyArray<string> })
                        : null;
                const {
                    savedAssets: _savedAssets,
                    savedIds: _savedIds,
                    customAssets: _customAssets,
                    ...rest
                } = state ?? {};
                const customAssets = Array.isArray(state?.customAssets)
                    ? state.customAssets
                    : initialState.customAssets;
                const assetLookup = new Map(historySlice.getState().assets.map((a) => [a.id, a]));
                const savedAssets =
                    (Array.isArray(state?.savedAssets) ? state.savedAssets : null) ??
                    (Array.isArray(state?.savedIds)
                        ? state.savedIds.map((id) => assetLookup.get(id)).filter(Boolean)
                        : null) ??
                    [];

                return state
                    ? { ...initialState, ...rest, customAssets, savedAssets }
                    : { ...initialState, customAssets, savedAssets };
            },
        }),
        [],
    );

    usePersist(chatSlice, B.persist.chat);
    usePersist(contextSlice, B.persist.context);
    usePersist(historySlice, B.persist.history);
    usePersist(librarySlice, B.persist.library, libraryPersist);
    usePersist(previewSlice, B.persist.preview);
    usePersist(uiSlice, B.persist.ui);
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

export { App, B as SHELL_CONFIG };
