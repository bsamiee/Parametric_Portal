import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef, useEffect, useState } from 'react';
import { FocusScope, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import type { Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, fn, merged, pick, resolve, TUNING_KEYS, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

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

// --- Pure Utility Functions -------------------------------------------------

const focus = (opts: { autoFocus: boolean; contain: boolean; restoreFocus: boolean }, child: ReactNode) =>
    createElement(FocusScope, { ...opts, ...({ children: child } as const) });

// --- Component Builders -----------------------------------------------------

const mkModal = (
    i: OverlayInput<'modal'>,
    v: Record<string, string>,
    o: Resolved['overlay'],
    a: Resolved['animation'],
    _s: Resolved['scale'],
) =>
    forwardRef((props: ModalProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, size = 'lg', style, title, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: o.closeOnOutsideClick, isOpen, onClose },
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
                className: fn.cls(
                    'w-full shadow-xl max-h-[90vh] overflow-y-auto',
                    B.ov.size[size],
                    B.ov.var.r,
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      { ...titleProps, className: fn.cls('border-b font-semibold text-lg', B.ov.var.px, B.ov.var.py) },
                      title,
                  )
                : null,
            createElement('div', { className: fn.cls(B.ov.var.px, B.ov.var.py) }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...underlayProps,
                      className: fn.cls('fixed inset-0 flex items-center justify-center', B.ov.backdrop),
                      style: fn.zStyle(o, true),
                  },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkDialog = (
    i: OverlayInput<'dialog'>,
    v: Record<string, string>,
    o: Resolved['overlay'],
    a: Resolved['animation'],
    _s: Resolved['scale'],
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
            { isDismissable: o.closeOnOutsideClick, isOpen, onClose },
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
                className: fn.cls(
                    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-xl w-full overflow-hidden',
                    B.ov.size[size],
                    B.ov.var.r,
                    i.className,
                    className,
                ),
                ref,
                role: 'alertdialog',
                style: { ...v, ...animStyle(a), ...fn.zStyle(o), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      { ...titleProps, className: fn.cls('border-b font-semibold text-lg', B.ov.var.px, B.ov.var.py) },
                      title,
                  )
                : null,
            createElement('div', { className: fn.cls(B.ov.var.px, B.ov.var.py) }, children),
            createElement(
                'div',
                { className: fn.cls('border-t flex justify-end gap-3', B.ov.var.px, B.ov.var.py) },
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
                      className: fn.cls('fixed inset-0', B.ov.backdrop),
                      style: fn.zStyle(o, true),
                  },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkDrawer = (
    i: OverlayInput<'drawer'>,
    v: Record<string, string>,
    o: Resolved['overlay'],
    a: Resolved['animation'],
    _s: Resolved['scale'],
) =>
    forwardRef((props: DrawerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, position = o.position, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: o.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        usePreventScroll({ isDisabled: !isOpen });
        const isHoriz = position === 'left' || position === 'right';
        const content = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                className: fn.cls(
                    'fixed shadow-xl overflow-hidden',
                    B.ov.pos[position],
                    isHoriz ? 'h-full' : 'w-full',
                    B.ov.var.r,
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...animStyle(a), ...fn.zStyle(o), ...style } as CSSProperties,
            },
            createElement('div', { className: fn.cls('h-full overflow-y-auto', B.ov.var.px, B.ov.var.py) }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...underlayProps,
                      className: fn.cls('fixed inset-0', B.ov.backdrop),
                      style: fn.zStyle(o, true),
                  },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkPopover = (
    i: OverlayInput<'popover'>,
    v: Record<string, string>,
    o: Resolved['overlay'],
    _a: Resolved['animation'],
    s: Resolved['scale'],
) =>
    forwardRef((props: PopoverProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, triggerRef, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const { overlayProps } = useOverlay({ isDismissable: o.closeOnOutsideClick, isOpen, onClose }, ref);
        const [pos, setPos] = useState({ left: 0, top: 0 });
        const offsetPx = Math.round(s.scale * B.algo.popoverOffMul * s.density * s.baseUnit * 4 * 16);
        useEffect(() => {
            const t = triggerRef.current;
            setPos(t ? { left: t.offsetLeft, top: t.offsetTop + t.offsetHeight + offsetPx } : { left: 0, top: 0 });
        }, [triggerRef, offsetPx]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      ...overlayProps,
                      className: fn.cls(
                          'absolute shadow-lg border overflow-hidden',
                          B.ov.var.r,
                          i.className,
                          className,
                      ),
                      ref,
                      style: { ...v, ...fn.zStyle(o), ...pos, ...style } as CSSProperties,
                  },
                  createElement('div', { className: fn.cls(B.ov.var.px, B.ov.var.py) }, children),
              )
            : null;
    });

const mkTooltip = (
    i: OverlayInput<'tooltip'>,
    _v: Record<string, string>,
    o: Resolved['overlay'],
    _a: Resolved['animation'],
    s: Resolved['scale'],
) =>
    forwardRef((props: TooltipProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, style, triggerRef, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const [pos, setPos] = useState({ left: 0, top: 0 });
        const offsetPx = Math.round(s.scale * B.algo.tooltipOffMul * s.density * s.baseUnit * 4 * 16);
        useEffect(() => {
            const t = triggerRef.current;
            setPos(t ? { left: t.offsetLeft, top: t.offsetTop - offsetPx } : { left: 0, top: 0 });
        }, [triggerRef, offsetPx]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      className: fn.cls(
                          'absolute text-xs px-2 py-1 rounded shadow-lg pointer-events-none',
                          i.className,
                          className,
                      ),
                      ref,
                      role: 'tooltip',
                      style: { ...fn.zStyle(o), ...pos, ...style } as CSSProperties,
                  },
                  children,
              )
            : null;
    });

// --- Dispatch Table ---------------------------------------------------------

const builders = {
    dialog: mkDialog,
    drawer: mkDrawer,
    modal: mkModal,
    popover: mkPopover,
    sheet: mkDrawer,
    tooltip: mkTooltip,
} as const;

const createOV = <T extends OverlayType>(i: OverlayInput<T>) => {
    const s = resolve('scale', i.scale);
    const o = resolve('overlay', (i.type ?? 'modal') === 'sheet' ? { ...i.overlay, position: 'bottom' } : i.overlay);
    const a = resolve('animation', i.animation);
    const c = fn.computeScale(s);
    const v = fn.cssVars(c, 'ov');
    const builder = builders[i.type ?? 'modal'];
    const comp = (
        builder as unknown as (
            i: OverlayInput<T>,
            v: Record<string, string>,
            o: Resolved['overlay'],
            a: Resolved['animation'],
            s: Resolved['scale'],
        ) => ReturnType<typeof forwardRef>
    )(i, v, o, a, s);
    comp.displayName = `Overlay(${i.type ?? 'modal'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createOverlays = (tuning?: TuningFor<'ov'>) =>
    Object.freeze({
        create: <T extends OverlayType>(i: OverlayInput<T>) => createOV({ ...i, ...merged(tuning, i, TUNING_KEYS.ov) }),
        Dialog: createOV({ type: 'dialog', ...pick(tuning, TUNING_KEYS.ov) }),
        Drawer: createOV({ type: 'drawer', ...pick(tuning, TUNING_KEYS.ov) }),
        Modal: createOV({ type: 'modal', ...pick(tuning, TUNING_KEYS.ov) }),
        Popover: createOV({ type: 'popover', ...pick(tuning, TUNING_KEYS.ov) }),
        Sheet: createOV({
            type: 'sheet',
            ...pick(tuning, ['animation', 'scale']),
            overlay: { ...tuning?.overlay, position: 'bottom' },
        }),
        Tooltip: createOV({ type: 'tooltip', ...pick(tuning, ['scale']) }),
    });

// --- Export -----------------------------------------------------------------

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
