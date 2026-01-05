/**
 * Export branded primitives with schema validation and generation.
 * Unifies type/value exports via Effect Schema for domain safety.
 */
import { DateTime, Effect, pipe, Schema as S } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Return fallback when schema decode fails on partial objects. */
const schemaDefaults = <T>(schema: S.Schema<T, unknown, never>, fallback: T): T =>
	Effect.runSync(Effect.try({ catch: () => fallback, try: () => S.decodeUnknownSync(schema)({}) }));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	bounds: {
		index: { max: Number.MAX_SAFE_INTEGER, min: 0 },
		percentage: { max: 100, min: 0 },
		safeInteger: { max: Number.MAX_SAFE_INTEGER, min: Number.MIN_SAFE_INTEGER },
		variantCount: { max: 100, min: 1 },
		zoomFactor: { max: 10, min: 0.1 },
	},
	hex: { length8: 8, length64: 64, radix: 16 },
	patterns: {
		email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
		hex8: /^[0-9a-f]{8}$/,
		hex64: /^[0-9a-f]{64}$/i,
		hexColor: /^#[0-9a-f]{6}$/i,
		htmlId: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
		isoDate: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
		slug: /^[a-z0-9-]+$/,
		url: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
		uuidv7: /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
	},
} as const);

// --- [SCHEMA_BUILDERS] -------------------------------------------------------

const sb = {
	boundedInt: <T extends string>(label: T, min: number, max: number) =>
		pipe(S.Number, S.int(), S.between(min, max), S.brand(label)),
	boundedNumber: <T extends string>(label: T, min: number, max: number) =>
		pipe(S.Number, S.between(min, max), S.brand(label)),
	nonNegativeInt: <T extends string>(label: T) =>
		pipe(S.Number, S.int(), S.nonNegative(), S.brand(label)),
	nonNegativeNumber: <T extends string>(label: T) =>
		pipe(S.Number, S.nonNegative(), S.brand(label)),
	pattern: <T extends string>(label: T, regex: RegExp) =>
		pipe(S.String, S.pattern(regex), S.brand(label)),
	positiveInt: <T extends string>(label: T) =>
		pipe(S.Number, S.int(), S.positive(), S.brand(label)),
	positiveNumber: <T extends string>(label: T) =>
		pipe(S.Number, S.positive(), S.brand(label)),
} as const;
/** Create branded type with standard schema operations. */
const make = <A, I>(schema: S.Schema<A, I, never>) =>
	Object.freeze({
		decode: S.decodeUnknown(schema),
		decodeEither: S.decodeUnknownEither(schema),
		decodeSync: S.decodeUnknownSync(schema),
		encode: S.encode(schema),
		encodeSync: S.encodeSync(schema),
		is: S.is(schema),
		schema,
	});
/** Extend branded type with synchronous generation capability. */
const makeGeneratable = <A, I>(schema: S.Schema<A, I, never>, generateSync: () => A) =>
	Object.freeze({ ...make(schema), generate: Effect.sync(generateSync), generateSync });

// --- [DURATION_MS] -----------------------------------------------------------

const DurationMsSchema = sb.nonNegativeNumber('DurationMs');
type DurationMs = S.Schema.Type<typeof DurationMsSchema>
const DurationMs = Object.freeze({
	...make(DurationMsSchema),
	add: (a: DurationMs, b: DurationMs): DurationMs => (a + b) as DurationMs,
	clamp: (d: DurationMs, min: DurationMs, max: DurationMs): DurationMs =>
		Math.max(min, Math.min(max, d)) as DurationMs,
	fromMillis: (ms: number): DurationMs => ms as DurationMs,
	fromSeconds: (s: number): DurationMs => (s * 1000) as DurationMs,
	max: (a: DurationMs, b: DurationMs): DurationMs => Math.max(a, b) as DurationMs,
	scale: (d: DurationMs, k: number): DurationMs => (d * k) as DurationMs,
	sub: (a: DurationMs, b: DurationMs): DurationMs => (a - b) as DurationMs,
	toSeconds: (d: DurationMs): number => d / 1000,
	zero: 0 as DurationMs,
});

// --- [EMAIL] -----------------------------------------------------------------

const EmailSchema = sb.pattern('Email', B.patterns.email);
type Email = S.Schema.Type<typeof EmailSchema>
const Email = Object.freeze(make(EmailSchema));

// --- [HEX8] ------------------------------------------------------------------

const Hex8Schema = sb.pattern('Hex8', B.patterns.hex8);
type Hex8 = S.Schema.Type<typeof Hex8Schema>
/** Generate random 8-character hex string. */
const hex8GenerateSync = (): Hex8 =>
	Array.from({ length: B.hex.length8 }, () =>
		Math.trunc(Math.random() * B.hex.radix).toString(B.hex.radix),
	).join('') as Hex8;
/** Derive deterministic 8-character hex from seed string. */
const hex8Derive = (seed: string): Hex8 => {
	const mod = B.hex.radix ** B.hex.length8;
	const hash = Array.from(seed).reduce<number>((a, c) => (a * 31 + (c.codePointAt(0) ?? 0)) % mod, 0);
	return hash.toString(B.hex.radix).padStart(B.hex.length8, '0').slice(-B.hex.length8) as Hex8;
};
const Hex8 = Object.freeze({ ...makeGeneratable(Hex8Schema, hex8GenerateSync), derive: hex8Derive });

// --- [HEX64] -----------------------------------------------------------------

const Hex64Schema = sb.pattern('Hex64', B.patterns.hex64);
type Hex64 = S.Schema.Type<typeof Hex64Schema>
const Hex64 = Object.freeze({
	...make(Hex64Schema),
	fromBase64: (base64: string): Uint8Array =>
		Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0),
	fromBytes: (bytes: Uint8Array): Hex64 =>
		S.decodeSync(Hex64Schema)([...bytes].map((b) => b.toString(B.hex.radix).padStart(2, '0')).join('')),
});

// --- [HEX_COLOR] -------------------------------------------------------------

const HexColorSchema = sb.pattern('HexColor', B.patterns.hexColor);
type HexColor = S.Schema.Type<typeof HexColorSchema>
const HexColor = Object.freeze(make(HexColorSchema));

// --- [HTML_ID] ---------------------------------------------------------------

const HtmlIdSchema = sb.pattern('HtmlId', B.patterns.htmlId);
type HtmlId = S.Schema.Type<typeof HtmlIdSchema>
const HtmlId = Object.freeze(make(HtmlIdSchema));

// --- [INDEX] -----------------------------------------------------------------

const IndexSchema = sb.boundedInt('Index', B.bounds.index.min, B.bounds.index.max);
type Index = S.Schema.Type<typeof IndexSchema>
const Index = Object.freeze(make(IndexSchema));

// --- [ISO_DATE] --------------------------------------------------------------

const IsoDateSchema = sb.pattern('IsoDate', B.patterns.isoDate);
type IsoDate = S.Schema.Type<typeof IsoDateSchema>
const IsoDate = Object.freeze(make(IsoDateSchema));

// --- [NON_NEGATIVE_INT] ------------------------------------------------------

const NonNegativeIntSchema = sb.nonNegativeInt('NonNegativeInt');
type NonNegativeInt = S.Schema.Type<typeof NonNegativeIntSchema>
const NonNegativeInt = Object.freeze(make(NonNegativeIntSchema));

// --- [PERCENTAGE] ------------------------------------------------------------

const PercentageSchema = sb.boundedNumber('Percentage', B.bounds.percentage.min, B.bounds.percentage.max);
type Percentage = S.Schema.Type<typeof PercentageSchema>
const Percentage = Object.freeze(make(PercentageSchema));

// --- [POSITIVE_INT] ----------------------------------------------------------

const PositiveIntSchema = sb.positiveInt('PositiveInt');
type PositiveInt = S.Schema.Type<typeof PositiveIntSchema>
const PositiveInt = Object.freeze(make(PositiveIntSchema));

// --- [SAFE_INTEGER] ----------------------------------------------------------

const SafeIntegerSchema = sb.boundedInt('SafeInteger', B.bounds.safeInteger.min, B.bounds.safeInteger.max);
type SafeInteger = S.Schema.Type<typeof SafeIntegerSchema>
const SafeInteger = Object.freeze(make(SafeIntegerSchema));

// --- [SLUG] ------------------------------------------------------------------

const SlugSchema = sb.pattern('Slug', B.patterns.slug);
type Slug = S.Schema.Type<typeof SlugSchema>
const Slug = Object.freeze(make(SlugSchema));

// --- [TIMESTAMP] -------------------------------------------------------------

const TimestampSchema = sb.positiveNumber('Timestamp');
type Timestamp = S.Schema.Type<typeof TimestampSchema>
const timestampNowSync = (): Timestamp => Date.now() as Timestamp;
const Timestamp = Object.freeze({
	...makeGeneratable(TimestampSchema, timestampNowSync),
	addDuration: (ts: Timestamp, d: DurationMs): Timestamp => (ts + d) as Timestamp,
	diff: (later: Timestamp, earlier: Timestamp): DurationMs => (later - earlier) as DurationMs,
	expiresAt: (durationMs: DurationMs): Timestamp => (timestampNowSync() + durationMs) as Timestamp,
	expiresAtDate: (durationMs: DurationMs): Date => new Date(timestampNowSync() + durationMs),
	fromDate: S.transform(S.DateFromSelf, TimestampSchema, {
		decode: (date) => date.getTime() as Timestamp,
		encode: (ts) => new Date(ts),
		strict: true,
	}),
	fromDateTime: (dt: DateTime.Utc): Timestamp => DateTime.toEpochMillis(dt) as Timestamp,
	now: Effect.sync(timestampNowSync),
	nowSync: timestampNowSync,
});

// --- [URL] -------------------------------------------------------------------

const UrlSchema = sb.pattern('Url', B.patterns.url);
type Url = S.Schema.Type<typeof UrlSchema>
const Url = Object.freeze(make(UrlSchema));

// --- [UUIDV7] ----------------------------------------------------------------

const Uuidv7Schema = sb.pattern('Uuidv7', B.patterns.uuidv7);
type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>
/** Generate token-safe UUID via crypto.randomUUID(). DB IDs use PostgreSQL uuidv7(). */
const uuidv7GenerateSync = (): Uuidv7 => crypto.randomUUID() as Uuidv7;
const Uuidv7 = Object.freeze(makeGeneratable(Uuidv7Schema, uuidv7GenerateSync));

// --- [VARIANT_COUNT] ---------------------------------------------------------

const VariantCountSchema = sb.boundedInt('VariantCount', B.bounds.variantCount.min, B.bounds.variantCount.max);
type VariantCount = S.Schema.Type<typeof VariantCountSchema>
const VariantCount = Object.freeze(make(VariantCountSchema));

// --- [ZOOM_FACTOR] -----------------------------------------------------------

const ZoomFactorSchema = sb.boundedNumber('ZoomFactor', B.bounds.zoomFactor.min, B.bounds.zoomFactor.max);
type ZoomFactor = S.Schema.Type<typeof ZoomFactorSchema>
const ZoomFactor = Object.freeze({
	...make(ZoomFactorSchema),
	clamp: (z: ZoomFactor, min: ZoomFactor, max: ZoomFactor): ZoomFactor =>
		Math.max(min, Math.min(max, z)) as ZoomFactor,
	max: B.bounds.zoomFactor.max as ZoomFactor,
	min: B.bounds.zoomFactor.min as ZoomFactor,
	one: 1 as ZoomFactor,
	scale: (z: ZoomFactor, factor: number): ZoomFactor =>
		S.decodeSync(ZoomFactorSchema)(z * factor),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as TYPES_TUNING, schemaDefaults };
export {
	DurationMs,
	Email,
	Hex64,
	Hex8,
	HexColor,
	HtmlId,
	Index,
	IsoDate,
	NonNegativeInt,
	Percentage,
	PositiveInt,
	SafeInteger,
	Slug,
	Timestamp,
	Url,
	Uuidv7,
	VariantCount,
	ZoomFactor,
};
