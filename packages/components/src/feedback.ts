import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { Computed, Feedback, FeedbackInput, ScaleInput } from './schema.ts';
import { cls, computeScale, cssVars, resolveFeedback, resolveScale } from './schema.ts';

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
    readonly className?: string;
    readonly feedback?: FeedbackInput | undefined;
    readonly scale?: ScaleInput | undefined;
    readonly type?: T;
};

// --- Constants (CSS Variable Classes Only - NO hardcoded colors) ------------

const B = Object.freeze({
    var: {
        fs: 'text-[length:var(--fb-font-size)]',
        g: 'gap-[var(--fb-gap)]',
        px: 'px-[var(--fb-padding-x)]',
        py: 'py-[var(--fb-padding-y)]',
        r: 'rounded-[var(--fb-radius)]',
    },
} as const);

// --- Component Builders -----------------------------------------------------

const mkAlert = (i: FBInput<'alert'>, v: Record<string, string>, f: Feedback) =>
    forwardRef((props: AlertProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, variant, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(
                    'relative flex items-start border',
                    B.var.g,
                    B.var.px,
                    B.var.py,
                    B.var.r,
                    B.var.fs,
                    i.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                role: 'alert',
                style: { ...v, ...style } as CSSProperties,
            },
            icon,
            createElement('div', { className: 'flex-1' }, children),
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

const mkProgress = (i: FBInput<'progress'>, v: Record<string, string>) =>
    forwardRef((props: ProgressProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, style, value = 0, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        const clamped = Math.max(0, Math.min(100, value));
        return createElement(
            'div',
            {
                ...rest,
                'aria-valuemax': 100,
                'aria-valuemin': 0,
                'aria-valuenow': clamped,
                className: cls(
                    'relative h-2 w-full overflow-hidden rounded-full bg-current/10',
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
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': true,
                'aria-label': 'Loading',
                className: cls('space-y-2', i.className, className),
                ref,
                role: 'status',
                style: { ...v, ...style } as CSSProperties,
            },
            Array.from({ length: lines }, (_, idx) =>
                createElement('div', {
                    className: cls('animate-pulse rounded bg-current/10', idx === lines - 1 ? 'w-3/4' : 'w-full'),
                    key: idx,
                    style: { height: c.height },
                }),
            ),
        );
    });

const mkSpinner = (i: FBInput<'spinner'>, c: Computed) =>
    forwardRef((props: SpinnerProps, fRef: ForwardedRef<SVGSVGElement>) => {
        const { className, style, ...rest } = props;
        const intRef = useRef<SVGSVGElement>(null);
        const ref = (fRef ?? intRef) as RefObject<SVGSVGElement>;
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

const mkToast = (i: FBInput<'toast'>, v: Record<string, string>, f: Feedback) =>
    forwardRef((props: ToastProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, title, variant, ...rest } = props;
        const intRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? intRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(
                    'relative flex items-start border shadow-lg',
                    B.var.g,
                    B.var.px,
                    B.var.py,
                    B.var.r,
                    B.var.fs,
                    i.className,
                    className,
                ),
                'data-variant': variant,
                ref,
                role: 'alert',
                style: { ...v, ...style } as CSSProperties,
            },
            icon,
            createElement(
                'div',
                { className: 'flex-1' },
                title ? createElement('div', { className: 'font-semibold' }, title) : null,
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

// --- Dispatch Table ---------------------------------------------------------

const builders = {
    alert: mkAlert,
    progress: mkProgress,
    skeleton: mkSkeleton,
    spinner: mkSpinner,
    toast: mkToast,
} as const;

const createFB = <T extends FeedbackType>(i: FBInput<T>) => {
    const s = resolveScale(i.scale);
    const f = resolveFeedback(i.feedback);
    const c = computeScale(s);
    const v = cssVars(c, 'fb');
    const builder = builders[i.type ?? 'alert'];
    const comp = (
        builder as (i: FBInput<T>, c: Computed, v: Record<string, string>, f: Feedback) => ReturnType<typeof forwardRef>
    )(i, c, v, f);
    comp.displayName = `Feedback(${i.type ?? 'alert'})`;
    return comp;
};

// --- Factory ----------------------------------------------------------------

const merge = <T extends Record<string, unknown>>(a?: T, b?: T): T | undefined =>
    a || b ? ({ ...a, ...b } as T) : undefined;

const createFeedback = (tuning?: { scale?: ScaleInput; feedback?: FeedbackInput }) =>
    Object.freeze({
        Alert: createFB({
            type: 'alert',
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.feedback && { feedback: tuning.feedback }),
        }),
        create: <T extends FeedbackType>(i: FBInput<T>) =>
            createFB({
                ...i,
                ...(merge(tuning?.scale, i.scale) && { scale: merge(tuning?.scale, i.scale) }),
                ...(merge(tuning?.feedback, i.feedback) && { feedback: merge(tuning?.feedback, i.feedback) }),
            }),
        Progress: createFB({ type: 'progress', ...(tuning?.scale && { scale: tuning.scale }) }),
        Skeleton: createFB({ type: 'skeleton', ...(tuning?.scale && { scale: tuning.scale }) }),
        Spinner: createFB({ type: 'spinner', ...(tuning?.scale && { scale: tuning.scale }) }),
        Toast: createFB({
            type: 'toast',
            ...(tuning?.scale && { scale: tuning.scale }),
            ...(tuning?.feedback && { feedback: tuning.feedback }),
        }),
    });

// --- Export -----------------------------------------------------------------

export { B as FEEDBACK_TUNING, createFeedback };
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
