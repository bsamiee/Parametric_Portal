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
    ALGORITHM_CONFIG,
    computeDimensions,
    createBehaviorDefaults,
    createDimensionDefaults,
    decodeBehavior,
    decodeDimensions,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type ControlType = 'button' | 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';

type ControlTuning = {
    readonly algorithms: typeof ALGORITHM_CONFIG;
    readonly defaults: {
        readonly behavior: BehaviorConfig;
        readonly dimensions: DimensionConfig;
    };
    readonly stateClasses: {
        readonly disabled: string;
        readonly focus: string;
        readonly hover: string;
        readonly loading: string;
        readonly pressed: string;
    };
};

type ControlFactoryInput<T extends ControlType> = {
    readonly asChild?: boolean;
    readonly behavior?: Partial<BehaviorConfig>;
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly fullWidth?: boolean;
    readonly type: T;
};

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

type ControlComponent<T extends ControlType> = T extends 'button'
    ? ReturnType<typeof forwardRef<HTMLButtonElement, ButtonProps>>
    : T extends 'input' | 'checkbox' | 'radio'
      ? ReturnType<typeof forwardRef<HTMLInputElement, InputProps>>
      : ReturnType<typeof forwardRef<HTMLElement, Record<string, unknown>>>;

type ControlFactory = {
    readonly Button: ControlComponent<'button'>;
    readonly create: <T extends ControlType>(input: ControlFactoryInput<T>) => ControlComponent<T>;
    readonly Input: ControlComponent<'input'>;
};

// --- Constants (Unified Factory -> Frozen) ----------------------------------

const { controlTuning, interactionVariants } = Effect.runSync(
    Effect.all({
        controlTuning: Effect.succeed({
            algorithms: ALGORITHM_CONFIG,
            defaults: {
                behavior: createBehaviorDefaults(),
                dimensions: createDimensionDefaults(),
            },
            stateClasses: {
                disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
                focus: 'outline-none ring-2 ring-offset-2 ring-[var(--color-primary-500,currentColor)]',
                hover: 'brightness-110',
                loading: 'cursor-wait animate-pulse',
                pressed: 'brightness-90 scale-[0.98]',
            },
        } as const),
        interactionVariants: Effect.succeed({
            fullWidth: {
                false: 'w-auto',
                true: 'w-full',
            },
            inputType: {
                checkbox: 'appearance-none cursor-pointer',
                radio: 'appearance-none cursor-pointer rounded-full',
                text: 'bg-transparent',
            },
        } as const),
    }),
);

const CONTROL_TUNING: ControlTuning = Object.freeze(controlTuning);
const INTERACTION_VARIANTS = Object.freeze(interactionVariants);

// --- Pure Utility Functions -------------------------------------------------

const mergeClasses = (...inputs: ReadonlyArray<string | undefined>): string => twMerge(clsx(inputs));

const computeStyleVars = (dims: ComputedDimensions): Record<string, string> => ({
    '--control-font-size': dims.fontSize,
    '--control-gap': dims.gap,
    '--control-height': dims.height,
    '--control-icon-size': dims.iconSize,
    '--control-padding-x': dims.paddingX,
    '--control-padding-y': dims.paddingY,
    '--control-radius': dims.radius,
});

const createControlVariants = () =>
    cva(
        [
            'inline-flex items-center justify-center',
            'font-medium transition-all duration-150',
            'h-[var(--control-height)]',
            'px-[var(--control-padding-x)] py-[var(--control-padding-y)]',
            'text-[length:var(--control-font-size)]',
            'rounded-[var(--control-radius)]',
            'gap-[var(--control-gap)]',
        ].join(' '),
        {
            compoundVariants: [],
            defaultVariants: {
                fullWidth: false,
            },
            variants: {
                fullWidth: INTERACTION_VARIANTS.fullWidth,
            },
        },
    );

const createInputVariants = () =>
    cva(
        [
            'inline-flex items-center',
            'font-normal transition-all duration-150',
            'h-[var(--control-height)]',
            'px-[var(--control-padding-x)] py-[var(--control-padding-y)]',
            'text-[length:var(--control-font-size)]',
            'rounded-[var(--control-radius)]',
            'border border-current/20',
            'bg-transparent',
        ].join(' '),
        {
            compoundVariants: [],
            defaultVariants: {
                fullWidth: false,
                inputType: 'text',
            },
            variants: {
                fullWidth: INTERACTION_VARIANTS.fullWidth,
                inputType: INTERACTION_VARIANTS.inputType,
            },
        },
    );

const getStateClasses = (
    behavior: BehaviorConfig,
    isHovered: boolean,
    isPressed: boolean,
    isFocused: boolean,
): string =>
    mergeClasses(
        behavior.disabled ? CONTROL_TUNING.stateClasses.disabled : undefined,
        behavior.loading ? CONTROL_TUNING.stateClasses.loading : undefined,
        isFocused && !behavior.disabled ? CONTROL_TUNING.stateClasses.focus : undefined,
        isHovered && !behavior.disabled && !behavior.loading ? CONTROL_TUNING.stateClasses.hover : undefined,
        isPressed && !behavior.disabled ? CONTROL_TUNING.stateClasses.pressed : undefined,
    );

// --- Effect Pipelines & Builders --------------------------------------------

const resolveConfig = (
    dimInput: Partial<DimensionConfig> | undefined,
    behInput: Partial<BehaviorConfig> | undefined,
): Effect.Effect<{ behavior: BehaviorConfig; dimensions: DimensionConfig }, never, never> =>
    pipe(
        Effect.all({
            behavior: pipe(
                decodeBehavior({ ...CONTROL_TUNING.defaults.behavior, ...behInput }),
                Effect.catchAll(() => Effect.succeed(CONTROL_TUNING.defaults.behavior)),
            ),
            dimensions: pipe(
                decodeDimensions({ ...CONTROL_TUNING.defaults.dimensions, ...dimInput }),
                Effect.catchAll(() => Effect.succeed(CONTROL_TUNING.defaults.dimensions)),
            ),
        }),
    );

const createButtonComponent = (factoryInput: ControlFactoryInput<'button'>): ControlComponent<'button'> => {
    const controlVariants = createControlVariants();

    const resolved = Effect.runSync(resolveConfig(factoryInput.dimensions, factoryInput.behavior));
    const dims = Effect.runSync(computeDimensions(resolved.dimensions));
    const staticStyleVars = computeStyleVars(dims);
    const staticBehavior = resolved.behavior;
    const staticBaseClasses = controlVariants({ fullWidth: factoryInput.fullWidth ?? false });

    const Component = forwardRef((props: ButtonProps, forwardedRef: ForwardedRef<HTMLButtonElement>) => {
        const { asChild, children, className, ...ariaProps } = props;
        const useSlot = asChild ?? factoryInput.asChild ?? false;
        const internalRef = useRef<HTMLButtonElement>(null);
        const ref = (forwardedRef ?? internalRef) as RefObject<HTMLButtonElement>;

        const { buttonProps, isPressed } = useButton(
            {
                ...ariaProps,
                isDisabled: staticBehavior.disabled || staticBehavior.loading,
            },
            ref,
        );

        const { hoverProps, isHovered } = useHover({
            isDisabled: staticBehavior.disabled || staticBehavior.loading,
        });

        const { focusProps, isFocusVisible } = useFocusRing();

        const stateClasses = getStateClasses(staticBehavior, isHovered, isPressed, isFocusVisible);
        const finalClassName = mergeClasses(staticBaseClasses, stateClasses, factoryInput.className, className);

        const mergedProps = mergeProps(buttonProps, hoverProps, focusProps, {
            className: finalClassName,
            ref,
            style: staticStyleVars as CSSProperties,
            type: 'button' as const,
        });

        return useSlot ? createElement(Slot, mergedProps, children) : createElement('button', mergedProps, children);
    });

    Component.displayName = 'Control(button)';
    return Component;
};

type InputControlType = 'checkbox' | 'input' | 'radio' | 'switch' | 'textarea';

const createInputComponent = <T extends InputControlType>(
    factoryInput: ControlFactoryInput<T>,
): ControlComponent<'input'> => {
    const inputVariants = createInputVariants();
    const controlType = factoryInput.type as string;
    const htmlInputType = controlType === 'checkbox' ? 'checkbox' : controlType === 'radio' ? 'radio' : 'text';
    const staticBaseClasses = inputVariants({ fullWidth: factoryInput.fullWidth ?? false, inputType: htmlInputType });
    const factoryDimensions = factoryInput.dimensions;
    const factoryBehavior = factoryInput.behavior;

    const Component = forwardRef((props: InputProps, forwardedRef: ForwardedRef<HTMLInputElement>) => {
        const { asChild, behavior: propBehavior, className, dimensions: propDimensions, ...inputProps } = props;
        const useSlot = asChild ?? factoryInput.asChild ?? false;
        const internalRef = useRef<HTMLInputElement>(null);
        const ref = (forwardedRef ?? internalRef) as RefObject<HTMLInputElement>;

        const { behavior, styleVars } = useMemo(() => {
            const resolved = Effect.runSync(
                resolveConfig({ ...factoryDimensions, ...propDimensions }, { ...factoryBehavior, ...propBehavior }),
            );
            const dims = Effect.runSync(computeDimensions(resolved.dimensions));
            return { behavior: resolved.behavior, styleVars: computeStyleVars(dims) };
        }, [propDimensions, propBehavior]);

        const { hoverProps, isHovered } = useHover({
            isDisabled: behavior.disabled || behavior.loading,
        });

        const { focusProps, isFocusVisible } = useFocusRing();

        const stateClasses = getStateClasses(behavior, isHovered, false, isFocusVisible);
        const finalClassName = mergeClasses(staticBaseClasses, stateClasses, factoryInput.className, className);

        const mergedProps = mergeProps(hoverProps, focusProps, inputProps, {
            'aria-busy': behavior.loading ? true : undefined,
            className: finalClassName,
            disabled: behavior.disabled,
            ref,
            style: styleVars as CSSProperties,
            type: htmlInputType,
        });

        return useSlot ? createElement(Slot, mergedProps) : createElement('input', mergedProps);
    });

    Component.displayName = `Control(${factoryInput.type})`;
    return Component;
};

const createControlComponent = <T extends ControlType>(factoryInput: ControlFactoryInput<T>): ControlComponent<T> =>
    (factoryInput.type === 'button'
        ? createButtonComponent(factoryInput as ControlFactoryInput<'button'>)
        : createInputComponent(factoryInput as ControlFactoryInput<'input'>)) as ControlComponent<T>;

const createControls = (tuning?: Partial<ControlTuning>): ControlFactory => {
    const mergedTuning = {
        algorithms: tuning?.algorithms ?? CONTROL_TUNING.algorithms,
        defaults: {
            behavior: { ...CONTROL_TUNING.defaults.behavior, ...tuning?.defaults?.behavior },
            dimensions: { ...CONTROL_TUNING.defaults.dimensions, ...tuning?.defaults?.dimensions },
        },
        stateClasses: { ...CONTROL_TUNING.stateClasses, ...tuning?.stateClasses },
    };

    return Object.freeze({
        Button: createButtonComponent({
            behavior: mergedTuning.defaults.behavior,
            dimensions: mergedTuning.defaults.dimensions,
            type: 'button',
        }),
        create: <T extends ControlType>(input: ControlFactoryInput<T>) =>
            createControlComponent({
                ...input,
                behavior: { ...mergedTuning.defaults.behavior, ...input.behavior },
                dimensions: { ...mergedTuning.defaults.dimensions, ...input.dimensions },
            }),
        Input: createInputComponent({
            behavior: mergedTuning.defaults.behavior,
            dimensions: mergedTuning.defaults.dimensions,
            type: 'input',
        }),
    });
};

// --- Export -----------------------------------------------------------------

export { createControls, CONTROL_TUNING };
