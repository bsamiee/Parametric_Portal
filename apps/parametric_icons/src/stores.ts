/**
 * Application state stores via Zustand factory from @parametric-portal/runtime.
 */

import type { ExportFormat } from '@parametric-portal/runtime/services/browser';
import { createStore } from '@parametric-portal/runtime/store/factory';
import { ColorMode, Intent, OutputMode } from '@parametric-portal/types/icons';
import { Svg, SvgAsset } from '@parametric-portal/types/svg';
import {
    Index,
    PositiveInt,
    Timestamp,
    TYPES_TUNING,
    Uuidv7,
    VariantCount,
    ZoomFactor,
} from '@parametric-portal/types/types';
import { Option, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type SidebarTab = 'history' | 'inspector' | 'library' | 'session';
type UploadState = 'error' | 'idle' | 'preview' | 'validating';
type MessageRole = 'assistant' | 'user';
type Message = S.Schema.Type<typeof MessageSchema>;
type ChatState = S.Schema.Type<typeof ChatStateSchema>;
type PreviewState = S.Schema.Type<typeof PreviewStateSchema>;
type ContextState = S.Schema.Type<typeof ContextStateSchema>;
type UiState = S.Schema.Type<typeof UiStateSchema>;
type Asset = S.Schema.Type<typeof AssetSchema>;
type HistoryState = S.Schema.Type<typeof HistoryStateSchema>;
type LibraryState = S.Schema.Type<typeof LibraryStateSchema>;
type SubmittedContext = { readonly context: ContextState; readonly intent: Intent; readonly prompt: string } | null;
type ChatActions = {
    readonly addMessage: (msg: Message) => void;
    readonly clearMessages: () => void;
    readonly setGenerating: (flag: boolean) => void;
    readonly setInput: (text: string) => void;
};
type PreviewActions = {
    readonly resetZoom: () => void;
    readonly setSvg: (svg: string | null) => void;
    readonly setZoom: (value: number) => void;
    readonly zoomIn: () => void;
    readonly zoomOut: () => void;
};
type ContextActions = {
    readonly addAttachment: (ref: SvgAsset) => void;
    readonly clearAttachments: () => void;
    readonly removeAttachment: (id: string) => void;
    readonly setColorMode: (mode: ColorMode) => void;
    readonly setContext: (ctx: ContextState) => void;
    readonly setIntent: (intent: Intent) => void;
    readonly setOutput: (mode: OutputMode) => void;
    readonly toggleColorMode: () => void;
};
type HistoryActions = {
    readonly addAsset: (asset: Asset) => void;
    readonly clearAll: () => void;
    readonly deleteAsset: (id: string) => void;
    readonly selectAsset: (id: string | null) => void;
    readonly setSelectedVariantIndex: (assetId: string, index: number) => void;
};
type HistoryComputed = {
    readonly currentAsset: Asset | null;
    readonly hasSelection: boolean;
};
type LibraryActions = {
    readonly addAsset: (asset: Asset) => void;
    readonly addCustomAsset: (name: string, svg: string) => void;
    readonly clearAssets: () => void;
    readonly removeAsset: (id: string) => void;
    readonly removeCustomAsset: (id: string) => void;
};
type LibraryComputed = {
    readonly getCustomAsset: (id: string) => SvgAsset | undefined;
    readonly isSaved: (id: string) => boolean;
};
type UiActions = {
    readonly closeExportDialog: () => void;
    readonly closeUploadDialog: () => void;
    readonly openExportDialog: () => void;
    readonly openUploadDialog: () => void;
    readonly resetUploadDialog: () => void;
    readonly setExportFormat: (format: ExportFormat) => void;
    readonly setSidebarTab: (tab: SidebarTab) => void;
    readonly setSubmittedContext: (ctx: SubmittedContext) => void;
    readonly setUploadFile: (name: string, svg: string | null, error: string | null) => void;
    readonly setUploadState: (state: UploadState) => void;
    readonly toggleGrid: () => void;
    readonly toggleSafeArea: () => void;
    readonly toggleSidebar: () => void;
};

// --- [SCHEMA] ----------------------------------------------------------------

const MessageSchema = S.Struct({
    content: S.String,
    id: S.typeSchema(Uuidv7.schema),
    role: S.Literal('user', 'assistant'),
    timestamp: Timestamp.schema,
});
const ChatStateSchema = S.Struct({
    input: S.String,
    isGenerating: S.Boolean,
    messages: S.Array(MessageSchema),
});
const PreviewStateSchema = S.Struct({
    currentSvg: S.NullOr(S.String),
    zoom: ZoomFactor.schema,
});
const ContextStateSchema = S.Struct({
    attachments: S.Array(SvgAsset.schema),
    colorMode: ColorMode,
    intent: Intent,
    output: OutputMode,
});
const SubmittedContextSchema = S.NullOr(S.Struct({ context: ContextStateSchema, intent: Intent, prompt: S.String }));
const UiStateSchema = S.Struct({
    activeTab: S.Literal('history', 'inspector', 'library', 'session'),
    exportFormat: S.Literal('png', 'svg', 'zip'),
    isExportOpen: S.Boolean,
    isSidebarOpen: S.Boolean,
    isUploadOpen: S.Boolean,
    showGrid: S.Boolean,
    showSafeArea: S.Boolean,
    submittedContext: SubmittedContextSchema,
    uploadErrorMessage: S.NullOr(S.String),
    uploadFileName: S.String,
    uploadPreviewSvg: S.NullOr(S.String),
    uploadState: S.Literal('error', 'idle', 'preview', 'validating'),
});
const AssetSchema = S.Struct({
    context: ContextStateSchema,
    id: S.typeSchema(Uuidv7.schema),
    intent: Intent,
    prompt: S.String,
    selectedVariantIndex: S.optional(Index.schema),
    timestamp: Timestamp.schema,
    variants: S.Array(SvgAsset.schema),
});
const HistoryStateSchema = S.Struct({
    assets: S.Array(AssetSchema),
    currentId: S.NullOr(S.String),
});
const LibraryStateSchema = S.Struct({
    customAssets: S.Array(SvgAsset.schema),
    savedAssets: S.Array(AssetSchema),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    chat: { input: '', isGenerating: false, messages: [] } as ChatState,
    context: {
        attachments: [],
        colorMode: 'dark',
        intent: 'create',
        output: 'single',
    } as ContextState,
    history: { assets: [], currentId: null, maxItems: PositiveInt.decodeSync(64) },
    library: { customAssets: [], savedAssets: [] } as LibraryState,
    preview: { currentSvg: null, zoom: ZoomFactor.one } as PreviewState,
    ui: {
        activeTab: 'history',
        exportFormat: 'svg',
        isExportOpen: false,
        isSidebarOpen: false,
        isUploadOpen: false,
        showGrid: false,
        showSafeArea: false,
        submittedContext: null,
        uploadErrorMessage: null,
        uploadFileName: '',
        uploadPreviewSvg: null,
        uploadState: 'idle',
    } as UiState,
    variantCount: { batch: VariantCount.decodeSync(3), single: VariantCount.decodeSync(1) },
    zoom: { factor: 1.25, max: TYPES_TUNING.bounds.zoomFactor.max, min: TYPES_TUNING.bounds.zoomFactor.min },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useChatStore = createStore<ChatState & ChatActions>(
    (set, get) => ({
        ...B.chat,
        addMessage: (msg) => set({ messages: [...get().messages, msg] }),
        clearMessages: () => set({ messages: [] }),
        setGenerating: (flag) => set({ isGenerating: flag }),
        setInput: (text) => set({ input: text }),
    }),
    { immer: false, name: 'parametric-icons:chat', persist: false, temporal: false },
);
const usePreviewStore = createStore<PreviewState & PreviewActions>(
    (set, get) => ({
        ...B.preview,
        resetZoom: () => set({ zoom: ZoomFactor.one }),
        setSvg: (svg) => set({ currentSvg: svg }),
        setZoom: (value) =>
            set({ zoom: ZoomFactor.clamp(ZoomFactor.decodeSync(value), ZoomFactor.min, ZoomFactor.max) }),
        zoomIn: () =>
            set({
                zoom: ZoomFactor.clamp(ZoomFactor.scale(get().zoom, B.zoom.factor), ZoomFactor.min, ZoomFactor.max),
            }),
        zoomOut: () =>
            set({
                zoom: ZoomFactor.clamp(ZoomFactor.scale(get().zoom, 1 / B.zoom.factor), ZoomFactor.min, ZoomFactor.max),
            }),
    }),
    {
        immer: false,
        name: 'parametric-icons:preview',
        persist: false,
        temporal: { enabled: true, limit: PositiveInt.decodeSync(50) },
    },
);
const useContextStore = createStore<ContextState & ContextActions>(
    (set, get) => ({
        ...B.context,
        addAttachment: (ref) => set({ attachments: [...get().attachments, ref] }),
        clearAttachments: () => set({ attachments: [] }),
        removeAttachment: (id) => set({ attachments: get().attachments.filter((a) => a.id !== id) }),
        setColorMode: (mode) => set({ colorMode: mode }),
        setContext: (ctx) =>
            set({
                attachments: [...ctx.attachments],
                colorMode: ctx.colorMode,
                intent: ctx.intent,
                output: ctx.output,
            }),
        setIntent: (intent) => set({ intent }),
        setOutput: (mode) => set({ output: mode }),
        toggleColorMode: () => set({ colorMode: get().colorMode === 'dark' ? 'light' : 'dark' }),
    }),
    { immer: false, name: 'parametric-icons:context', temporal: false },
);
const useHistoryStore = createStore<HistoryState & HistoryActions, HistoryComputed>(
    (set, get) => ({
        ...B.history,
        addAsset: (asset) =>
            set({
                assets: [{ ...asset, selectedVariantIndex: Index.decodeSync(0) }, ...get().assets].slice(
                    0,
                    B.history.maxItems,
                ),
                currentId: asset.id,
            }),
        clearAll: () => set({ assets: [], currentId: null }),
        deleteAsset: (id) =>
            set({
                assets: get().assets.filter((a) => a.id !== id),
                currentId: get().currentId === id ? null : get().currentId,
            }),
        selectAsset: (id) => set({ currentId: id }),
        setSelectedVariantIndex: (assetId, index) =>
            set({
                assets: get().assets.map((a) =>
                    a.id === assetId ? { ...a, selectedVariantIndex: Index.decodeSync(index) } : a,
                ),
            }),
    }),
    {
        computed: {
            compute: (state) => ({
                currentAsset: state.assets.find((a) => a.id === state.currentId) ?? null,
                hasSelection: state.currentId !== null,
            }),
        },
        immer: false,
        name: 'parametric-icons:history',
        persist: true,
        temporal: false,
    },
);
const useLibraryStore = createStore<LibraryState & LibraryActions, LibraryComputed>(
    (set, get) => ({
        ...B.library,
        addAsset: (asset) =>
            set({
                savedAssets: get().savedAssets.some((a) => a.id === asset.id)
                    ? get().savedAssets
                    : [...get().savedAssets, asset],
            }),
        addCustomAsset: (name, svgContent) =>
            Option.match(Svg.sanitize(svgContent), {
                onNone: () => {},
                onSome: (svg) => {
                    const id = Uuidv7.generateSync();
                    set({ customAssets: [...get().customAssets, { id, name, svg }] });
                },
            }),
        clearAssets: () => set({ savedAssets: [] }),
        removeAsset: (id) => set({ savedAssets: get().savedAssets.filter((asset) => asset.id !== id) }),
        removeCustomAsset: (id) => set({ customAssets: get().customAssets.filter((a) => a.id !== id) }),
    }),
    {
        computed: {
            compute: (state) => ({
                getCustomAsset: (id: string) => state.customAssets.find((a) => a.id === id),
                isSaved: (id: string) => state.savedAssets.some((asset) => asset.id === id),
            }),
        },
        immer: false,
        name: 'parametric-icons:library',
        persist: true,
        temporal: false,
    },
);
const useUiStore = createStore<UiState & UiActions>(
    (set, get) => ({
        ...B.ui,
        closeExportDialog: () => set({ isExportOpen: false }),
        closeUploadDialog: () => set({ isUploadOpen: false }),
        openExportDialog: () => set({ isExportOpen: true }),
        openUploadDialog: () => set({ isUploadOpen: true }),
        resetUploadDialog: () =>
            set({
                isUploadOpen: false,
                uploadErrorMessage: null,
                uploadFileName: '',
                uploadPreviewSvg: null,
                uploadState: 'idle',
            }),
        setExportFormat: (format) => set({ exportFormat: format }),
        setSidebarTab: (tab) => set({ activeTab: tab }),
        setSubmittedContext: (ctx) => set({ submittedContext: ctx }),
        setUploadFile: (name, svg, error) =>
            set({ uploadErrorMessage: error, uploadFileName: name, uploadPreviewSvg: svg }),
        setUploadState: (state) => set({ uploadState: state }),
        toggleGrid: () => set({ showGrid: !get().showGrid }),
        toggleSafeArea: () => set({ showSafeArea: !get().showSafeArea }),
        toggleSidebar: () => set({ isSidebarOpen: !get().isSidebarOpen }),
    }),
    { immer: false, name: 'parametric-icons:ui', temporal: false },
);

// --- [EXPORT] ----------------------------------------------------------------

export {
    B as STORE_TUNING,
    useChatStore,
    useContextStore,
    useHistoryStore,
    useLibraryStore,
    usePreviewStore,
    useUiStore,
};
export type {
    Asset,
    ChatActions,
    ChatState,
    ContextActions,
    ContextState,
    HistoryActions,
    HistoryComputed,
    HistoryState,
    LibraryActions,
    LibraryComputed,
    LibraryState,
    Message,
    MessageRole,
    PreviewActions,
    PreviewState,
    SidebarTab,
    SubmittedContext,
    UiActions,
    UiState,
    UploadState,
};
