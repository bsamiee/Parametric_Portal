/**
 * FileUpload: DropZone container with optional FileTrigger slot.
 * Pure presentation - async state from external useFileUpload hook.
 * REQUIRED: accept prop for MIME type filtering.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { FC, ReactNode, Ref } from 'react';
import { useCallback } from 'react';
import type { DropEvent, FileDropItem } from 'react-aria';
import { DropZone, type DropZoneRenderProps, FileTrigger } from 'react-aria-components';
import { cn } from '../core/css-slots';

// --- [TYPES] -----------------------------------------------------------------

type FileUploadRenderProps = { readonly isDropTarget: boolean };
type FileUploadProps = {
    readonly accept: ReadonlyArray<string>;
    readonly asyncState?: AsyncState<unknown, unknown>;
    readonly children?: ReactNode | ((state: FileUploadRenderProps) => ReactNode);
    readonly className?: string;
    readonly isDisabled?: boolean;
    readonly multiple?: boolean;
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
        ),
    }),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractFilesFromDrop = async (event: DropEvent): Promise<ReadonlyArray<File>> => {
    const fileItems = event.items.filter((item): item is FileDropItem => item.kind === 'file');
    return Promise.all(fileItems.map((item) => item.getFile()));
};

// --- [COMPONENTS] ------------------------------------------------------------

const FileUpload: FC<FileUploadProps> = ({
    accept,
    asyncState,
    children,
    className,
    isDisabled,
    multiple = false,
    onFilesChange,
    ref,
    trigger,
}) => {
    const handleDrop = useCallback(
        (event: DropEvent): void => {
            void extractFilesFromDrop(event).then((files) => files.length > 0 && onFilesChange(files));
        },
        [onFilesChange],
    );
    const handleSelect = useCallback(
        (fileList: FileList | null): void => {
            fileList && fileList.length > 0 && onFilesChange(Array.from(fileList));
        },
        [onFilesChange],
    );
    const getDropOperation = useCallback(
        (types: { has: (type: string) => boolean }): 'copy' | 'cancel' =>
            accept.some((type) => types.has(type)) ? 'copy' : 'cancel',
        [accept],
    );
    const renderContent = useCallback(
        (renderProps: DropZoneRenderProps): ReactNode => (
            <div
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
                        onSelect={handleSelect}
                    >
                        {trigger}
                    </FileTrigger>
                )}
                {typeof children === 'function' ? children({ isDropTarget: renderProps.isDropTarget }) : children}
            </div>
        ),
        [accept, asyncState, children, className, handleSelect, multiple, ref, trigger],
    );
    return (
        <DropZone getDropOperation={getDropOperation} isDisabled={isDisabled === true} onDrop={handleDrop}>
            {renderContent}
        </DropZone>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as FILE_UPLOAD_TUNING, FileUpload };
export type { FileUploadProps, FileUploadRenderProps };
