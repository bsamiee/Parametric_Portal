/**
 * Overlay components: render dialog, drawer, modal, popover, sheet, tooltip.
 * Uses B.ov, utilities, animStyle from schema.ts with React Aria focus management.
 */
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useEffect, useState } from 'react';
import { FocusScope, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import type { Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, merged, pick, resolve, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- Types -------------------------------------------------------------------

type OverlayType = 'dialog' | 'drawer' | 'modal' | 'popover' | 'sheet' | 'tooltip';
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
    readonly confirmLabel?: string;
    readonly onConfirm?: () => void;
};
type DrawerProps = BaseProps & { readonly position?: Position };
type PopoverProps = BaseProps & { readonly triggerRef: React.RefObject<HTMLElement> };
type TooltipProps = Omit<BaseProps, 'onClose'> & { readonly triggerRef: React.RefObject<HTMLElement> };
type OverlayInput<T extends OverlayType = 'modal'> = {
    readonly animation?: Inputs['animation'] | undefined;
    readonly className?: string;
    readonly overlay?: Inputs['overlay'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};

// --- Pure Functions ----------------------------------------------------------

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
                    'w-full shadow-xl max-h-[90vh] overflow-y-auto',
                    B.ov.size[size],
                    B.ov.var.r,
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
                          className: utilities.cls('border-b font-semibold text-lg', B.ov.var.px, B.ov.var.py),
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
                      className: utilities.cls('fixed inset-0 flex items-center justify-center', B.ov.backdrop),
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
                    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-xl w-full overflow-hidden',
                    B.ov.size[size],
                    B.ov.var.r,
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
                          className: utilities.cls('border-b font-semibold text-lg', B.ov.var.px, B.ov.var.py),
                      },
                      title,
                  )
                : null,
            createElement('div', { className: utilities.cls(B.ov.var.px, B.ov.var.py) }, children),
            createElement(
                'div',
                { className: utilities.cls('border-t flex justify-end gap-3', B.ov.var.px, B.ov.var.py) },
                createElement(
                    'button',
                    { className: 'px-4 py-2 rounded border', onClick: onClose, type: 'button' },
                    cancelLabel,
                ),
                onConfirm
                    ? createElement(
                          'button',
                          { className: 'px-4 py-2 rounded', onClick: onConfirm, type: 'button' },
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
                      className: utilities.cls('fixed inset-0', B.ov.backdrop),
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
                    'fixed shadow-xl overflow-hidden',
                    B.ov.pos[position],
                    isHorizontal ? 'h-full' : 'w-full',
                    B.ov.var.r,
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
                      className: utilities.cls('fixed inset-0', B.ov.backdrop),
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
        const [position, setPosition] = useState({ left: 0, top: 0 });
        const offsetPx = Math.round(scale.scale * B.algo.popoverOffMul * scale.density * scale.baseUnit * 4 * 16);
        useEffect(() => {
            const trigger = triggerRef.current;
            setPosition(
                trigger
                    ? { left: trigger.offsetLeft, top: trigger.offsetTop + trigger.offsetHeight + offsetPx }
                    : { left: 0, top: 0 },
            );
        }, [triggerRef, offsetPx]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      ...overlayProps,
                      className: utilities.cls(
                          'absolute shadow-lg border overflow-hidden',
                          B.ov.var.r,
                          input.className,
                          className,
                      ),
                      ref,
                      style: { ...vars, ...utilities.zStyle(overlay), ...position, ...style } as CSSProperties,
                  },
                  createElement('div', { className: utilities.cls(B.ov.var.px, B.ov.var.py) }, children),
              )
            : null;
    });

const createTooltipComponent = (
    input: OverlayInput<'tooltip'>,
    _vars: Record<string, string>,
    overlay: Resolved['overlay'],
    _animation: Resolved['animation'],
    scale: Resolved['scale'],
) =>
    forwardRef((props: TooltipProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, style, triggerRef, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const [position, setPosition] = useState({ left: 0, top: 0 });
        const offsetPx = Math.round(scale.scale * B.algo.tooltipOffMul * scale.density * scale.baseUnit * 4 * 16);
        useEffect(() => {
            const trigger = triggerRef.current;
            setPosition(
                trigger ? { left: trigger.offsetLeft, top: trigger.offsetTop - offsetPx } : { left: 0, top: 0 },
            );
        }, [triggerRef, offsetPx]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      className: utilities.cls(
                          'absolute text-xs px-2 py-1 rounded shadow-lg pointer-events-none',
                          input.className,
                          className,
                      ),
                      ref,
                      role: 'tooltip',
                      style: { ...utilities.zStyle(overlay), ...position, ...style } as CSSProperties,
                  },
                  children,
              )
            : null;
    });

// --- Dispatch Tables ---------------------------------------------------------

const builderHandlers = {
    dialog: createDialogComponent,
    drawer: createDrawerComponent,
    modal: createModalComponent,
    popover: createPopoverComponent,
    sheet: createDrawerComponent,
    tooltip: createTooltipComponent,
} as const;

const createOverlayComponent = <T extends OverlayType>(input: OverlayInput<T>) => {
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
        ) => ReturnType<typeof forwardRef>
    )(input, vars, overlay, animation, scale);
    component.displayName = `Overlay(${input.type ?? 'modal'})`;
    return component;
};

// --- Entry Point -------------------------------------------------------------

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
        Tooltip: createOverlayComponent({ type: 'tooltip', ...pick(tuning, ['scale']) }),
    });

// --- Export ------------------------------------------------------------------

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
    TooltipProps,
};
