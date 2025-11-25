import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { Animation, AnimationInput, Computed, FbTuning, Feedback, FeedbackInput, ScaleInput } from './schema.ts';
import { animStyle, B, cls, computeScale, cssVars, merged, pick, resolve, useForwardedRef } from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type FeedbackType = 'alert' | 'progress' | 'skeleton' | 'spinner' | 'toast';
type Variant = string;
type AlertProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly icon?: ReactNode;
    readonly onDismiss?: () => void;
    readonly variant?: Variant;
};
type ProgressProps = HTMLAttributes<HTMLDivElement> & { readonly value?: number };
type SpinnerProps = HTMLAttributes<SVGElement>;
type SkeletonProps = HTMLAttributes<HTMLDivElement> & { readonly lines?: number };
type ToastProps = AlertProps & { readonly title?: string };
type FBInput<T extends FeedbackType = 'alert'> = {
    readonly animation?: AnimationInput | undefined;
    readonly className?: string;
    readonly feedback?: FeedbackInput | undefined;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Component Builders -----------------------------------------------------

const mkAlertBase = (
    i: FBInput<'alert' | 'toast'>,
    v: Record<string, string>,
    f: Feedback,
    a: Animation,
    opts: { shadow: boolean; title: boolean },
) =>
    forwardRef((props: ToastProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, title, variant, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: cls(
                    'relative flex items-start border',
                    opts.shadow ? 'shadow-lg' : '',
                    B.fb.var.g,
                    B.fb.var.px,
                    B.fb.var.py,
                    B.fb.var.r,
                    B.fb.var.fs,
                    i.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                role: 'alert',
                style: { ...v, ...animStyle(a), ...style } as CSSProperties,
            },
            icon,
            createElement(
                'div',
                { className: 'flex-1' },
                opts.title && title ? createElement('div', { className: 'font-semibold' }, title) : null,
                children,
            ),
            f.dismissible && onDismiss
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

const mkAlert = (i: FBInput<'alert'>, v: Record<string, string>, f: Feedback, a: Animation) =>
    mkAlertBase(i, v, f, a, { shadow: false, title: false });

const mkToast = (i: FBInput<'toast'>, v: Record<string, string>, f: Feedback, a: Animation) =>
    mkAlertBase(i, v, f, a, { shadow: true, title: true });

const mkProgress = (i: FBInput<'progress'>, v: Record<string, string>) =>
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
                className: cls(
                    'relative w-full overflow-hidden rounded-full bg-current/10',
                    B.fb.var.progressH,
                    i.className,
                    className,
                ),
                ref,
                role: 'progressbar',
                style: { ...v, ...style } as CSSProperties,
            },
            createElement('div', {
                className: 'h-full bg-current transition-all duration-300',
                style: { width: `${clamped}%` },
            }),
        );
    });

const mkSkeleton = (i: FBInput<'skeleton'>, c: Computed, v: Record<string, string>) =>
    forwardRef((props: SkeletonProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, lines = 1, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': true,
                'aria-label': 'Loading',
                className: cls('flex flex-col', B.fb.var.skeletonSp, i.className, className),
                ref,
                role: 'status',
                style: { ...v, ...style } as CSSProperties,
            },
            Array.from({ length: lines }, (_, idx) =>
                createElement('div', {
                    className: cls('animate-pulse rounded bg-current/10', idx === lines - 1 ? 'w-3/4' : 'w-full'),
                    key: `skeleton-line-${idx}`,
                    style: { height: c.height },
                }),
            ),
        );
    });

const mkSpinner = (i: FBInput<'spinner'>, c: Computed) =>
    forwardRef((props: SpinnerProps, fRef: ForwardedRef<SVGSVGElement>) => {
        const { className, style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'svg',
            {
                ...rest,
                'aria-label': 'Loading',
                className: cls('animate-spin', i.className, className),
                fill: 'none',
                height: c.iconSize,
                ref,
                role: 'status',
                stroke: 'currentColor',
                strokeWidth: 2,
                style,
                viewBox: '0 0 24 24',
                width: c.iconSize,
            },
            createElement('circle', { className: 'opacity-25', cx: 12, cy: 12, r: 10 }),
            createElement('path', {
                className: 'opacity-75',
                d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z',
                fill: 'currentColor',
            }),
        );
    });

// --- Dispatch Table ---------------------------------------------------------

const builders = {
    alert: mkAlert,
    progress: mkProgress,
    skeleton: mkSkeleton,
    spinner: mkSpinner,
    toast: mkToast,
} as const;

const createFB = <T extends FeedbackType>(i: FBInput<T>) => {
    const s = resolve('scale', i.scale);
    const f = resolve('feedback', i.feedback);
    const a = resolve('animation', i.animation);
    const c = computeScale(s);
    const v = cssVars(c, 'fb');
    const builder = builders[i.type ?? 'alert'];
    const comp = (
        builder as (
            i: FBInput<T>,
            v: Record<string, string>,
            f: Feedback,
            a: Animation,
        ) => ReturnType<typeof forwardRef>
    )(i, v, f, a);
    comp.displayName = `Feedback(${i.type ?? 'alert'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const K = ['animation', 'feedback', 'scale'] as const;

const createFeedback = (tuning?: FbTuning) =>
    Object.freeze({
        Alert: createFB({ type: 'alert', ...pick(tuning, K) }),
        create: <T extends FeedbackType>(i: FBInput<T>) => createFB({ ...i, ...merged(tuning, i, K) }),
        Progress: createFB({ type: 'progress', ...pick(tuning, ['scale']) }),
        Skeleton: createFB({ type: 'skeleton', ...pick(tuning, ['scale']) }),
        Spinner: createFB({ type: 'spinner', ...pick(tuning, ['scale']) }),
        Toast: createFB({ type: 'toast', ...pick(tuning, K) }),
    });

// --- Export -----------------------------------------------------------------

export { createFeedback };
export type {
    AlertProps,
    FBInput as FeedbackInput,
    FeedbackType,
    ProgressProps,
    SkeletonProps,
    SpinnerProps,
    ToastProps,
    Variant,
};
