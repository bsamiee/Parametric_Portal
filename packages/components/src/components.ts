import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { Effect, Option, pipe } from 'effect';
import { twMerge } from 'tailwind-merge';

// --- Type Definitions -------------------------------------------------------

type ComponentInput = S.Schema.Type<typeof ComponentInputSchema>;
type ComponentSpec = {
    readonly className: string;
    readonly name: string;
    readonly scale: number;
    readonly style: Readonly<Record<string, string>>;
};

// --- Schema Definitions -----------------------------------------------------

const ScaleValue = pipe(S.Number, S.int(), S.between(1, 20), S.brand('ScaleValue'));
const SpacingScale = pipe(S.Number, S.int(), S.between(0, 16), S.brand('SpacingScale'));

const TypographyConfigSchema = S.Struct({
    family: S.Literal('display', 'body', 'mono'),
    weight: S.Literal('thin', 'light', 'regular', 'medium', 'semibold', 'bold'),
});

const ComponentInputSchema = S.Struct({
    disabled: S.optional(S.Boolean),
    interactive: S.optional(S.Boolean),
    name: pipe(S.String, S.pattern(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)),
    rounding: S.optional(SpacingScale),
    sizing: S.Struct({
        paddingX: SpacingScale,
        paddingY: SpacingScale,
        scale: ScaleValue,
    }),
    typography: S.optional(TypographyConfigSchema),
});

// --- Constants (Unified Factory → Frozen) -----------------------------------

const COMPONENT_CONFIG = Object.freeze({
    baseClasses: [
        'inline-flex',
        'items-center',
        'justify-center',
        'transition-colors',
        'focus-visible:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-offset-2',
    ] as const,
    disabledClasses: ['pointer-events-none', 'opacity-50'] as const,
    interactiveClasses: ['cursor-pointer', 'select-none'] as const,
} as const);

const MULTIPLIERS = Object.freeze({
    padding: 0.25,
    rounding: 0.125,
    sizing: 0.5,
} as const);

const COMPONENT_VARIANTS = cva(
    [
        '[min-height:var(--component-min-height)]',
        '[padding-inline:var(--component-padding-x)]',
        '[padding-block:var(--component-padding-y)]',
        '[border-radius:var(--component-radius,0)]',
    ],
    {
        defaultVariants: {},
        variants: {},
    },
);

// --- Pure Utility Functions -------------------------------------------------

const calculatePadding = (scale: number): string =>
    scale === 0 ? '0' : `calc(var(--spacing-${scale}, ${scale * MULTIPLIERS.padding}rem))`;

const calculateRounding = (scale: number): string =>
    scale === 0 ? '0' : `calc(var(--radius-${scale}, ${scale * MULTIPLIERS.rounding}rem))`;

const calculateSizing = (scale: number): string => `calc(var(--size-${scale}, ${scale * MULTIPLIERS.sizing}rem))`;

const mapFontWeight = (weight: S.Schema.Type<typeof TypographyConfigSchema>['weight']): string =>
    ({
        bold: 'var(--font-weight-bold, 700)',
        light: 'var(--font-weight-light, 300)',
        medium: 'var(--font-weight-medium, 500)',
        regular: 'var(--font-weight-regular, 400)',
        semibold: 'var(--font-weight-semibold, 600)',
        thin: 'var(--font-weight-thin, 100)',
    })[weight];

const mapFontFamily = (family: S.Schema.Type<typeof TypographyConfigSchema>['family']): string =>
    ({
        body: 'var(--font-body)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
    })[family];

// --- Effect Pipelines & Builders --------------------------------------------

const buildClassList = (input: ComponentInput): Effect.Effect<ReadonlyArray<string>, never, never> =>
    pipe(
        Effect.succeed([...COMPONENT_CONFIG.baseClasses]),
        Effect.map((base) => (input.interactive === true ? [...base, ...COMPONENT_CONFIG.interactiveClasses] : base)),
        Effect.map((classes) =>
            input.disabled === true ? [...classes, ...COMPONENT_CONFIG.disabledClasses] : classes,
        ),
    );

const buildStyles = (input: ComponentInput): Effect.Effect<Readonly<Record<string, string>>, never, never> =>
    pipe(
        Effect.succeed({
            '--component-min-height': calculateSizing(input.sizing.scale),
            '--component-padding-x': calculatePadding(input.sizing.paddingX),
            '--component-padding-y': calculatePadding(input.sizing.paddingY),
        }),
        Effect.map((styles) =>
            pipe(
                Option.fromNullable(input.rounding),
                Option.match({
                    onNone: () => styles,
                    onSome: (r) => ({ ...styles, '--component-radius': calculateRounding(r) }),
                }),
            ),
        ),
        Effect.map((styles) =>
            pipe(
                Option.fromNullable(input.typography),
                Option.match({
                    onNone: () => styles,
                    onSome: (t) => ({
                        ...styles,
                        '--component-font-family': mapFontFamily(t.family),
                        '--component-font-weight': mapFontWeight(t.weight),
                    }),
                }),
            ),
        ),
    );

const defineComponent = (input: ComponentInput): Effect.Effect<ComponentSpec, ParseError> =>
    pipe(
        S.decode(ComponentInputSchema)(input),
        Effect.flatMap((validated) =>
            pipe(
                Effect.all({
                    classList: buildClassList(validated),
                    style: buildStyles(validated),
                }),
                Effect.map(
                    ({ classList, style }) =>
                        Object.freeze({
                            className: twMerge(clsx([...classList, COMPONENT_VARIANTS()])),
                            name: validated.name,
                            scale: validated.sizing.scale,
                            style: Object.freeze(style),
                        }) satisfies ComponentSpec,
                ),
            ),
        ),
    );

// --- Export -----------------------------------------------------------------

export { defineComponent, COMPONENT_CONFIG };
export type { ComponentInput };
