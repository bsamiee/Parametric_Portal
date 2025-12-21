/**
 * InputBar component: render persistent command/input bar with submit button, icons, loading state.
 * Uses B.bar, createBuilderContext, stateCls from schema.ts with React Aria accessibility.
 * Tooltips use unified useTooltipState + renderTooltipPortal from schema.ts.
 */
import type {
    CSSProperties,
    ForwardedRef,
    ForwardRefExoticComponent,
    HTMLAttributes,
    KeyboardEvent,
    ReactNode,
    RefAttributes,
} from 'react';
import { createElement, forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import type { AriaButtonOptions } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover } from 'react-aria';
import type { Inputs, ResolvedContext, TooltipSide, TuningFor } from './schema.ts';
import {
    B,
    computeOffsetPx,
    createBuilderContext,
    merged,
    pick,
    renderTooltipPortal,
    stateCls,
    TUNING_KEYS,
    useForwardedRef,
    useTooltipState,
    utilities,
} from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type InputBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'onSubmit'> & {
    readonly leftIcon?: ReactNode;
    readonly leftIconTooltip?: string;
    readonly leftIconTooltipSide?: TooltipSide;
    readonly loading?: boolean;
    readonly onLeftIconClick?: () => void;
    readonly onSubmit?: (value: string) => void;
    readonly onValueChange?: (value: string) => void;
    readonly placeholder?: string;
    readonly submitIcon?: ReactNode;
    readonly value?: string;
};

type InputBarInput = {
    readonly behavior?: Inputs['behavior'] | undefined;
    readonly className?: string;
    readonly scale?: Inputs['scale'] | undefined;
};

type InputBarApi = Readonly<{
    Bar: ForwardRefExoticComponent<InputBarProps & RefAttributes<HTMLDivElement>>;
    create: (input: InputBarInput) => ForwardRefExoticComponent<InputBarProps & RefAttributes<HTMLDivElement>>;
}>;

type Ctx = ResolvedContext<'behavior' | 'scale'>;

// --- [CONSTANTS] -------------------------------------------------------------

const barCls = {
    base: utilities.cls(B.bar.root, B.bar.var.r, B.bar.var.g, B.bar.var.h, B.bar.var.px, B.bar.var.py),
    icon: B.bar.var.iconSize,
    input: B.bar.var.fs,
    spinner: B.bar.var.iconSize,
    submit: utilities.cls(B.bar.var.r, B.bar.var.submitPad),
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const barHelpers = {
    baseStyle: (ctx: Ctx, style?: CSSProperties): CSSProperties => ({ ...ctx.vars, ...style }),
} as const;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const createInputBarComponent = (input: InputBarInput) => {
    const ctx = createBuilderContext('bar', ['behavior', 'scale'] as const, input);
    const base = utilities.cls(barCls.base, stateCls.bar(ctx.behavior), input.className);

    const Component = forwardRef((props: InputBarProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const {
            className,
            leftIcon,
            leftIconTooltip,
            leftIconTooltipSide = 'top',
            loading = false,
            onLeftIconClick,
            onSubmit,
            onValueChange,
            placeholder,
            style,
            submitIcon,
            value,
            ...rest
        } = props;
        const ref = useForwardedRef(fRef);
        const buttonRef = useRef<HTMLButtonElement>(null);
        const leftIconRef = useRef<HTMLButtonElement>(null);

        // Controlled/uncontrolled value handling
        const [internalValue, setInternalValue] = useState('');
        const currentValue = value ?? internalValue;
        const handleChange = onValueChange ?? setInternalValue;

        // Submit handler
        const handleSubmit = useCallback(() => {
            onSubmit?.(currentValue);
            value === undefined && setInternalValue('');
        }, [currentValue, onSubmit, value]);

        // Keyboard submit
        const handleKeyDown = useCallback(
            (e: KeyboardEvent<HTMLInputElement>) => {
                const shouldSubmit = e.key === 'Enter' && !e.shiftKey;
                shouldSubmit && e.preventDefault();
                shouldSubmit && handleSubmit();
            },
            [handleSubmit],
        );

        // Compute runtime state
        const { isDisabled, canSubmit } = useMemo(
            () => ({
                canSubmit: !(ctx.behavior.disabled || loading) && currentValue.trim().length > 0,
                isDisabled: ctx.behavior.disabled || loading,
            }),
            [loading, currentValue],
        );

        // React Aria hooks
        const { hoverProps, isHovered } = useHover({ isDisabled });
        const { focusProps, isFocusVisible } = useFocusRing();
        const { buttonProps } = useButton(
            { isDisabled: !canSubmit, onPress: handleSubmit } as AriaButtonOptions<'button'>,
            buttonRef,
        );

        // Left icon tooltip with unified tooltip primitives
        const tooltipOffsetPx = computeOffsetPx(ctx.scale, B.algo.tooltipOffMul);
        const tooltipState = useTooltipState(leftIconRef, {
            ...(leftIconTooltip !== undefined && { content: leftIconTooltip }),
            offsetPx: tooltipOffsetPx,
            side: leftIconTooltipSide,
        });

        const mergedProps = mergeProps(hoverProps, focusProps, rest, {
            className: utilities.cls(base, loading ? B.bar.state.loading : undefined, className),
            'data-focus': isFocusVisible || undefined,
            'data-hover': isHovered || undefined,
            'data-loading': loading || undefined,
            ref,
            style: barHelpers.baseStyle(ctx, style),
        });

        const leftIconEl = leftIcon
            ? createElement(
                  'span',
                  { className: 'relative inline-flex' },
                  createElement(
                      'button',
                      {
                          ...tooltipState.triggerProps,
                          className: utilities.cls(
                              B.bar.icon,
                              barCls.icon,
                              'cursor-pointer hover:opacity-80 transition-opacity',
                          ),
                          onClick: onLeftIconClick,
                          ref: (node: HTMLButtonElement | null) => {
                              (leftIconRef as { current: HTMLButtonElement | null }).current = node;
                              tooltipState.refs.setReference(node);
                          },
                          type: 'button',
                      },
                      leftIcon,
                  ),
                  renderTooltipPortal(tooltipState),
              )
            : null;

        return createElement(
            'div',
            mergedProps,
            leftIconEl,
            createElement('input', {
                autoComplete: 'off',
                className: utilities.cls(B.bar.input, barCls.input),
                disabled: isDisabled,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleChange(e.target.value),
                onKeyDown: handleKeyDown,
                placeholder,
                spellCheck: false,
                type: 'text',
                value: currentValue,
            }),
            createElement(
                'button',
                {
                    ...buttonProps,
                    className: utilities.cls(B.bar.submit, barCls.submit),
                    'data-loading': loading || undefined,
                    disabled: !canSubmit,
                    ref: buttonRef,
                    type: 'button',
                },
                loading
                    ? createElement(
                          'svg',
                          {
                              className: utilities.cls(B.bar.spinner, barCls.icon),
                              fill: 'none',
                              stroke: 'currentColor',
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                              strokeWidth: 2,
                              viewBox: '0 0 24 24',
                          },
                          createElement('path', { d: 'M21 12a9 9 0 11-6.219-8.56' }),
                      )
                    : submitIcon,
            ),
        );
    });
    Component.displayName = 'Bar';
    return Component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createInputBars = (tuning?: TuningFor<'bar'>): InputBarApi =>
    Object.freeze({
        Bar: createInputBarComponent(pick(tuning, TUNING_KEYS.bar)),
        create: (input: InputBarInput) =>
            createInputBarComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.bar) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createInputBars };
export type { InputBarApi, InputBarInput, InputBarProps };
