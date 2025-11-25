import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { Effect, pipe } from 'effect';
import { create } from 'zustand';

// --- Type Definitions --------------------------------------------------------

type BrandMetadata = S.Schema.Type<typeof BrandMetadataSchema>;
type RegistryState = { readonly brands: ReadonlyMap<string, BrandMetadata> };
type RegistryActions = {
    readonly getBrandNames: () => ReadonlyArray<string>;
    readonly hasBrand: (name: string) => boolean;
    readonly register: (name: string) => void;
    readonly unregister: (name: string) => void;
};
type BrandRegistry = RegistryState & RegistryActions;

type UtilsConfig = {
    readonly defaultDateFormat?: string;
};

type UtilsApi = {
    readonly addDays: (numDays: number) => (date: Date) => Effect.Effect<Date, never>;
    readonly createRegistry: () => BrandRegistry;
    readonly daysBetween: (start: Date, end: Date) => Effect.Effect<number, never>;
    readonly formatDate: (formatStr?: string) => (date: Date) => Effect.Effect<string, ParseError>;
    readonly parse: (input: string) => Effect.Effect<Date, ParseError>;
};

// --- Schema Definitions ------------------------------------------------------

const BrandMetadataSchema = S.Struct({
    brandName: S.String,
    createdAt: S.Number,
});

// --- Constants (Single B Constant) -------------------------------------------

const B = Object.freeze({
    defaultFormat: 'yyyy-MM-dd',
    registry: { initial: new Map<string, BrandMetadata>() },
} as const);

// --- Pure Utility Functions --------------------------------------------------

const createBrandEntry = (name: string): Effect.Effect<BrandMetadata, ParseError, never> =>
    pipe(
        Effect.sync(() => ({ brandName: name, createdAt: Date.now() })),
        Effect.flatMap(S.decode(BrandMetadataSchema)),
    );

const addBrand = (state: RegistryState, brand: BrandMetadata): ReadonlyMap<string, BrandMetadata> =>
    new Map([...state.brands, [brand.brandName, brand]]);

const removeBrand = (state: RegistryState, name: string): ReadonlyMap<string, BrandMetadata> =>
    new Map([...state.brands].filter(([brandName]) => brandName !== name));

// --- Registry Factory --------------------------------------------------------

const createRegistry = (): BrandRegistry =>
    create<BrandRegistry>((set, get) => ({
        brands: B.registry.initial,
        getBrandNames: () => [...get().brands.keys()],
        hasBrand: (name) => get().brands.has(name),
        register: (name) =>
            Effect.runSync(
                pipe(
                    createBrandEntry(name),
                    Effect.tap((brand) => Effect.sync(() => set((state) => ({ brands: addBrand(state, brand) })))),
                    Effect.asVoid,
                ),
            ),
        unregister: (name) => set((state) => ({ brands: removeBrand(state, name) })),
    }))();

// --- Date Utilities ----------------------------------------------------------

const dateUtils = {
    addDays:
        (numDays: number) =>
        (date: Date): Effect.Effect<Date, never> =>
            Effect.sync(() => addDays(date, numDays)),
    daysBetween: (start: Date, end: Date): Effect.Effect<number, never> =>
        Effect.sync(() => differenceInDays(end, start)),
    formatDate:
        (formatStr: string) =>
        (date: Date): Effect.Effect<string, ParseError> =>
            Effect.try({
                catch: (error) => new Error(`Format failed: ${String(error)}`) as ParseError,
                try: () => format(date, formatStr),
            }),
    parse: (input: string): Effect.Effect<Date, ParseError> =>
        pipe(
            Effect.try({
                catch: (error) => new Error(`Parse failed: ${String(error)}`) as ParseError,
                try: () => parseISO(input),
            }),
            Effect.filterOrFail(
                (parsedDate) => !Number.isNaN(parsedDate.getTime()),
                () => new Error(`Invalid date: ${input}`) as ParseError,
            ),
        ),
};

// --- Polymorphic Entry Point -------------------------------------------------

const createUtils = (config: UtilsConfig = {}): UtilsApi =>
    Object.freeze({
        addDays: dateUtils.addDays,
        createRegistry,
        daysBetween: dateUtils.daysBetween,
        formatDate: (formatStr?: string) => dateUtils.formatDate(formatStr ?? config.defaultDateFormat ?? B.defaultFormat),
        parse: dateUtils.parse,
    } as const);

// --- Export (2 Exports: Tuning + Factory) ------------------------------------

export { B as UTILS_TUNING, createUtils };
export type { BrandMetadata, BrandRegistry, UtilsApi, UtilsConfig };
