/**
 * Export branded primitives with schema validation and generation.
 * Unifies type/value exports via Effect Schema for domain safety.
 *
 * Pattern: Brand.X() returns frozen companion object, typeof X.Type extracts type.
 */
import { DateTime, Effect, pipe, Schema as S } from 'effect';

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

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const companion = <A, I>(schema: S.Schema<A, I, never>) =>
	Object.freeze({
		decode: S.decodeUnknown(schema),
		decodeEither: S.decodeUnknownEither(schema),
		decodeSync: S.decodeUnknownSync(schema),
		encode: S.encode(schema),
		encodeSync: S.encodeSync(schema),
		is: S.is(schema),
		schema,
		Type: undefined as unknown as A,
	});
const Brand = Object.freeze({
	boundedInt: <T extends string>(label: T, min: number, max: number) => companion(pipe(S.Number, S.int(), S.between(min, max), S.brand(label))),
	boundedNumber: <T extends string>(label: T, min: number, max: number) => companion(pipe(S.Number, S.between(min, max), S.brand(label))),
	nonNegativeInt: <T extends string>(label: T) => companion(pipe(S.Number, S.int(), S.nonNegative(), S.brand(label))),
	nonNegativeNumber: <T extends string>(label: T) => companion(pipe(S.Number, S.nonNegative(), S.brand(label))),
	pattern: <T extends string>(label: T, regex: RegExp) => companion(pipe(S.String, S.pattern(regex), S.brand(label))),
	positiveInt: <T extends string>(label: T) => companion(pipe(S.Number, S.int(), S.positive(), S.brand(label))),
	positiveNumber: <T extends string>(label: T) => companion(pipe(S.Number, S.positive(), S.brand(label))),
});
const withGen = <A, I, Gen extends () => A>(base: ReturnType<typeof companion<A, I>>, generateSync: Gen) => Object.freeze({ ...base, generate: Effect.sync(generateSync), generateSync });

// --- [DURATION_MS] -----------------------------------------------------------

const _DurationMs = Brand.nonNegativeNumber('DurationMs');
type DurationMs = typeof _DurationMs.Type;
const DurationMs = Object.freeze({
	..._DurationMs,
	add: (a: DurationMs, b: DurationMs): DurationMs => (a + b) as DurationMs,
	clamp: (d: DurationMs, min: DurationMs, max: DurationMs): DurationMs => Math.max(min, Math.min(max, d)) as DurationMs,
	fromMillis: (ms: number): DurationMs => ms as DurationMs,
	fromSeconds: (s: number): DurationMs => (s * 1000) as DurationMs,
	max: (a: DurationMs, b: DurationMs): DurationMs => Math.max(a, b) as DurationMs,
	scale: (d: DurationMs, k: number): DurationMs => (d * k) as DurationMs,
	sub: (a: DurationMs, b: DurationMs): DurationMs => (a - b) as DurationMs,
	toSeconds: (d: DurationMs): number => d / 1000,
	zero: 0 as DurationMs,
});

// --- [EMAIL] -----------------------------------------------------------------

const Email = Brand.pattern('Email', B.patterns.email);
type Email = typeof Email.Type;

// --- [HEX8] ------------------------------------------------------------------

const _Hex8 = Brand.pattern('Hex8', B.patterns.hex8);
type Hex8 = typeof _Hex8.Type;
const hex8GenerateSync = (): Hex8 => [...crypto.getRandomValues(new Uint8Array(B.hex.length8 / 2))].map((b) => b.toString(B.hex.radix).padStart(2, '0')).join('') as Hex8;
const hex8Derive = (seed: string): Hex8 => {
	const mod = B.hex.radix ** B.hex.length8;
	const hash = Array.from(seed).reduce<number>((a, c) => (a * 31 + (c.codePointAt(0) ?? 0)) % mod, 0);
	return hash.toString(B.hex.radix).padStart(B.hex.length8, '0').slice(-B.hex.length8) as Hex8;
};
const Hex8 = Object.freeze({ ...withGen(_Hex8, hex8GenerateSync), derive: hex8Derive });

// --- [HEX64] -----------------------------------------------------------------

const _Hex64 = Brand.pattern('Hex64', B.patterns.hex64);
type Hex64 = typeof _Hex64.Type;
const Hex64 = Object.freeze({
	..._Hex64,
	fromBase64: (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0),
	fromBytes: (bytes: Uint8Array): Hex64 => [...bytes].map((b) => b.toString(B.hex.radix).padStart(2, '0')).join('') as Hex64,
});

// --- [HEX_COLOR] -------------------------------------------------------------

const HexColor = Brand.pattern('HexColor', B.patterns.hexColor);
type HexColor = typeof HexColor.Type;

// --- [HTML_ID] ---------------------------------------------------------------

const HtmlId = Brand.pattern('HtmlId', B.patterns.htmlId);
type HtmlId = typeof HtmlId.Type;

// --- [INDEX] -----------------------------------------------------------------

const Index = Brand.boundedInt('Index', B.bounds.index.min, B.bounds.index.max);
type Index = typeof Index.Type;

// --- [ISO_DATE] --------------------------------------------------------------

const IsoDate = Brand.pattern('IsoDate', B.patterns.isoDate);
type IsoDate = typeof IsoDate.Type;

// --- [NON_NEGATIVE_INT] ------------------------------------------------------

const NonNegativeInt = Brand.nonNegativeInt('NonNegativeInt');
type NonNegativeInt = typeof NonNegativeInt.Type;

// --- [PERCENTAGE] ------------------------------------------------------------

const Percentage = Brand.boundedNumber('Percentage', B.bounds.percentage.min, B.bounds.percentage.max);
type Percentage = typeof Percentage.Type;

// --- [POSITIVE_INT] ----------------------------------------------------------

const PositiveInt = Brand.positiveInt('PositiveInt');
type PositiveInt = typeof PositiveInt.Type;

// --- [SAFE_INTEGER] ----------------------------------------------------------

const SafeInteger = Brand.boundedInt('SafeInteger', B.bounds.safeInteger.min, B.bounds.safeInteger.max);
type SafeInteger = typeof SafeInteger.Type;

// --- [SLUG] ------------------------------------------------------------------

const Slug = Brand.pattern('Slug', B.patterns.slug);
type Slug = typeof Slug.Type;

// --- [TIMESTAMP] -------------------------------------------------------------

const _Timestamp = Brand.positiveNumber('Timestamp');
type Timestamp = typeof _Timestamp.Type;
const timestampNowSync = (): Timestamp => Date.now() as Timestamp;
const Timestamp = Object.freeze({
	...withGen(_Timestamp, timestampNowSync),
	addDuration: (ts: Timestamp, d: DurationMs): Timestamp => (ts + d) as Timestamp,
	diff: (later: Timestamp, earlier: Timestamp): DurationMs => (later - earlier) as DurationMs,
	expiresAt: (durationMs: DurationMs): Timestamp => (timestampNowSync() + durationMs) as Timestamp,
	expiresAtDate: (durationMs: DurationMs): Date => new Date(timestampNowSync() + durationMs),
	fromDate: S.transform(S.DateFromSelf, _Timestamp.schema, {
		decode: (date) => date.getTime() as Timestamp,
		encode: (ts) => new Date(ts),
		strict: true,
	}),
	fromDateTime: (dt: DateTime.Utc): Timestamp => DateTime.toEpochMillis(dt) as Timestamp,
	nowSync: timestampNowSync,
});

// --- [URL] -------------------------------------------------------------------

const Url = Brand.pattern('Url', B.patterns.url);
type Url = typeof Url.Type;

// --- [UUIDV7] ----------------------------------------------------------------

const _Uuidv7 = Brand.pattern('Uuidv7', B.patterns.uuidv7);
type Uuidv7 = typeof _Uuidv7.Type;
const uuidv7GenerateSync = (): Uuidv7 => crypto.randomUUID() as Uuidv7;
const Uuidv7 = withGen(_Uuidv7, uuidv7GenerateSync);

// --- [VARIANT_COUNT] ---------------------------------------------------------

const VariantCount = Brand.boundedInt('VariantCount', B.bounds.variantCount.min, B.bounds.variantCount.max);
type VariantCount = typeof VariantCount.Type;

// --- [ZOOM_FACTOR] -----------------------------------------------------------

const _ZoomFactor = Brand.boundedNumber('ZoomFactor', B.bounds.zoomFactor.min, B.bounds.zoomFactor.max);
type ZoomFactor = typeof _ZoomFactor.Type;
const ZoomFactor = Object.freeze({
	..._ZoomFactor,
	clamp: (z: ZoomFactor, min: ZoomFactor, max: ZoomFactor): ZoomFactor => Math.max(min, Math.min(max, z)) as ZoomFactor,
	max: B.bounds.zoomFactor.max as ZoomFactor,
	min: B.bounds.zoomFactor.min as ZoomFactor,
	one: 1 as ZoomFactor,
	scale: (z: ZoomFactor, factor: number): ZoomFactor => _ZoomFactor.decodeSync(z * factor),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Brand, companion };
export {
	DurationMs, Email, Hex64, Hex8, HexColor, HtmlId, Index, IsoDate, NonNegativeInt, Percentage,
	PositiveInt, SafeInteger, Slug, Timestamp, Url, Uuidv7, VariantCount, ZoomFactor,
};
