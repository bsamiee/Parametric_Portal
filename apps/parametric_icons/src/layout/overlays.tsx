/**
 * Overlay system: export and upload dialog components with hooks.
 */

import { useExport } from '@parametric-portal/runtime/hooks/browser';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { fileOpsImpl } from '@parametric-portal/runtime/hooks/file';
import { type ExportFormat, PngSizeSchema } from '@parametric-portal/types/browser';
import { validateContent } from '@parametric-portal/types/files';
import { sanitizeSvg } from '@parametric-portal/types/svg';
import { Index, VariantCount } from '@parametric-portal/types/types';
import { Effect, Schema as S } from 'effect';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { type UploadState, useHistoryStore, usePreviewStore, useUiStore } from '../stores.ts';
import { Button, Dialog, Icon, Spinner, Stack, SvgPreview, UploadTrigger, UploadZone } from '../ui.ts';

// --- [TYPES] -----------------------------------------------------------------

type ExportDialogProps = {
    readonly close: () => void;
    readonly format: ExportFormat;
    readonly handleExport: () => void;
    readonly isOpen: boolean;
    readonly open: () => void;
    readonly setFormat: (f: ExportFormat) => void;
};
type UploadDialogProps = {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onUpload: (name: string, svg: string) => void;
};
type StateRendererProps = {
    readonly errorMessage: string | null;
    readonly fileName: string;
    readonly handleFiles: (fileList: FileList | null) => void;
    readonly previewSvg: string | null;
    readonly reset: () => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    export: {
        formats: [
            { key: 'svg', label: 'SVG (Vector)' },
            { key: 'png', label: 'PNG (512x512)' },
            { key: 'zip', label: 'ZIP (All Variants)' },
        ] as ReadonlyArray<{ readonly key: ExportFormat; readonly label: string }>,
        pngSize: 512,
    },
    upload: {
        browseText: 'browse',
        dropText: 'Drop SVG file here or',
        errorPrefix: 'Invalid SVG:',
        title: 'Upload SVG',
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const uploadStateRenderers = {
    error: ({ errorMessage, reset }: StateRendererProps): ReactNode => (
        <Stack gap align='center' className='py-8'>
            <Icon name='CircleAlert' className='w-12 h-12 text-red-500' />
            <span className='text-red-500'>
                {B.upload.errorPrefix} {errorMessage}
            </span>
            <Button variant='outline' onPress={reset}>
                Try Again
            </Button>
        </Stack>
    ),
    idle: ({ handleFiles }: StateRendererProps): ReactNode => (
        <UploadZone onDrop={handleFiles} className='p-8'>
            {({ isDropTarget }) => (
                <Stack gap align='center' className={isDropTarget ? 'opacity-100' : 'opacity-70'}>
                    <Icon name='Upload' className='w-12 h-12' />
                    <span>
                        {B.upload.dropText}{' '}
                        <UploadTrigger accept='image/svg+xml' onSelect={handleFiles}>
                            <button type='button' className='text-(--ctrl-primary-bg) underline cursor-pointer'>
                                {B.upload.browseText}
                            </button>
                        </UploadTrigger>
                    </span>
                </Stack>
            )}
        </UploadZone>
    ),
    preview: ({ fileName, previewSvg, reset }: StateRendererProps): ReactNode => (
        <Stack gap>
            <div className='w-full aspect-square max-h-64 bg-(--panel-bg-light) rounded-lg overflow-hidden border border-(--panel-border-dark)'>
                {previewSvg && <SvgPreview svg={previewSvg} sanitize={sanitizeSvg} className='w-full h-full' />}
            </div>
            <Stack direction='row' justify='between' align='center'>
                <span className='text-sm opacity-70'>{fileName}.svg</span>
                <Button variant='ghost' onPress={reset}>
                    <Icon name='X' />
                    Clear
                </Button>
            </Stack>
        </Stack>
    ),
    validating: (): ReactNode => (
        <Stack gap align='center' className='py-8'>
            <Spinner />
            <span>Validating SVG...</span>
        </Stack>
    ),
} as const satisfies Record<UploadState, (props: StateRendererProps) => ReactNode>;

// --- [ENTRY_POINT] -----------------------------------------------------------

const useExportDialog = (): ExportDialogProps => {
    const isOpen = useUiStore((s) => s.isExportOpen);
    const format = useUiStore((s) => s.exportFormat);
    const openExportDialog = useUiStore((s) => s.openExportDialog);
    const closeExportDialog = useUiStore((s) => s.closeExportDialog);
    const setExportFormat = useUiStore((s) => s.setExportFormat);
    const currentSvg = usePreviewStore((s) => s.currentSvg);
    const currentAsset = useHistoryStore((s) => s.currentAsset);
    const { exportAs } = useExport();
    const open = openExportDialog;
    const close = closeExportDialog;
    const setFormat = setExportFormat;
    const handleExport = () => {
        const variants = currentAsset?.variants ?? [];
        exportAs({
            filename: currentAsset?.prompt ?? '',
            format,
            pngSize: S.decodeUnknownSync(PngSizeSchema)(B.export.pngSize),
            variantCount: VariantCount.decodeSync(variants.length),
            variantIndex: Index.decodeSync(currentAsset?.selectedVariantIndex ?? 0),
            variants,
            ...(currentSvg !== null && { svg: currentSvg }),
        });
        close();
    };
    return { close, format, handleExport, isOpen, open, setFormat };
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
const UploadDialog = ({ isOpen, onClose, onUpload }: UploadDialogProps): ReactNode => {
    const uploadState = useUiStore((s) => s.uploadState);
    const fileName = useUiStore((s) => s.uploadFileName);
    const previewSvg = useUiStore((s) => s.uploadPreviewSvg);
    const errorMessage = useUiStore((s) => s.uploadErrorMessage);
    const setUploadState = useUiStore((s) => s.setUploadState);
    const setUploadFile = useUiStore((s) => s.setUploadFile);
    const resetUploadDialog = useUiStore((s) => s.resetUploadDialog);
    const reset = useCallback(() => resetUploadDialog(), [resetUploadDialog]);
    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);
    const validateMutation = useEffectMutate<string, File, { message: string }, never>(
        (file) =>
            Effect.gen(function* () {
                const content = yield* fileOpsImpl.toText(file);
                const validContent = yield* validateContent('image/svg+xml', content);
                return sanitizeSvg(validContent);
            }),
        {
            onError: (err, file) => {
                const name = file.name.replace(/\.svg$/i, '');
                setUploadFile(name, null, err.message);
                setUploadState('error');
            },
            onSuccess: (svg, file) => {
                const name = file.name.replace(/\.svg$/i, '');
                setUploadFile(name, svg, null);
                setUploadState('preview');
            },
        },
    );
    const processFile = useCallback(
        (file: File) => {
            const name = file.name.replace(/\.svg$/i, '');
            setUploadState('validating');
            setUploadFile(name, null, null);
            validateMutation.mutate(file);
        },
        [setUploadState, setUploadFile, validateMutation],
    );
    const handleFiles = useCallback(
        (fileList: FileList | null) => {
            const file = fileList?.[0];
            file && processFile(file);
        },
        [processFile],
    );
    const handleConfirm = useCallback(() => {
        previewSvg && onUpload(fileName || 'Untitled', previewSvg);
        handleClose();
    }, [previewSvg, fileName, onUpload, handleClose]);
    return (
        <Dialog
            isOpen={isOpen}
            onClose={handleClose}
            title={B.upload.title}
            confirmLabel='Add to Library'
            onConfirm={handleConfirm}
            confirmDisabled={uploadState !== 'preview'}
        >
            {uploadStateRenderers[uploadState]({ errorMessage, fileName, handleFiles, previewSvg, reset })}
        </Dialog>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { ExportDialog, UploadDialog, useExportDialog };
