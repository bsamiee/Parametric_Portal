/**
 * Construct type-safe CSS units preventing dimensional analysis errors.
 * Compile-time tracking ensures px/rem operations maintain unit consistency.
 */
import type { N } from 'ts-toolbelt';

// --- [TYPES] -----------------------------------------------------------------

declare const __unit: unique symbol

type Label = (typeof DOMAINS)['labels'][number]
type ConvertibleLabel = keyof (typeof DOMAINS)['ratios']
type Dim = { readonly L: number }
type MulDim<A extends Dim, B extends Dim> = { L: N.Add<A['L'], B['L']> }
type DivDim<A extends Dim, B extends Dim> = { L: N.Sub<A['L'], B['L']> }
type Unit<L extends Label> = number & { readonly [__unit]: { dim: Dim; label: L } }
type Compound<L1 extends Label, Op extends '*' | '/', L2 extends Label> = number & {
	readonly [__unit]: {
		dim: Op extends '*' ? MulDim<Dim, Dim> : DivDim<Dim, Dim>
		label: `${L1}${Op}${L2}`
	}
}

// --- [CONSTANTS] -------------------------------------------------------------

/** Define unit conversion ratios assuming 16px base font size. */
const DOMAINS = {
	dim: { L: 1 as const },
	labels: ['px', 'rem', 'em', 'vh', 'vw'] as const,
	ratios: { em: 16, px: 1, rem: 16 } as const,
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Construct pixel unit from raw number. */
const px = (n: number): Unit<'px'> => n as Unit<'px'>;
/** Construct rem unit from raw number. */
const rem = (n: number): Unit<'rem'> => n as Unit<'rem'>;
/** Construct em unit from raw number. */
const em = (n: number): Unit<'em'> => n as Unit<'em'>;
/** Construct viewport height unit from raw number. */
const vh = (n: number): Unit<'vh'> => n as Unit<'vh'>;
/** Construct viewport width unit from raw number. */
const vw = (n: number): Unit<'vw'> => n as Unit<'vw'>;

/** Add same-unit values preserving type safety. */
const add = <L extends Label>(a: Unit<L>, b: Unit<L>): Unit<L> => (a + b) as Unit<L>;
/** Subtract same-unit values preserving type safety. */
const sub = <L extends Label>(a: Unit<L>, b: Unit<L>): Unit<L> => (a - b) as Unit<L>;
/** Multiply unit value by dimensionless scalar. */
const scale = <L extends Label>(v: Unit<L>, k: number): Unit<L> => (v * k) as Unit<L>;
/** Negate unit value preserving type. */
const negate = <L extends Label>(v: Unit<L>): Unit<L> => (-v) as Unit<L>;
/** Compute absolute value preserving unit type. */
const abs = <L extends Label>(v: Unit<L>): Unit<L> => Math.abs(v) as Unit<L>;
/** Constrain unit value within inclusive bounds. */
const clamp = <L extends Label>(v: Unit<L>, lo: Unit<L>, hi: Unit<L>): Unit<L> =>
	Math.max(lo, Math.min(hi, v)) as Unit<L>;
/** Round unit value to specified decimal places. */
const round = <L extends Label>(v: Unit<L>, d = 2): Unit<L> =>
	(Math.round(v * 10 ** d) / 10 ** d) as Unit<L>;

/** Multiply two units creating compound dimensional type. */
const mul = <L1 extends Label, L2 extends Label>(a: Unit<L1>, b: Unit<L2>): Compound<L1, '*', L2> =>
	(a * b) as Compound<L1, '*', L2>;
/** Divide two units creating compound dimensional type. */
const div = <L1 extends Label, L2 extends Label>(a: Unit<L1>, b: Unit<L2>): Compound<L1, '/', L2> =>
	(a / b) as Compound<L1, '/', L2>;

/** Retrieve conversion ratio for unit label. */
const ratioOf = (l: ConvertibleLabel): number => DOMAINS.ratios[l];
/** Convert between compatible CSS units using standard ratios. */
const convert = <From extends ConvertibleLabel, To extends ConvertibleLabel>(
	v: Unit<From>,
	_from: From,
	to: To,
): Unit<To> => ((v * ratioOf(_from)) / ratioOf(to)) as Unit<To>;

/** Extract raw numeric value from typed unit. */
const raw = <L extends Label>(v: Unit<L>): number => v;
/** Serialize unit value to CSS string representation. */
const format = <L extends Label>(v: Unit<L>, l: L): string => `${v}${l}`;

// --- [EXPORT] ----------------------------------------------------------------

export { DOMAINS as UNITS_TUNING };
export { abs, add, clamp, convert, div, em, format, mul, negate, px, raw, rem, round, scale, sub, vh, vw };
export type { Compound, Label, Unit };
