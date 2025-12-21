/**
 * Form control components: render button, checkbox, input, radio, switch, textarea.
 * Uses B.ctrl, utilities, stateCls, resolve from schema.ts with React Aria accessibility.
 * Tooltips use unified useTooltipState + renderTooltipPortal from schema.ts.
 */
import { Slot } from '@radix-ui/react-slot';
import type {
    CSSProperties,
    ForwardedRef,
    ForwardRefExoticComponent,
    InputHTMLAttributes,
    ReactNode,
    RefAttributes,
    TextareaHTMLAttributes,
} from 'react';
import { createElement, forwardRef, useMemo, useRef } from 'react';
import type { AriaButtonOptions, AriaSwitchProps } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover, useSwitch } from 'react-aria';
import { useToggleState } from 'react-stately';
import type { Inputs, TooltipSide, TuningFor } from './schema.ts';
import {
    B,
    computeOffsetPx,
    merged,
    pick,
    renderTooltipPortal,
    resolve,
    stateCls,
    TUNING_KEYS,
    useForwardedRef,
    useTooltipState,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type ControlType = 'button' | 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';
type ButtonVariant = keyof typeof B.ctrl.variant;
type ButtonProps = AriaButtonOptions<'button'> & {
    readonly asChild?: boolean;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly leftIcon?: ReactNode;
    readonly rightIcon?: ReactNode;
    readonly tooltip?: string;
    readonly tooltipSide?: TooltipSide;
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
type ControlsApi = Readonly<{
    Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>;
    Checkbox: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;
    create: <T extends ControlType>(input: ControlInput<T>) => ForwardRefExoticComponent<RefAttributes<unknown>>;
    Input: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;
    Radio: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;
    Switch: ForwardRefExoticComponent<SwitchProps & RefAttributes<HTMLInputElement>>;
    Textarea: ForwardRefExoticComponent<TextareaProps & RefAttributes<HTMLTextAreaElement>>;
}>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const { base, h, px, py, fs, r, g, wFull, wAuto } = B.ctrl.var;
const baseCls = (fw?: boolean): string => utilities.cls(base, h, px, py, fs, r, g, fw ? wFull : wAuto);

const createButtonControl = (input: ControlInput<'button'>) => {
    const behavior = resolve('behavior', input.behavior);
    const scale = resolve('scale', input.scale);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'ctrl');
    const base = utilities.cls(baseCls(input.fullWidth), stateCls.ctrl(behavior), input.className);
    const tooltipOffsetPx = computeOffsetPx(scale, B.algo.tooltipOffMul);

    const Component = forwardRef((props: ButtonProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const {
            asChild,
            children,
            className,
            leftIcon,
            rightIcon,
            tooltip,
            tooltipSide = 'top',
            variant = 'default',
            ...aria
        } = props;
        const ref = useForwardedRef(fRef);
        const triggerRef = useRef<HTMLButtonElement>(null);
        const isDisabled = behavior.disabled || behavior.loading;

        const { buttonProps, isPressed } = useButton({ ...aria, isDisabled }, ref);
        const { hoverProps, isHovered } = useHover({ isDisabled });
        const { focusProps, isFocusVisible } = useFocusRing();

        const tooltipState = useTooltipState(triggerRef, {
            ...(tooltip !== undefined && { content: tooltip }),
            isDisabled,
            offsetPx: tooltipOffsetPx,
            side: tooltipSide,
        });

        const mergedProps = mergeProps(buttonProps, hoverProps, focusProps, tooltip ? tooltipState.triggerProps : {}, {
            className: utilities.cls(base, B.ctrl.variant[variant], className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            'data-pressed': isPressed || undefined,
            'data-variant': variant,
            ref: (node: HTMLButtonElement | null) => {
                (ref as { current: HTMLButtonElement | null }).current = node;
                (triggerRef as { current: HTMLButtonElement | null }).current = node;
                tooltipState.refs.setReference(node);
            },
            style: vars as CSSProperties,
        });

        const content = createElement(
            'span',
            { className: utilities.cls('inline-flex items-center', B.ctrl.var.g) },
            leftIcon,
            children,
            rightIcon,
        );

        const buttonEl =
            (asChild ?? input.asChild)
                ? createElement(Slot, mergedProps, content)
                : createElement('button', { ...mergedProps, type: 'button' }, content);

        return createElement(
            'span',
            { className: 'relative inline-flex' },
            buttonEl,
            renderTooltipPortal(tooltipState),
        );
    });

    Component.displayName = 'Ctrl(button)';
    return Component;
};

type InputHtmlType = 'checkbox' | 'radio' | 'text';
const inputTypeMap = {
    button: 'text',
    checkbox: 'checkbox',
    input: 'text',
    radio: 'radio',
    switch: 'text',
    textarea: 'text',
} as const satisfies Readonly<Record<ControlType, InputHtmlType>>;

const createInputControl = <T extends ControlType>(input: ControlInput<T>) => {
    const controlType = input.type ?? 'input';
    const isTextarea = controlType === 'textarea';
    const htmlType = inputTypeMap[controlType] ?? 'text';
    const base = utilities.cls(
        baseCls(input.fullWidth),
        B.ctrl.var.inputBorder,
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

const createControls = (tuning?: TuningFor<'ctrl'>): ControlsApi =>
    Object.freeze({
        Button: createButtonControl({ type: 'button', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Checkbox: createInputControl<'checkbox'>({ type: 'checkbox', ...pick(tuning, TUNING_KEYS.ctrl) }),
        create: <T extends ControlType>(input: ControlInput<T>) =>
            create({ ...input, ...merged(tuning, input, TUNING_KEYS.ctrl) }),
        Input: createInputControl<'input'>({ type: 'input', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Radio: createInputControl<'radio'>({ type: 'radio', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Switch: createSwitchControl({ type: 'switch', ...pick(tuning, TUNING_KEYS.ctrl) }),
        Textarea: createInputControl<'textarea'>({ type: 'textarea', ...pick(tuning, TUNING_KEYS.ctrl) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createControls };
export type {
    ButtonProps,
    ButtonVariant,
    ControlInput,
    ControlsApi,
    ControlType,
    InputProps,
    SwitchProps,
    TextareaProps,
};
