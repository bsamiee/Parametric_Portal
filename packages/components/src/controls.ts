/**
 * Form control components: render button, checkbox, input, radio, switch, textarea.
 * Uses B.ctrl, utilities, stateCls, resolve from schema.ts with React Aria accessibility.
 */
import { Slot } from '@radix-ui/react-slot';
import type { CSSProperties, ForwardedRef, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { createElement, forwardRef, useMemo } from 'react';
import type { AriaButtonOptions, AriaSwitchProps } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover, useSwitch } from 'react-aria';
import { useToggleState } from 'react-stately';
import type { Inputs, TuningFor } from './schema.ts';
import { B, merged, pick, resolve, stateCls, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

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
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
};
type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'disabled'> & {
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
};
type SwitchProps = AriaSwitchProps & { readonly className?: string };
type ControlInput<T extends ControlType = 'button'> = {
    readonly asChild?: boolean;
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly className?: string;
    readonly fullWidth?: boolean;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const { base, h, px, py, fs, r, g } = B.ctrl.var;
const baseCls = (fw?: boolean): string => utilities.cls(base, h, px, py, fs, r, g, fw ? 'w-full' : 'w-auto');

const createButtonControl = (input: ControlInput<'button'>) => {
    const behavior = resolve('behavior', input.behavior);
    const scale = resolve('scale', input.scale);
    const vars = utilities.cssVars(utilities.computeScale(scale), 'ctrl');
    const base = utilities.cls(baseCls(input.fullWidth), stateCls.ctrl(behavior), input.className);
    const Component = forwardRef((props: ButtonProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const { asChild, children, className, leftIcon, rightIcon, variant = 'default', ...aria } = props;
        const ref = useForwardedRef(fRef);
        const { buttonProps, isPressed } = useButton(
            { ...aria, isDisabled: behavior.disabled || behavior.loading },
            ref,
        );
        const { hoverProps, isHovered } = useHover({ isDisabled: behavior.disabled || behavior.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const mergedProps = mergeProps(buttonProps, hoverProps, focusProps, {
            className: utilities.cls(base, B.ctrl.variant[variant], className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            'data-pressed': isPressed || undefined,
            'data-variant': variant,
            ref,
            style: vars as CSSProperties,
        });
        const content = createElement(
            'span',
            { className: utilities.cls('inline-flex items-center', B.ctrl.var.g) },
            leftIcon,
            children,
            rightIcon,
        );
        return (asChild ?? input.asChild)
            ? createElement(Slot, mergedProps, content)
            : createElement('button', { ...mergedProps, type: 'button' }, content);
    });
    Component.displayName = 'Ctrl(button)';
    return Component;
};

const createInputControl = <T extends ControlType>(input: ControlInput<T>) => {
    const isTextarea = input.type === 'textarea';
    const htmlType = input.type === 'checkbox' ? 'checkbox' : input.type === 'radio' ? 'radio' : 'text';
    const base = utilities.cls(
        baseCls(input.fullWidth),
        'border border-current/20 bg-transparent',
        isTextarea ? 'resize-y min-h-16' : undefined,
        input.className,
    );
    const Component = forwardRef(
        (props: InputProps | TextareaProps, fRef: ForwardedRef<HTMLInputElement | HTMLTextAreaElement>) => {
            const { behavior: propBehavior, className, scale: propScale, ...rest } = props;
            const asChild = 'asChild' in props ? props.asChild : undefined;
            const ref = useForwardedRef(fRef);
            const { behavior, vars } = useMemo(() => {
                const resolvedBehavior = resolve('behavior', { ...input.behavior, ...propBehavior });
                const resolvedScale = resolve('scale', { ...input.scale, ...propScale });
                return {
                    behavior: resolvedBehavior,
                    vars: utilities.cssVars(utilities.computeScale(resolvedScale), 'ctrl'),
                };
            }, [input.behavior, input.scale, propBehavior, propScale]);
            const { hoverProps, isHovered } = useHover({ isDisabled: behavior.disabled || behavior.loading });
            const { focusProps, isFocusVisible } = useFocusRing();
            const merged = mergeProps(hoverProps, focusProps, rest, {
                'aria-busy': behavior.loading || undefined,
                'aria-readonly': behavior.readonly || undefined,
                className: utilities.cls(base, stateCls.ctrl(behavior), className),
                'data-focus': isFocusVisible || undefined,
                'data-hover': isHovered || undefined,
                'data-readonly': behavior.readonly || undefined,
                disabled: behavior.disabled,
                readOnly: behavior.readonly,
                ref,
                style: vars as CSSProperties,
                ...(!isTextarea && { type: htmlType }),
            });
            const element = isTextarea ? 'textarea' : 'input';
            return (asChild ?? input.asChild) ? createElement(Slot, merged) : createElement(element, merged);
        },
    );
    Component.displayName = `Ctrl(${input.type ?? 'input'})`;
    return Component;
};

const createSwitchControl = (input: ControlInput<'switch'>) => {
    const behavior = resolve('behavior', input.behavior);
    const vars = utilities.cssVars(utilities.computeScale(resolve('scale', input.scale)), 'ctrl');
    const Component = forwardRef((props: SwitchProps, fRef: ForwardedRef<HTMLInputElement>) => {
        const { className, ...aria } = props;
        const ref = useForwardedRef(fRef);
        const state = useToggleState(aria);
        const { inputProps } = useSwitch(aria, state, ref);
        const { focusProps, isFocusVisible } = useFocusRing();
        return createElement(
            'label',
            {
                className: utilities.cls(
                    B.ctrl.switch.track,
                    B.ctrl.var.h,
                    state.isSelected ? B.ctrl.switch.trackOn : undefined,
                    stateCls.ctrl(behavior),
                    input.className,
                    className,
                ),
                'data-focus': isFocusVisible || undefined,
                'data-selected': state.isSelected || undefined,
                style: { ...vars, width: `calc(var(--ctrl-height) * ${B.algo.switchWidthRatio})` } as CSSProperties,
            },
            createElement('input', mergeProps(inputProps, focusProps, { className: 'sr-only', ref })),
            createElement('span', {
                className: utilities.cls(B.ctrl.switch.thumb, state.isSelected ? B.ctrl.switch.thumbOn : undefined),
                style: {
                    height: `calc(var(--ctrl-height) - ${B.algo.switchThumbInsetPx}px)`,
                    width: `calc(var(--ctrl-height) - ${B.algo.switchThumbInsetPx}px)`,
                },
            }),
        );
    });
    Component.displayName = 'Ctrl(switch)';
    return Component;
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    button: createButtonControl,
    checkbox: createInputControl<'checkbox'>,
    input: createInputControl<'input'>,
    radio: createInputControl<'radio'>,
    switch: createSwitchControl,
    textarea: createInputControl<'textarea'>,
} as const;

const create = <T extends ControlType>(input: ControlInput<T>) =>
    (builderHandlers[input.type ?? 'button'] as (input: ControlInput<T>) => ReturnType<typeof forwardRef>)(input);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createControls = (tuning?: TuningFor<'ctrl'>) =>
    Object.freeze({
        Button: create({ type: 'button', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Checkbox: create({ type: 'checkbox', ...pick(tuning, TUNING_KEYS.ctrl) }),
        create: <T extends ControlType>(input: ControlInput<T>) =>
            create({ ...input, ...merged(tuning, input, TUNING_KEYS.ctrl) }),
        Input: create({ type: 'input', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Radio: create({ type: 'radio', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Switch: create({ type: 'switch', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Textarea: create({ type: 'textarea', ...pick(tuning, TUNING_KEYS.ctrl) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createControls };
export type { ButtonProps, ButtonVariant, ControlInput, ControlType, InputProps, SwitchProps, TextareaProps };
