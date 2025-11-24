import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
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

// --- Schema Definitions ------------------------------------------------------

const BrandMetadataSchema = S.Struct({
    brandName: S.String,
    createdAt: S.Number,
});

// --- Constants (Unified Factory → Frozen) -----------------------------------

const { initialState } = Effect.runSync(
    Effect.all({
        initialState: Effect.succeed({ brands: new Map<string, BrandMetadata>() }),
    }),
);

const INITIAL_STATE = Object.freeze(initialState);

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

const listBrandNames = (state: RegistryState): ReadonlyArray<string> => [...state.brands.keys()];

const brandExists = (state: RegistryState, name: string): boolean => state.brands.has(name);

// --- Effect Pipelines & Builders --------------------------------------------

const createBrandRegistry = () =>
    create<BrandRegistry>((set, get) => ({
        brands: INITIAL_STATE.brands,
        getBrandNames: () => listBrandNames(get()),
        hasBrand: (name) => brandExists(get(), name),
        register: (name) =>
            pipe(
                createBrandEntry(name),
                Effect.tap((brand) => Effect.sync(() => set((state) => ({ brands: addBrand(state, brand) })))),
                Effect.runSync,
            ),
        unregister: (name) => set((state) => ({ brands: removeBrand(state, name) })),
    }));

// --- Export ------------------------------------------------------------------

export const useBrandRegistry = createBrandRegistry();
export { BrandMetadataSchema };
export type { BrandMetadata, BrandRegistry };
