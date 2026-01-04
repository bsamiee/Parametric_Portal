/**
 * Panel components: Sidebar, CommandBar, Stage.
 * Mirrors Arsenal architecture with rail + drawer sidebar, centered input, and preview viewport.
 */

import type { HttpClient } from '@effect/platform';
import { useClipboard, useExport } from '@parametric-portal/runtime/hooks/browser';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { sanitizeFilename } from '@parametric-portal/runtime/services/browser';
import { useAuthStore } from '@parametric-portal/runtime/stores/auth';
import { AsyncState } from '@parametric-portal/types/async';
import type { IconResponse, Intent } from '@parametric-portal/types/icons';
import { Svg, type SvgAsset } from '@parametric-portal/types/svg';
import { Index, Timestamp, Uuidv7, VariantCount, type ZoomFactor } from '@parametric-portal/types/types';
import { Effect, Option, pipe } from 'effect';
import type { ReactNode } from 'react';
import { createElement, useCallback, useEffect, useRef } from 'react';
import { type GenerateInput, generateIcon } from '../infrastructure.ts';
import {
    type Asset,
    type ContextState,
    type MessageRole,
    type SidebarTab,
    STORE_TUNING,
    useChatStore,
    useContextStore,
    useHistoryStore,
    useLibraryStore,
    usePreviewStore,
    useUiStore,
} from '../stores.ts';
import {
    Box,
    ContextSelector,
    Empty,
    GridOverlay,
    ICON_GAP,
    Icon,
    IconButton,
    InputBar,
    ListItem,
    SafeAreaOverlay,
    ScrollArea,
    Spinner,
    Stack,
    Stepper,
    SvgPreview,
    Thumb,
} from '../ui.ts';
import { UserAvatar } from './auth.tsx';
import { UploadDialog } from './overlays.tsx';

// --- [TYPES] -----------------------------------------------------------------

type SidebarIconName = 'History' | 'SlidersHorizontal' | 'Heart' | 'SquareTerminal' | 'PanelLeft';
type PreviewRenderState = 'empty' | 'generating' | 'ready';
type PreviewRenderProps = { readonly sanitized: string | null; readonly zoom: ZoomFactor };
type PanelContentProps = HistoryPanelProps & LibraryPanelProps;
type HistoryPanelProps = {
    readonly assets: ReadonlyArray<Asset>;
    readonly currentId: string | null;
    readonly onClear: () => void;
    readonly onDelete: (id: string) => void;
    readonly onSelect: (id: string) => void;
};
type LibraryPanelProps = {
    readonly customAssets: ReadonlyArray<SvgAsset>;
    readonly onAddAttachment: (asset: SvgAsset) => void;
    readonly onOpenUpload: () => void;
    readonly onRemoveCustomAsset: (id: string) => void;
    readonly onRemoveSaved: (id: string) => void;
    readonly savedAssets: ReadonlyArray<Asset>;
};
type AttachmentThumbProps = {
    readonly name: string;
    readonly onRemove: () => void;
    readonly scopeSeed: string;
    readonly svg: string;
};
type MessageCardProps = {
    readonly content: string;
    readonly role: MessageRole;
    readonly timestamp: number;
};
type ViewportProps = {
    readonly isLoading: boolean;
    readonly sanitized: string | null;
    readonly showGrid: boolean;
    readonly showSafeArea: boolean;
    readonly zoom: ZoomFactor;
};
type ViewportHUDProps = {
    readonly currentId: string | null;
    readonly currentSvg: string | null;
    readonly filename: string;
    readonly isSaved: boolean;
    readonly onToggleSave: () => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    header: { subtitle: 'ICON GENERATOR', title: 'Parametric Arsenal' },
    inputBarCls:
        'h-14 items-center border-none px-6 gap-4 text-(--panel-text-strong) [&_input]:text-(--panel-text-strong) [&_input]:placeholder:text-(--panel-text-placeholder) [&>span:first-child]:flex [&>span:first-child]:items-center [&>span:first-child]:justify-center [&>span:first-child]:mr-3 [&>span:first-child]:text-(--panel-text-secondary) [&>button]:bg-(--submit-btn-bg) [&>button]:rounded-lg [&>button]:w-9 [&>button]:h-9 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:text-(--submit-btn-text)',
    messageLabels: { assistant: 'SYSTEM', user: 'USER' },
    reticle: ['top-0 left-0', 'top-0 right-0 rotate-90', 'bottom-0 right-0 rotate-180', 'bottom-0 left-0 -rotate-90'],
    sidebarTabs: [
        { icon: 'History', key: 'history', tooltip: 'History' },
        { icon: 'SlidersHorizontal', key: 'inspector', tooltip: 'Inspector' },
        { icon: 'Heart', key: 'library', tooltip: 'Library' },
        { icon: 'SquareTerminal', key: 'session', tooltip: 'Session' },
    ] as ReadonlyArray<{ readonly icon: SidebarIconName; readonly key: SidebarTab; readonly tooltip: string }>,
} as const);
const modeOptions = [
    { icon: <Icon name='Sparkles' className='w-4 h-4' />, key: 'create', label: 'Create' },
    { icon: <Icon name='Pencil' className='w-4 h-4' />, key: 'refine', label: 'Refine' },
] as const;
const outputOptions = [
    { icon: <Icon name='Box' className='w-4 h-4' />, key: 'single', label: 'Single' },
    { icon: <Icon name='Layers' className='w-4 h-4' />, key: 'batch', label: 'Batch' },
] as const;
const styleOptions = [
    { icon: <Icon name='Moon' className='w-4 h-4' />, key: 'dark', label: 'Dark' },
    { icon: <Icon name='Sun' className='w-4 h-4' />, key: 'light', label: 'Light' },
] as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const derivePreviewRenderState = (isGenerating: boolean, hasSvg: boolean): PreviewRenderState => {
    const stateKey = `${isGenerating ? 1 : 0}${hasSvg ? 1 : 0}` as const;
    const stateMap = { '00': 'empty', '01': 'ready', '10': 'generating', '11': 'generating' } as const;
    return stateMap[stateKey];
};
const generateId = (): Uuidv7 => Uuidv7.generateSync();
const CadReticle = (): ReactNode => (
    <div className='absolute inset-0 pointer-events-none z-10'>
        {B.reticle.map((pos) => (
            <div key={pos} className={`absolute w-4 h-4 cad-reticle-corner ${pos}`} />
        ))}
    </div>
);
const AttachmentThumb = ({ name, onRemove, scopeSeed, svg }: AttachmentThumbProps): ReactNode =>
    createElement(
        Thumb,
        {
            action: createElement(Icon, { className: 'w-2.5 h-2.5', name: 'X' }),
            className: 'w-11 h-11 [&>div:first-child]:p-1.5',
            onAction: onRemove,
            tooltip: name || 'Reference',
            tooltipSide: 'top',
        },
        createElement(SvgPreview, {
            className: 'w-full h-full',
            sanitize: (value: string) => Svg.sanitize(value, scopeSeed),
            svg,
        }),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const previewRenderers = {
    empty: () => <Icon name='Scan' className='text-(--panel-icon-muted) w-6 h-6' />,
    generating: () => (
        <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-[1px]'>
            <Spinner className='w-12 h-12 text-(--panel-icon-default)' />
        </div>
    ),
    ready: ({ sanitized, zoom }: PreviewRenderProps) =>
        sanitized && (
            <div className='w-full h-full' style={{ transform: `scale(${zoom})` }}>
                <SvgPreview svg={sanitized} className='w-full h-full' />
            </div>
        ),
} as const satisfies Record<PreviewRenderState, (props: PreviewRenderProps) => ReactNode>;
const HistoryContent = ({ assets, currentId, onSelect, onDelete, onClear }: HistoryPanelProps): ReactNode =>
    assets.length === 0 ? (
        <Empty icon={<Icon name='History' className='w-8 h-8 opacity-50' />} title='No History' />
    ) : (
        <div className='flex flex-col h-full'>
            <ScrollArea className='flex-1'>
                <div className='flex flex-col gap-3'>
                    {assets.map((asset) => {
                        const date = new Date(asset.timestamp);
                        return (
                            <ListItem
                                key={asset.id}
                                className='sidebar-item'
                                isSelected={currentId === asset.id}
                                onClick={() => onSelect(asset.id)}
                                onAction={() => onDelete(asset.id)}
                                thumbnail={
                                    asset.variants[0] ? (
                                        <SvgPreview
                                            svg={asset.variants[0].svg}
                                            sanitize={(value: string) => Svg.sanitize(value, asset.id)}
                                            className='w-full h-full'
                                        />
                                    ) : (
                                        <Icon name='Image' className='w-5 h-5 opacity-50' />
                                    )
                                }
                                badge={
                                    <span className='intent-badge' data-intent={asset.intent}>
                                        {asset.intent}
                                    </span>
                                }
                                action={
                                    <Icon
                                        name='Trash2'
                                        className='w-5 h-5 sidebar-action-btn sidebar-action-btn-destructive'
                                        tooltip='Delete'
                                        tooltipSide='top'
                                    />
                                }
                            >
                                <p className='text-sm text-(--panel-text-secondary) truncate'>{asset.prompt}</p>
                                <div className='mt-1'>
                                    <p className='text-xs text-(--panel-text-muted)'>{date.toLocaleDateString()}</p>
                                    <p className='text-xs text-(--panel-text-muted)'>{date.toLocaleTimeString()}</p>
                                </div>
                            </ListItem>
                        );
                    })}
                </div>
            </ScrollArea>
            <div className='shrink-0 pt-4 mt-4 border-t border-(--panel-border-dark)'>
                <button type='button' className='clear-history-btn' onClick={onClear}>
                    Clear History
                </button>
            </div>
        </div>
    );
const LibraryContent = ({
    customAssets,
    savedAssets,
    onAddAttachment,
    onOpenUpload,
    onRemoveCustomAsset,
    onRemoveSaved,
}: LibraryPanelProps): ReactNode => {
    const hasContent = customAssets.length > 0 || savedAssets.length > 0;
    return (
        <div className='flex flex-col h-full'>
            {hasContent ? (
                <ScrollArea className='flex-1'>
                    <div className='flex flex-col gap-3'>
                        {customAssets.length > 0 && (
                            <>
                                <span className='text-xs font-medium text-(--panel-text-muted) uppercase tracking-wider'>
                                    Uploaded
                                </span>
                                {customAssets.map((asset) => (
                                    <ListItem
                                        key={asset.id}
                                        className='sidebar-item'
                                        onClick={() => onAddAttachment(asset)}
                                        onAction={() => onRemoveCustomAsset(asset.id)}
                                        thumbnail={
                                            <SvgPreview
                                                svg={asset.svg}
                                                sanitize={(value: string) => Svg.sanitize(value, asset.id)}
                                                className='w-full h-full'
                                            />
                                        }
                                        badge={
                                            <span className='intent-badge' data-intent='upload'>
                                                upload
                                            </span>
                                        }
                                        action={
                                            <Icon
                                                name='Trash2'
                                                className='w-5 h-5 sidebar-action-btn sidebar-action-btn-destructive'
                                                tooltip='Remove'
                                                tooltipSide='top'
                                            />
                                        }
                                    >
                                        <p className='text-sm text-(--panel-text-secondary) truncate'>{asset.name}</p>
                                    </ListItem>
                                ))}
                            </>
                        )}
                        {savedAssets.length > 0 && (
                            <>
                                <span className='text-xs font-medium text-(--panel-text-muted) uppercase tracking-wider mt-2'>
                                    Saved
                                </span>
                                {savedAssets.map((asset) => {
                                    const variantIndex = asset.selectedVariantIndex ?? 0;
                                    const svg = asset.variants[variantIndex]?.svg;
                                    return (
                                        <ListItem
                                            key={asset.id}
                                            className='sidebar-item'
                                            onClick={() => onRemoveSaved(asset.id)}
                                            onAction={() =>
                                                svg && onAddAttachment({ id: asset.id, name: asset.prompt, svg })
                                            }
                                            thumbnail={
                                                svg ? (
                                                    <SvgPreview
                                                        svg={svg}
                                                        sanitize={(value: string) => Svg.sanitize(value, asset.id)}
                                                        className='w-full h-full'
                                                    />
                                                ) : (
                                                    <Icon name='Image' className='w-5 h-5 opacity-50' />
                                                )
                                            }
                                            badge={
                                                <span className='intent-badge' data-intent={asset.intent}>
                                                    {asset.intent}
                                                </span>
                                            }
                                            action={
                                                <Icon
                                                    name='Plus'
                                                    className='w-5 h-5 sidebar-action-btn'
                                                    tooltip='Add as reference'
                                                    tooltipSide='top'
                                                />
                                            }
                                        >
                                            <p className='text-sm text-(--panel-text-secondary) truncate'>
                                                {asset.prompt}
                                            </p>
                                        </ListItem>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </ScrollArea>
            ) : (
                <div className='flex-1 flex items-center justify-center'>
                    <Empty icon={<Icon name='Heart' className='w-8 h-8 opacity-50' />} title='No Saved Items' />
                </div>
            )}
            <div className='shrink-0 pt-4 mt-4 border-t border-(--panel-border-dark)'>
                <button type='button' className='clear-history-btn' onClick={onOpenUpload}>
                    <Icon name='Upload' className='w-4 h-4 mr-2' />
                    Upload SVG
                </button>
            </div>
        </div>
    );
};
const MessageCard = ({ content, role, timestamp }: MessageCardProps): ReactNode => (
    <div className='session-message' data-role={role}>
        <div className='session-message-icon' data-role={role}>
            <Icon name={role === 'user' ? 'User' : 'Bot'} className='w-4 h-4' />
        </div>
        <div className='flex-1 min-w-0'>
            <span className='session-message-label' data-role={role}>
                {B.messageLabels[role]}
            </span>
            <p className='text-sm text-(--panel-text-secondary) mt-1 whitespace-pre-wrap'>{content}</p>
            <p className='text-xs text-(--panel-text-muted) mt-2'>{new Date(timestamp).toLocaleTimeString()}</p>
        </div>
    </div>
);
const SessionContent = (): ReactNode => {
    const messages = useChatStore((s) => s.messages);
    const isGenerating = useChatStore((s) => s.isGenerating);
    return messages.length === 0 && !isGenerating ? (
        <Empty icon={<Icon name='SquareTerminal' className='w-8 h-8 opacity-50' />} title='Session Log Empty' />
    ) : (
        <ScrollArea className='h-full'>
            <div className='flex flex-col gap-3'>
                {messages.map((msg) => (
                    <MessageCard key={msg.id} content={msg.content} role={msg.role} timestamp={msg.timestamp} />
                ))}
                {isGenerating && (
                    <div className='session-thinking-card'>
                        <div className='w-8 h-8 rounded bg-(--panel-bg-lighter) flex items-center justify-center shrink-0'>
                            <Spinner className='w-4 h-4' />
                        </div>
                        <div className='flex-1 space-y-2'>
                            <span className='session-message-label' data-role='assistant'>
                                THINKING
                            </span>
                            <div className='skeleton w-3/4' />
                            <div className='skeleton w-1/2' />
                        </div>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
};
const InspectorContent = (): ReactNode => {
    const currentSvg = usePreviewStore((s) => s.currentSvg);
    const currentAsset = useHistoryStore((s) => s.currentAsset);
    return currentSvg ? (
        <ScrollArea className='h-full'>
            <Stack gap className='divide-y divide-(--panel-border-dark)'>
                {currentAsset && (
                    <>
                        <div className='inspector-section'>
                            <h3 className='inspector-header'>Metadata</h3>
                            <Stack gap>
                                <div className='inspector-row'>
                                    <span className='text-(--panel-text-muted)'>Intent</span>
                                    <span className='intent-badge' data-intent={currentAsset.intent}>
                                        {currentAsset.intent.toUpperCase()}
                                    </span>
                                </div>
                                <div className='inspector-row'>
                                    <span className='text-(--panel-text-muted)'>Variants</span>
                                    <span className='text-(--panel-text-secondary)'>
                                        {currentAsset.variants.length}
                                    </span>
                                </div>
                                <div className='inspector-row'>
                                    <span className='text-(--panel-text-muted)'>Created</span>
                                    <span className='text-(--panel-text-secondary) text-xs'>
                                        {new Date(currentAsset.timestamp).toLocaleString()}
                                    </span>
                                </div>
                            </Stack>
                        </div>
                        <div className='inspector-section pt-4'>
                            <h3 className='inspector-header'>Prompt</h3>
                            <p className='text-sm text-(--panel-text-secondary)'>{currentAsset.prompt}</p>
                        </div>
                    </>
                )}
                <div className='inspector-section pt-4'>
                    <h3 className='inspector-header'>Source</h3>
                    <pre className='inspector-code'>{currentSvg}</pre>
                </div>
            </Stack>
        </ScrollArea>
    ) : (
        <Empty icon={<Icon name='SlidersHorizontal' className='w-8 h-8 opacity-50' />} title='No Selection' />
    );
};
const panelRenderers = {
    history: (props: PanelContentProps) => <HistoryContent {...props} />,
    inspector: () => <InspectorContent />,
    library: (props: PanelContentProps) => <LibraryContent {...props} />,
    session: () => <SessionContent />,
} as const satisfies Record<SidebarTab, (props: PanelContentProps) => ReactNode>;

// --- [ENTRY_POINT] -----------------------------------------------------------

const Sidebar = (): ReactNode => {
    const isSidebarOpen = useUiStore((s) => s.isSidebarOpen);
    const activeTab = useUiStore((s) => s.activeTab);
    const isUploadOpen = useUiStore((s) => s.isUploadOpen);
    const toggleSidebar = useUiStore((s) => s.toggleSidebar);
    const setSidebarTab = useUiStore((s) => s.setSidebarTab);
    const openUploadDialog = useUiStore((s) => s.openUploadDialog);
    const closeUploadDialog = useUiStore((s) => s.closeUploadDialog);
    const assets = useHistoryStore((s) => s.assets);
    const currentId = useHistoryStore((s) => s.currentId);
    const selectAsset = useHistoryStore((s) => s.selectAsset);
    const clearAll = useHistoryStore((s) => s.clearAll);
    const deleteAsset = useHistoryStore((s) => s.deleteAsset);
    const customAssets = useLibraryStore((s) => s.customAssets);
    const savedAssets = useLibraryStore((s) => s.savedAssets);
    const addCustomAsset = useLibraryStore((s) => s.addCustomAsset);
    const clearAssets = useLibraryStore((s) => s.clearAssets);
    const removeAsset = useLibraryStore((s) => s.removeAsset);
    const removeCustomAsset = useLibraryStore((s) => s.removeCustomAsset);
    const isSaved = useLibraryStore((s) => s.isSaved);
    const setSvg = usePreviewStore((s) => s.setSvg);
    const setContext = useContextStore((s) => s.setContext);
    const addAttachment = useContextStore((s) => s.addAttachment);
    const handleTabClick = useCallback(
        (tab: SidebarTab) => {
            const action = isSidebarOpen && activeTab === tab ? 'close' : 'open';
            const tabHandlers = {
                close: () => toggleSidebar(),
                open: () => {
                    setSidebarTab(tab);
                    !isSidebarOpen && toggleSidebar();
                },
            } as const satisfies Record<'close' | 'open', () => void>;
            tabHandlers[action]();
        },
        [isSidebarOpen, activeTab, toggleSidebar, setSidebarTab],
    );
    // Sync history selection with preview pane
    const handleSelectAsset = useCallback(
        (id: string) => {
            selectAsset(id);
            const asset = assets.find((a) => a.id === id);
            asset && setContext(asset.context);
            const variantIndex = asset?.selectedVariantIndex ?? 0;
            const svg = asset?.variants[variantIndex]?.svg;
            svg && setSvg(svg);
        },
        [assets, selectAsset, setSvg, setContext],
    );
    const handleUpload = useCallback(
        (name: string, svg: string) => {
            addCustomAsset(name, svg);
        },
        [addCustomAsset],
    );
    const panelProps: PanelContentProps = {
        assets,
        currentId,
        customAssets,
        onAddAttachment: addAttachment,
        onClear: () => {
            clearAssets();
            clearAll();
        },
        onDelete: (id) => {
            deleteAsset(id);
            isSaved(id) && removeAsset(id);
        },
        onOpenUpload: openUploadDialog,
        onRemoveCustomAsset: removeCustomAsset,
        onRemoveSaved: removeAsset,
        onSelect: handleSelectAsset,
        savedAssets,
    };
    return (
        <>
            <UploadDialog isOpen={isUploadOpen} onClose={closeUploadDialog} onUpload={handleUpload} />
            <div className='sidebar'>
                <div className='sidebar-rail'>
                    <IconButton
                        variant='ghost'
                        className='rail-btn'
                        tooltip={isSidebarOpen ? 'Collapse' : 'Expand'}
                        tooltipSide='right'
                        onPress={toggleSidebar}
                        aria-label={isSidebarOpen ? 'Collapse' : 'Expand'}
                    >
                        <Icon name='PanelLeft' className='w-5 h-5' />
                    </IconButton>
                    <div className='h-4' />
                    <div className='flex flex-col' style={{ gap: ICON_GAP }}>
                        {B.sidebarTabs.map(({ icon, key, tooltip }) => (
                            <IconButton
                                key={key}
                                variant='ghost'
                                className='rail-btn'
                                tooltip={tooltip}
                                tooltipSide='right'
                                onPress={() => handleTabClick(key)}
                                aria-label={tooltip}
                                aria-pressed={activeTab === key && isSidebarOpen}
                            >
                                <Icon name={icon} className='w-5 h-5' />
                            </IconButton>
                        ))}
                    </div>
                    <div className='flex-1' />
                    <UserAvatar />
                </div>
                <div
                    className='sidebar-drawer'
                    style={{
                        opacity: isSidebarOpen ? 1 : 0,
                        transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-1rem)',
                        width: isSidebarOpen ? '20rem' : 0,
                    }}
                >
                    <div className='sidebar-drawer-header'>
                        <span className='text-[11px] font-bold tracking-widest text-(--panel-text-muted) uppercase'>
                            {activeTab}
                        </span>
                    </div>
                    <div className='sidebar-drawer-content'>{panelRenderers[activeTab](panelProps)}</div>
                </div>
            </div>
        </>
    );
};
const CommandBar = (): ReactNode => {
    const input = useChatStore((s) => s.input);
    const setInput = useChatStore((s) => s.setInput);
    const addMessage = useChatStore((s) => s.addMessage);
    const setGenerating = useChatStore((s) => s.setGenerating);
    const intent = useContextStore((s) => s.intent);
    const output = useContextStore((s) => s.output);
    const colorMode = useContextStore((s) => s.colorMode);
    const attachments = useContextStore((s) => s.attachments);
    const setIntent = useContextStore((s) => s.setIntent);
    const setOutput = useContextStore((s) => s.setOutput);
    const setColorMode = useContextStore((s) => s.setColorMode);
    const removeAttachment = useContextStore((s) => s.removeAttachment);
    const isSidebarOpen = useUiStore((s) => s.isSidebarOpen);
    const submittedContext = useUiStore((s) => s.submittedContext);
    const setSidebarTab = useUiStore((s) => s.setSidebarTab);
    const toggleSidebar = useUiStore((s) => s.toggleSidebar);
    const setSubmittedContext = useUiStore((s) => s.setSubmittedContext);
    const currentSvg = usePreviewStore((s) => s.currentSvg);
    const setSvg = usePreviewStore((s) => s.setSvg);
    const addAsset = useHistoryStore((s) => s.addAsset);
    const accessToken = useAuthStore((s) => s.accessToken);
    const openAuthOverlay = useAuthStore((s) => s.openAuthOverlay);
    const submittedContextRef = useRef(submittedContext);
    submittedContextRef.current = submittedContext;
    const { mutate, state } = useEffectMutate<IconResponse, GenerateInput, unknown, HttpClient.HttpClient>(
        (input) =>
            accessToken === null
                ? Effect.fail({ _tag: 'AuthError', reason: 'Not authenticated' } as const)
                : generateIcon(accessToken, input),
        {
            onError: (err) => {
                const errorMessage =
                    typeof err === 'object' && err !== null && 'reason' in err ? String(err.reason) : 'Unknown error';
                addMessage({
                    content: `Error: ${errorMessage}`,
                    id: generateId(),
                    role: 'assistant',
                    timestamp: Timestamp.nowSync(),
                });
                setSubmittedContext(null);
                abortControllerRef.current = null;
            },
            onSuccess: (response) => {
                const ctx = submittedContextRef.current;
                ctx === null ||
                    (() => {
                        const { variants } = response;
                        const firstVariant = variants[0];
                        firstVariant && setSvg(firstVariant.svg);
                        addMessage({
                            content: `Generated ${variants.length} variant${variants.length > 1 ? 's' : ''}: ${variants.map((v: SvgAsset) => v.name).join(', ')}`,
                            id: generateId(),
                            role: 'assistant',
                            timestamp: Timestamp.nowSync(),
                        });
                        addAsset({
                            context: ctx.context,
                            id: generateId(),
                            intent: ctx.intent,
                            prompt: ctx.prompt,
                            selectedVariantIndex: Index.decodeSync(0),
                            timestamp: Timestamp.nowSync(),
                            variants: variants.map((v: SvgAsset) => ({
                                id: generateId(),
                                name: v.name,
                                svg: v.svg,
                            })),
                        });
                        setSubmittedContext(null);
                        abortControllerRef.current = null;
                    })();
            },
        },
    );
    const isGenerating = AsyncState.isPending(state);
    const variantCount = output === 'batch' ? STORE_TUNING.variantCount.batch : STORE_TUNING.variantCount.single;
    const abortControllerRef = useRef<AbortController | null>(null);
    const handleOpenLibrary = useCallback(() => {
        setSidebarTab('library');
        !isSidebarOpen && toggleSidebar();
    }, [isSidebarOpen, setSidebarTab, toggleSidebar]);
    useEffect(() => {
        setGenerating(isGenerating);
    }, [isGenerating, setGenerating]);
    useEffect(
        // Cleanup abort controller on unmount
        () => () => {
            abortControllerRef.current?.abort();
        },
        [],
    );
    const handleGenerate = useCallback(
        (prompt: string): void =>
            pipe(
                Option.fromNullable(prompt.trim() || null),
                Option.flatMap((trimmed) =>
                    pipe(
                        Option.fromNullable(accessToken),
                        Option.match({
                            onNone: () => {
                                openAuthOverlay();
                                return Option.none<string>();
                            },
                            onSome: () => {
                                const isRefineWithoutSvg = intent === 'refine' && !currentSvg;
                                isRefineWithoutSvg &&
                                    addMessage({
                                        content:
                                            'Cannot refine: No asset selected. Switch to Create mode or select an asset first.',
                                        id: generateId(),
                                        role: 'assistant',
                                        timestamp: Timestamp.nowSync(),
                                    });
                                return isRefineWithoutSvg ? Option.none<string>() : Option.some(trimmed);
                            },
                        }),
                    ),
                ),
                Option.match({
                    onNone: () => undefined,
                    onSome: (trimmed) => {
                        abortControllerRef.current?.abort();
                        const controller = new AbortController();
                        abortControllerRef.current = controller;
                        setSubmittedContext({
                            context: { attachments, colorMode, intent, output },
                            intent,
                            prompt: trimmed,
                        });
                        addMessage({
                            content: trimmed,
                            id: generateId(),
                            role: 'user',
                            timestamp: Timestamp.nowSync(),
                        });
                        mutate({
                            attachments: attachments.length > 0 ? attachments : undefined,
                            colorMode,
                            intent,
                            prompt: trimmed,
                            referenceSvg: intent === 'refine' ? (currentSvg ?? undefined) : undefined,
                            signal: controller.signal,
                            variantCount: VariantCount.decodeSync(variantCount),
                        });
                        setInput('');
                    },
                }),
            ),
        [
            accessToken,
            attachments,
            colorMode,
            intent,
            currentSvg,
            mutate,
            variantCount,
            addMessage,
            setInput,
            output,
            setSubmittedContext,
            openAuthOverlay,
        ],
    );
    return (
        <div className='command-bar'>
            <div className='command-header'>
                <h1 className='command-title'>{B.header.title}</h1>
                <span className='command-subtitle'>{B.header.subtitle}</span>
            </div>
            <div className='input-wrapper'>
                {attachments.length > 0 && (
                    <div className='attachments-tray'>
                        <span className='attachments-label'>Attachments</span>
                        {attachments.map((ref) => (
                            <AttachmentThumb
                                key={ref.id}
                                name={ref.name}
                                scopeSeed={ref.id}
                                svg={ref.svg}
                                onRemove={() => removeAttachment(ref.id)}
                            />
                        ))}
                    </div>
                )}
                <div className='input-capsule'>
                    <InputBar
                        className={B.inputBarCls}
                        leftIcon={<Icon name='Plus' className='w-5 h-5' />}
                        leftIconTooltip='Add from Library'
                        leftIconTooltipSide='top'
                        loading={isGenerating}
                        onLeftIconClick={handleOpenLibrary}
                        onSubmit={handleGenerate}
                        onValueChange={setInput}
                        placeholder={
                            intent === 'create' ? 'Describe a geometric task...' : 'Refinement instructions...'
                        }
                        submitIcon={<Icon name='ArrowUp' className='w-5 h-5' />}
                        value={input}
                    />
                </div>
            </div>
            <div className='context-row'>
                <div className='flex items-center gap-1'>
                    <ContextSelector
                        label='Mode'
                        options={modeOptions}
                        value={intent}
                        onChange={(key) => setIntent(key as Intent)}
                    />
                    <div className='context-divider' />
                    <ContextSelector
                        label='Output'
                        options={outputOptions}
                        value={output}
                        onChange={(key) => setOutput(key as ContextState['output'])}
                    />
                </div>
                <div className='flex-1' />
                <ContextSelector
                    label='Output Style'
                    options={styleOptions}
                    value={colorMode}
                    onChange={(key) => setColorMode(key as ContextState['colorMode'])}
                />
            </div>
        </div>
    );
};
const ViewportHUD = ({ currentId, currentSvg, filename, isSaved, onToggleSave }: ViewportHUDProps): ReactNode => {
    const { copy } = useClipboard<string>();
    const { exportAs } = useExport();
    const handleCopy = useCallback(() => {
        currentSvg && copy(currentSvg);
    }, [currentSvg, copy]);
    const handleDownload = useCallback(() => {
        currentSvg && exportAs({ filename, format: 'svg', svg: currentSvg });
    }, [currentSvg, exportAs, filename]);
    return currentSvg && currentId ? (
        <div className='viewport-hud'>
            <div className='viewport-hud-inner'>
                <IconButton
                    variant='ghost'
                    className='viewport-hud-btn'
                    data-saved={isSaved}
                    onPress={onToggleSave}
                    tooltip={isSaved ? 'Remove from Library' : 'Save to Library'}
                    tooltipSide='bottom'
                >
                    <Icon name='Heart' className='w-3.5 h-3.5' />
                </IconButton>
                <IconButton
                    variant='ghost'
                    className='viewport-hud-btn'
                    onPress={handleCopy}
                    tooltip='Copy SVG'
                    tooltipSide='bottom'
                >
                    <Icon name='Copy' className='w-3.5 h-3.5' />
                </IconButton>
                <IconButton
                    variant='ghost'
                    className='viewport-hud-btn'
                    onPress={handleDownload}
                    tooltip='Download'
                    tooltipSide='bottom'
                >
                    <Icon name='Download' className='w-3.5 h-3.5' />
                </IconButton>
            </div>
        </div>
    ) : null;
};
const Viewport = ({ isLoading, sanitized, showGrid, showSafeArea, zoom }: ViewportProps): ReactNode => {
    const state = derivePreviewRenderState(isLoading, Boolean(sanitized));
    const currentSvg = usePreviewStore((s) => s.currentSvg);
    const setSvg = usePreviewStore((s) => s.setSvg);
    const assets = useHistoryStore((s) => s.assets);
    const currentId = useHistoryStore((s) => s.currentId);
    const setSelectedVariantIndex = useHistoryStore((s) => s.setSelectedVariantIndex);
    const savedAssets = useLibraryStore((s) => s.savedAssets);
    const addAssetToLibrary = useLibraryStore((s) => s.addAsset);
    const removeAssetFromLibrary = useLibraryStore((s) => s.removeAsset);
    const isSaved = currentId ? savedAssets.some((asset) => asset.id === currentId) : false;
    const currentAsset = currentId ? assets.find((a) => a.id === currentId) : null;
    const variantIndex = currentAsset?.selectedVariantIndex ?? 0;
    const variantCount = currentAsset?.variants.length ?? 0;
    const handleToggleSave = useCallback(() => {
        currentAsset && (isSaved ? removeAssetFromLibrary(currentAsset.id) : addAssetToLibrary(currentAsset));
    }, [currentAsset, isSaved, removeAssetFromLibrary, addAssetToLibrary]);
    const handlePrevVariant = useCallback(() => {
        currentAsset &&
            variantIndex > 0 &&
            (() => {
                const newIndex = variantIndex - 1;
                setSelectedVariantIndex(currentAsset.id, newIndex);
                const svg = currentAsset.variants[newIndex]?.svg;
                svg && setSvg(svg);
            })();
    }, [currentAsset, variantIndex, setSelectedVariantIndex, setSvg]);
    const handleNextVariant = useCallback(() => {
        currentAsset &&
            variantIndex < variantCount - 1 &&
            (() => {
                const newIndex = variantIndex + 1;
                setSelectedVariantIndex(currentAsset.id, newIndex);
                const svg = currentAsset.variants[newIndex]?.svg;
                svg && setSvg(svg);
            })();
    }, [currentAsset, variantIndex, variantCount, setSelectedVariantIndex, setSvg]);
    return (
        <div className='relative w-full aspect-square group'>
            <ViewportHUD
                currentId={currentId}
                currentSvg={currentSvg}
                filename={currentAsset ? sanitizeFilename(currentAsset.prompt) : 'icon'}
                isSaved={isSaved}
                onToggleSave={handleToggleSave}
            />
            <Stepper
                className='variant-nav'
                currentIndex={variantIndex}
                mode='disable'
                nextIcon={<Icon name='ChevronRight' className='w-3 h-3' />}
                onNext={handleNextVariant}
                onPrev={handlePrevVariant}
                prevIcon={<Icon name='ChevronLeft' className='w-3 h-3' />}
                showCounter
                size='sm'
                total={variantCount}
            />
            <CadReticle />
            <GridOverlay show={showGrid} />
            <SafeAreaOverlay show={showSafeArea} />
            <div className='absolute inset-0 flex items-center justify-center'>
                {previewRenderers[state]({ sanitized, zoom })}
            </div>
        </div>
    );
};
const Stage = (): ReactNode => {
    const isGenerating = useChatStore((s) => s.isGenerating);
    const currentId = useHistoryStore((s) => s.currentId);
    const currentSvg = usePreviewStore((s) => s.currentSvg);
    const zoom = usePreviewStore((s) => s.zoom);
    const showGrid = useUiStore((s) => s.showGrid);
    const showSafeArea = useUiStore((s) => s.showSafeArea);
    const toggleGrid = useUiStore((s) => s.toggleGrid);
    const toggleSafeArea = useUiStore((s) => s.toggleSafeArea);
    const scopeSeed = currentId ?? currentSvg ?? '';
    const sanitized = currentSvg ? Svg.sanitize(currentSvg, scopeSeed) : null;
    return (
        <div className='stage'>
            <Box className='preview-box'>
                <Viewport
                    isLoading={isGenerating}
                    sanitized={sanitized}
                    showGrid={showGrid}
                    showSafeArea={showSafeArea}
                    zoom={zoom}
                />
            </Box>
            <div className='hud-controls'>
                <IconButton
                    variant='ghost'
                    className='hud-btn'
                    tooltip='Toggle Grid'
                    tooltipSide='top'
                    onPress={toggleGrid}
                    aria-label='Toggle Grid'
                    aria-pressed={showGrid}
                >
                    <Icon name='LayoutGrid' className='w-4 h-4' />
                </IconButton>
                <IconButton
                    variant='ghost'
                    className='hud-btn'
                    tooltip='Toggle Bounds'
                    tooltipSide='top'
                    onPress={toggleSafeArea}
                    aria-label='Toggle Bounds'
                    aria-pressed={showSafeArea}
                >
                    <Icon name='Scan' className='w-4 h-4' />
                </IconButton>
            </div>
        </div>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { CommandBar, Sidebar, Stage };
