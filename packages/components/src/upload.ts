/**
 * Upload UI factory: FileTrigger and DropZone wrappers with React Aria accessibility.
 * Uses react-aria-components for native file selection and drag-drop handling.
 */
import type { CSSProperties, ForwardedRef, ForwardRefExoticComponent, ReactNode, RefAttributes } from 'react';
import { createElement, forwardRef } from 'react';
import type { DropEvent, FileDropItem } from 'react-aria';
import type { DropZoneRenderProps } from 'react-aria-components';
import { DropZone as AriaDropZone, FileTrigger as AriaFileTrigger } from 'react-aria-components';
import type { Inputs, TuningFor } from './schema.ts';
import { resolve, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type UploadInput = { readonly scale?: Inputs['scale'] };

type UploadProps = {
    readonly accept?: string;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly disabled?: boolean;
    readonly multiple?: boolean;
    readonly onSelect: (files: FileList | null) => void;
};

type DropZoneProps = {
    readonly children: ReactNode | ((state: { readonly isDropTarget: boolean }) => ReactNode);
    readonly className?: string;
    readonly onDrop: (files: FileList) => void;
};

type UploadApi = Readonly<{
    Trigger: ForwardRefExoticComponent<UploadProps & RefAttributes<HTMLDivElement>>;
    Zone: ForwardRefExoticComponent<DropZoneProps & RefAttributes<HTMLDivElement>>;
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cls: {
        dropzone: 'relative border-2 border-dashed rounded-lg transition-colors',
        dropzoneActive: 'border-(--ctrl-primary-bg) bg-(--ctrl-primary-bg)/5',
        dropzoneIdle: 'border-(--upload-border)',
        trigger: 'cursor-pointer',
        triggerDisabled: 'cursor-(--upload-disabled-cursor) opacity-(--upload-disabled-opacity)',
    },
    defaults: {
        accept: 'image/svg+xml',
        multiple: false,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractFilesFromDrop = async (event: DropEvent): Promise<FileList> => {
    const fileItems = event.items.filter((item): item is FileDropItem => item.kind === 'file');
    const files = await Promise.all(fileItems.map((item) => item.getFile()));
    const dataTransfer = new DataTransfer();
    for (const file of files) {
        dataTransfer.items.add(file);
    }
    return dataTransfer.files;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createUpload = (input?: UploadInput & TuningFor<'ctrl'>): UploadApi => {
    const scale = resolve('scale', input?.scale);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'upload');

    const Trigger = forwardRef<HTMLDivElement, UploadProps>((props: UploadProps, ref: ForwardedRef<HTMLDivElement>) => {
        const {
            accept = B.defaults.accept,
            children,
            className,
            disabled = false,
            multiple = B.defaults.multiple,
            onSelect,
        } = props;

        const triggerCls = utilities.cls(B.cls.trigger, disabled && B.cls.triggerDisabled, className);

        return createElement(
            AriaFileTrigger,
            {
                ...(accept && { acceptedFileTypes: [accept] }),
                allowsMultiple: multiple,
                onSelect,
            },
            createElement(
                'div',
                {
                    className: triggerCls,
                    'data-disabled': disabled || undefined,
                    ref,
                    style: vars as CSSProperties,
                },
                children,
            ),
        );
    });

    Trigger.displayName = 'Upload.Trigger';

    const Zone = forwardRef<HTMLDivElement, DropZoneProps>(
        (props: DropZoneProps, ref: ForwardedRef<HTMLDivElement>) => {
            const { children, className, onDrop } = props;

            const handleDrop = (event: DropEvent): void => {
                void extractFilesFromDrop(event).then((files) => files.length > 0 && onDrop(files));
            };

            const renderChildren = (renderProps: DropZoneRenderProps): ReactNode =>
                createElement(
                    'div',
                    {
                        className: utilities.cls(
                            B.cls.dropzone,
                            renderProps.isDropTarget ? B.cls.dropzoneActive : B.cls.dropzoneIdle,
                            className,
                        ),
                        'data-drop-target': renderProps.isDropTarget || undefined,
                        ref,
                        style: vars as CSSProperties,
                    },
                    typeof children === 'function' ? children({ isDropTarget: renderProps.isDropTarget }) : children,
                );

            // biome-ignore lint/correctness/noChildrenProp: react-aria-components DropZone requires render prop children
            return createElement(AriaDropZone, { children: renderChildren, onDrop: handleDrop });
        },
    );

    Zone.displayName = 'Upload.Zone';

    return Object.freeze({ Trigger, Zone });
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as UPLOAD_TUNING, createUpload };
export type { DropZoneProps, UploadApi, UploadInput, UploadProps };
