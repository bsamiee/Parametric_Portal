/**
 * FilePreview: Mode-dispatched file preview with auto MIME detection.
 * Pure presentation - content pre-sanitized by useFileUpload hook.
 * REQUIRED: metadata prop with mimeType for mode detection.
 */
import { type FileMetadata, type MimeCategory, type MimeType, mimeToCategory } from '@parametric-portal/types/files';
import { Archive, Code, File, FileText, Image } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { cn } from '../core/css-slots';
import { renderSlotContent, type SlotInput } from '../core/slots';

// --- [TYPES] -----------------------------------------------------------------

type PreviewMode = MimeCategory | 'svg' | 'unknown';
type FilePreviewProps = {
    readonly className?: string;
    readonly content?: string;
    readonly dataUrl?: string;
    readonly icon?: SlotInput;
    readonly metadata: FileMetadata;
    readonly mode?: PreviewMode;
    readonly ref?: Ref<HTMLDivElement>;
    readonly showMetadata?: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    modeIcons: Object.freeze({
        archive: Archive,
        code: Code,
        document: FileText,
        image: Image,
        model: File,
        svg: Image,
        unknown: File,
    } as const satisfies Record<PreviewMode, SlotInput>),
    slot: Object.freeze({
        base: cn(
            'relative flex flex-col items-center justify-center overflow-hidden',
            'w-(--file-preview-width) h-(--file-preview-height)',
            'rounded-(--file-preview-radius) bg-(--file-preview-bg)',
        ),
        icon: cn('size-(--file-preview-icon-size) text-(--file-preview-icon-color)'),
        image: cn('w-full h-full object-contain'),
        meta: cn('absolute bottom-0 left-0 right-0 p-2 bg-black/50 text-white text-xs truncate'),
        svg: cn('w-full h-full [&>svg]:w-full [&>svg]:h-full'),
    }),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const detectMode = (mimeType: string): PreviewMode =>
    mimeType === 'image/svg+xml'
        ? 'svg'
        : ((mimeToCategory[mimeType as MimeType] as PreviewMode | undefined) ?? 'unknown');
const renderModeContent = (
    mode: PreviewMode,
    icon: SlotInput,
    content: string | undefined,
    dataUrl: string | undefined,
    metadata: FileMetadata,
    showMetadata: boolean,
): ReactNode => {
    const metaEl = showMetadata && <div className={B.slot.meta}>{metadata.name}</div>;
    const contentByMode = {
        archive: () => (
            <>
                {renderSlotContent(icon, B.slot.icon)}
                {metaEl}
            </>
        ),
        code: () => (
            <>
                {renderSlotContent(icon, B.slot.icon)}
                {metaEl}
            </>
        ),
        document: () => (
            <>
                {renderSlotContent(icon, B.slot.icon)}
                {metaEl}
            </>
        ),
        image: () => (
            <>
                {dataUrl ? (
                    <img alt={metadata.name} className={B.slot.image} src={dataUrl} />
                ) : (
                    renderSlotContent(icon, B.slot.icon)
                )}
                {metaEl}
            </>
        ),
        model: () => (
            <>
                {renderSlotContent(icon, B.slot.icon)}
                {metaEl}
            </>
        ),
        svg: () => (
            <>
                {content ? (
                    <div className={B.slot.svg} dangerouslySetInnerHTML={{ __html: content }} />
                ) : (
                    renderSlotContent(icon, B.slot.icon)
                )}
                {metaEl}
            </>
        ),
        unknown: () => (
            <>
                {renderSlotContent(icon, B.slot.icon)}
                {metaEl}
            </>
        ),
    } as const satisfies Record<PreviewMode, () => ReactNode>;
    return contentByMode[mode]();
};

// --- [COMPONENTS] ------------------------------------------------------------

const FilePreview: FC<FilePreviewProps> = ({
    className,
    content,
    dataUrl,
    icon,
    metadata,
    mode: modeOverride,
    ref,
    showMetadata = false,
}) => {
    const mode = modeOverride ?? detectMode(metadata.mimeType);
    const effectiveIcon = icon ?? B.modeIcons[mode];
    return (
        <div
            className={cn(B.slot.base, className)}
            data-mime-type={metadata.mimeType}
            data-mode={mode}
            data-slot='file-preview'
            ref={ref}
        >
            {renderModeContent(mode, effectiveIcon, content, dataUrl, metadata, showMetadata)}
        </div>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILE_PREVIEW_TUNING, FilePreview };
export type { FilePreviewProps, PreviewMode };
