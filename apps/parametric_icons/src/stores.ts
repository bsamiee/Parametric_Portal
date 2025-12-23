/**
 * Application state slices via store factory from @parametric-portal/types.
 */

import type { ExportFormat } from '@parametric-portal/hooks/browser';
import {
    type ApiKeyListItem,
    ApiKeyListItemSchema,
    type ColorMode,
    ColorModeSchema,
    type Intent,
    IntentSchema,
    type OutputMode,
    OutputModeSchema,
    type UserResponse,
    UserResponseSchema,
} from '@parametric-portal/types/database';
import { type StoreSlice, store } from '@parametric-portal/types/stores';
import { type Svg, type SvgAsset, SvgAssetSchema, sanitizeSvg } from '@parametric-portal/types/svg';
import { type Index, IndexSchema, types, type ZoomFactor, ZoomFactorSchema } from '@parametric-portal/types/types';
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type MessageRole = 'user' | 'assistant';
type SidebarTab = 'history' | 'inspector' | 'library' | 'session';
type Message = S.Schema.Type<typeof MessageSchema>;
type ChatState = S.Schema.Type<typeof ChatStateSchema>;
type PreviewState = S.Schema.Type<typeof PreviewStateSchema>;
type ContextState = S.Schema.Type<typeof ContextStateSchema>;
type UiState = S.Schema.Type<typeof UiStateSchema>;
type Asset = S.Schema.Type<typeof AssetSchema>;
type HistoryState = S.Schema.Type<typeof HistoryStateSchema>;
type LibraryState = S.Schema.Type<typeof LibraryStateSchema>;
type AuthState = S.Schema.Type<typeof AuthStateSchema>;
type UploadState = 'error' | 'idle' | 'preview' | 'validating';
type SubmittedContext = { readonly prompt: string; readonly intent: Intent; readonly context: ContextState } | null;

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
    zoom: ZoomFactorSchema,
});

const ContextStateSchema = S.Struct({
    attachments: S.Array(SvgAssetSchema),
    colorMode: ColorModeSchema,
    intent: IntentSchema,
    output: OutputModeSchema,
});

const SubmittedContextSchema = S.NullOr(
    S.Struct({ context: ContextStateSchema, intent: IntentSchema, prompt: S.String }),
);

const UiStateSchema = S.Struct({
    activeTab: S.Literal('history', 'inspector', 'library', 'session'),
    exportFormat: S.Literal('png', 'svg', 'zip'),
    // Export dialog state
    isExportOpen: S.Boolean,
    isSidebarOpen: S.Boolean,
    // Upload dialog state
    isUploadOpen: S.Boolean,
    showGrid: S.Boolean,
    showSafeArea: S.Boolean,
    // Request lifecycle state
    submittedContext: SubmittedContextSchema,
    uploadErrorMessage: S.NullOr(S.String),
    uploadFileName: S.String,
    uploadPreviewSvg: S.NullOr(S.String),
    uploadState: S.Literal('error', 'idle', 'preview', 'validating'),
});

const AssetSchema = S.Struct({
    context: ContextStateSchema,
    id: S.typeSchema(typesApi.brands.uuidv7),
    intent: IntentSchema,
    prompt: S.String,
    selectedVariantIndex: S.optional(IndexSchema),
    timestamp: S.Number,
    variants: S.Array(SvgAssetSchema),
});

const HistoryStateSchema = S.Struct({
    assets: S.Array(AssetSchema),
    currentId: S.NullOr(S.String),
});

const CustomAssetSchema = SvgAssetSchema;

type CustomAsset = S.Schema.Type<typeof CustomAssetSchema>;

const LibraryStateSchema = S.Struct({
    customAssets: S.Array(CustomAssetSchema),
    savedAssets: S.Array(AssetSchema),
});

const AuthStateSchema = S.Struct({
    accessToken: S.NullOr(S.String),
    apiKeys: S.Array(ApiKeyListItemSchema),
    expiresAt: S.NullOr(S.DateFromSelf),
    isAccountOverlayOpen: S.Boolean,
    isAuthOverlayOpen: S.Boolean,
    isLoading: S.Boolean,
    user: S.NullOr(UserResponseSchema),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    auth: {
        accessToken: null,
        apiKeys: [],
        expiresAt: null,
        isAccountOverlayOpen: false,
        isAuthOverlayOpen: false,
        isLoading: false,
        user: null,
    } as AuthState,
    chat: { input: '', isGenerating: false, messages: [] } as ChatState,
    context: {
        attachments: [],
        colorMode: 'dark',
        intent: 'create',
        output: 'single',
    } as ContextState,
    history: { assets: [], currentId: null, maxItems: 64 },
    library: { customAssets: [], savedAssets: [] } as LibraryState,
    preview: { currentSvg: null, zoom: 1 as ZoomFactor } as PreviewState,
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
    readonly addAttachment: (ref: SvgAsset) => void;
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
    // Upload dialog actions
    readonly openUploadDialog: () => void;
    readonly closeUploadDialog: () => void;
    readonly setUploadState: (state: UploadState) => void;
    readonly setUploadFile: (name: string, svg: string | null, error: string | null) => void;
    readonly resetUploadDialog: () => void;
    // Export dialog actions
    readonly openExportDialog: () => void;
    readonly closeExportDialog: () => void;
    readonly setExportFormat: (format: ExportFormat) => void;
    // Request lifecycle actions
    readonly setSubmittedContext: (ctx: SubmittedContext) => void;
};

type AuthActions = {
    readonly addApiKey: (key: ApiKeyListItem) => void;
    readonly clearAuth: () => void;
    readonly closeAccountOverlay: () => void;
    readonly closeAuthOverlay: () => void;
    readonly openAccountOverlay: () => void;
    readonly openAuthOverlay: () => void;
    readonly removeApiKey: (id: string) => void;
    readonly setApiKeys: (keys: ReadonlyArray<ApiKeyListItem>) => void;
    readonly setAuth: (accessToken: string, expiresAt: Date, user: UserResponse) => void;
    readonly setLoading: (flag: boolean) => void;
};

const authSlice: StoreSlice<AuthState, AuthActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addApiKey: (key: ApiKeyListItem) => set({ ...get(), apiKeys: [...get().apiKeys, key] }),
        clearAuth: () => set(B.auth),
        closeAccountOverlay: () => set({ ...get(), isAccountOverlayOpen: false }),
        closeAuthOverlay: () => set({ ...get(), isAuthOverlayOpen: false }),
        openAccountOverlay: () => set({ ...get(), isAccountOverlayOpen: true }),
        openAuthOverlay: () => set({ ...get(), isAuthOverlayOpen: true }),
        removeApiKey: (id: string) => set({ ...get(), apiKeys: get().apiKeys.filter((k) => k.id !== id) }),
        setApiKeys: (keys: ReadonlyArray<ApiKeyListItem>) => set({ ...get(), apiKeys: [...keys] }),
        setAuth: (accessToken: string, expiresAt: Date, user: UserResponse) =>
            set({ ...get(), accessToken, expiresAt, isLoading: false, user }),
        setLoading: (flag: boolean) => set({ ...get(), isLoading: flag }),
    }),
    initialState: B.auth,
    name: 'auth',
});

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
        resetZoom: () => set({ ...get(), zoom: 1 as ZoomFactor }),
        setSvg: (svg: string | null) => set({ ...get(), currentSvg: svg }),
        setZoom: (value: number) =>
            set({ ...get(), zoom: Math.max(B.zoom.min, Math.min(B.zoom.max, value)) as ZoomFactor }),
        zoomIn: () => set({ ...get(), zoom: Math.min(B.zoom.max, get().zoom * B.zoom.factor) as ZoomFactor }),
        zoomOut: () => set({ ...get(), zoom: Math.max(B.zoom.min, get().zoom / B.zoom.factor) as ZoomFactor }),
    }),
    initialState: B.preview,
    name: 'preview',
});

const contextSlice: StoreSlice<ContextState, ContextActions> = storeApi.createSlice({
    actions: (set, get) => ({
        addAttachment: (ref: SvgAsset) => set({ ...get(), attachments: [...get().attachments, ref] }),
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
        closeExportDialog: () => set({ ...get(), isExportOpen: false }),
        closeUploadDialog: () => set({ ...get(), isUploadOpen: false }),
        // Export dialog actions
        openExportDialog: () => set({ ...get(), isExportOpen: true }),
        // Upload dialog actions
        openUploadDialog: () => set({ ...get(), isUploadOpen: true }),
        resetUploadDialog: () =>
            set({
                ...get(),
                isUploadOpen: false,
                uploadErrorMessage: null,
                uploadFileName: '',
                uploadPreviewSvg: null,
                uploadState: 'idle',
            }),
        setExportFormat: (format: ExportFormat) => set({ ...get(), exportFormat: format }),
        setSidebarTab: (tab: SidebarTab) => set({ ...get(), activeTab: tab }),
        // Request lifecycle actions
        setSubmittedContext: (ctx: SubmittedContext) => set({ ...get(), submittedContext: ctx }),
        setUploadFile: (name: string, svg: string | null, error: string | null) =>
            set({ ...get(), uploadErrorMessage: error, uploadFileName: name, uploadPreviewSvg: svg }),
        setUploadState: (state: UploadState) => set({ ...get(), uploadState: state }),
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
                assets: [{ ...asset, selectedVariantIndex: 0 as Index }, ...get().assets].slice(0, B.history.maxItems),
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
                assets: get().assets.map((a) =>
                    a.id === assetId ? { ...a, selectedVariantIndex: index as Index } : a,
                ),
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
            set({ ...get(), customAssets: [...get().customAssets, { id, name, svg: sanitizeSvg(svg) as Svg }] });
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
    auth: authSlice,
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
    authSlice,
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
    AuthActions,
    AuthState,
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
    PreviewActions,
    PreviewState,
    SidebarTab,
    SubmittedContext,
    UiActions,
    UiState,
    UploadState,
};
