import { cva } from 'class-variance-authority';
import { Effect } from 'effect';
import type { CSSProperties, ForwardedRef, HTMLAttributes, ReactNode, RefObject } from 'react';
import { createElement, forwardRef, useRef } from 'react';
import type { DimensionConfig, FeedbackConfig, FeedbackVariant } from './schema.ts';
import {
    cls,
    computeDimensions,
    createDimensionDefaults,
    createFeedbackDefaults,
    createVars,
    resolveDimensions,
} from './schema.ts';

// --- Type Definitions -------------------------------------------------------

type FeedbackType = 'alert' | 'progress' | 'skeleton' | 'spinner' | 'toast';
type AlertProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly icon?: ReactNode;
    readonly onDismiss?: () => void;
};
type ProgressProps = HTMLAttributes<HTMLDivElement> & { readonly value?: number };
type SpinnerProps = HTMLAttributes<SVGElement>;
type SkeletonProps = HTMLAttributes<HTMLDivElement> & { readonly lines?: number };
type ToastProps = AlertProps & { readonly title?: string | undefined };
type FeedbackInput<T extends FeedbackType> = {
    readonly className?: string;
    readonly dimensions?: Partial<DimensionConfig>;
    readonly feedback?: Partial<FeedbackConfig>;
    readonly type: T;
};

// --- Constants (Unified Base) -----------------------------------------------

const B = Object.freeze({
    cls: {
        error: 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-100 dark:border-red-800',
        info: 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-800',
        success:
            'bg-green-50 text-green-900 border-green-200 dark:bg-green-950 dark:text-green-100 dark:border-green-800',
        warning:
            'bg-yellow-50 text-yellow-900 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-100 dark:border-yellow-800',
    } as { readonly [K in FeedbackVariant]: string },
    defaults: { dimensions: createDimensionDefaults(), feedback: createFeedbackDefaults() },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const vars = createVars('feedback');

const resolveDims = (dim?: Partial<DimensionConfig>): DimensionConfig =>
    Effect.runSync(resolveDimensions(dim, B.defaults.dimensions));

const alertVariants = cva(
    [
        'relative flex items-start gap-[var(--feedback-gap)] border',
        'px-[var(--feedback-padding-x)] py-[var(--feedback-padding-y)]',
        'rounded-[var(--feedback-radius)] text-[length:var(--feedback-font-size)]',
    ].join(' '),
    { defaultVariants: { variant: 'info' }, variants: { variant: B.cls } },
);

const progressVariants = cva('relative h-2 w-full overflow-hidden rounded-full bg-current/10', {
    defaultVariants: {},
    variants: {},
});

const spinnerVariants = cva('animate-spin', { defaultVariants: {}, variants: {} });

const skeletonVariants = cva('animate-pulse rounded-[var(--feedback-radius)] bg-current/10', {
    defaultVariants: {},
    variants: {},
});

// --- Component Factories ----------------------------------------------------

const createAlert = (i: FeedbackInput<'alert'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const variant = i.feedback?.variant ?? B.defaults.feedback.variant;
    const base = alertVariants({ variant });
    const Component = forwardRef((props: AlertProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const dismissible = i.feedback?.dismissible ?? B.defaults.feedback.dismissible;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(base, i.className, className),
                ref,
                role: 'alert',
                style: { ...cssVars, ...style } as CSSProperties,
            },
            icon,
            createElement('div', { className: 'flex-1' }, children),
            dismissible && onDismiss
                ? createElement(
                      'button',
                      {
                          'aria-label': 'Dismiss',
                          className: 'ml-auto opacity-70 hover:opacity-100',
                          onClick: onDismiss,
                          type: 'button',
                      },
                      '×',
                  )
                : null,
        );
    });
    Component.displayName = 'Feedback(alert)';
    return Component;
};

const createProgress = (i: FeedbackInput<'progress'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const base = progressVariants({});
    const Component = forwardRef((props: ProgressProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, style, value = 0, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        const clampedValue = Math.max(0, Math.min(100, value));
        return createElement(
            'div',
            {
                ...rest,
                'aria-valuemax': 100,
                'aria-valuemin': 0,
                'aria-valuenow': clampedValue,
                className: cls(base, i.className, className),
                ref,
                role: 'progressbar',
                style: { ...cssVars, ...style } as CSSProperties,
            },
            createElement('div', {
                className: 'h-full bg-current transition-all duration-300',
                style: { width: `${clampedValue}%` },
            }),
        );
    });
    Component.displayName = 'Feedback(progress)';
    return Component;
};

const createSpinner = (i: FeedbackInput<'spinner'>) => {
    const dims = resolveDims(i.dimensions);
    const computed = Effect.runSync(computeDimensions(dims));
    const base = spinnerVariants({});
    const Component = forwardRef((props: SpinnerProps, fRef: ForwardedRef<SVGSVGElement>) => {
        const { className, style, ...rest } = props;
        const internalRef = useRef<SVGSVGElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<SVGSVGElement>;
        return createElement(
            'svg',
            {
                ...rest,
                'aria-label': 'Loading',
                className: cls(base, i.className, className),
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
    Component.displayName = 'Feedback(spinner)';
    return Component;
};

const createSkeleton = (i: FeedbackInput<'skeleton'>) => {
    const dims = resolveDims(i.dimensions);
    const computed = Effect.runSync(computeDimensions(dims));
    const cssVars = vars(computed);
    const base = skeletonVariants({});
    const Component = forwardRef((props: SkeletonProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, lines = 1, style, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                'aria-busy': true,
                'aria-label': 'Loading content',
                className: cls('space-y-2', i.className, className),
                ref,
                role: 'status',
                style: { ...cssVars, ...style } as CSSProperties,
            },
            Array.from({ length: lines }, (_, idx) =>
                createElement('div', {
                    className: cls(base, idx === lines - 1 ? 'w-3/4' : 'w-full'),
                    key: idx,
                    style: { height: computed.height },
                }),
            ),
        );
    });
    Component.displayName = 'Feedback(skeleton)';
    return Component;
};

const createToast = (i: FeedbackInput<'toast'>) => {
    const dims = resolveDims(i.dimensions);
    const cssVars = vars(Effect.runSync(computeDimensions(dims)));
    const variant = i.feedback?.variant ?? B.defaults.feedback.variant;
    const base = alertVariants({ variant });
    const Component = forwardRef((props: ToastProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { children, className, icon, onDismiss, style, title, ...rest } = props;
        const internalRef = useRef<HTMLDivElement>(null);
        const ref = (fRef ?? internalRef) as RefObject<HTMLDivElement>;
        return createElement(
            'div',
            {
                ...rest,
                className: cls(base, 'shadow-lg', i.className, className),
                ref,
                role: 'alert',
                style: { ...cssVars, ...style } as CSSProperties,
            },
            icon,
            createElement(
                'div',
                { className: 'flex-1' },
                title ? createElement('div', { className: 'font-semibold' }, title) : null,
                children,
            ),
            onDismiss
                ? createElement(
                      'button',
                      {
                          'aria-label': 'Dismiss',
                          className: 'ml-auto opacity-70 hover:opacity-100',
                          onClick: onDismiss,
                          type: 'button',
                      },
                      '×',
                  )
                : null,
        );
    });
    Component.displayName = 'Feedback(toast)';
    return Component;
};

// --- Factory ----------------------------------------------------------------

const createFeedback = (tuning?: {
    defaults?: { dimensions?: Partial<DimensionConfig>; feedback?: Partial<FeedbackConfig> };
}) => {
    const defs = {
        dimensions: { ...B.defaults.dimensions, ...tuning?.defaults?.dimensions },
        feedback: { ...B.defaults.feedback, ...tuning?.defaults?.feedback },
    };
    return Object.freeze({
        Alert: createAlert({ dimensions: defs.dimensions, feedback: defs.feedback, type: 'alert' }),
        create: {
            alert: (i: Omit<FeedbackInput<'alert'>, 'type'>) =>
                createAlert({
                    ...i,
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    feedback: { ...defs.feedback, ...i.feedback },
                    type: 'alert',
                }),
            progress: (i: Omit<FeedbackInput<'progress'>, 'type'>) =>
                createProgress({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'progress' }),
            skeleton: (i: Omit<FeedbackInput<'skeleton'>, 'type'>) =>
                createSkeleton({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'skeleton' }),
            spinner: (i: Omit<FeedbackInput<'spinner'>, 'type'>) =>
                createSpinner({ ...i, dimensions: { ...defs.dimensions, ...i.dimensions }, type: 'spinner' }),
            toast: (i: Omit<FeedbackInput<'toast'>, 'type'>) =>
                createToast({
                    ...i,
                    dimensions: { ...defs.dimensions, ...i.dimensions },
                    feedback: { ...defs.feedback, ...i.feedback },
                    type: 'toast',
                }),
        },
        Progress: createProgress({ dimensions: defs.dimensions, type: 'progress' }),
        Skeleton: createSkeleton({ dimensions: defs.dimensions, type: 'skeleton' }),
        Spinner: createSpinner({ dimensions: defs.dimensions, type: 'spinner' }),
        Toast: createToast({ dimensions: defs.dimensions, feedback: defs.feedback, type: 'toast' }),
    });
};

// --- Export -----------------------------------------------------------------

export { B as FEEDBACK_TUNING, createFeedback };
