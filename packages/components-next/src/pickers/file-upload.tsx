/**
 * Unified DnD (drop + clipboard) and FileTrigger for file selection.
 * Requires accept prop for MIME type filtering. Uses RAC DropZone + useClipboard.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref } from 'react';
import { useCallback, useMemo } from 'react';
import type { DirectoryDropItem, DragTypes, DropItem, DropOperation, FileDropItem } from 'react-aria';
import { useClipboard } from 'react-aria';
import { DropZone, FileTrigger } from 'react-aria-components';
import { Toast, type ToastTrigger } from '../core/toast';
import { cn, defined } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type FileUploadRenderProps = { readonly isDropTarget: boolean; readonly progress: number };
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
    readonly progress?: number;
    readonly ref?: Ref<HTMLDivElement>;
    readonly toast?: ToastTrigger;
    readonly trigger?: ReactNode;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    slot: {
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
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const walkDirectory = async (dir: DirectoryDropItem, basePath = ''): Promise<ReadonlyArray<File>> => {
    // biome-ignore lint/nursery/useAwaitThenable: AsyncIterable requires Array.fromAsync which returns Promise
    const entries = await Array.fromAsync(dir.getEntries());
    const makePath = (name: string) => (basePath ? `${basePath}/${name}` : name);
    const handlers = {
        directory: (entry: DirectoryDropItem, path: string) => walkDirectory(entry, path),
        file: async (entry: { getFile: () => Promise<File> }, _path: string) => [await entry.getFile()],
    } as const;
    const results = await Promise.all(
        entries.map((entry) => handlers[entry.kind]?.(entry as never, makePath(entry.name)) ?? Promise.resolve([])),
    );
    return results.flat();
};
const extractFiles = async (items: readonly DropItem[]): Promise<readonly File[]> => {
    const files = await Promise.all(items.filter((item): item is FileDropItem => item.kind === 'file').map((item) => item.getFile()));
    const directories = items.filter((item): item is DirectoryDropItem => item.kind === 'directory');
    const directoryFiles = await Promise.all(directories.map((dir) => walkDirectory(dir)));
    return [...files, ...directoryFiles.flat()];
};

// --- [ENTRY_POINT] -----------------------------------------------------------
const acceptTypes = (...types: readonly string[]) =>
    (dragTypes: DragTypes, allowed: DropOperation[]): DropOperation => types.some((type) => dragTypes.has(type)) ? (allowed[0] ?? 'cancel') : 'cancel';
const FileUpload: FC<FileUploadProps> = ({
    accept, acceptDirectory, asyncState, children, className, defaultCamera, isDisabled,
    multiple = false, onDropActivate, onDropEnter, onDropExit, onFilesChange, progress = 0, ref, toast, trigger, }) => {
    Toast.useTrigger(asyncState, toast);
    const onDropHandler = useCallback(
        (event: { items: readonly DropItem[] }) => void extractFiles(event.items).then((files) => files.length > 0 && onFilesChange(files)),
        [onFilesChange],
    );
    const onPaste = useCallback(
        (items: DropItem[]) => {
            const validItems = items.filter((item): item is FileDropItem => item.kind === 'file' && accept.includes(item.type));
            return void Promise.all(validItems.map((item) => item.getFile())).then((files) => files.length > 0 && onFilesChange(files));
        },
        [accept, onFilesChange],
    );
    const onSelect = useCallback(
        (fileList: FileList | null) => fileList && fileList.length > 0 && onFilesChange(Array.from(fileList)),
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
                    className={cn(_B.slot.base, className)}
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
                    {typeof children === 'function' ? children({ isDropTarget, progress }) : children}
                </div>
            )}
        </DropZone>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { FileUpload };
export type { FileUploadProps };
