/**
 * Generic CSS wiring generation for theme-aware components.
 * Dev defines ComponentSpec; infrastructure generates CSS rules.
 * Maps data-slot/data-color/data-size/data-async-state to CSS variable slots.
 *
 * Design:
 * - Discriminated union RuleInput for type-safe rule generation
 * - Dispatch table ruleHandlers for polymorphic rule generation
 * - CssIdentifierSchema validates component names at boundary
 * - ThemeErrorType unifies error channel with colors.ts/theme.ts
 */
import type { DeepReadonly } from 'ts-essentials';
import { Array as A, Effect, Option, pipe, Record as R, Schema as S } from 'effect';
import { TW } from '@parametric-portal/types/ui';
import { CssIdentifierSchema, ThemeError, type ThemeErrorType } from './colors.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const ColorSlotRefSchema = S.Union(
	...TW.colorStep.map((n) => S.Literal(String(n))),
	S.Literal('text-on'),
	S.Literal('hovered'),
	S.Literal('pressed'),
	S.Literal('focused'),
	S.Literal('selected'),
	S.Literal('disabled'),
);
const AsyncStyleKeySchema = S.Union(S.Literal('idle'), S.Literal('loading'), S.Literal('success'), S.Literal('failure'));
const FocusRingOverrideSchema = S.Struct({
	color: S.optional(S.String), offset: S.optional(S.String),
	width: S.optional(S.String), z: S.optional(S.String),
});
const TooltipStyleSpecSchema = S.Struct({
	arrow: S.optional(S.Struct({
		color: S.String, height: S.String, path: S.optional(S.String), staticOffset: S.optional(S.String), stroke: S.optional(S.String),
		strokeWidth: S.optional(S.String), tipRadius: S.optional(S.String), width: S.String,
	})),
	base: S.Record({ key: S.String, value: S.String }),
	name: CssIdentifierSchema,
	positioning: S.optional(S.Struct({ arrowPadding: S.optional(S.String), offset: S.optional(S.String), shiftPadding: S.optional(S.String), })),
	transition: S.Struct({ duration: S.String, easing: S.String, initialOpacity: S.String, initialTransform: S.String, }),
});
const ComponentSpecSchema = S.Struct({
	asyncStyles: S.optional(S.Record({ key: AsyncStyleKeySchema, value: S.Record({ key: S.String, value: S.String }) })),
	base: S.Record({ key: S.String, value: S.String }),
	colorInherit: S.optional(S.String),
	colorSlots: S.Record({ key: S.String, value: ColorSlotRefSchema }),
	focusRing: S.optional(FocusRingOverrideSchema),
	longpress: S.optional(S.Record({ key: S.String, value: S.String })),
	name: CssIdentifierSchema,
	sizes: S.Record({ key: S.String, value: S.Record({ key: S.String, value: S.String }) }),
	variants: S.optional(S.Record({ key: S.String, value: S.Record({ key: S.String, value: S.String }) })),
});

// --- [TYPES] -----------------------------------------------------------------

type RuleInput =
	| { readonly kind: 'async'; readonly name: string; readonly state: string; readonly values: Record<string, string> }
	| { readonly kind: 'base'; readonly name: string; readonly values: Record<string, string> }
	| { readonly kind: 'color'; readonly color: string; readonly name: string; readonly values: Record<string, string> }
	| { readonly kind: 'color-inherit'; readonly ancestor: string; readonly color: string; readonly name: string; readonly values: Record<string, string> }
	| { readonly kind: 'focus-ring'; readonly name: string; readonly overrides: FocusRingOverride }
	| { readonly kind: 'longpress'; readonly name: string; readonly values: Record<string, string> }
	| { readonly kind: 'size'; readonly name: string; readonly size: string; readonly values: Record<string, string> }
	| { readonly kind: 'variant'; readonly name: string; readonly values: Record<string, string>; readonly variant: string };
type RuleContext<K extends RuleInput['kind']> = Extract<RuleInput, { kind: K }>;
type RuleResult = { readonly selector: string; readonly entries: readonly (readonly [string, string])[] } | undefined;
type FocusRingOverride = S.Schema.Type<typeof FocusRingOverrideSchema>;
type ComponentSpec = S.Schema.Type<typeof ComponentSpecSchema>;
type TooltipStyleSpec = S.Schema.Type<typeof TooltipStyleSpecSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	focusRingKeys: ['width', 'color', 'offset', 'z'] as const,
}) satisfies DeepReadonly<{ focusRingKeys: readonly string[] }>;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const slotSelector = (n: string): string => `:is([data-slot="${n}"], [data-theme="${n}"])`;
const selectorFor = Object.freeze({
	async: (n: string, state: string) =>
		state === 'loading'
			? `${slotSelector(n)}:is([data-async-state="loading"], [data-pending])`
			: `${slotSelector(n)}[data-async-state="${state}"]`,
	base: (n: string) => slotSelector(n),
	color: (n: string, color: string) => `${slotSelector(n)}[data-color="${color}"]`,
	'color-inherit': (n: string, color: string, ancestor: string) => `${slotSelector(ancestor)}[data-color="${color}"] ${slotSelector(n)}:not([data-color])`,
	'focus-ring': (n: string) => slotSelector(n),
	longpress: (n: string) => `${slotSelector(n)}[data-longpress-progress]::before`,
	size: (n: string, size: string) => `${slotSelector(n)}[data-size="${size}"]`,
	variant: (n: string, variant: string) => `${slotSelector(n)}[data-variant="${variant}"]`,
});
const resolveColorValue = (value: string, color: string): string => value.startsWith('var(') ? value : value === 'text-on' ? `var(--color-text-on-${color})` : `var(--color-${color}-${value})`;
const ruleHandlers: { readonly [K in RuleInput['kind']]: (input: RuleContext<K>) => RuleResult } = Object.freeze({
	async: (i) => ({ entries: R.toEntries(i.values), selector: selectorFor.async(i.name, i.state) }),
	base: (i) => ({ entries: R.toEntries(i.values), selector: selectorFor.base(i.name) }),
	color: (i) => ({ entries: A.map(R.toEntries(i.values), ([k, v]) => [k, resolveColorValue(v, i.color)] as const), selector: selectorFor.color(i.name, i.color) }),
	'color-inherit': (i) => ({ entries: A.map(R.toEntries(i.values), ([k, v]) => [k, resolveColorValue(v, i.color)] as const), selector: selectorFor['color-inherit'](i.name, i.color, i.ancestor) }),
	'focus-ring': (i) => {
		const entries = A.filterMap(B.focusRingKeys, (key) => pipe(Option.fromNullable(i.overrides[key]), Option.map((v) => [`focus-ring-${key}`, v] as const)));
		return A.isNonEmptyArray(entries) ? { entries, selector: selectorFor['focus-ring'](i.name) } : undefined;
	},
	longpress: (i) => ({ entries: R.toEntries(i.values), selector: selectorFor.longpress(i.name) }),
	size: (i) => ({ entries: R.toEntries(i.values), selector: selectorFor.size(i.name, i.size) }),
	variant: (i) => ({ entries: R.toEntries(i.values), selector: selectorFor.variant(i.name, i.variant) }),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const optionalArray = <T, U>(value: T | undefined, transform: (v: T) => readonly U[]): readonly U[] => pipe(Option.fromNullable(value), Option.map(transform), Option.getOrElse(() => [] as U[]));
const optionalMappedVars = <T extends Record<string, unknown>>(
	value: T | undefined,
	prefix: string,
	mappings: ReadonlyArray<readonly [key: string, selector: (v: T) => unknown]>,
): readonly string[] =>
	pipe(
		Option.fromNullable(value),
		Option.map((obj) => A.filterMap(mappings, ([key, select]) => pipe(Option.fromNullable(select(obj)), Option.map((v) => `  --${prefix}-${key}: ${v};`)))),
		Option.getOrElse(() => [] as string[]),
	);
const formatDeclaration = (name: string, key: string, value: string): string => `  --${name}-${key}: ${value};`;
const generateRule = (input: RuleInput): string | undefined => {
	const result = ruleHandlers[input.kind](input as never);
	return result === undefined
		? undefined
		: pipe(
				result.entries,
				A.map(([k, v]) => input.kind === 'focus-ring' ? `  --${k}: ${v};` : formatDeclaration(input.name, k, v)),
				A.join('\n'),
				(body) => `${result.selector} {\n${body}\n}`,
			);
};
const generateSingleComponentWiring = (spec: ComponentSpec, colorNames: readonly string[]): string =>
	pipe(
		[
			[{ kind: 'base' as const, name: spec.name, values: spec.base }],
			A.map(colorNames, (color) => ({ color, kind: 'color' as const, name: spec.name, values: spec.colorSlots })),
			optionalArray(spec.colorInherit, (ancestor) => A.map(colorNames, (color) => ({ ancestor, color, kind: 'color-inherit' as const, name: spec.name, values: spec.colorSlots }))),
			A.map(R.toEntries(spec.sizes), ([size, values]) => ({ kind: 'size' as const, name: spec.name, size, values })),
			optionalArray(spec.variants, (variants) => A.map(R.toEntries(variants), ([variant, values]) => ({ kind: 'variant' as const, name: spec.name, values, variant }))),
			optionalArray(spec.asyncStyles, (asyncStyles) => A.map(R.toEntries(asyncStyles), ([state, values]) => ({ kind: 'async' as const, name: spec.name, state, values }))),
			optionalArray(spec.longpress, (values) => [{ kind: 'longpress' as const, name: spec.name, values }]),
			optionalArray(spec.focusRing, (overrides) => [{ kind: 'focus-ring' as const, name: spec.name, overrides }]),
		],
		A.flatten,
		A.filterMap((input) => Option.fromNullable(generateRule(input))),
		A.join('\n\n'),
	);
const generateSingleTooltipWiring = (spec: TooltipStyleSpec): string => {
	const selector = `[data-slot="tooltip"][data-style="${spec.name}"]`;
	const baseVars = A.map(R.toEntries(spec.base), ([k, v]) => `  --tooltip-${k}: ${v};`);
	const arrowVars = optionalMappedVars(spec.arrow, 'tooltip', [
		['arrow-color', (a) => a.color],
		['arrow-height', (a) => a.height],
		['arrow-width', (a) => a.width],
		['arrow-path', (a) => a.path],
		['arrow-stroke', (a) => a.stroke],
		['arrow-stroke-width', (a) => a.strokeWidth],
		['arrow-tip-radius', (a) => a.tipRadius],
	]);
	const positionVars = optionalMappedVars(spec.positioning, 'tooltip', [
		['offset', (p) => p.offset],
		['arrow-padding', (p) => p.arrowPadding],
		['shift-padding', (p) => p.shiftPadding],
	]);
	const transitionVars = [
		`  --tooltip-transition-duration: ${spec.transition.duration};`,
		`  --tooltip-transition-easing: ${spec.transition.easing};`,
	];
	const allVars = A.join([...baseVars, ...arrowVars, ...positionVars, ...transitionVars], '\n');
	return A.join(
		[
			`${selector} {\n${allVars}\n}`,
			`${selector}[data-status="initial"],\n${selector}[data-status="close"] {\n  opacity: ${spec.transition.initialOpacity};\n  transform: ${spec.transition.initialTransform};\n}`,
			`${selector}[data-status="open"] {\n  opacity: 1;\n  transform: none;\n}`,
		],
		'\n\n',
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateComponentWiring = (
	specs: readonly unknown[],
	colorNames: readonly string[],
): Effect.Effect<string, ThemeErrorType> =>
	pipe(
		Effect.forEach(specs, (raw, idx) =>
			pipe(
				S.decodeUnknown(ComponentSpecSchema)(raw),
				Effect.mapError((e) =>
					ThemeError.Validation({
						cause: e,
						field: `components[${idx}]`,
						message: `Invalid component spec at index ${idx}`,
						received: raw,
					}),
				),
			),
		),
		Effect.map((validated) => pipe(validated, A.map((s) => generateSingleComponentWiring(s, colorNames)), A.join('\n\n'))),
	);
const generateTooltipWiring = (specs: readonly unknown[]): Effect.Effect<string, ThemeErrorType> =>
	pipe(
		Effect.forEach(specs, (raw, idx) =>
			pipe(
				S.decodeUnknown(TooltipStyleSpecSchema)(raw),
				Effect.mapError((e) =>
					ThemeError.Validation({
						cause: e,
						field: `tooltipStyles[${idx}]`,
						message: `Invalid tooltip style spec at index ${idx}`,
						received: raw,
					}),
				),
			),
		),
		Effect.map((validated) => pipe(validated, A.map(generateSingleTooltipWiring), A.join('\n\n'))),
	);

// --- [EXPORT] ----------------------------------------------------------------

export { ComponentSpecSchema, generateComponentWiring, generateTooltipWiring, TooltipStyleSpecSchema };
export type { ComponentSpec, TooltipStyleSpec };
