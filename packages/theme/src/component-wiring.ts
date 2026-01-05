/**
 * Generic CSS wiring generation for theme-aware components.
 * Dev defines ComponentSpec; infrastructure generates CSS rules.
 * Maps data-slot/data-color/data-size/data-async-state to CSS variable slots.
 */
import { TW } from '@parametric-portal/types/ui';
import { Effect, Match, type ParseResult, pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type RuleKind = 'async' | 'base' | 'color' | 'size' | 'variant';
type ComponentSpec = S.Schema.Type<typeof ComponentSpecSchema>;
// --- [SCHEMA] ----------------------------------------------------------------

const AsyncStyleKeySchema = S.Union(
    S.Literal('idle'),
    S.Literal('loading'),
    S.Literal('success'),
    S.Literal('failure'),
);
const ColorSlotRefSchema = S.Union(
    ...TW.colorStep.map((n) => S.Literal(String(n))),
    S.Literal('text-on'),
    S.Literal('hovered'),
    S.Literal('pressed'),
    S.Literal('focused'),
    S.Literal('selected'),
    S.Literal('disabled'),
);
const ComponentSpecSchema = S.Struct({
    asyncStyles: S.optional(S.Record({ key: AsyncStyleKeySchema, value: S.Record({ key: S.String, value: S.String }) })),
    base: S.Record({ key: S.String, value: S.String }),
    colorSlots: S.Record({ key: S.String, value: ColorSlotRefSchema }),
    name: S.String.pipe(S.minLength(1)),
    sizes: S.Record({ key: S.String, value: S.Record({ key: S.String, value: S.String }) }),
    variants: S.optional(S.Record({ key: S.String, value: S.Record({ key: S.String, value: S.String }) })),
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const selectorFor: Record<RuleKind, (name: string, qualifier?: string) => string> = {
    async: (n, q) => q === 'loading'
        ? `[data-slot="${n}"]:is([data-async-state="loading"], [data-pending])` : `[data-slot="${n}"][data-async-state="${q}"]`,
    base: (n) => `[data-slot="${n}"]`,
    color: (n, q) => `[data-slot="${n}"][data-color="${q}"]`,
    size: (n, q) => `[data-slot="${n}"][data-size="${q}"]`,
    variant: (n, q) => `[data-slot="${n}"][data-variant="${q}"]`,
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const resolveValue = (kind: RuleKind, value: string, qualifier?: string): string =>
    Match.value({ kind, value }).pipe(
        Match.when({ kind: 'color', value: 'text-on' }, () => `var(--color-text-on-${qualifier})`),
        Match.when({ kind: 'color' }, () => `var(--color-${qualifier}-${value})`),
        Match.orElse(() => value),
    );
const generateRule = (name: string, kind: RuleKind, values: Record<string, string>, qualifier?: string): string =>
    `${selectorFor[kind](name, qualifier)} {\n${Object.entries(values)
        .map(([k, v]) => `  --${name}-${k}: ${resolveValue(kind, v, qualifier)};`)
        .join('\n')}\n}`;
const generateSingleComponentWiring = (spec: ComponentSpec, colorNames: readonly string[]): string =>
    [
        generateRule(spec.name, 'base', spec.base),
        ...colorNames.map((color) => generateRule(spec.name, 'color', spec.colorSlots, color)),
        ...Object.entries(spec.sizes).map(([size, values]) => generateRule(spec.name, 'size', values, size)),
        ...(spec.variants === undefined ? [] : Object.entries(spec.variants).map(([variant, values]) => generateRule(spec.name, 'variant', values, variant))),
        ...(spec.asyncStyles === undefined ? [] : Object.entries(spec.asyncStyles).map(([state, values]) => generateRule(spec.name, 'async', values, state))),
    ].join('\n\n');

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateComponentWiring = (
    specs: readonly unknown[],
    colorNames: readonly string[],
): Effect.Effect<string, ParseResult.ParseError> =>
    pipe(
        Effect.forEach(specs, (raw) => S.decodeUnknown(ComponentSpecSchema)(raw)),
        Effect.map((validated) => validated.map((s) => generateSingleComponentWiring(s, colorNames)).join('\n\n')),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { ComponentSpecSchema, generateComponentWiring };
