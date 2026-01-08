/**
 * Accessible DnD + Clipboard module wrapping react-aria hooks.
 * Unified interface for drag, drop, and keyboard clipboard operations.
 * Separate from gesture.ts: DnD is discrete (items) vs continuous (coordinates).
 */
import { useMergeRefs } from '@floating-ui/react';
import type { MimeType } from '@parametric-portal/types/files';
import type { CSSProperties, DOMAttributes, Ref, RefObject } from 'react';
import { useMemo, useRef } from 'react';
import {
	mergeProps, useClipboard as useClipboardLib, useDrag as useDragLib, useDrop as useDropLib, type AriaButtonProps, type DragItem,
	type DragOptions, type DragPreviewRenderer, type DragTypes, type DropItem, type DropOperation, type DropOptions, type FileDropItem,
} from 'react-aria';
import { defined } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type DndDragConfig = {
	readonly getAllowedDropOperations?: DragOptions['getAllowedDropOperations'];
	readonly getItems: () => DragItem[];
	readonly hasDragButton?: boolean;
	readonly onDragEnd?: DragOptions['onDragEnd'];
	readonly onDragMove?: DragOptions['onDragMove'];
	readonly onDragStart?: DragOptions['onDragStart'];
	readonly preview?: RefObject<DragPreviewRenderer | null>;
};
type DndDropConfig = {
	readonly getDropOperation?: DropOptions['getDropOperation'];
	readonly getDropOperationForPoint?: DropOptions['getDropOperationForPoint'];
	readonly hasDropButton?: boolean;
	readonly onDrop?: DropOptions['onDrop'];
	readonly onDropActivate?: DropOptions['onDropActivate'];
	readonly onDropEnter?: DropOptions['onDropEnter'];
	readonly onDropExit?: DropOptions['onDropExit'];
	readonly onDropMove?: DropOptions['onDropMove'];
};
type DndClipboardConfig = {
	readonly getItems?: (details: { action: 'copy' | 'cut' }) => DragItem[];
	readonly onCopy?: () => void;
	readonly onCut?: () => void;
	readonly onPaste?: (items: DropItem[]) => void;
};
type DndConfig = {
	readonly clipboard?: DndClipboardConfig;
	readonly drag?: DndDragConfig;
	readonly drop?: DndDropConfig;
	readonly isDisabled?: boolean;
	readonly ref?: Ref<HTMLElement | null>;
};
type DndProps = DOMAttributes<Element> & {
	readonly 'data-dragging'?: '' | undefined;
	readonly 'data-drop-target'?: '' | undefined;
	readonly style?: CSSProperties | undefined;
	readonly tabIndex?: number | undefined;
};
type DndResult = {
	readonly dragButtonProps: AriaButtonProps<'button'> | undefined;
	readonly dropButtonProps: AriaButtonProps<'button'> | undefined;
	readonly isDragging: boolean;
	readonly isDropTarget: boolean;
	readonly props: DndProps;
	readonly ref: Ref<HTMLElement | null>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const emptyItems = (): DragItem[] => [];

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractText = async (item: DropItem, mimeType = 'text/plain'): Promise<string | null> => item.kind === 'text' ? (item).getText(mimeType) : null;
const extractFile = async (item: DropItem): Promise<File | null> => item.kind === 'file' ? await (item).getFile() : null;
const extractFiles = async (items: readonly DropItem[]): Promise<readonly File[]> => Promise.all(items.filter((i): i is FileDropItem => i.kind === 'file').map((i) => i.getFile()));
const createTextItem = (text: string, mimeType = 'text/plain'): DragItem => ({ [mimeType]: text });
const acceptTypes = (...types: MimeType[]) => (dragTypes: DragTypes, allowed: DropOperation[]): DropOperation => types.some((t) => dragTypes.has(t)) ? (allowed[0] ?? 'cancel') : 'cancel';

// --- [ENTRY_POINT] -----------------------------------------------------------

const useDnd = (config: DndConfig): DndResult => {
	const { clipboard, drag, drop, isDisabled = false, ref: externalRef } = config;
	const internalRef = useRef<HTMLElement>(null);
	const mergedRef = useMergeRefs([internalRef, externalRef].filter(Boolean) as Array<Ref<HTMLElement | null>>);
	const enabled = !isDisabled;
	const { dragButtonProps, dragProps, isDragging } = useDragLib({
		getItems: drag?.getItems ?? emptyItems,
		isDisabled: !enabled || !drag,
		...defined({ getAllowedDropOperations: drag?.getAllowedDropOperations, hasDragButton: drag?.hasDragButton, onDragEnd: drag?.onDragEnd, onDragMove: drag?.onDragMove, onDragStart: drag?.onDragStart, preview: drag?.preview }),
	});
	const { dropButtonProps, dropProps, isDropTarget } = useDropLib({
		isDisabled: !enabled || !drop,
		ref: internalRef as RefObject<HTMLElement>,
		...defined({ getDropOperation: drop?.getDropOperation, getDropOperationForPoint: drop?.getDropOperationForPoint, hasDropButton: drop?.hasDropButton, onDrop: drop?.onDrop, onDropActivate: drop?.onDropActivate, onDropEnter: drop?.onDropEnter, onDropExit: drop?.onDropExit, onDropMove: drop?.onDropMove }),
	});
	const { clipboardProps } = useClipboardLib({
		isDisabled: !enabled || !clipboard,
		...defined({ getItems: clipboard?.getItems, onCopy: clipboard?.onCopy, onCut: clipboard?.onCut, onPaste: clipboard?.onPaste }),
	});
	const props = useMemo((): DndProps => {
		const dragP = enabled && drag ? dragProps : {};
		const dropP = enabled && drop ? dropProps : {};
		const clipP = enabled && clipboard ? clipboardProps : {};
		// Data attrs + styles only included when feature is configured (explicit gating)
		// This prevents conflicts when consumer uses useDnd alongside other drop systems (e.g., RAC DropZone)
		// tabIndex: 0 required for keyboard DnD navigation when drop/clipboard is configured
		return {
			...mergeProps(dragP, dropP, clipP),
			...(drag && isDragging && { 'data-dragging': '' as const }),
			...(drop && isDropTarget && { 'data-drop-target': '' as const }),
			...((drop || clipboard) && { tabIndex: 0 as const }),
			style: {
				...((drag || drop) && { touchAction: 'none' }),
				...(drag && { cursor: isDragging ? 'grabbing' : 'grab' }),
				...(drag && isDragging && { userSelect: 'none' }),
			},
		};
	}, [clipboard, clipboardProps, drag, dragProps, drop, dropProps, enabled, isDragging, isDropTarget]);
	return {
		dragButtonProps: drag?.hasDragButton ? dragButtonProps : undefined,
		dropButtonProps: drop?.hasDropButton ? dropButtonProps : undefined,
		isDragging,
		isDropTarget,
		props,
		ref: mergedRef,
	};
};

// --- [EXPORT] ----------------------------------------------------------------

const DndUtils = Object.freeze({ acceptTypes, createTextItem, extractFile, extractFiles, extractText });

export { DndUtils, useDnd };
export type { DndClipboardConfig, DndConfig, DndDragConfig, DndDropConfig, DndProps, DndResult };
