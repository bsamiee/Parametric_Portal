/**
 * Mode-dispatched file preview with auto MIME detection.
 * Accepts individual props or file object from useFileUpload hook.
 */
import type { Metadata } from '@parametric-portal/types/files';
import type { LucideIcon } from 'lucide-react';
import { Archive, Code, File, FileText, Image } from 'lucide-react';
import type { FC, ReactNode, Ref } from 'react';
import { cn, Slot } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type FilePreviewProps = {
	readonly className?: string;
	readonly content?: string;
	readonly dataUrl?: string;
	readonly file?: { readonly content: string; readonly dataUrl: string; readonly metadata: Metadata };
	readonly icon?: LucideIcon | ReactNode;
	readonly metadata?: Metadata;
	readonly mode?: Metadata['mode'] | 'unknown';
	readonly ref?: Ref<HTMLDivElement>;
	readonly showMetadata?: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	modeIcons: {
		archive: Archive,
		code: Code,
		document: FileText,
		image: Image,
		model: File,
		svg: Image,
		unknown: File,
	} as const satisfies Record<Metadata['mode'] | 'unknown', LucideIcon>,
	slot: {
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
	},
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const FilePreview: FC<FilePreviewProps> = ({ className, content, dataUrl, file, icon, metadata, mode: modeOverride, ref, showMetadata }) => {
	const meta = file?.metadata ?? metadata;
	if (!meta) return null;
	const mode = modeOverride ?? meta.mode, src = file?.dataUrl ?? dataUrl, svg = file?.content ?? content;
	const visual = (mode === 'image' && src && <img alt={meta.name} className={_B.slot.image} src={src} />) || (mode === 'svg' && svg && <div className={_B.slot.svg} dangerouslySetInnerHTML={{ __html: svg }} />) || Slot.content(icon ?? _B.modeIcons[mode], _B.slot.icon);
	return (
		<div className={cn(_B.slot.base, className)} data-mime={meta.mime} data-mode={mode} data-slot='file-preview' ref={ref}>
			{visual}
			{(showMetadata ?? file != null) && <div className={_B.slot.meta}>{meta.name}</div>}
		</div>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { FilePreview };
export type { FilePreviewProps };
