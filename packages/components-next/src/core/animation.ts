/**
 * Provide CSS-native enter/exit animations via tw-animate-css.
 * Apps customize duration/easing via CSS variable slots.
 */

// --- [TYPES] -----------------------------------------------------------------

type AnimationState = 'failure' | 'idle' | 'loading' | 'success';
type AnimationDirection = 'enter' | 'exit';
type AnimationPreset = 'bounce' | 'fade' | 'none' | 'ping' | 'pulse' | 'scale' | 'slide' | 'spin';
type StateAnimationConfig = { readonly animation: AnimationPreset; readonly iteration?: 'infinite' | number };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cssVars: {
        delay: 'animation-delay',
        direction: 'animation-direction',
        duration: 'animation-duration',
        easing: 'animation-easing',
        fillMode: 'animation-fill',
        iteration: 'animation-iteration',
    },
    enter: {
        bounce: 'animate-in zoom-in-95',
        fade: 'animate-in fade-in',
        none: '',
        ping: 'animate-in fade-in',
        pulse: 'animate-in fade-in',
        scale: 'animate-in zoom-in-0',
        slide: 'animate-in slide-in-from-bottom-2',
        spin: 'animate-in spin-in',
    } satisfies Record<AnimationPreset, string>,
    exit: {
        bounce: 'animate-out zoom-out-95',
        fade: 'animate-out fade-out',
        none: '',
        ping: 'animate-out fade-out',
        pulse: 'animate-out fade-out',
        scale: 'animate-out zoom-out-0',
        slide: 'animate-out slide-out-to-bottom-2',
        spin: 'animate-out spin-out',
    } satisfies Record<AnimationPreset, string>,
    prefixes: { duration: 'duration', easing: 'ease' } as Record<string, string>,
    state: {
        failure: { animation: 'ping', iteration: 3 },
        idle: { animation: 'none' },
        loading: { animation: 'spin', iteration: 'infinite' },
        success: { animation: 'bounce', iteration: 1 },
    } satisfies Record<AnimationState, StateAnimationConfig>,
    tailwind: {
        bounce: 'animate-bounce',
        none: '',
        ping: 'animate-ping',
        pulse: 'animate-pulse',
        spin: 'animate-spin',
    } as Record<string, string>,
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const direction = { enter: B.enter, exit: B.exit } as const;
const iteration = {
    infinite: 'animate-iteration-infinite',
    number: (n: number) => `animate-iteration-[${n}]`,
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const animationSlot = (c: string, p: keyof typeof B.cssVars): string =>
    `${B.prefixes[p] ?? p}-(--${c}-${B.cssVars[p]})`;
const getEnterAnimation = (p: AnimationPreset): string => B.enter[p];
const getExitAnimation = (p: AnimationPreset): string => B.exit[p];
const getStateAnimation = (s: AnimationState): string => (s === 'idle' ? '' : (B.tailwind[B.state[s].animation] ?? ''));
const composeAnimation = (c: string, d: AnimationDirection, p: AnimationPreset): string => {
    const base = direction[d][p];
    return base === '' ? '' : [base, animationSlot(c, 'duration'), animationSlot(c, 'easing')].join(' ');
};
const getIterationClass = (s: AnimationState): string => {
    const cfg = B.state[s];
    const iter = 'iteration' in cfg ? cfg.iteration : undefined;
    return iter === undefined ? '' : iter === 'infinite' ? iteration.infinite : iteration.number(iter as number);
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    animationSlot,
    B as ANIMATION_TUNING,
    composeAnimation,
    getEnterAnimation,
    getExitAnimation,
    getIterationClass,
    getStateAnimation,
};
export type { AnimationDirection, AnimationPreset, AnimationState, StateAnimationConfig };
