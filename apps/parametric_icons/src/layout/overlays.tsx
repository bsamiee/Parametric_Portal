/**
 * Overlay system: types, utilities, hooks, and components for command palette and export dialog.
 */
import type { ExportFormat } from '@parametric-portal/hooks/browser';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useClipboard, useExport, useMutation, useStoreActions, useStoreSlice } from '../core.ts';
import { asyncApi, generateIcon } from '../generation.ts';
import { chatSlice, contextSlice, historySlice, previewSlice } from '../stores.ts';
import { Button, CommandDialog, Dialog, Icon, Spinner, Stack } from '../ui.ts';

// --- [TYPES] -----------------------------------------------------------------

type ExportDialogProps = {
    readonly close: () => void;
    readonly format: ExportFormat;
    readonly handleExport: () => void;
    readonly isOpen: boolean;
    readonly open: () => void;
    readonly setFormat: (f: ExportFormat) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    command: {
        placeholder: 'Type a command or search...',
    },
    export: {
        formats: [
            { key: 'svg', label: 'SVG (Vector)' },
            { key: 'png', label: 'PNG (512x512)' },
            { key: 'zip', label: 'ZIP (All Variants)' },
        ] as ReadonlyArray<{ readonly key: ExportFormat; readonly label: string }>,
        pngSize: 512,
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const useExportDialog = (): ExportDialogProps => {
    const [isOpen, setIsOpen] = useState(false);
    const [format, setFormat] = useState<ExportFormat>('svg');
    const { currentSvg } = useStoreSlice(previewSlice);
    const historyActions = useStoreActions(historySlice);
    const { exportAs } = useExport();
    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);
    const handleExport = () => {
        const currentAsset = historyActions.getCurrentAsset();
        const variants = currentAsset?.variants ?? [];
        const variantCount = variants.length;
        const variantIndex = currentAsset?.selectedVariantIndex ?? 0;

        exportAs({
            filename: currentAsset?.prompt ?? '',
            format,
            pngSize: B.export.pngSize,
            variantCount,
            variantIndex,
            variants,
            ...(currentSvg !== null && { svg: currentSvg }),
        });
        close();
    };

    return { close, format, handleExport, isOpen, open, setFormat };
};

const useCommandPalette = (openExportDialog: () => void) => {
    const [open, setOpen] = useState(false);
    const { input } = useStoreSlice(chatSlice);
    const { currentSvg, zoom } = useStoreSlice(previewSlice);
    const { intent, colorMode, output } = useStoreSlice(contextSlice);
    const chatActions = useStoreActions(chatSlice);
    const previewActions = useStoreActions(previewSlice);
    const { mutate, state } = useMutation(generateIcon);
    const { copy } = useClipboard<string>();
    const isGenerating = asyncApi.isLoading(state);
    const close = () => setOpen(false);
    const variantCount = output === 'batch' ? 3 : 1;

    const actions = {
        clearInput: () => {
            chatActions.setInput('');
            close();
        },
        copyToClipboard: () => {
            currentSvg && copy(currentSvg);
            close();
        },
        exportIcon: () => {
            close();
            openExportDialog();
        },
        generate: () => {
            input.trim() &&
                !isGenerating &&
                mutate({
                    colorMode,
                    intent,
                    prompt: input,
                    referenceSvg: intent === 'refine' ? (currentSvg ?? undefined) : undefined,
                    variantCount,
                });
            close();
        },
        resetZoom: () => {
            previewActions.resetZoom();
            close();
        },
        zoomIn: () => {
            previewActions.zoomIn();
            close();
        },
        zoomOut: () => {
            previewActions.zoomOut();
            close();
        },
    };

    const pages: ReadonlyArray<{
        readonly groups: ReadonlyArray<{
            readonly heading: string;
            readonly items: ReadonlyArray<{
                readonly disabled?: boolean;
                readonly icon: ReactNode;
                readonly key: string;
                readonly keywords: ReadonlyArray<string>;
                readonly label: string;
                readonly onSelect: () => void;
                readonly shortcut: string;
                readonly value: string;
            }>;
            readonly key: string;
        }>;
        readonly key: string;
        readonly placeholder: string;
    }> = [
        {
            groups: [
                {
                    heading: 'Actions',
                    items: [
                        {
                            icon: <Icon name='Wand' />,
                            key: 'generate',
                            keywords: ['create', 'make', 'ai', 'icon', 'prompt'],
                            label: 'Generate Icon',
                            onSelect: actions.generate,
                            shortcut: '⌘ G',
                            value: 'generate icon',
                        },
                        {
                            icon: <Icon name='Eraser' />,
                            key: 'clear',
                            keywords: ['reset', 'empty', 'delete', 'remove'],
                            label: 'Clear Input',
                            onSelect: actions.clearInput,
                            shortcut: '⌘ ⌫',
                            value: 'clear input',
                        },
                    ],
                    key: 'actions',
                },
                {
                    heading: 'Export',
                    items: [
                        {
                            disabled: !currentSvg,
                            icon: <Icon name='Download' />,
                            key: 'export',
                            keywords: ['save', 'download', 'file', 'svg', 'png'],
                            label: 'Export Icon...',
                            onSelect: actions.exportIcon,
                            shortcut: '⌘ S',
                            value: 'export icon',
                        },
                        {
                            disabled: !currentSvg,
                            icon: <Icon name='Clipboard' />,
                            key: 'copy',
                            keywords: ['clipboard', 'paste', 'copy'],
                            label: 'Copy to Clipboard',
                            onSelect: actions.copyToClipboard,
                            shortcut: '⌘ C',
                            value: 'copy clipboard',
                        },
                    ],
                    key: 'export',
                },
                {
                    heading: 'View',
                    items: [
                        {
                            icon: <Icon name='ZoomIn' />,
                            key: 'zoomIn',
                            keywords: ['bigger', 'enlarge', 'magnify', 'scale'],
                            label: `Zoom In (${Math.round(zoom * 100)}%)`,
                            onSelect: actions.zoomIn,
                            shortcut: '⌘ +',
                            value: 'zoom in',
                        },
                        {
                            icon: <Icon name='ZoomOut' />,
                            key: 'zoomOut',
                            keywords: ['smaller', 'shrink', 'reduce', 'scale'],
                            label: `Zoom Out (${Math.round(zoom * 100)}%)`,
                            onSelect: actions.zoomOut,
                            shortcut: '⌘ -',
                            value: 'zoom out',
                        },
                        {
                            icon: <Icon name='Maximize' />,
                            key: 'resetZoom',
                            keywords: ['default', 'original', '100%', 'actual'],
                            label: 'Reset Zoom',
                            onSelect: actions.resetZoom,
                            shortcut: '⌘ 0',
                            value: 'reset zoom',
                        },
                    ],
                    key: 'view',
                },
            ],
            key: 'root',
            placeholder: B.command.placeholder,
        },
    ];

    return { isGenerating, onOpenChange: setOpen, open, pages };
};

const CommandPaletteWithExport = ({ openExportDialog }: { readonly openExportDialog: () => void }): ReactNode => {
    const { isGenerating, onOpenChange, open, pages } = useCommandPalette(openExportDialog);
    return (
        <CommandDialog
            loading={isGenerating}
            loadingContent={
                <Stack direction='row' align='center' gap>
                    <Spinner />
                    <span>Generating...</span>
                </Stack>
            }
            loop
            onOpenChange={onOpenChange}
            open={open}
            pages={pages}
            vimBindings
        />
    );
};

const ExportDialog = ({
    close,
    format,
    handleExport,
    isOpen,
    setFormat,
}: Omit<ExportDialogProps, 'open'>): ReactNode => (
    <Dialog isOpen={isOpen} onClose={close} title='Export Icon' confirmLabel='Export' onConfirm={handleExport}>
        <Stack gap>
            <span className='text-sm opacity-70'>Select export format:</span>
            <Stack direction='row' gap>
                {B.export.formats.map((f) => (
                    <Button
                        key={f.key}
                        variant={format === f.key ? 'primary' : 'outline'}
                        onPress={() => setFormat(f.key)}
                    >
                        {f.label}
                    </Button>
                ))}
            </Stack>
        </Stack>
    </Dialog>
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as OVERLAY_CONFIG, CommandPaletteWithExport, ExportDialog, useExportDialog };
export type { ExportDialogProps };
