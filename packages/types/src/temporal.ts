/**
 * Define temporal operations via Effect-wrapped date-fns: parse, format, addDays, daysBetween with Immer brand registry.
 */
import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { Effect, pipe } from 'effect';
import { castDraft, enableMapSet, produce } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// --- Types -------------------------------------------------------------------

type BrandMetadata = S.Schema.Type<typeof BrandMetadataSchema>;
type RegistryState = { readonly brands: ReadonlyMap<string, BrandMetadata> };
type RegistryActions = {
    readonly clear: () => void;
    readonly getBrandNames: () => ReadonlyArray<string>;
    readonly hasBrand: (name: string) => boolean;
    readonly register: (name: string) => void;
    readonly unregister: (name: string) => void;
};
type BrandRegistry = RegistryState & RegistryActions;
type TemporalConfig = {
    readonly defaultDateFormat?: string;
};
type TemporalApi = {
    readonly addDays: (numDays: number) => (date: Date) => Effect.Effect<Date, never>;
    readonly createRegistry: () => BrandRegistry;
    readonly daysBetween: (start: Date, end: Date) => Effect.Effect<number, never>;
    readonly formatDate: (formatStr?: string) => (date: Date) => Effect.Effect<string, ParseError>;
    readonly parse: (input: string) => Effect.Effect<Date, ParseError>;
    readonly produce: typeof produce;
};

// --- Schema ------------------------------------------------------------------

const BrandMetadataSchema = S.Struct({
    brandName: S.String,
    createdAt: S.Number,
});

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    defaultFormat: 'yyyy-MM-dd',
    registry: { initial: new Map<string, BrandMetadata>() },
} as const);

enableMapSet();

// --- Pure Functions ----------------------------------------------------------

const createBrandEntry = (name: string): Effect.Effect<BrandMetadata, ParseError, never> =>
    pipe(
        Effect.sync(() => ({ brandName: name, createdAt: Date.now() })),
        Effect.flatMap(S.decode(BrandMetadataSchema)),
    );

// --- Dispatch Tables ---------------------------------------------------------

const temporalHandlers = {
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

// --- Entry Point -------------------------------------------------------------

const createRegistry = (): BrandRegistry => {
    const useStore = create<BrandRegistry>()(
        immer((set, get) => ({
            brands: B.registry.initial,
            clear: () =>
                set((draft) => {
                    draft.brands = new Map<string, BrandMetadata>();
                }),
            getBrandNames: () => [...get().brands.keys()],
            hasBrand: (name) => get().brands.has(name),
            register: (name) =>
                Effect.runSync(
                    pipe(
                        createBrandEntry(name),
                        Effect.tap((brand) =>
                            Effect.sync(() =>
                                set((draft) => {
                                    castDraft(draft.brands).set(brand.brandName, brand);
                                }),
                            ),
                        ),
                        Effect.asVoid,
                    ),
                ),
            unregister: (name) =>
                set((draft) => {
                    castDraft(draft.brands).delete(name);
                }),
        })),
    );
    return useStore.getState();
};

const createTemporal = (config: TemporalConfig = {}): TemporalApi =>
    Object.freeze({
        addDays: temporalHandlers.addDays,
        createRegistry,
        daysBetween: temporalHandlers.daysBetween,
        formatDate: (formatStr?: string) =>
            temporalHandlers.formatDate(formatStr ?? config.defaultDateFormat ?? B.defaultFormat),
        parse: temporalHandlers.parse,
        produce,
    } as const);

// --- Export ------------------------------------------------------------------

export { B as TEMPORAL_TUNING, createTemporal };
export type { BrandMetadata, BrandRegistry, TemporalApi, TemporalConfig };
