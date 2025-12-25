/**
 * Overlay components: render dialog, drawer, modal, popover, sheet.
 * Uses B.ov, utilities, animStyle from schema.ts with React Aria focus management.
 * Tooltips use unified useTooltipState + renderTooltipPortal from schema.ts.
 */
import type {
    CSSProperties,
    ForwardedRef,
    ForwardRefExoticComponent,
    HTMLAttributes,
    ReactNode,
    RefAttributes,
} from 'react';
import { createElement, forwardRef, useLayoutEffect } from 'react';
import { FocusScope, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import type { Inputs, Resolved, TuningFor } from './schema.ts';
import {
    animStyle,
    B,
    computeOffsetPx,
    merged,
    pick,
    resolve,
    TUNING_KEYS,
    useForwardedRef,
    useTooltipPosition,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type OverlayType = 'dialog' | 'drawer' | 'modal' | 'popover' | 'sheet';
type Position = 'bottom' | 'left' | 'right' | 'top';
type BaseProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly isOpen: boolean;
    readonly onClose: () => void;
};
type ModalSize = keyof typeof B.ov.size;
type ModalProps = BaseProps & { readonly size?: ModalSize; readonly title?: string };
type DialogProps = ModalProps & {
    readonly cancelLabel?: string;
    readonly confirmDisabled?: boolean;
    readonly confirmLabel?: string;
    readonly onConfirm?: () => void;
};
type DrawerProps = BaseProps & { readonly position?: Position };
type PopoverProps = BaseProps & { readonly triggerRef: React.RefObject<HTMLElement> };
type OverlayInput<T extends OverlayType = 'modal'> = {
    readonly animation?: Inputs['animation'] | undefined;
    readonly className?: string;
    readonly overlay?: Inputs['overlay'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};
type OverlayComponentMap = {
    readonly dialog: ForwardRefExoticComponent<DialogProps & RefAttributes<HTMLDivElement>>;
    readonly drawer: ForwardRefExoticComponent<DrawerProps & RefAttributes<HTMLDivElement>>;
    readonly modal: ForwardRefExoticComponent<ModalProps & RefAttributes<HTMLDivElement>>;
    readonly popover: ForwardRefExoticComponent<PopoverProps & RefAttributes<HTMLDivElement>>;
    readonly sheet: ForwardRefExoticComponent<DrawerProps & RefAttributes<HTMLDivElement>>;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createFocusScope = (opts: { autoFocus: boolean; contain: boolean; restoreFocus: boolean }, child: ReactNode) =>
    createElement(FocusScope, { ...opts, ...({ children: child } as const) });
const createModalComponent = (
    input: OverlayInput<'modal'>,
    vars: Record<string, string>,
    overlay: Resolved['overlay'],
    animation: Resolved['animation'],
    _scale: Resolved['scale'],
) =>
    forwardRef((props: ModalProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, size = 'lg', style, title, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: overlay.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        const { dialogProps, titleProps } = useDialog({}, ref);
        usePreventScroll({ isDisabled: !isOpen });
        const content = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                ...dialogProps,
                className: utilities.cls(
                    B.ov.modal.content,
                    B.ov.modal.shadow,
                    B.ov.modal.maxH,
                    B.ov.var.r,
                    B.ov.size[size],
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...animStyle(animation), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      {
                          ...titleProps,
                          className: utilities.cls(B.ov.title.base, B.ov.title.font, B.ov.var.px, B.ov.var.py),
                      },
                      title,
                  )
                : null,
            createElement('div', { className: utilities.cls(B.ov.var.px, B.ov.var.py) }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...underlayProps,
                      className: utilities.cls(B.ov.modal.underlay, B.ov.backdrop),
                      style: utilities.zStyle(overlay, true),
                  },
                  createFocusScope({ autoFocus: true, contain: overlay.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });
const createDialogComponent = (
    input: OverlayInput<'dialog'>,
    vars: Record<string, string>,
    overlay: Resolved['overlay'],
    animation: Resolved['animation'],
    _scale: Resolved['scale'],
) =>
    forwardRef((props: DialogProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            cancelLabel = 'Cancel',
            children,
            className,
            confirmDisabled = false,
            confirmLabel = 'Confirm',
            isOpen,
            onClose,
            onConfirm,
            size = 'md',
            style,
            title,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: overlay.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        const { dialogProps, titleProps } = useDialog({}, ref);
        usePreventScroll({ isDisabled: !isOpen });
        const content = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                ...dialogProps,
                className: utilities.cls(
                    B.ov.dialog.pos,
                    B.ov.modal.shadow,
                    'w-full',
                    B.ov.var.r,
                    B.ov.size[size],
                    input.className,
                    className,
                ),
                ref,
                role: 'alertdialog',
                style: { ...vars, ...animStyle(animation), ...utilities.zStyle(overlay), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      {
                          ...titleProps,
                          className: utilities.cls(B.ov.title.base, B.ov.title.font, B.ov.var.px, B.ov.var.py),
                      },
                      title,
                  )
                : null,
            createElement('div', { className: utilities.cls(B.ov.var.px, B.ov.var.py) }, children),
            createElement(
                'div',
                { className: utilities.cls(B.ov.dialog.footer, B.ov.var.px, B.ov.var.py) },
                createElement(
                    'button',
                    { className: B.ov.dialog.button, onClick: onClose, type: 'button' },
                    cancelLabel,
                ),
                onConfirm
                    ? createElement(
                          'button',
                          {
                              className: utilities.cls(
                                  B.ov.dialog.button,
                                  B.ov.dialog.buttonConfirm,
                                  confirmDisabled && B.ov.dialog.buttonDisabled,
                              ),
                              disabled: confirmDisabled,
                              onClick: onConfirm,
                              type: 'button',
                          },
                          confirmLabel,
                      )
                    : null,
            ),
        );
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...underlayProps,
                      className: utilities.cls(B.ov.pos.fixed, B.ov.backdrop),
                      style: utilities.zStyle(overlay, true),
                  },
                  createFocusScope({ autoFocus: true, contain: overlay.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });
const createDrawerComponent = (
    input: OverlayInput<'drawer'>,
    vars: Record<string, string>,
    overlay: Resolved['overlay'],
    animation: Resolved['animation'],
    _scale: Resolved['scale'],
) =>
    forwardRef((props: DrawerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, position = overlay.position, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: overlay.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        usePreventScroll({ isDisabled: !isOpen });
        const isHorizontal = position === 'left' || position === 'right';
        const content = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                className: utilities.cls(
                    'fixed',
                    B.ov.modal.shadow,
                    B.ov.popover.base,
                    B.ov.var.r,
                    B.ov.pos[position],
                    isHorizontal ? 'h-full' : 'w-full',
                    input.className,
                    className,
                ),
                ref,
                style: { ...vars, ...animStyle(animation), ...utilities.zStyle(overlay), ...style } as CSSProperties,
            },
            createElement(
                'div',
                { className: utilities.cls('h-full overflow-y-auto', B.ov.var.px, B.ov.var.py) },
                children,
            ),
        );
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...underlayProps,
                      className: utilities.cls(B.ov.pos.fixed, B.ov.backdrop),
                      style: utilities.zStyle(overlay, true),
                  },
                  createFocusScope({ autoFocus: true, contain: overlay.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });
const createPopoverComponent = (
    input: OverlayInput<'popover'>,
    vars: Record<string, string>,
    overlay: Resolved['overlay'],
    _animation: Resolved['animation'],
    scale: Resolved['scale'],
) =>
    forwardRef((props: PopoverProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, triggerRef, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps } = useOverlay({ isDismissable: overlay.closeOnOutsideClick, isOpen, onClose }, ref);
        const offsetPx = computeOffsetPx(scale, B.algo.popoverOffMul);
        const { floatingStyles, refs } = useTooltipPosition(isOpen, 'bottom', offsetPx);
        // Sync trigger ref with floating-ui reference
        useLayoutEffect(() => {
            triggerRef.current && refs.setReference(triggerRef.current);
        }, [triggerRef, refs]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      ...overlayProps,
                      className: utilities.cls(
                          B.ov.popover.shadow,
                          B.ov.popover.border,
                          B.ov.popover.base,
                          B.ov.var.r,
                          input.className,
                          className,
                      ),
                      ref: (node: HTMLDivElement | null) => {
                          (ref as { current: HTMLDivElement | null }).current = node;
                          refs.setFloating(node);
                      },
                      style: { ...vars, ...utilities.zStyle(overlay), ...floatingStyles, ...style } as CSSProperties,
                  },
                  createElement('div', { className: utilities.cls(B.ov.var.px, B.ov.var.py) }, children),
              )
            : null;
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    dialog: createDialogComponent,
    drawer: createDrawerComponent,
    modal: createModalComponent,
    popover: createPopoverComponent,
    sheet: createDrawerComponent,
} as const;
const createOverlayComponent = <T extends OverlayType>(input: OverlayInput<T>): OverlayComponentMap[T] => {
    const scale = resolve('scale', input.scale);
    const overlay = resolve(
        'overlay',
        (input.type ?? 'modal') === 'sheet' ? { ...input.overlay, position: 'bottom' } : input.overlay,
    );
    const animation = resolve('animation', input.animation);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'ov');
    const builder = builderHandlers[input.type ?? 'modal'];
    const component = (
        builder as unknown as (
            input: OverlayInput<T>,
            vars: Record<string, string>,
            overlay: Resolved['overlay'],
            animation: Resolved['animation'],
            scale: Resolved['scale'],
        ) => OverlayComponentMap[T]
    )(input, vars, overlay, animation, scale);
    component.displayName = `Overlay(${input.type ?? 'modal'})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createOverlays = (tuning?: TuningFor<'ov'>) =>
    Object.freeze({
        create: <T extends OverlayType>(input: OverlayInput<T>) =>
            createOverlayComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.ov) }),
        Dialog: createOverlayComponent({ type: 'dialog', ...pick(tuning, TUNING_KEYS.ov) }),
        Drawer: createOverlayComponent({ type: 'drawer', ...pick(tuning, TUNING_KEYS.ov) }),
        Modal: createOverlayComponent({ type: 'modal', ...pick(tuning, TUNING_KEYS.ov) }),
        Popover: createOverlayComponent({ type: 'popover', ...pick(tuning, TUNING_KEYS.ov) }),
        Sheet: createOverlayComponent({
            type: 'sheet',
            ...pick(tuning, ['animation', 'scale']),
            overlay: { ...tuning?.overlay, position: 'bottom' },
        }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createOverlays };
export type {
    BaseProps,
    DialogProps,
    DrawerProps,
    ModalProps,
    ModalSize,
    OverlayInput,
    OverlayType,
    PopoverProps,
    Position,
};
