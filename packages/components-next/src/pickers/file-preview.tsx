/**
 * FilePreview: Mode-dispatched file preview with auto MIME detection.
 * Pure presentation - content pre-sanitized by useFileUpload hook.
 * Accepts either individual props OR a `file` object from useFileUpload.
 */
import { type FileMetadata, type MimeCategory, type MimeType, mimeToCategory } from '@parametric-portal/types/files';
import { Match } from 'effect';
import type { LucideIcon } from 'lucide-react';
import { Archive, Code, File, FileText, Image } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { cn, Slot } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type PreviewMode = MimeCategory | 'svg' | 'unknown';
type ValidatedFileInput = {
	readonly content: string;
	readonly dataUrl: string;
	readonly metadata: FileMetadata;
};
type FilePreviewProps = {
	readonly className?: string;
	readonly content?: string;
	readonly dataUrl?: string;
	readonly file?: ValidatedFileInput;
	readonly icon?: LucideIcon | ReactNode;
	readonly metadata?: FileMetadata;
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
	} as const satisfies Record<PreviewMode, LucideIcon>),
	slot: Object.freeze({
		base: cn(
			'relative flex flex-col items-center justify-center overflow-hidden',
			'w-(--file-preview-width) h-(--file-preview-height)',
			'rounded-(--file-preview-radius) bg-(--file-preview-bg)',
		),
		icon: cn('size-(--file-preview-icon-size) text-(--file-preview-icon-color)'),
		image: cn('w-full h-full object-contain'),
		meta: cn(
			'absolute bottom-0 left-0 right-0 truncate',
			'p-(--file-preview-meta-padding)',
			'bg-(--file-preview-meta-bg)',
			'text-(--file-preview-meta-fg)',
			'text-(--file-preview-meta-font-size)',
		),
		svg: cn('w-full h-full [&>svg]:w-full [&>svg]:h-full'),
	}),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const detectMode = (mimeType: string): PreviewMode =>
	Match.value(mimeType).pipe(
		Match.when('image/svg+xml', () => 'svg' as const),
		Match.orElse(() => (mimeToCategory[mimeType as MimeType] as PreviewMode | undefined) ?? 'unknown'),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const FilePreview: FC<FilePreviewProps> = ({ className, content, dataUrl, file, icon, metadata, mode: modeOverride, ref, showMetadata }) => {
	const m = file?.metadata ?? metadata;
	const mode = m ? (modeOverride ?? detectMode(m.mimeType)) : 'unknown';
	const iconEl = Slot.content(icon ?? B.modeIcons[mode], B.slot.icon);
	const imageEl = mode === 'image' && (file?.dataUrl ?? dataUrl) && <img alt={m?.name} className={B.slot.image} src={file?.dataUrl ?? dataUrl} />;
	const svgContent = file?.content ?? content;
	const svgEl = mode === 'svg' && svgContent && <div className={B.slot.svg} dangerouslySetInnerHTML={{ __html: svgContent }} />;
	const metaEl = m && (showMetadata ?? file != null) && <div className={B.slot.meta}>{m.name}</div>;
	return m ? (
		<div className={cn(B.slot.base, className)} data-mime-type={m.mimeType} data-mode={mode} data-slot='file-preview' ref={ref}>
			{imageEl || svgEl || iconEl}
			{metaEl}
		</div>
	) : null;
};

// --- [EXPORT] ----------------------------------------------------------------

export { FilePreview };
export type { FilePreviewProps };
