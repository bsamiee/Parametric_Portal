/**
 * FileUpload: Unified DnD (drop + clipboard) + FileTrigger.
 * Pure presentation - async state from external useFileUpload hook.
 * REQUIRED: accept prop for MIME type filtering.
 * Uses RAC DropZone + useClipboard directly.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref } from 'react';
import { useCallback, useMemo } from 'react';
import type { DragTypes, DropItem, DropOperation, FileDropItem } from 'react-aria';
import { useClipboard } from 'react-aria';
import { DropZone, FileTrigger } from 'react-aria-components';
import { cn, defined } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type FileUploadRenderProps = { readonly isDropTarget: boolean };
type FileUploadProps = {
	readonly accept: ReadonlyArray<string>;
	readonly acceptDirectory?: boolean;
	readonly asyncState?: AsyncState;
	readonly children?: ReactNode | ((state: FileUploadRenderProps) => ReactNode);
	readonly className?: string;
	readonly defaultCamera?: 'environment' | 'user';
	readonly isDisabled?: boolean;
	readonly multiple?: boolean;
	readonly onDropActivate?: () => void;
	readonly onDropEnter?: () => void;
	readonly onDropExit?: () => void;
	readonly onFilesChange: (files: ReadonlyArray<File>) => void;
	readonly ref?: Ref<HTMLDivElement>;
	readonly trigger?: ReactNode;
};

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

// --- [ENTRY_POINT] -----------------------------------------------------------

const extractFiles = async (items: readonly DropItem[]): Promise<readonly File[]> =>
	Promise.all(items.filter((i): i is FileDropItem => i.kind === 'file').map((i) => i.getFile()));
const acceptTypes = (...types: readonly string[]) =>
	(dragTypes: DragTypes, allowed: DropOperation[]): DropOperation =>
		types.some((t) => dragTypes.has(t)) ? (allowed[0] ?? 'cancel') : 'cancel';
const FileUpload: FC<FileUploadProps> = ({
	accept, acceptDirectory, asyncState, children, className, defaultCamera, isDisabled,
	multiple = false, onDropActivate, onDropEnter, onDropExit, onFilesChange, ref, trigger,
}) => {
	const onDropHandler = useCallback(
		(e: { items: readonly DropItem[] }) => void extractFiles(e.items).then((f) => f.length > 0 && onFilesChange(f)),
		[onFilesChange],
	);
	const onPaste = useCallback(
		(items: DropItem[]) => {
			const validItems = items.filter((i): i is FileDropItem => i.kind === 'file' && accept.includes(i.type));
			return void Promise.all(validItems.map((i) => i.getFile())).then((f) => f.length > 0 && onFilesChange(f));
		},
		[accept, onFilesChange],
	);
	const onSelect = useCallback(
		(fl: FileList | null) => fl && fl.length > 0 && onFilesChange(Array.from(fl)),
		[onFilesChange],
	);
	const getDropOperation = useMemo(() => acceptTypes(...accept), [accept]);
	const { clipboardProps } = useClipboard({ onPaste, ...defined({ isDisabled }) });
	return (
		<DropZone
			getDropOperation={getDropOperation}
			onDrop={onDropHandler}
			{...defined({ isDisabled, onDropActivate, onDropEnter, onDropExit })}
		>
			{({ isDropTarget, isFocusVisible }) => (
				<div
					{...clipboardProps}
					className={cn(B.slot.base, className)}
					data-async-state={AsyncState.toAttr(asyncState)}
					data-drop-target={isDropTarget || undefined}
					data-focus-visible={isFocusVisible || undefined}
					data-slot='file-upload'
					ref={ref}
				>
					{trigger && (
						<FileTrigger
							acceptedFileTypes={accept as string[]}
							allowsMultiple={multiple}
							onSelect={onSelect}
							{...(acceptDirectory === true && { acceptDirectory: true })}
							{...defined({ defaultCamera })}
						>
							{trigger}
						</FileTrigger>
					)}
					{typeof children === 'function' ? children({ isDropTarget }) : children}
				</div>
			)}
		</DropZone>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { FileUpload };
export type { FileUploadProps };
