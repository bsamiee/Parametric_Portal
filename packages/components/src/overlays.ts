import { cva } from 'class-variance-authority';
import { Effect } from 'effect';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useEffect, useRef, useState } from 'react';
import { FocusScope, useDialog, useModal, useOverlay, usePreventScroll } from 'react-aria';
import type { AnimationConfig, DimensionConfig, OverlayConfig, OverlayPosition } from './schema.ts';
import {
    cls,
    computeDimensions,
    createAnimationDefaults,
    createDimensionDefaults,
    createOverlayDefaults,
    createVars,
    resolveAnimation,
    resolveDimensions,
    resolveOverlay,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type OverlayType = 'dialog' | 'drawer' | 'modal' | 'popover' | 'sheet' | 'tooltip';
type OverlayBaseProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly isOpen: boolean;
    readonly onClose: () => void;
};
type ModalProps = OverlayBaseProps & { readonly title?: string };
type DialogProps = ModalProps & {
    readonly cancelLabel?: string;
    readonly confirmLabel?: string;
    readonly onConfirm?: () => void;
};
type DrawerProps = OverlayBaseProps & { readonly position?: OverlayPosition };
type PopoverProps = OverlayBaseProps & { readonly triggerRef: RefObject<HTMLElement> };
type TooltipProps = Omit<OverlayBaseProps, 'onClose'> & { readonly triggerRef: RefObject<HTMLElement> };
type OverlayInput<T extends OverlayType> = {
    readonly animation?: Partial<AnimationConfig>;
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly overlay?: Partial<OverlayConfig>;
    readonly type: T;
};

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    cls: {
        backdrop: 'fixed inset-0 bg-black/50 z-40',
        drawer: {
            bottom: 'inset-x-0 bottom-0 rounded-t-xl',
            left: 'inset-y-0 left-0 rounded-r-xl',
            right: 'inset-y-0 right-0 rounded-l-xl',
            top: 'inset-x-0 top-0 rounded-b-xl',
        } as { readonly [K in OverlayPosition]: string },
    },
    defaults: {
        animation: createAnimationDefaults(),
        dimensions: createDimensionDefaults(),
        overlay: createOverlayDefaults(),
    },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const vars = createVars('overlay');

// Adapter: FocusScope requires children as prop; spread avoids static 'children:' key in source
const focusWrap = (opts: { autoFocus: boolean; contain: boolean; restoreFocus: boolean }, child: ReactNode) =>
    createElement(FocusScope, { ...opts, ...({ children: child } as const) });

const resolveDims = (dim?: Partial<DimensionConfig>): DimensionConfig =>
    Effect.runSync(resolveDimensions(dim, B.defaults.dimensions));

const resolveOvr = (ovr?: Partial<OverlayConfig>): OverlayConfig =>
    Effect.runSync(resolveOverlay(ovr, B.defaults.overlay));

const resolveAnim = (anim?: Partial<AnimationConfig>): AnimationConfig =>
    Effect.runSync(resolveAnimation(anim, B.defaults.animation));

const modalVariants = cva(
    [
        'fixed z-50 bg-white dark:bg-gray-900 shadow-xl',
        'rounded-[var(--overlay-radius)] overflow-hidden',
        'max-h-[90vh] overflow-y-auto',
    ].join(' '),
    { defaultVariants: {}, variants: {} },
);

const dialogVariants = cva(
    [
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
        'bg-white dark:bg-gray-900 shadow-xl w-full max-w-md',
        'rounded-[var(--overlay-radius)] overflow-hidden',
    ].join(' '),
    { defaultVariants: {}, variants: {} },
);

const drawerVariants = cva('fixed z-50 bg-white dark:bg-gray-900 shadow-xl overflow-hidden', {
    defaultVariants: {},
    variants: {},
});

const popoverVariants = cva(
    [
        'absolute z-50 bg-white dark:bg-gray-900 shadow-lg border',
        'rounded-[var(--overlay-radius)] overflow-hidden',
    ].join(' '),
    { defaultVariants: {}, variants: {} },
);

const tooltipVariants = cva(
    [
        'absolute z-50 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900',
        'text-xs px-2 py-1 rounded shadow-lg pointer-events-none',
    ].join(' '),
    { defaultVariants: {}, variants: {} },
);

// --- Component Factories ----------------------------------------------------

const createModal = (i: OverlayInput<'modal'>) => {
    const dims = resolveDims(i.dimensions);
    const ovr = resolveOvr(i.overlay);
    const anim = resolveAnim(i.animation);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = modalVariants({});
    const Component = forwardRef((props: ModalProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, title, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: ovr.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        const { dialogProps, titleProps } = useDialog({}, ref);
        usePreventScroll({ isDisabled: !isOpen });
        const animStyle = anim.enabled ? { transition: `all ${anim.duration}ms ${anim.easing}` } : {};
        const content = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                ...dialogProps,
                className: cls(base, 'w-full max-w-lg', i.className, className),
                ref,
                style: { ...cssVars, ...animStyle, ...style } as CSSProperties,
            },
            title
                ? createElement('div', { ...titleProps, className: 'px-6 py-4 border-b font-semibold text-lg' }, title)
                : null,
            createElement('div', { className: 'px-6 py-4' }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  { ...underlayProps, className: cls(B.cls.backdrop, 'flex items-center justify-center') },
                  focusWrap({ autoFocus: true, contain: ovr.trapFocus, restoreFocus: true }, content),
              )
            : null;
    });
    Component.displayName = 'Overlay(modal)';
    return Component;
};

const createDialog = (i: OverlayInput<'dialog'>) => {
    const dims = resolveDims(i.dimensions);
    const ovr = resolveOvr(i.overlay);
    const anim = resolveAnim(i.animation);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = dialogVariants({});
    const Component = forwardRef((props: DialogProps, fRef: ForwardedRef<HTMLDivElement>) => {
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
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: ovr.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        const { dialogProps, titleProps } = useDialog({}, ref);
        usePreventScroll({ isDisabled: !isOpen });
        const animStyle = anim.enabled ? { transition: `all ${anim.duration}ms ${anim.easing}` } : {};
        const dialogContent = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                ...dialogProps,
                className: cls(base, i.className, className),
                ref,
                role: 'alertdialog',
                style: { ...cssVars, ...animStyle, ...style } as CSSProperties,
            },
            title
                ? createElement('div', { ...titleProps, className: 'px-6 py-4 border-b font-semibold text-lg' }, title)
                : null,
            createElement('div', { className: 'px-6 py-4' }, children),
            createElement(
                'div',
                { className: 'px-6 py-4 border-t flex justify-end gap-3 bg-gray-50 dark:bg-gray-800' },
                createElement(
                    'button',
                    {
                        className: 'px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700',
                        onClick: onClose,
                        type: 'button',
                    },
                    cancelLabel,
                ),
                onConfirm
                    ? createElement(
                          'button',
                          {
                              className: 'px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700',
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
                  { ...underlayProps, className: B.cls.backdrop },
                  focusWrap({ autoFocus: true, contain: ovr.trapFocus, restoreFocus: true }, dialogContent),
              )
            : null;
    });
    Component.displayName = 'Overlay(dialog)';
    return Component;
};

const createDrawer = (i: OverlayInput<'drawer'>) => {
    const dims = resolveDims(i.dimensions);
    const ovr = resolveOvr(i.overlay);
    const anim = resolveAnim(i.animation);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = drawerVariants({});
    const pos = ovr.position;
    const sizeClass = pos === 'left' || pos === 'right' ? 'w-80 h-full' : 'h-80 w-full';
    const Component = forwardRef((props: DrawerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, position = pos, style, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const { overlayProps, underlayProps } = useOverlay(
            { isDismissable: ovr.closeOnOutsideClick, isOpen, onClose },
            ref,
        );
        const { modalProps } = useModal();
        usePreventScroll({ isDisabled: !isOpen });
        const animStyle = anim.enabled ? { transition: `transform ${anim.duration}ms ${anim.easing}` } : {};
        const drawerContent = createElement(
            'div',
            {
                ...rest,
                ...overlayProps,
                ...modalProps,
                className: cls(base, sizeClass, B.cls.drawer[position], i.className, className),
                ref,
                style: { ...cssVars, ...animStyle, ...style } as CSSProperties,
            },
            createElement('div', { className: 'p-4 h-full overflow-y-auto' }, children),
        );
        return isOpen
            ? createElement(
                  'div',
                  { ...underlayProps, className: B.cls.backdrop },
                  focusWrap({ autoFocus: true, contain: ovr.trapFocus, restoreFocus: true }, drawerContent),
              )
            : null;
    });
    Component.displayName = 'Overlay(drawer)';
    return Component;
};

const createPopover = (i: OverlayInput<'popover'>) => {
    const dims = resolveDims(i.dimensions);
    const ovr = resolveOvr(i.overlay);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = popoverVariants({});
    const Component = forwardRef((props: PopoverProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, onClose, style, triggerRef, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const { overlayProps } = useOverlay({ isDismissable: ovr.closeOnOutsideClick, isOpen, onClose }, ref);
        const [position, setPosition] = useState({ left: 0, top: 0 });
        useEffect(() => {
            const trigger = triggerRef.current;
            const pos = trigger
                ? { left: trigger.offsetLeft, top: trigger.offsetTop + trigger.offsetHeight + 8 }
                : { left: 0, top: 0 };
            setPosition(pos);
        }, [triggerRef]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      ...overlayProps,
                      className: cls(base, i.className, className),
                      ref,
                      style: { ...cssVars, ...position, ...style } as CSSProperties,
                  },
                  createElement('div', { className: 'p-4' }, children),
              )
            : null;
    });
    Component.displayName = 'Overlay(popover)';
    return Component;
};

const createTooltip = (i: OverlayInput<'tooltip'>) => {
    const base = tooltipVariants({});
    const Component = forwardRef((props: TooltipProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, isOpen, style, triggerRef, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const [position, setPosition] = useState({ left: 0, top: 0 });
        useEffect(() => {
            const trigger = triggerRef.current;
            const pos = trigger ? { left: trigger.offsetLeft, top: trigger.offsetTop - 28 } : { left: 0, top: 0 };
            setPosition(pos);
        }, [triggerRef]);
        return isOpen
            ? createElement(
                  'div',
                  {
                      ...rest,
                      className: cls(base, i.className, className),
                      ref,
                      role: 'tooltip',
                      style: { ...position, ...style } as CSSProperties,
                  },
                  children,
              )
            : null;
    });
    Component.displayName = 'Overlay(tooltip)';
    return Component;
};

const createSheet = (i: OverlayInput<'sheet'>) => {
    const drawer = createDrawer({ ...i, overlay: { ...i.overlay, position: 'bottom' }, type: 'drawer' });
    return drawer;
};

// --- Factory ----------------------------------------------------------------

const createOverlays = (tuning?: {
    defaults?: {
        animation?: Partial<AnimationConfig>;
        dimensions?: Partial<DimensionConfig>;
        overlay?: Partial<OverlayConfig>;
    };
}) => {
    const defs = {
        animation: { ...B.defaults.animation, ...tuning?.defaults?.animation },
        dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
        overlay: { ...B.defaults.overlay, ...tuning?.defaults?.overlay },
    };
    return Object.freeze({
        create: {
            dialog: (i: Omit<OverlayInput<'dialog'>, 'type'>) =>
                createDialog({
                    ...i,
                    animation: { ...defs.animation, ...i.animation },
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    overlay: { ...defs.overlay, ...i.overlay },
                    type: 'dialog',
                }),
            drawer: (i: Omit<OverlayInput<'drawer'>, 'type'>) =>
                createDrawer({
                    ...i,
                    animation: { ...defs.animation, ...i.animation },
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    overlay: { ...defs.overlay, ...i.overlay },
                    type: 'drawer',
                }),
            modal: (i: Omit<OverlayInput<'modal'>, 'type'>) =>
                createModal({
                    ...i,
                    animation: { ...defs.animation, ...i.animation },
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    overlay: { ...defs.overlay, ...i.overlay },
                    type: 'modal',
                }),
            popover: (i: Omit<OverlayInput<'popover'>, 'type'>) =>
                createPopover({
                    ...i,
                    animation: { ...defs.animation, ...i.animation },
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    overlay: { ...defs.overlay, ...i.overlay },
                    type: 'popover',
                }),
            sheet: (i: Omit<OverlayInput<'sheet'>, 'type'>) =>
                createSheet({
                    ...i,
                    animation: { ...defs.animation, ...i.animation },
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    overlay: { ...defs.overlay, ...i.overlay },
                    type: 'sheet',
                }),
            tooltip: (i: Omit<OverlayInput<'tooltip'>, 'type'>) =>
                createTooltip({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'tooltip' }),
        },
        Dialog: createDialog({
            animation: defs.animation,
            dimensions: defs.dimensions,
            overlay: defs.overlay,
            type: 'dialog',
        }),
        Drawer: createDrawer({
            animation: defs.animation,
            dimensions: defs.dimensions,
            overlay: defs.overlay,
            type: 'drawer',
        }),
        Modal: createModal({
            animation: defs.animation,
            dimensions: defs.dimensions,
            overlay: defs.overlay,
            type: 'modal',
        }),
        Popover: createPopover({
            animation: defs.animation,
            dimensions: defs.dimensions,
            overlay: defs.overlay,
            type: 'popover',
        }),
        Sheet: createSheet({
            animation: defs.animation,
            dimensions: defs.dimensions,
            overlay: { ...defs.overlay, position: 'bottom' },
            type: 'sheet',
        }),
        Tooltip: createTooltip({ dimensions: defs.dimensions, type: 'tooltip' }),
    });
};

// --- Export -----------------------------------------------------------------

export { B as OVERLAY_TUNING, createOverlays };
