/**
 * CSS variable animation slot utilities + enter/exit state machine.
 * Respects prefers-reduced-motion; integrates with AsyncState.
 */
import type { AutoAnimationPlugin } from '@formkit/auto-animate';
import { AsyncState } from '@parametric-portal/types/async';
import { useEffect, useRef, useState } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type AnimationPhase = 'entered' | 'entering' | 'exited' | 'exiting' | 'idle';
type AnimSlots = { readonly idle?: string; readonly loading?: string; readonly success?: string; readonly failure?: string };

// --- [HELPERS] ---------------------------------------------------------------

const reducedMotion = (): boolean => globalThis.window?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
const phaseTransitions: Record<AnimationPhase, AnimationPhase> = {
    entered: 'entered',
    entering: 'entered',
    exited: 'idle',
    exiting: 'exited',
    idle: 'idle',
};
const nextPhase = (p: AnimationPhase): AnimationPhase => phaseTransitions[p];

// --- [HOOKS] -----------------------------------------------------------------

const phaseForTransition = (wasOpen: boolean, isOpen: boolean, rm: boolean): AnimationPhase | null =>
    !wasOpen && isOpen ? (rm ? 'entered' : 'entering') :
    wasOpen && !isOpen ? (rm ? 'idle' : 'exiting') :
    null;
const useAnimationPhase = (isOpen: boolean, durationMs: number): AnimationPhase => {
    const [phase, setPhase] = useState<AnimationPhase>('idle');
    const prevRef = useRef(isOpen);
    useEffect(() => {
        const wasOpen = prevRef.current;
        prevRef.current = isOpen;
        const rm = reducedMotion();
        const newPhase = phaseForTransition(wasOpen, isOpen, rm);
        newPhase && setPhase(newPhase);
        const t = setTimeout(() => setPhase(nextPhase), rm ? 0 : durationMs);
        return () => clearTimeout(t);
    }, [isOpen, durationMs]);
    return phase;
};
const useAsyncAnimation = (asyncState: AsyncState<unknown, unknown> | undefined, slots: AnimSlots): string =>
    asyncState === undefined ? (slots.idle ?? 'none') : AsyncState.$match(asyncState, {
        Failure: () => slots.failure ?? 'none',
        Idle: () => slots.idle ?? 'none',
        Loading: () => slots.loading ?? 'none',
        Success: () => slots.success ?? 'none',
    });

// --- [FACTORY] ---------------------------------------------------------------

const createListPlugin = (config: {
    readonly duration: number;
    readonly easing: string;
    readonly enterScale: number;
    readonly exitScale: number;
    readonly disableOnReducedMotion?: boolean;
}): AutoAnimationPlugin => {
    const { disableOnReducedMotion = true, duration, easing, enterScale, exitScale } = config;
    const frames = {
        add: [{ opacity: 0, transform: `scale(${enterScale})` }, { opacity: 1, transform: 'scale(1)' }],
        remove: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${exitScale})` }],
    };
    type Coords = { readonly left: number; readonly top: number };
    const isCoords = (v: unknown): v is Coords =>
        v != null && typeof v === 'object' && 'left' in v && 'top' in v;
    const computeRemainFrames = (oldCoords: unknown, newCoords: unknown): Keyframe[] =>
        isCoords(oldCoords) && isCoords(newCoords)
            ? [{ transform: `translate(${oldCoords.left - newCoords.left}px, ${oldCoords.top - newCoords.top}px)` }, { transform: 'translate(0, 0)' }]
            : [];
    const actionFrames: Record<'add' | 'remove', Keyframe[]> = { add: frames.add, remove: frames.remove };
    const getKeyframes = (action: 'add' | 'remove' | 'remain', oldCoords: unknown, newCoords: unknown): Keyframe[] =>
        action === 'remain' ? computeRemainFrames(oldCoords, newCoords) : (actionFrames[action] ?? []);
    return (el, action, oldCoords, newCoords) => {
        const kf = getKeyframes(action, oldCoords, newCoords);
        return new KeyframeEffect(el, kf, { duration: disableOnReducedMotion && reducedMotion() ? 0 : duration, easing });
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { createListPlugin, useAnimationPhase, useAsyncAnimation };
export type { AnimationPhase, AnimSlots };
