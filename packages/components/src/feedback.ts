/**
 * Feedback components: render alert, progress, skeleton, spinner, toast states.
 * Uses B, utilities, animStyle, resolve from schema.ts with CSS animation support.
 */
import type { LucideIcon } from 'lucide-react';
import { icons } from 'lucide-react';
import type {
    CSSProperties,
    ForwardedRef,
    ForwardRefExoticComponent,
    HTMLAttributes,
    ReactNode,
    RefAttributes,
} from 'react';
import { createElement, forwardRef } from 'react';
import type { Computed, Inputs, Resolved, TuningFor } from './schema.ts';
import { animStyle, B, merged, pick, resolve, TUNING_KEYS, useForwardedRef, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type FeedbackType = 'alert' | 'empty' | 'progress' | 'skeleton' | 'spinner' | 'toast';
type AlertProps = HTMLAttributes<HTMLDivElement> & {
    readonly children?: ReactNode;
    readonly icon?: ReactNode;
    readonly onDismiss?: () => void;
    readonly variant?: string;
};
type ProgressProps = HTMLAttributes<HTMLDivElement> & { readonly value?: number };
type IconName = keyof typeof icons;
type SpinnerProps = HTMLAttributes<HTMLDivElement> & { readonly icon?: IconName };
type SkeletonProps = HTMLAttributes<HTMLDivElement> & { readonly lines?: number };
type ToastProps = AlertProps & { readonly title?: string };
type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
    readonly action?: { readonly label: string; readonly onAction: () => void };
    readonly description?: string;
    readonly icon?: ReactNode;
    readonly title?: string;
};
type FBInput<T extends FeedbackType = 'alert'> = {
    readonly animation?: Inputs['animation'] | undefined;
    readonly className?: string;
    readonly feedback?: Inputs['feedback'] | undefined;
    readonly scale?: Inputs['scale'] | undefined;
    readonly type?: T;
};
type FeedbackComponentMap = {
    readonly alert: ForwardRefExoticComponent<AlertProps & RefAttributes<HTMLDivElement>>;
    readonly empty: ForwardRefExoticComponent<EmptyStateProps & RefAttributes<HTMLDivElement>>;
    readonly progress: ForwardRefExoticComponent<ProgressProps & RefAttributes<HTMLDivElement>>;
    readonly skeleton: ForwardRefExoticComponent<SkeletonProps & RefAttributes<HTMLDivElement>>;
    readonly spinner: ForwardRefExoticComponent<SpinnerProps & RefAttributes<HTMLDivElement>>;
    readonly toast: ForwardRefExoticComponent<ToastProps & RefAttributes<HTMLDivElement>>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const feedbackCls = {
    alert: utilities.cls(B.fb.var.r, B.fb.var.fs, B.fb.var.g, B.fb.var.px, B.fb.var.py),
    progress: B.fb.var.progressH,
    skeleton: B.fb.var.skeletonSp,
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

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
                    feedbackCls.alert,
                    opts.shadow ? B.fb.toast.shadow : '',
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
                          className: B.fb.dismiss.base,
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
                    feedbackCls.progress,
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
                className: utilities.cls('flex flex-col', feedbackCls.skeleton, input.className, className),
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

const getSpinnerIcon = (name: IconName): LucideIcon => icons[name];

const createSpinnerComponent = (input: FBInput<'spinner'>, computed: Computed) =>
    forwardRef((props: SpinnerProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { className, icon = 'LoaderCircle', style, ...rest } = props;
        const ref = useForwardedRef(fRef);
        const Icon = getSpinnerIcon(icon);
        return createElement(
            'div',
            {
                ...rest,
                'aria-label': 'Loading',
                className: utilities.cls('inline-flex', input.className, className),
                ref,
                role: 'status',
                style,
            },
            createElement(Icon, {
                className: B.fb.spinner.anim,
                height: computed.iconSize,
                stroke: 'currentColor',
                strokeWidth: 2,
                width: computed.iconSize,
            }),
        );
    });

const createEmptyStateComponent = (input: FBInput<'empty'>, vars: Record<string, string>) =>
    forwardRef((props: EmptyStateProps, fRef: ForwardedRef<HTMLDivElement>) => {
        const { action, className, description, icon, style, title, ...rest } = props;
        const ref = useForwardedRef(fRef);
        return createElement(
            'div',
            {
                ...rest,
                className: utilities.cls(
                    'flex flex-col items-center justify-center text-center',
                    B.fb.var.g,
                    B.fb.var.py,
                    input.className,
                    className,
                ),
                ref,
                role: 'status',
                style: { ...vars, ...style } as CSSProperties,
            },
            icon ? createElement('div', { className: B.fb.empty.iconOpacity }, icon) : null,
            title
                ? createElement(
                      'span',
                      { className: utilities.cls('font-bold tracking-widest uppercase', B.fb.var.fs) },
                      title,
                  )
                : null,
            description
                ? createElement(
                      'p',
                      { className: utilities.cls(B.fb.empty.descFs, B.fb.empty.descOpacity) },
                      description,
                  )
                : null,
            action
                ? createElement(
                      'button',
                      {
                          className: utilities.cls(B.fb.action.mt, B.fb.action.px, B.fb.action.py, B.fb.action.base),
                          onClick: action.onAction,
                          type: 'button',
                      },
                      action.label,
                  )
                : null,
        );
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const builderHandlers = {
    alert: createAlertComponent,
    empty: createEmptyStateComponent,
    progress: createProgressComponent,
    skeleton: createSkeletonComponent,
    spinner: createSpinnerComponent,
    toast: createToastComponent,
} as const;

const createFeedbackComponent = <T extends FeedbackType>(input: FBInput<T>): FeedbackComponentMap[T] => {
    const scale = resolve('scale', input.scale);
    const feedback = resolve('feedback', input.feedback);
    const animation = resolve('animation', input.animation);
    const computed = utilities.computeScale(scale);
    const vars = utilities.cssVars(computed, 'fb');
    const builder = builderHandlers[input.type ?? 'alert'];
    const component = (
        builder as unknown as (
            input: FBInput<T>,
            vars: Record<string, string>,
            feedback: Resolved['feedback'],
            animation: Resolved['animation'],
        ) => FeedbackComponentMap[T]
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
        Empty: createFeedbackComponent({ type: 'empty', ...pick(tuning, ['scale']) }),
        Progress: createFeedbackComponent({ type: 'progress', ...pick(tuning, ['scale']) }),
        Skeleton: createFeedbackComponent({ type: 'skeleton', ...pick(tuning, ['scale']) }),
        Spinner: createFeedbackComponent({ type: 'spinner', ...pick(tuning, ['scale']) }),
        Toast: createFeedbackComponent({ type: 'toast', ...pick(tuning, TUNING_KEYS.fb) }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createFeedback };
export type {
    AlertProps,
    EmptyStateProps,
    FBInput as FeedbackInput,
    FeedbackType,
    ProgressProps,
    SkeletonProps,
    SpinnerProps,
    ToastProps,
};
