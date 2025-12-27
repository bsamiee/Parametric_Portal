/**
 * Motion library integration with preset animations.
 * Grounding: Declarative animation props for compound components.
 */
import type { HTMLMotionProps, MotionStyle, Transition, Variants } from 'motion/react';
import type { CSSProperties } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type TransitionPreset = 'fast' | 'normal' | 'slow';
type AnimationPreset = 'fadeIn' | 'scaleIn' | 'slideUp' | 'slideDown';
type NormalizedStyle = MotionStyle | undefined;
type WithNormalizedStyle<T> = Omit<T, 'style'> & { readonly style?: NormalizedStyle };
type MotionConfig = {
    readonly animate: Record<string, number | string>;
    readonly exit: Record<string, number | string>;
    readonly initial: Record<string, number | string>;
    readonly transition: Transition;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    presets: {
        fadeIn: {
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            initial: { opacity: 0 },
        },
        scaleIn: {
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0, scale: 0.95 },
            initial: { opacity: 0, scale: 0.95 },
        },
        slideDown: {
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -8 },
            initial: { opacity: 0, y: -8 },
        },
        slideUp: {
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: 8 },
            initial: { opacity: 0, y: 8 },
        },
    },
    transitions: {
        fast: { duration: 0.15, ease: 'easeOut' },
        normal: { duration: 0.2, ease: 'easeOut' },
        slow: { duration: 0.3, ease: 'easeInOut' },
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getMotionConfig = (
    preset: AnimationPreset = 'fadeIn',
    transition: TransitionPreset = 'normal',
): MotionConfig => ({
    ...B.presets[preset],
    transition: B.transitions[transition],
});
const getInteractionProps = (enabled = true) =>
    enabled
        ? {
              transition: B.transitions.fast,
              whileHover: { scale: 1.02 },
              whileTap: { scale: 0.98 },
          }
        : {};
const createVariants = (preset: AnimationPreset = 'fadeIn'): Variants => ({
    animate: B.presets[preset].animate,
    exit: B.presets[preset].exit,
    initial: B.presets[preset].initial,
});
const normalizeStyle = (style: CSSProperties | undefined): NormalizedStyle =>
    style === undefined ? undefined : (style as MotionStyle);
const extractMotionProps = <E extends HTMLElement, T extends { style?: CSSProperties | undefined }>(
    props: T,
    interactionEnabled: boolean,
): HTMLMotionProps<E extends HTMLButtonElement ? 'button' : E extends HTMLInputElement ? 'input' : 'div'> => {
    const { style, ...rest } = props;
    return {
        ...rest,
        ...(style !== undefined && { style: style as MotionStyle }),
        ...(interactionEnabled && getInteractionProps(true)),
    } as HTMLMotionProps<E extends HTMLButtonElement ? 'button' : E extends HTMLInputElement ? 'input' : 'div'>;
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as MOTION_TUNING, createVariants, extractMotionProps, getInteractionProps, getMotionConfig, normalizeStyle };
export type { AnimationPreset, MotionConfig, NormalizedStyle, TransitionPreset, WithNormalizedStyle };
