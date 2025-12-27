/**
 * ComponentsProvider for global configuration.
 * Grounding: Context-based composition pattern for compound components.
 */
import { type Context, createContext, createElement, type FC, type ReactNode, useContext } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type Scale = {
    readonly baseUnit: number;
    readonly density: number;
    readonly radiusMultiplier: number;
    readonly scale: number;
};
type Behavior = {
    readonly disabled: boolean;
    readonly loading: boolean;
    readonly readonly: boolean;
};
type Animation = {
    readonly delay: number;
    readonly duration: number;
    readonly easing: string;
    readonly enabled: boolean;
};
type ComponentsConfig = {
    readonly animation: Animation;
    readonly behavior: Behavior;
    readonly scale: Scale;
};
type ComponentsProviderProps = {
    readonly children?: ReactNode;
    readonly config?: Partial<ComponentsConfig>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    animation: {
        delay: 0,
        duration: 200,
        easing: 'ease-out',
        enabled: true,
    },
    behavior: {
        disabled: false,
        loading: false,
        readonly: false,
    },
    scale: {
        baseUnit: 0.25,
        density: 1,
        radiusMultiplier: 0.25,
        scale: 5,
    },
} as const) satisfies ComponentsConfig;

// --- [CONTEXT] ---------------------------------------------------------------

const ComponentsContext: Context<ComponentsConfig> = createContext<ComponentsConfig>(B);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mergeConfig = (partial?: Partial<ComponentsConfig>): ComponentsConfig =>
    partial
        ? {
              animation: { ...B.animation, ...partial.animation },
              behavior: { ...B.behavior, ...partial.behavior },
              scale: { ...B.scale, ...partial.scale },
          }
        : B;

// --- [ENTRY_POINT] -----------------------------------------------------------

const ComponentsProvider: FC<ComponentsProviderProps> = ({ children, config }) =>
    createElement(ComponentsContext.Provider, { value: mergeConfig(config) }, children);
const useComponents = (): ComponentsConfig => useContext(ComponentsContext);
const useScale = (): Scale => useContext(ComponentsContext).scale;
const useBehavior = (): Behavior => useContext(ComponentsContext).behavior;
const useAnimation = (): Animation => useContext(ComponentsContext).animation;

// --- [EXPORT] ----------------------------------------------------------------

export { B as COMPONENTS_DEFAULTS, ComponentsProvider, useAnimation, useBehavior, useComponents, useScale };
export type { Animation, Behavior, ComponentsConfig, ComponentsProviderProps, Scale };
