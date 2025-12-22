/**
 * Application state slices via store factory from @parametric-portal/types.
 */

import type { ColorMode, Intent, ReferenceAttachment, SvgAsset } from '@parametric-portal/api/contracts/icons';
import { SvgAssetSchema, SvgVariantSchema } from '@parametric-portal/api/contracts/icons';
import { ColorModeSchema, IntentSchema } from '@parametric-portal/types/icons';
import { type StoreSlice, store } from '@parametric-portal/types/stores';
import { types } from '@parametric-portal/types/types';
import { pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type OutputMode = 'single' | 'batch';
type MessageRole = 'user' | 'assistant';
type SidebarTab = 'history' | 'inspector' | 'library' | 'session';
type Message = S.Schema.Type<typeof MessageSchema>;
type ChatState = S.Schema.Type<typeof ChatStateSchema>;
type PreviewState = S.Schema.Type<typeof PreviewStateSchema>;
type ContextState = S.Schema.Type<typeof ContextStateSchema>;
type UiState = S.Schema.Type<typeof UiStateSchema>;
type Asset = S.Schema.Type<typeof AssetSchema>;
type SvgVariant = S.Schema.Type<typeof SvgVariantSchema>;
type HistoryState = S.Schema.Type<typeof HistoryStateSchema>;
type LibraryState = S.Schema.Type<typeof LibraryStateSchema>;

// --- [SCHEMA] ----------------------------------------------------------------

const typesApi = types();

const MessageSchema = S.Struct({
    content: S.String,
    id: S.typeSchema(typesApi.brands.uuidv7),
    role: S.Literal('user', 'assistant'),
    timestamp: S.Number,
});

const ChatStateSchema = S.Struct({
    input: S.String,
    isGenerating: S.Boolean,
    messages: S.Array(MessageSchema),
});

const PreviewStateSchema = S.Struct({
    currentSvg: S.NullOr(S.String),
    zoom: pipe(S.Number, S.between(0.1, 10)),
});

const ContextStateSchema = S.Struct({
    attachments: S.Array(SvgAssetSchema),
    colorMode: ColorModeSchema,
    intent: IntentSchema,
    output: S.Literal('single', 'batch'),
});

const UiStateSchema = S.Struct({
    activeTab: S.Literal('history', 'inspector', 'library', 'session'),
    isSidebarOpen: S.Boolean,
    showGrid: S.Boolean,
    showSafeArea: S.Boolean,
});

const AssetSchema = S.Struct({
    context: ContextStateSchema,
    id: S.typeSchema(typesApi.brands.uuidv7),
    intent: IntentSchema,
    prompt: S.String,
    selectedVariantIndex: S.optional(pipe(S.Number, S.int(), S.greaterThanOrEqualTo(0))),
    timestamp: S.Number,
    variants: S.Array(SvgVariantSchema),
});

const HistoryStateSchema = S.Struct({
    assets: S.Array(AssetSchema),
    currentId: S.NullOr(S.String),
});

// CustomAsset is now an alias to SvgAsset
const CustomAssetSchema = SvgAssetSchema;
type CustomAsset = SvgAsset;

const LibraryStateSchema = S.Struct({
    customAssets: S.Array(CustomAssetSchema),
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
    history: { assets: [], currentId: null, maxItems: 64 },
    library: { customAssets: [], savedAssets: [] } as LibraryState,
    preview: { currentSvg: null, zoom: 1 } as PreviewState,
    ui: { activeTab: 'history', isSidebarOpen: false, showGrid: false, showSafeArea: false } as UiState,
    variantCount: { batch: 3, single: 1 },
    zoom: { factor: 1.25, max: 10, min: 0.1 },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const storeApi = store({ enableDevtools: true, name: 'parametric-icons' });

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
    readonly addAttachment: (ref: ReferenceAttachment) => void;
    readonly clearAttachments: () => void;
    readonly removeAttachment: (id: string) => void;
    readonly setColorMode: (mode: ColorMode) => void;
    readonly setIntent: (intent: Intent) => void;
    readonly setOutput: (mode: OutputMode) => void;
    readonly toggleColorMode: () => void;
};

type HistoryActions = {
    readonly addAsset: (asset: Asset) => void;
    readonly clearAll: () => void;
    readonly deleteAsset: (id: string) => void;
    readonly findAsset: (id: string) => Asset | undefined;
    readonly getCurrentAsset: () => Asset | undefined;
    readonly selectAsset: (id: string | null) => void;
    readonly setSelectedVariantIndex: (assetId: string, index: number) => void;
};

type LibraryActions = {
    readonly addAsset: (asset: Asset) => void;
    readonly addCustomAsset: (name: string, svg: string) => void;
    readonly clearAssets: () => void;
    readonly getCustomAsset: (id: string) => CustomAsset | undefined;
    readonly isSaved: (id: string) => boolean;
    readonly removeCustomAsset: (id: string) => void;
    readonly removeAsset: (id: string) => void;
};

type UiActions = {
    readonly setSidebarTab: (tab: SidebarTab) => void;
    readonly toggleGrid: () => void;
    readonly toggleSafeArea: () => void;
    readonly toggleSidebar: () => void;
};

const chatSlice: StoreSlice<ChatState, ChatActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addMessage: (msg: Message) => set({ ...get(), messages: [...get().messages, msg] }),
        clearMessages: () => set({ ...get(), messages: [] }),
        setGenerating: (flag: boolean) => set({ ...get(), isGenerating: flag }),
        setInput: (text: string) => set({ ...get(), input: text }),
    }),
    initialState: B.chat,
    name: 'chat',
});

const previewSlice: StoreSlice<PreviewState, PreviewActions> = storeApi.createSlice({
    actions: (set, get) => ({
        resetZoom: () => set({ ...get(), zoom: 1 }),
        setSvg: (svg: string | null) => set({ ...get(), currentSvg: svg }),
        setZoom: (value: number) => set({ ...get(), zoom: Math.max(B.zoom.min, Math.min(B.zoom.max, value)) }),
        zoomIn: () => set({ ...get(), zoom: Math.min(B.zoom.max, get().zoom * B.zoom.factor) }),
        zoomOut: () => set({ ...get(), zoom: Math.max(B.zoom.min, get().zoom / B.zoom.factor) }),
    }),
    initialState: B.preview,
    name: 'preview',
});

const contextSlice: StoreSlice<ContextState, ContextActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addAttachment: (ref: ReferenceAttachment) => set({ ...get(), attachments: [...get().attachments, ref] }),
        clearAttachments: () => set({ ...get(), attachments: [] }),
        removeAttachment: (id: string) => set({ ...get(), attachments: get().attachments.filter((a) => a.id !== id) }),
        setColorMode: (mode: ColorMode) => set({ ...get(), colorMode: mode }),
        setIntent: (intent: Intent) => set({ ...get(), intent }),
        setOutput: (mode: OutputMode) => set({ ...get(), output: mode }),
        toggleColorMode: () => set({ ...get(), colorMode: get().colorMode === 'dark' ? 'light' : 'dark' }),
    }),
    initialState: B.context,
    name: 'context',
});

const uiSlice: StoreSlice<UiState, UiActions> = storeApi.createSlice({
    actions: (set, get) => ({
        setSidebarTab: (tab: SidebarTab) => set({ ...get(), activeTab: tab }),
        toggleGrid: () => set({ ...get(), showGrid: !get().showGrid }),
        toggleSafeArea: () => set({ ...get(), showSafeArea: !get().showSafeArea }),
        toggleSidebar: () => set({ ...get(), isSidebarOpen: !get().isSidebarOpen }),
    }),
    initialState: B.ui,
    name: 'ui',
});

const historySlice: StoreSlice<HistoryState, HistoryActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addAsset: (asset: Asset) =>
            set({
                ...get(),
                assets: [{ ...asset, selectedVariantIndex: 0 }, ...get().assets].slice(0, B.history.maxItems),
                currentId: asset.id,
            }),
        clearAll: () => set({ ...get(), assets: [], currentId: null }),
        deleteAsset: (id: string) =>
            set({
                ...get(),
                assets: get().assets.filter((a) => a.id !== id),
                currentId: get().currentId === id ? null : get().currentId,
            }),
        findAsset: (id: string) => get().assets.find((a) => a.id === id),
        getCurrentAsset: () => get().assets.find((a) => a.id === get().currentId),
        selectAsset: (id: string | null) => set({ ...get(), currentId: id }),
        setSelectedVariantIndex: (assetId: string, index: number) =>
            set({
                ...get(),
                assets: get().assets.map((a) => (a.id === assetId ? { ...a, selectedVariantIndex: index } : a)),
            }),
    }),
    initialState: { assets: [] as ReadonlyArray<Asset>, currentId: null as string | null },
    name: 'history',
});

const librarySlice: StoreSlice<LibraryState, LibraryActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addAsset: (asset: Asset) =>
            set({
                ...get(),
                savedAssets: get().savedAssets.some((a) => a.id === asset.id)
                    ? get().savedAssets
                    : [...get().savedAssets, asset],
            }),
        addCustomAsset: (name: string, svg: string) => {
            const id = typesApi.generateUuidv7Sync();
            set({ ...get(), customAssets: [...get().customAssets, { id, name, svg }] });
        },
        clearAssets: () => set({ ...get(), savedAssets: [] }),
        getCustomAsset: (id: string) => get().customAssets.find((a) => a.id === id),
        isSaved: (id: string) => get().savedAssets.some((asset) => asset.id === id),
        removeAsset: (id: string) =>
            set({ ...get(), savedAssets: get().savedAssets.filter((asset) => asset.id !== id) }),
        removeCustomAsset: (id: string) =>
            set({ ...get(), customAssets: get().customAssets.filter((a) => a.id !== id) }),
    }),
    initialState: B.library,
    name: 'library',
});

const appStore = storeApi.combineSlices({
    chat: chatSlice,
    context: contextSlice,
    history: historySlice,
    library: librarySlice,
    preview: previewSlice,
    ui: uiSlice,
});

// --- [EXPORT] ----------------------------------------------------------------

export {
    appStore,
    B as STORE_TUNING,
    chatSlice,
    contextSlice,
    historySlice,
    librarySlice,
    previewSlice,
    storeApi,
    uiSlice,
};
export type {
    Asset,
    ChatActions,
    ChatState,
    ContextActions,
    ContextState,
    CustomAsset,
    HistoryActions,
    HistoryState,
    LibraryActions,
    LibraryState,
    Message,
    MessageRole,
    OutputMode,
    PreviewActions,
    PreviewState,
    SidebarTab,
    SvgVariant,
    UiActions,
    UiState,
};
