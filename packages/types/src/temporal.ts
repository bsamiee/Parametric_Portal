/**
 * Temporal operations and brand registry.
 * Grounding: date-fns wrappers with Immer-powered Zustand store.
 */
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { Effect, pipe, Schema as S } from 'effect';
import { castDraft, enableMapSet, produce } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// --- [TYPES] -----------------------------------------------------------------

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
    readonly formatDate: (formatStr?: string) => (date: Date) => Effect.Effect<string, TemporalError>;
    readonly parse: (input: string) => Effect.Effect<Date, TemporalError>;
    readonly produce: typeof produce;
};

// --- [SCHEMA] ----------------------------------------------------------------

const BrandMetadataSchema = S.Struct({
    brandName: S.String,
    createdAt: S.Number,
});

// --- [CLASSES] ---------------------------------------------------------------

class TemporalError extends S.TaggedClass<TemporalError>()('TemporalError', {
    message: S.String,
    operation: S.Literal('format', 'parse'),
}) {}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaultFormat: 'yyyy-MM-dd',
    registry: { initial: new Map<string, BrandMetadata>() },
} as const);

enableMapSet();

type ImmerSetter = (fn: (draft: RegistryState) => void) => void;

const updateBrands = (set: ImmerSetter, brand: BrandMetadata): void =>
    set((draft) => {
        castDraft(draft.brands).set(brand.brandName, brand);
    });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createBrandEntry = (name: string): Effect.Effect<BrandMetadata, TemporalError, never> =>
    pipe(
        Effect.sync(() => ({ brandName: name, createdAt: Date.now() })),
        Effect.flatMap(S.decode(BrandMetadataSchema)),
        Effect.mapError((e) => new TemporalError({ message: e.message, operation: 'parse' })),
    );

const registerBrandEffect = (
    name: string,
    updateFn: (brand: BrandMetadata) => void,
): Effect.Effect<void, TemporalError> =>
    pipe(
        createBrandEntry(name),
        Effect.tap((brand) => Effect.sync(() => updateFn(brand))),
        Effect.asVoid,
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const temporalHandlers = {
    addDays:
        (numDays: number) =>
        (date: Date): Effect.Effect<Date, never> =>
            Effect.sync(() => addDays(date, numDays)),
    daysBetween: (start: Date, end: Date): Effect.Effect<number, never> =>
        Effect.sync(() => differenceInDays(end, start)),
    formatDate:
        (formatStr: string) =>
        (date: Date): Effect.Effect<string, TemporalError> =>
            Effect.try({
                catch: (error) =>
                    new TemporalError({ message: `Format failed: ${String(error)}`, operation: 'format' }),
                try: () => format(date, formatStr),
            }),
    parse: (input: string): Effect.Effect<Date, TemporalError> =>
        pipe(
            Effect.try({
                catch: (error) => new TemporalError({ message: `Parse failed: ${String(error)}`, operation: 'parse' }),
                try: () => parseISO(input),
            }),
            Effect.filterOrFail(
                (parsedDate) => !Number.isNaN(parsedDate.getTime()),
                () => new TemporalError({ message: `Invalid date: ${input}`, operation: 'parse' }),
            ),
        ),
};

// --- [ENTRY_POINT] -----------------------------------------------------------

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
            register: (name) => Effect.runSync(registerBrandEffect(name, (brand) => updateBrands(set, brand))),
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

// --- [EXPORT] ----------------------------------------------------------------

export { B as TEMPORAL_TUNING, createTemporal, TemporalError };
export type { BrandMetadata, BrandRegistry, TemporalApi, TemporalConfig };
