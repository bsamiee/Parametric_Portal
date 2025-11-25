import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useEffect, useRef, useState } from 'react';
import { FocusScope, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import type { Animation, AnimationInput, Overlay, OverlayInput as OvInput, ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, merge, resolveAnimation, resolveOverlay, resolveScale } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type OverlayType = 'dialog' | 'drawer' | 'modal' | 'popover' | 'sheet' | 'tooltip';
type Position = 'bottom' | 'left' | 'right' | 'top';
type BaseProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly isOpen: boolean;
    readonly onClose: () => void;
};
type ModalProps = BaseProps & { readonly title?: string };
type DialogProps = ModalProps & {
    readonly cancelLabel?: string;
    readonly confirmLabel?: string;
    readonly onConfirm?: () => void;
};
type DrawerProps = BaseProps & { readonly position?: Position };
type PopoverProps = BaseProps & { readonly triggerRef: RefObject<HTMLElement> };
type TooltipProps = Omit<BaseProps, 'onClose'> & { readonly triggerRef: RefObject<HTMLElement> };
type OverlayInput<T extends OverlayType = 'modal'> = {
    readonly animation?: AnimationInput | undefined;
    readonly className?: string;
    readonly overlay?: OvInput | undefined;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    pos: {
        bottom: 'inset-x-0 bottom-0',
        left: 'inset-y-0 left-0',
        right: 'inset-y-0 right-0',
        top: 'inset-x-0 top-0',
    } as { readonly [K in Position]: string },
    var: { px: 'px-[var(--ov-padding-x)]', py: 'py-[var(--ov-padding-y)]', r: 'rounded-[var(--ov-radius)]' },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const focus = (opts: { autoFocus: boolean; contain: boolean; restoreFocus: boolean }, child: ReactNode) =>
    createElement(FocusScope, { ...opts, ...({ children: child } as const) });
const animStyle = (a: Animation): CSSProperties =>
    a.enabled
        ? { transition: `all ${a.duration}ms ${a.easing}`, transitionDelay: a.delay ? `${a.delay}ms` : undefined }
        : {};

// --- Component Builders -----------------------------------------------------

const mkModal = (i: OverlayInput<'modal'>, v: Record<string, string>, o: Overlay, a: Animation) =>
    forwardRef((props: ModalProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, title, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
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
                className: cls(
                    'w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto',
                    B.var.r,
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      { ...titleProps, className: cls('border-b font-semibold text-lg', B.var.px, B.var.py) },
                      title,
                  )
                : null,
            createElement('div', { className: cls(B.var.px, B.var.py) }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  { ...underlayProps, className: 'fixed inset-0 bg-black/50 z-40 flex items-center justify-center' },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkDialog = (i: OverlayInput<'dialog'>, v: Record<string, string>, o: Overlay, a: Animation) =>
    forwardRef((props: DialogProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            cancelLabel = 'Cancel',
            children,
            className,
            confirmLabel = 'Confirm',
            isOpen,
            onClose,
            onConfirm,
            style,
            title,
            ...rest
        } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
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
                className: cls(
                    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 shadow-xl w-full max-w-md overflow-hidden',
                    B.var.r,
                    i.className,
                    className,
                ),
                ref,
                role: 'alertdialog',
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            title
                ? createElement(
                      'div',
                      { ...titleProps, className: cls('border-b font-semibold text-lg', B.var.px, B.var.py) },
                      title,
                  )
                : null,
            createElement('div', { className: cls(B.var.px, B.var.py) }, children),
            createElement(
                'div',
                { className: cls('border-t flex justify-end gap-3', B.var.px, B.var.py) },
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
                  { ...underlayProps, className: 'fixed inset-0 bg-black/50 z-40' },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkDrawer = (i: OverlayInput<'drawer'>, v: Record<string, string>, o: Overlay, a: Animation) =>
    forwardRef((props: DrawerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, position = o.position, style, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
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
                className: cls(
                    'fixed z-50 shadow-xl overflow-hidden',
                    B.pos[position],
                    isHoriz ? 'h-full' : 'w-full',
                    B.var.r,
                    i.className,
                    className,
                ),
                ref,
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            createElement('div', { className: cls('h-full overflow-y-auto', B.var.px, B.var.py) }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  { ...underlayProps, className: 'fixed inset-0 bg-black/50 z-40' },
                  focus({ autoFocus: true, contain: o.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });

const mkPopover = (i: OverlayInput<'popover'>, v: Record<string, string>, o: Overlay) =>
    forwardRef((props: PopoverProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, triggerRef, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        const { overlayProps } = useOverlay({ isDismissable: o.closeOnOutsideClick, isOpen, onClose }, ref);
        const [pos, setPos] = useState({ left: 0, top: 0 });
        useEffect(() => {
            const t = triggerRef.current;
            setPos(t ? { left: t.offsetLeft, top: t.offsetTop + t.offsetHeight + 8 } : { left: 0, top: 0 });
        }, [triggerRef]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      ...overlayProps,
                      className: cls('absolute z-50 shadow-lg border overflow-hidden', B.var.r, i.className, className),
                      ref,
                      style: { ...v, ...pos, ...style } as CSSProperties,
                  },
                  createElement('div', { className: cls(B.var.px, B.var.py) }, children),
              )
            : null;
    });

const mkTooltip = (i: OverlayInput<'tooltip'>) =>
    forwardRef((props: TooltipProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, style, triggerRef, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        const [pos, setPos] = useState({ left: 0, top: 0 });
        useEffect(() => {
            const t = triggerRef.current;
            setPos(t ? { left: t.offsetLeft, top: t.offsetTop - 28 } : { left: 0, top: 0 });
        }, [triggerRef]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      className: cls(
                          'absolute z-50 text-xs px-2 py-1 rounded shadow-lg pointer-events-none',
                          i.className,
                          className,
                      ),
                      ref,
                      role: 'tooltip',
                      style: { ...pos, ...style } as CSSProperties,
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
    const s = resolveScale(i.scale);
    const o = resolveOverlay(i.type === 'sheet' ? { ...i.overlay, position: 'bottom' } : i.overlay);
    const a = resolveAnimation(i.animation);
    const c = computeScale(s);
    const v = cssVars(c, 'ov');
    const builder = builders[i.type ?? 'modal'];
    const comp = (
        builder as unknown as (
            i: OverlayInput<T>,
            v: Record<string, string>,
            o: Overlay,
            a: Animation,
        ) => ReturnType<typeof forwardRef>
    )(i, v, o, a);
    comp.displayName = `Overlay(${i.type ?? 'modal'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const createOverlays = (tuning?: { animation?: AnimationInput; overlay?: OvInput; scale?: ScaleInput }) =>
    Object.freeze({
        create: <T extends OverlayType>(i: OverlayInput<T>) =>
            createOV({
                ...i,
                ...(merge(tuning?.animation, i.animation) && { animation: merge(tuning?.animation, i.animation) }),
                ...(merge(tuning?.overlay, i.overlay) && { overlay: merge(tuning?.overlay, i.overlay) }),
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
            }),
        Dialog: createOV({
            type: 'dialog',
            ...(tuning?.animation && { animation: tuning.animation }),
            ...(tuning?.overlay && { overlay: tuning.overlay }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Drawer: createOV({
            type: 'drawer',
            ...(tuning?.animation && { animation: tuning.animation }),
            ...(tuning?.overlay && { overlay: tuning.overlay }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Modal: createOV({
            type: 'modal',
            ...(tuning?.animation && { animation: tuning.animation }),
            ...(tuning?.overlay && { overlay: tuning.overlay }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Popover: createOV({
            type: 'popover',
            ...(tuning?.animation && { animation: tuning.animation }),
            ...(tuning?.overlay && { overlay: tuning.overlay }),
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Sheet: createOV({
            type: 'sheet',
            ...(tuning?.animation && { animation: tuning.animation }),
            overlay: { ...tuning?.overlay, position: 'bottom' },
            ...(tuning?.scale && { scale: tuning.scale }),
        }),
        Tooltip: createOV({ type: 'tooltip', ...(tuning?.scale && { scale: tuning.scale }) }),
    });

// --- Export -----------------------------------------------------------------

export { B as OVERLAY_TUNING, createOverlays };
export type {
    BaseProps,
    DialogProps,
    DrawerProps,
    ModalProps,
    OverlayInput,
    OverlayType,
    PopoverProps,
    Position,
    TooltipProps,
};
