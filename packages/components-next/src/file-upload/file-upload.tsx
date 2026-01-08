/**
 * FileUpload: DropZone + FileTrigger + clipboard paste integration.
 * Pure presentation - async state from external useFileUpload hook.
 * REQUIRED: accept prop for MIME type filtering.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref } from 'react';
import { useMemo } from 'react';
import { type DropEvent, type DropItem, type FileDropItem, useClipboard } from 'react-aria';
import { DropZone, type DropZoneRenderProps, FileTrigger } from 'react-aria-components';
import type { BasePropsFor } from '../core/props';
import { cn, defined } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DropActivateEvent = { readonly x: number; readonly y: number };
type FileUploadRenderProps = { readonly isDropTarget: boolean };
type FileUploadSpecificProps = {
	readonly accept: ReadonlyArray<string>;
	readonly acceptDirectory?: boolean;
	readonly children?: ReactNode | ((state: FileUploadRenderProps) => ReactNode);
	readonly className?: string;
	readonly defaultCamera?: 'environment' | 'user';
	readonly multiple?: boolean;
	readonly onDropActivate?: (e: DropActivateEvent) => void;
	readonly onDropEnter?: () => void;
	readonly onDropExit?: () => void;
	readonly onFilesChange: (files: ReadonlyArray<File>) => void;
	readonly ref?: Ref<HTMLDivElement>;
	readonly trigger?: ReactNode;
};
type FileUploadProps = BasePropsFor<'fileUpload'> & FileUploadSpecificProps;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		base: cn(
			'relative flex flex-col items-center justify-center',
			'w-(--file-upload-width) min-h-(--file-upload-height)',
			'rounded-(--file-upload-radius) bg-(--file-upload-bg)',
			'border-(--file-upload-border-width) border-(--file-upload-border-style)',
			'border-(--file-upload-idle-border)',
			'transition-colors duration-(--file-upload-transition-duration)',
			'data-[drop-target]:border-(--file-upload-active-border)',
			'data-[async-state=failure]:border-(--file-upload-error-border)',
			'disabled:opacity-(--file-upload-disabled-opacity) disabled:pointer-events-none',
			'data-[focus-visible]:ring-(--focus-ring-width) data-[focus-visible]:ring-(--focus-ring-color) data-[focus-visible]:z-(--focus-ring-z)',
		),
	}),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractFilesFromDrop = async (event: DropEvent): Promise<ReadonlyArray<File>> => {
	const fileItems = event.items.filter((item): item is FileDropItem => item.kind === 'file');
	return Promise.all(fileItems.map((item) => item.getFile()));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const FileUpload: FC<FileUploadProps> = ({
	accept, acceptDirectory, asyncState, children, className, defaultCamera, isDisabled,
	multiple = false, onDropActivate, onDropEnter, onDropExit, onFilesChange, ref, trigger,
}) => {
	const handlers = useMemo(
		() =>
			({
				getDropOp: (types: { has: (t: string) => boolean }): 'copy' | 'cancel' => accept.some((t) => types.has(t)) ? 'copy' : 'cancel',
				onDrop: (e: DropEvent) => void extractFilesFromDrop(e).then((f) => f.length > 0 && onFilesChange(f)),
				onPaste: (items: DropItem[]) => {
					const validItems = items.filter((i): i is FileDropItem => i.kind === 'file' && accept.includes(i.type));
					return void Promise.all(validItems.map((i) => i.getFile())).then((f) => f.length > 0 && onFilesChange(f));
				},
				onSelect: (fl: FileList | null) => fl && fl.length > 0 && onFilesChange(Array.from(fl)),
			}) as const,
		[accept, onFilesChange],
	);
	const { clipboardProps } = useClipboard({ onPaste: handlers.onPaste });
	return (
		<DropZone
			getDropOperation={handlers.getDropOp}
			isDisabled={isDisabled === true}
			onDrop={handlers.onDrop}
			{...defined({ onDropActivate, onDropEnter, onDropExit })}
		>
			{(renderProps: DropZoneRenderProps) => (
				<div
					{...clipboardProps}
					className={cn(B.slot.base, className)}
					data-async-state={AsyncState.toAttr(asyncState)}
					data-drop-target={renderProps.isDropTarget || undefined}
					data-slot='file-upload'
					ref={ref}
				>
					{trigger && (
						<FileTrigger
							acceptedFileTypes={accept as string[]}
							allowsMultiple={multiple}
							onSelect={handlers.onSelect}
							{...(acceptDirectory === true && { acceptDirectory: true })}
							{...defined({ defaultCamera })}
						>
							{trigger}
						</FileTrigger>
					)}
					{typeof children === 'function' ? children({ isDropTarget: renderProps.isDropTarget }) : children}
				</div>
			)}
		</DropZone>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { FileUpload };
export type { DropActivateEvent, FileUploadProps, FileUploadRenderProps };
