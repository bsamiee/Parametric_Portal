/**
 * Overlay system: export and upload dialog components with hooks.
 */
import type { ExportFormat } from '@parametric-portal/hooks/browser';
import { readFileAsText } from '@parametric-portal/hooks/file';
import { files } from '@parametric-portal/types/files';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useExport, useRuntime, useStoreActions, useStoreSlice } from '../core.ts';
import { sanitizeSvg } from '../generation.ts';
import { historySlice, previewSlice } from '../stores.ts';
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

type UploadState = 'error' | 'idle' | 'preview' | 'validating';

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

const filesApi = files();

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
    const runtime = useRuntime();
    const [uploadState, setUploadState] = useState<UploadState>('idle');
    const [fileName, setFileName] = useState('');
    const [previewSvg, setPreviewSvg] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const reset = useCallback(() => {
        setUploadState('idle');
        setFileName('');
        setPreviewSvg(null);
        setErrorMessage(null);
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    const processFile = useCallback(
        (file: File) => {
            setUploadState('validating');
            setFileName(file.name.replace(/\.svg$/i, ''));
            setErrorMessage(null);

            runtime
                .runPromise(readFileAsText(file))
                .then((content) =>
                    runtime
                        .runPromise(filesApi.validateSvgContent(content))
                        .then((validContent) => {
                            setPreviewSvg(sanitizeSvg(validContent));
                            setUploadState('preview');
                        })
                        .catch((err: { message: string }) => {
                            setErrorMessage(err.message);
                            setUploadState('error');
                        }),
                )
                .catch((err: { message: string }) => {
                    setErrorMessage(err.message);
                    setUploadState('error');
                });
        },
        [runtime],
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

export { B as OVERLAY_CONFIG, ExportDialog, UploadDialog, useExportDialog };
export type { ExportDialogProps, UploadDialogProps, UploadState };
