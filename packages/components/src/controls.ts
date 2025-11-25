import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, InputHTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useMemo, useRef } from 'react';
import type { AriaButtonOptions } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover } from 'react-aria';
import type { Behavior, BehaviorInput, ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, merge, resolveBehavior, resolveScale } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ControlType = 'button' | 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';
type ButtonProps = AriaButtonOptions<'button'> & {
    readonly asChild?: boolean;
    readonly children?: ReactNode;
    readonly className?: string;
};
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'disabled'> & {
    readonly asChild?: boolean;
    readonly behavior?: BehaviorInput | undefined;
    readonly scale?: ScaleInput | undefined;
};
type ControlInput<T extends ControlType = 'button'> = {
    readonly asChild?: boolean;
    readonly behavior?: BehaviorInput | undefined;
    readonly className?: string;
    readonly fullWidth?: boolean;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    state: { disabled: 'opacity-50 cursor-not-allowed pointer-events-none', loading: 'cursor-wait' },
    var: {
        base: 'inline-flex items-center justify-center font-medium transition-all duration-150',
        fs: 'text-[length:var(--ctrl-font-size)]',
        g: 'gap-[var(--ctrl-gap)]',
        h: 'h-[var(--ctrl-height)]',
        px: 'px-[var(--ctrl-padding-x)]',
        py: 'py-[var(--ctrl-padding-y)]',
        r: 'rounded-[var(--ctrl-radius)]',
    },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const baseCls = (fw?: boolean): string =>
    cls(B.var.base, B.var.h, B.var.px, B.var.py, B.var.fs, B.var.r, B.var.g, fw ? 'w-full' : 'w-auto');
const stateCls = (b: Behavior): string =>
    cls(b.disabled ? B.state.disabled : undefined, b.loading ? B.state.loading : undefined);

// --- Component Factories ----------------------------------------------------

const createBtn = (i: ControlInput<'button'>) => {
    const beh = resolveBehavior(i.behavior);
    const scl = resolveScale(i.scale);
    const vars = cssVars(computeScale(scl), 'ctrl');
    const base = cls(baseCls(i.fullWidth), stateCls(beh), i.className);
    const Comp = forwardRef((props: ButtonProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const { asChild, children, className, ...aria } = props;
        const intRef = useRef<HTMLButtonElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLButtonElement>;
        const { buttonProps, isPressed } = useButton({ ...aria, isDisabled: beh.disabled || beh.loading }, ref);
        const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const merged = mergeProps(buttonProps, hoverProps, focusProps, {
            className: cls(base, className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            'data-pressed': isPressed || undefined,
            ref,
            style: vars as CSSProperties,
        });
        return (asChild ?? i.asChild)
            ? createElement(Slot, merged, children)
            : createElement('button', { ...merged, type: 'button' }, children);
    });
    Comp.displayName = 'Ctrl(button)';
    return Comp;
};

const createInp = <T extends ControlType>(i: ControlInput<T>) => {
    const htmlType = i.type === 'checkbox' ? 'checkbox' : i.type === 'radio' ? 'radio' : 'text';
    const base = cls(baseCls(i.fullWidth), 'border border-current/20 bg-transparent', i.className);
    const Comp = forwardRef((props: InputProps, fRef: ForwardedRef<HTMLInputElement>) => {
        const { asChild, behavior: pb, className, scale: ps, ...rest } = props;
        const intRef = useRef<HTMLInputElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLInputElement>;
        const { beh, vars } = useMemo(() => {
            const b = resolveBehavior({ ...i.behavior, ...pb });
            const s = resolveScale({ ...i.scale, ...ps });
            return { beh: b, vars: cssVars(computeScale(s), 'ctrl') };
        }, [pb, ps, i.behavior, i.scale]);
        const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const merged = mergeProps(hoverProps, focusProps, rest, {
            'aria-busy': beh.loading || undefined,
            className: cls(base, stateCls(beh), className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            disabled: beh.disabled,
            ref,
            style: vars as CSSProperties,
            type: htmlType,
        });
        return (asChild ?? i.asChild) ? createElement(Slot, merged) : createElement('input', merged);
    });
    Comp.displayName = `Ctrl(${i.type ?? 'input'})`;
    return Comp;
};

const create = <T extends ControlType>(i: ControlInput<T>) =>
    i.type === 'button' ? createBtn(i as ControlInput<'button'>) : createInp(i);

// --- Factory ----------------------------------------------------------------

const createControls = (tuning?: { scale?: ScaleInput; behavior?: BehaviorInput }) =>
    Object.freeze({
        Button: create({
            type: 'button',
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
        }),
        create: <T extends ControlType>(i: ControlInput<T>) =>
            create({
                ...i,
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
                ...(merge(tuning?.behavior, i.behavior) && { behavior: merge(tuning?.behavior, i.behavior) }),
            }),
        Input: create({
            type: 'input',
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.behavior && { behavior: tuning.behavior }),
        }),
    });

// --- Export -----------------------------------------------------------------

export { B as CONTROL_TUNING, createControls };
export type { ButtonProps, ControlInput, ControlType, InputProps };
