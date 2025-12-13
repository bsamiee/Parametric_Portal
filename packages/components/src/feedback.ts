/**
 * Feedback components: render alert, progress, skeleton, spinner, toast states.
 * Uses B, utilities, animStyle, resolve from schema.ts with CSS animation support.
 */
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Computed, Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, merged, pick, resolve, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type FeedbackType = 'alert' | 'progress' | 'skeleton' | 'spinner' | 'toast';
type AlertProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly icon?: ReactNode;
    readonly onDismiss?: () => void;
    readonly variant?: string;
};
type ProgressProps = HTMLAttributes<HTMLDivElement> & { readonly value?: number };
type SpinnerProps = HTMLAttributes<SVGElement>;
type SkeletonProps = HTMLAttributes<HTMLDivElement> & { readonly lines?: number };
type ToastProps = AlertProps & { readonly title?: string };
type FBInput<T extends FeedbackType = 'alert'> = {
    readonly animation?: Inputs['animation'] | undefined;
    readonly className?: string;
    readonly feedback?: Inputs['feedback'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};

const createAlertBaseComponent = (
    input: FBInput<'alert' | 'toast'>,
    vars: Record<string, string>,
    feedback: Resolved['feedback'],
    animation: Resolved['animation'],
    opts: { shadow: boolean; title: boolean },
) =>
    forwardRef((props: ToastProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, title, variant, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'relative flex items-start border',
                    opts.shadow ? 'shadow-lg' : '',
                    B.fb.var.g,
                    B.fb.var.px,
                    B.fb.var.py,
                    B.fb.var.r,
                    B.fb.var.fs,
                    input.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                role: 'alert',
                style: { ...vars, ...animStyle(animation), ...style } as CSSProperties,
            },
            icon,
            createElement(
                'div',
                { className: 'flex-1' },
                opts.title && title ? createElement('div', { className: 'font-semibold' }, title) : null,
                children,
            ),
            feedback.dismissible && onDismiss
                ? createElement(
                      'button',
                      {
                          'aria-label': 'Dismiss',
                          className: 'ml-auto opacity-70 hover:opacity-100',
                          onClick: onDismiss,
                          type: 'button',
                      },
                      '\u00d7',
                  )
                : null,
        );
    });

const createAlertComponent = (
    input: FBInput<'alert'>,
    vars: Record<string, string>,
    feedback: Resolved['feedback'],
    animation: Resolved['animation'],
) => createAlertBaseComponent(input, vars, feedback, animation, { shadow: false, title: false });

const createToastComponent = (
    input: FBInput<'toast'>,
    vars: Record<string, string>,
    feedback: Resolved['feedback'],
    animation: Resolved['animation'],
) => createAlertBaseComponent(input, vars, feedback, animation, { shadow: true, title: true });

const createProgressComponent = (input: FBInput<'progress'>, vars: Record<string, string>) =>
    forwardRef((props: ProgressProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, style, value = 0, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const clamped = Math.max(0, Math.min(100, value));
        return createElement(
            'div',
            {
                ...rest,
                'aria-valuemax': 100,
                'aria-valuemin': 0,
                'aria-valuenow': clamped,
                className: utilities.cls(
                    'relative w-full overflow-hidden rounded-full bg-current/10',
                    B.fb.var.progressH,
                    input.className,
                    className,
                ),
                ref,
                role: 'progressbar',
                style: { ...vars, ...style } as CSSProperties,
            },
            createElement('div', {
                className: 'h-full bg-current transition-all duration-300',
                style: { width: `${clamped}%` },
            }),
        );
    });

const createSkeletonComponent = (input: FBInput<'skeleton'>, computed: Computed, vars: Record<string, string>) =>
    forwardRef((props: SkeletonProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, lines = 1, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': true,
                'aria-label': 'Loading',
                className: utilities.cls('flex flex-col', B.fb.var.skeletonSp, input.className, className),
                ref,
                role: 'status',
                style: { ...vars, ...style } as CSSProperties,
            },
            Array.from({ length: lines }, (_, idx) =>
                createElement('div', {
                    className: utilities.cls(
                        'animate-pulse rounded bg-current/10',
                        idx === lines - 1 ? 'w-3/4' : 'w-full',
                    ),
                    key: `skeleton-line-${idx}`,
                    style: { height: computed.height },
                }),
            ),
        );
    });

const createSpinnerComponent = (input: FBInput<'spinner'>, computed: Computed) =>
    forwardRef((props: SpinnerProps, fRef: ForwardedRef<SVGSVGElement>) => {
        const { className, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'svg',
            {
                ...rest,
                'aria-label': 'Loading',
                className: utilities.cls('animate-spin', input.className, className),
                fill: 'none',
                height: computed.iconSize,
                ref,
                role: 'status',
                stroke: 'currentColor',
                strokeWidth: 2,
                style,
                viewBox: '0 0 24 24',
                width: computed.iconSize,
            },
            createElement('circle', { className: 'opacity-25', cx: 12, cy: 12, r: 10 }),
            createElement('path', {
                className: 'opacity-75',
                d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z',
                fill: 'currentColor',
            }),
        );
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    alert: createAlertComponent,
    progress: createProgressComponent,
    skeleton: createSkeletonComponent,
    spinner: createSpinnerComponent,
    toast: createToastComponent,
} as const;

const createFeedbackComponent = <T extends FeedbackType>(input: FBInput<T>) => {
    const scale = resolve('scale', input.scale);
    const feedback = resolve('feedback', input.feedback);
    const animation = resolve('animation', input.animation);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'fb');
    const builder = builderHandlers[input.type ?? 'alert'];
    const component = (
        builder as (
            input: FBInput<T>,
            vars: Record<string, string>,
            feedback: Resolved['feedback'],
            animation: Resolved['animation'],
        ) => ReturnType<typeof forwardRef>
    )(input, vars, feedback, animation);
    component.displayName = `Feedback(${input.type ?? 'alert'})`;
    return component;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createFeedback = (tuning?: TuningFor<'fb'>) =>
    Object.freeze({
        Alert: createFeedbackComponent({ type: 'alert', ...pick(tuning, TUNING_KEYS.fb) }),
        create: <T extends FeedbackType>(input: FBInput<T>) =>
            createFeedbackComponent({ ...input, ...merged(tuning, input, TUNING_KEYS.fb) }),
        Progress: createFeedbackComponent({ type: 'progress', ...pick(tuning, ['scale']) }),
        Skeleton: createFeedbackComponent({ type: 'skeleton', ...pick(tuning, ['scale']) }),
        Spinner: createFeedbackComponent({ type: 'spinner', ...pick(tuning, ['scale']) }),
        Toast: createFeedbackComponent({ type: 'toast', ...pick(tuning, TUNING_KEYS.fb) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createFeedback };
export type {
    AlertProps,
    FBInput as FeedbackInput,
    FeedbackType,
    ProgressProps,
    SkeletonProps,
    SpinnerProps,
    ToastProps,
};
