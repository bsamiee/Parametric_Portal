import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, pipe } from 'effect';
import type { CSSProperties, ForwardedRef, InputHTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useMemo, useRef } from 'react';
import type { AriaButtonOptions } from 'react-aria';
import { mergeProps, useButton, useFocusRing, useHover } from 'react-aria';
import { twMerge } from 'tailwind-merge';
import type { BehaviorConfig, ComputedDimensions, DimensionConfig } from './schema.ts';
import {
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
    B as SB,
    styleVars,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ControlType = 'button' | 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';
type StateKey = 'disabled' | 'focus' | 'hover' | 'loading' | 'pressed';
type ButtonProps = AriaButtonOptions<'button'> & {
    readonly asChild?: boolean;
    readonly children?: ReactNode;
    readonly className?: string;
};
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'disabled'> & {
    readonly asChild?: boolean;
    readonly behavior?: Partial<BehaviorConfig>;
    readonly dimensions?: Partial<DimensionConfig>;
};
type ControlInput<T extends ControlType> = {
    readonly asChild?: boolean;
    readonly behavior?: Partial<BehaviorConfig>;
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly fullWidth?: boolean;
    readonly type: T;
};

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    algo: SB.algo,
    cls: {
        disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
        focus: 'outline-none ring-2 ring-offset-2 ring-[var(--color-primary-500,currentColor)]',
        hover: 'brightness-110',
        loading: 'cursor-wait animate-pulse',
        pressed: 'brightness-90 scale-[0.98]',
    } as { readonly [K in StateKey]: string },
    defaults: { behavior: createBehaviorDefaults(), dimensions: createDimensionDefaults() },
    input: {
        checkbox: 'appearance-none cursor-pointer',
        radio: 'appearance-none cursor-pointer rounded-full',
        text: 'bg-transparent',
    },
    width: { false: 'w-auto', true: 'w-full' },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const cls = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const vars = (d: ComputedDimensions): Record<string, string> => styleVars(d, 'control');

const stateClass = (b: BehaviorConfig, h: boolean, p: boolean, f: boolean): string =>
    cls(
        b.disabled ? B.cls.disabled : undefined,
        b.loading ? B.cls.loading : undefined,
        f && !b.disabled ? B.cls.focus : undefined,
        h && !b.disabled && !b.loading ? B.cls.hover : undefined,
        p && !b.disabled ? B.cls.pressed : undefined,
    );

const baseVariants = cva(
    [
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'h-[var(--control-height)] px-[var(--control-padding-x)] py-[var(--control-padding-y)]',
        'text-[length:var(--control-font-size)] rounded-[var(--control-radius)] gap-[var(--control-gap)]',
    ].join(' '),
    { defaultVariants: { fullWidth: false }, variants: { fullWidth: B.width } },
);

const inputVariants = cva(
    [
        'inline-flex items-center font-normal transition-all duration-150',
        'h-[var(--control-height)] px-[var(--control-padding-x)] py-[var(--control-padding-y)]',
        'text-[length:var(--control-font-size)] rounded-[var(--control-radius)] border border-current/20 bg-transparent',
    ].join(' '),
    { defaultVariants: { fullWidth: false, inputType: 'text' }, variants: { fullWidth: B.width, inputType: B.input } },
);

// --- Effect Pipelines -------------------------------------------------------

const resolve = (
    dim?: Partial<DimensionConfig>,
    beh?: Partial<BehaviorConfig>,
): Effect.Effect<{ behavior: BehaviorConfig; dimensions: DimensionConfig }, never, never> =>
    pipe(
        Effect.all({
            behavior: pipe(
                decodeBehavior({ ...B.defaults.behavior, ...beh }),
                Effect.catchAll(() => Effect.succeed(B.defaults.behavior)),
            ),
            dimensions: pipe(
                decodeDimensions({ ...B.defaults.dimensions, ...dim }),
                Effect.catchAll(() => Effect.succeed(B.defaults.dimensions)),
            ),
        }),
    );

// --- Component Factories ----------------------------------------------------

const createButton = (i: ControlInput<'button'>) => {
    const { behavior: beh, dimensions: dims } = Effect.runSync(resolve(i.dimensions, i.behavior));
    const computed = Effect.runSync(computeDimensions(dims));
    const cssVars = vars(computed);
    const base = baseVariants({ fullWidth: i.fullWidth ?? false });
    const Component = forwardRef((props: ButtonProps, fRef: ForwardedRef<HTMLButtonElement>) => {
        const { asChild, children, className, ...aria } = props;
        const internalRef = useRef<HTMLButtonElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLButtonElement>;
        const { buttonProps, isPressed } = useButton({ ...aria, isDisabled: beh.disabled || beh.loading }, ref);
        const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const merged = mergeProps(buttonProps, hoverProps, focusProps, {
            className: cls(base, stateClass(beh, isHovered, isPressed, isFocusVisible), i.className, className),
            ref,
            style: cssVars as CSSProperties,
        });
        return (asChild ?? i.asChild)
            ? createElement(Slot, merged, children)
            : createElement('button', { ...merged, type: 'button' }, children);
    });
    Component.displayName = 'Control(button)';
    return Component;
};

const createInput = <T extends ControlType>(i: ControlInput<T>) => {
    const htmlType = i.type === 'checkbox' ? 'checkbox' : i.type === 'radio' ? 'radio' : 'text';
    const base = inputVariants({ fullWidth: i.fullWidth ?? false, inputType: htmlType });
    const Component = forwardRef((props: InputProps, fRef: ForwardedRef<HTMLInputElement>) => {
        const { asChild, behavior: pb, className, dimensions: pd, ...rest } = props;
        const internalRef = useRef<HTMLInputElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLInputElement>;
        const { behavior: beh, cssVars } = useMemo(() => {
            const r = Effect.runSync(resolve({ ...i.dimensions, ...pd }, { ...i.behavior, ...pb }));
            return { behavior: r.behavior, cssVars: vars(Effect.runSync(computeDimensions(r.dimensions))) };
        }, [pd, pb, i.behavior, i.dimensions]);
        const { hoverProps, isHovered } = useHover({ isDisabled: beh.disabled || beh.loading });
        const { focusProps, isFocusVisible } = useFocusRing();
        const merged = mergeProps(hoverProps, focusProps, rest, {
            'aria-busy': beh.loading || undefined,
            className: cls(base, stateClass(beh, isHovered, false, isFocusVisible), i.className, className),
            disabled: beh.disabled,
            ref,
            style: cssVars as CSSProperties,
            type: htmlType,
        });
        return (asChild ?? i.asChild) ? createElement(Slot, merged) : createElement('input', merged);
    });
    Component.displayName = `Control(${i.type})`;
    return Component;
};

const create = <T extends ControlType>(i: ControlInput<T>) =>
    i.type === 'button' ? createButton(i as ControlInput<'button'>) : createInput(i);

// --- Factory ----------------------------------------------------------------

const createControls = (tuning?: {
    defaults?: { behavior?: Partial<BehaviorConfig>; dimensions?: Partial<DimensionConfig> };
}) =>
    Object.freeze({
        Button: create({
            behavior: { ...B.defaults.behavior, ...tuning?.defaults?.behavior },
            dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
            type: 'button',
        }),
        create: <T extends ControlType>(i: ControlInput<T>) =>
            create({
                ...i,
                behavior: { ...B.defaults.behavior, ...tuning?.defaults?.behavior, ...i.behavior },
                dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions, ...i.dimensions },
            }),
        Input: create({
            behavior: { ...B.defaults.behavior, ...tuning?.defaults?.behavior },
            dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
            type: 'input',
        }),
    });

// --- Export -----------------------------------------------------------------

export { B as CONTROL_TUNING, createControls };
