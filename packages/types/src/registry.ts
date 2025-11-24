import { Schema as S } from '@effect/schema';
import { create } from 'zustand';

// --- Schemas -----------------------------------------------------------------

const BrandMetadata = S.Struct({
    brandName: S.String,
    createdAt: S.Number,
});

type BrandMetadata = S.Schema.Type<typeof BrandMetadata>;

// --- Types -------------------------------------------------------------------

interface RegistryState {
    readonly brands: ReadonlyMap<string, BrandMetadata>;
}

interface RegistryActions {
    readonly getBrandNames: () => readonly string[];
    readonly hasBrand: (name: string) => boolean;
    readonly register: (name: string) => void;
    readonly unregister: (name: string) => void;
}

type BrandRegistry = RegistryState & RegistryActions;

// --- Factory -----------------------------------------------------------------

const createBrandRegistry = () =>
    create<BrandRegistry>((set, get) => ({
        brands: new Map(),

        getBrandNames: () => Array.from(get().brands.keys()),

        hasBrand: (name) => get().brands.has(name),

        register: (name) =>
            set((state) => {
                const next = new Map(state.brands);
                next.set(name, Object.freeze({ brandName: name, createdAt: Date.now() }));
                return { brands: next };
            }),

        unregister: (name) =>
            set((state) => {
                const next = new Map(state.brands);
                next.delete(name);
                return { brands: next };
            }),
    }));

// --- Export ------------------------------------------------------------------

export const useBrandRegistry = createBrandRegistry();
export { BrandMetadata };
export type { BrandRegistry };
