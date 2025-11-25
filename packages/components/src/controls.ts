import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { createElement, forwardRef, useMemo } from 'react';
import type { AriaButtonOptions, AriaSwitchProps } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover, useSwitch } from 'react-aria';
import { useToggleState } from 'react-stately';
import type { BehaviorInput, CtrlTuning, ScaleInput } from './schema.ts';
import { B, cls, computeScale, cssVars, merged, pick, resolve, stateCls, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ControlType = 'button' | 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';
type ButtonVariant = keyof typeof B.ctrl.variant;
type ButtonProps = AriaButtonOptions<'button'> & {
    readonly asChild?: boolean;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly leftIcon?: ReactNode;
    readonly rightIcon?: ReactNode;
    readonly variant?: ButtonVariant;
};
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'disabled'> & {
    readonly asChild?: boolean;
    readonly behavior?: BehaviorInput | undefined;
    readonly scale?: ScaleInput | undefined;
};
type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'disabled'> & {
    readonly behavior?: BehaviorInput | undefined;
    readonly scale?: ScaleInput | undefined;
};
type SwitchProps = AriaSwitchProps & { readonly className?: string };
type ControlInput<T extends ControlType = 'button'> = {
    readonly asChild?: boolean;
    readonly behavior?: BehaviorInput | undefined;
    readonly className?: string;
    readonly fullWidth?: boolean;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Pure Utility Functions -------------------------------------------------

const baseCls = (fw?: boolean): string =>
    cls(
        B.ctrl.var.base,
        B.ctrl.var.h,
        B.ctrl.var.px,
        B.ctrl.var.py,
        B.ctrl.var.fs,
        B.ctrl.var.r,
        B.ctrl.var.g,
        fw ? 'w-full' : 'w-auto',
    );

// --- Component Factories ----------------------------------------------------

const createBtn = (i: ControlInput<'button'>) => {
    const beh = resolve('behavior', i.behavior);
    const scl = resolve('scale', i.scale);
    const vars = cssVars(computeScale(scl), 'ctrl');
    const base = cls(baseCls(i.fullWidth), stateCls.ctrl(beh), i.className);
    const Comp = forwardRef((props: ButtonProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const { asChild, children, className, leftIcon, rightIcon, variant = 'default', ...aria } = props;
        const ref = useForwardedRef(fRef);
        const { buttonProps, isPressed } = useButton({ ...aria, isDisabled: beh.disabled || beh.loading }, ref);
        const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const mergedProps = mergeProps(buttonProps, hoverProps, focusProps, {
            className: cls(base, B.ctrl.variant[variant], className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            'data-pressed': isPressed || undefined,
            'data-variant': variant,
            ref,
            style: vars as CSSProperties,
        });
        const content = createElement(
            'span',
            { className: cls('inline-flex items-center', B.ctrl.var.g) },
            leftIcon,
            children,
            rightIcon,
        );
        return (asChild ?? i.asChild)
            ? createElement(Slot, mergedProps, content)
            : createElement('button', { ...mergedProps, type: 'button' }, content);
    });
    Comp.displayName = 'Ctrl(button)';
    return Comp;
};

const createInp = <T extends ControlType>(i: ControlInput<T>) => {
    const isTextarea = i.type === 'textarea';
    const htmlType = i.type === 'checkbox' ? 'checkbox' : i.type === 'radio' ? 'radio' : 'text';
    const base = cls(
        baseCls(i.fullWidth),
        'border border-current/20 bg-transparent',
        isTextarea ? 'resize-y min-h-16' : undefined,
        i.className,
    );
    const Comp = forwardRef(
        (props: InputProps | TextareaProps, fRef: ForwardedRef<HTMLInputElement | HTMLTextAreaElement>) => {
            const { behavior: pb, className, scale: ps, ...rest } = props;
            const asChild = 'asChild' in props ? props.asChild : undefined;
            const ref = useForwardedRef(fRef);
            const { beh, vars } = useMemo(() => {
                const b = resolve('behavior', { ...i.behavior, ...pb });
                const s = resolve('scale', { ...i.scale, ...ps });
                return { beh: b, vars: cssVars(computeScale(s), 'ctrl') };
            }, [i.behavior, i.scale, pb, ps]);
            const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
            const { focusProps, isFocusVisible } = useFocusRing();
            const merged = mergeProps(hoverProps, focusProps, rest, {
                'aria-busy': beh.loading || undefined,
                'aria-readonly': beh.readonly || undefined,
                className: cls(base, stateCls.ctrl(beh), className),
                'data-focus': isFocusVisible || undefined,
                'data-hover': isHovered || undefined,
                'data-readonly': beh.readonly || undefined,
                disabled: beh.disabled,
                readOnly: beh.readonly,
                ref,
                style: vars as CSSProperties,
                ...(!isTextarea && { type: htmlType }),
            });
            const el = isTextarea ? 'textarea' : 'input';
            return (asChild ?? i.asChild) ? createElement(Slot, merged) : createElement(el, merged);
        },
    );
    Comp.displayName = `Ctrl(${i.type ?? 'input'})`;
    return Comp;
};

const createSwitch = (i: ControlInput<'switch'>) => {
    const beh = resolve('behavior', i.behavior);
    const vars = cssVars(computeScale(resolve('scale', i.scale)), 'ctrl');
    const Comp = forwardRef((props: SwitchProps, fRef: ForwardedRef<HTMLInputElement>) => {
        const { className, ...aria } = props;
        const ref = useForwardedRef(fRef);
        const state = useToggleState(aria);
        const { inputProps } = useSwitch(aria, state, ref);
        const { focusProps, isFocusVisible } = useFocusRing();
        return createElement(
            'label',
            {
                className: cls(
                    B.ctrl.switch.track,
                    B.ctrl.var.h,
                    state.isSelected ? B.ctrl.switch.trackOn : undefined,
                    stateCls.ctrl(beh),
                    i.className,
                    className,
                ),
                'data-focus': isFocusVisible || undefined,
                'data-selected': state.isSelected || undefined,
                style: { ...vars, width: `calc(var(--ctrl-height) * ${B.algo.switchWidthRatio})` } as CSSProperties,
            },
            createElement('input', mergeProps(inputProps, focusProps, { className: 'sr-only', ref })),
            createElement('span', {
                className: cls(B.ctrl.switch.thumb, state.isSelected ? B.ctrl.switch.thumbOn : undefined),
                style: {
                    height: `calc(var(--ctrl-height) - ${B.algo.switchThumbInsetPx}px)`,
                    width: `calc(var(--ctrl-height) - ${B.algo.switchThumbInsetPx}px)`,
                },
            }),
        );
    });
    Comp.displayName = 'Ctrl(switch)';
    return Comp;
};

// --- Dispatch Table ---------------------------------------------------------

const builders = {
    button: createBtn,
    checkbox: createInp<'checkbox'>,
    input: createInp<'input'>,
    radio: createInp<'radio'>,
    switch: createSwitch,
    textarea: createInp<'textarea'>,
} as const;

const create = <T extends ControlType>(i: ControlInput<T>) =>
    (builders[i.type ?? 'button'] as (i: ControlInput<T>) => ReturnType<typeof forwardRef>)(i);

// --- Factory ----------------------------------------------------------------

const K = ['behavior', 'scale'] as const;

const createControls = (tuning?: CtrlTuning) =>
    Object.freeze({
        Button: create({ type: 'button', ...pick(tuning, K) }),
        Checkbox: create({ type: 'checkbox', ...pick(tuning, K) }),
        create: <T extends ControlType>(i: ControlInput<T>) => create({ ...i, ...merged(tuning, i, K) }),
        Input: create({ type: 'input', ...pick(tuning, K) }),
        Radio: create({ type: 'radio', ...pick(tuning, K) }),
        Switch: create({ type: 'switch', ...pick(tuning, K) }),
        Textarea: create({ type: 'textarea', ...pick(tuning, K) }),
    });

// --- Export -----------------------------------------------------------------

export { createControls };
export type { ButtonProps, ButtonVariant, ControlInput, ControlType, InputProps, SwitchProps, TextareaProps };
