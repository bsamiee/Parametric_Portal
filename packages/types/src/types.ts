/**
 * Define branded primitives with Effect Schema validation.
 * Simple types export schema + type; companions add domain operations.
 */
import { DateTime, Effect, Either, Encoding, Schema as S } from 'effect';
import { v7 as uuidv7 } from 'uuid';

// --- [SCHEMA] ----------------------------------------------------------------

const Email = S.String.pipe(
    S.pattern(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/),
    S.brand('Email'),
);
type Email = typeof Email.Type;

const HexColor = S.String.pipe(S.pattern(/^#[0-9a-f]{6}$/i), S.brand('HexColor'));
type HexColor = typeof HexColor.Type;

const HtmlId = S.String.pipe(S.pattern(/^[a-zA-Z_][a-zA-Z0-9_-]*$/), S.brand('HtmlId'));
type HtmlId = typeof HtmlId.Type;

const Index = S.Number.pipe(S.int(), S.between(0, Number.MAX_SAFE_INTEGER), S.brand('Index'));
type Index = typeof Index.Type;

const IsoDate = S.String.pipe(S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/), S.brand('IsoDate'));
type IsoDate = typeof IsoDate.Type;

const NonNegativeInt = S.Number.pipe(S.int(), S.nonNegative(), S.brand('NonNegativeInt'));
type NonNegativeInt = typeof NonNegativeInt.Type;

const Percentage = S.Number.pipe(S.between(0, 100), S.brand('Percentage'));
type Percentage = typeof Percentage.Type;

const PositiveInt = S.Number.pipe(S.int(), S.positive(), S.brand('PositiveInt'));
type PositiveInt = typeof PositiveInt.Type;

const SafeInteger = S.Number.pipe(S.int(), S.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), S.brand('SafeInteger'));
type SafeInteger = typeof SafeInteger.Type;

const Slug = S.String.pipe(S.pattern(/^[a-z0-9-]+$/), S.brand('Slug'));
type Slug = typeof Slug.Type;

const Url = S.String.pipe(S.pattern(/^https?:\/\/[^\s/$.?#].[^\s]*$/i), S.brand('Url'));
type Url = typeof Url.Type;

const VariantCount = S.Number.pipe(S.int(), S.between(1, 100), S.brand('VariantCount'));
type VariantCount = typeof VariantCount.Type;

// --- [COMPANIONS] ------------------------------------------------------------

const DurationMs = (() => {
    const schema = S.Number.pipe(S.nonNegative(), S.brand('DurationMs'));
    type T = typeof schema.Type;
    return {
        // Arithmetic
        add: (first: T, second: T): T => (first + second) as T,
        // Construction
        fromMillis: (ms: number): T => ms as T,
        fromSeconds: (seconds: number): T => (seconds * 1000) as T,
        schema,
        // Extraction
        toSeconds: (duration: T): number => duration / 1000,
    } as const;
})();
type DurationMs = typeof DurationMs.schema.Type;

const Hex8 = (() => {
    const schema = S.String.pipe(S.pattern(/^[0-9a-f]{8}$/), S.brand('Hex8'));
    type T = typeof schema.Type;
    const generateSync = (): T => Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(4))) as T;
    const derive = (seed: string): T => {
        const mod = 16 ** 8;
        const hash = Array.from(seed).reduce<number>((acc, char) => (acc * 31 + (char.codePointAt(0) ?? 0)) % mod, 0);
        return hash.toString(16).padStart(8, '0').slice(-8) as T;
    };
    return {
        derive,
        generate: Effect.sync(generateSync),
        generateSync,
        schema,
    } as const;
})();
type Hex8 = typeof Hex8.schema.Type;

const Hex64 = (() => {
    const schema = S.String.pipe(S.pattern(/^[0-9a-f]{64}$/i), S.brand('Hex64'));
    type T = typeof schema.Type;
    return {
        fromBase64: (base64: string): Uint8Array =>
            Either.getOrThrowWith(Encoding.decodeBase64(base64), () => new Error('Invalid base64')),
        fromBytes: (bytes: Uint8Array): T => Encoding.encodeHex(bytes) as T,
        schema,
    } as const;
})();
type Hex64 = typeof Hex64.schema.Type;

const Timestamp = (() => {
    const schema = S.Number.pipe(S.positive(), S.brand('Timestamp'));
    type T = typeof schema.Type;
    const nowSync = (): T => Date.now() as T;
    return {
        // Arithmetic (accepts number for Duration.toMillis() compatibility)
        add: (ts: T, ms: number): T => (ts + ms) as T,
        diff: (later: T, earlier: T): number => later - earlier,
        // Expiration helpers
        expiresAt: (ms: number): T => (nowSync() + ms) as T,
        expiresAtDate: (ms: number): Date => new Date(nowSync() + ms),
        fromDate: (date: Date): T => date.getTime() as T,
        // Schema transform for Date interop
        fromDateSchema: S.transform(S.DateFromSelf, schema, {
            decode: (date) => date.getTime() as T,
            encode: (ts) => new Date(ts),
            strict: true,
        }),
        fromDateTime: (dt: DateTime.Utc): T => DateTime.toEpochMillis(dt) as T,
        // Construction
        now: Effect.sync(nowSync),
        nowSync,
        schema,
    } as const;
})();
type Timestamp = typeof Timestamp.schema.Type;

const Uuidv7 = (() => {
    const schema = S.String.pipe(
        S.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        S.brand('Uuidv7'),
    );
    type T = typeof schema.Type;
    const generateSync = (): T => uuidv7() as T;
    return {
        generate: Effect.sync(generateSync),
        generateSync,
        schema,
    } as const;
})();
type Uuidv7 = typeof Uuidv7.schema.Type;

const ZoomFactor = (() => {
    const MIN = 0.1;
    const MAX = 10;
    const schema = S.Number.pipe(S.between(MIN, MAX), S.brand('ZoomFactor'));
    type T = typeof schema.Type;
    return {
        clamp: (value: number): T => Math.max(MIN, Math.min(MAX, value)) as T,
        max: MAX as T,
        min: MIN as T,
        one: 1 as T,
        schema,
    } as const;
})();
type ZoomFactor = typeof ZoomFactor.schema.Type;

// --- [EXPORT] ----------------------------------------------------------------

export {
    DurationMs, Email, Hex64, Hex8, HexColor, HtmlId, Index, IsoDate, NonNegativeInt, Percentage, PositiveInt, SafeInteger, Slug, Timestamp,
    Url, Uuidv7, VariantCount, ZoomFactor,
};
