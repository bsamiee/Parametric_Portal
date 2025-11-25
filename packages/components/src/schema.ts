import { Schema as S } from '@effect/schema';
import { clsx } from 'clsx';
import { pipe } from 'effect';
import type { CSSProperties, ForwardedRef, RefObject } from 'react';
import { useRef } from 'react';
import { useFocusRing } from 'react-aria';
import { twMerge } from 'tailwind-merge';

// --- Schema Definitions -----------------------------------------------------

const PositiveSchema = pipe(S.Number, S.positive());
const NonNegativeIntSchema = pipe(S.Number, S.int(), S.nonNegative());

const ScaleSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('scale'), { default: () => 'scale' as const }),
    baseUnit: S.optionalWith(pipe(PositiveSchema, S.brand('Unit')), { default: () => 0.25 as never }),
    density: S.optionalWith(pipe(S.Number, S.between(0.5, 2), S.brand('Density')), { default: () => 1 as never }),
    radiusMultiplier: S.optionalWith(pipe(S.Number, S.between(0, 1), S.brand('Radius')), {
        default: () => 0.25 as never,
    }),
    scale: S.optionalWith(pipe(S.Number, S.between(1, 10), S.brand('Scale')), { default: () => 5 as never }),
});

const BehaviorSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('behavior'), { default: () => 'behavior' as const }),
    asChild: S.optionalWith(S.Boolean, { default: () => false }),
    disabled: S.optionalWith(S.Boolean, { default: () => false }),
    focusable: S.optionalWith(S.Boolean, { default: () => true }),
    interactive: S.optionalWith(S.Boolean, { default: () => true }),
    loading: S.optionalWith(S.Boolean, { default: () => false }),
    readonly: S.optionalWith(S.Boolean, { default: () => false }),
});

const OverlaySchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('overlay'), { default: () => 'overlay' as const }),
    backdrop: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnEscape: S.optionalWith(S.Boolean, { default: () => true }),
    closeOnOutsideClick: S.optionalWith(S.Boolean, { default: () => true }),
    modal: S.optionalWith(S.Boolean, { default: () => true }),
    position: S.optionalWith(S.Union(S.Literal('top'), S.Literal('bottom'), S.Literal('left'), S.Literal('right')), {
        default: () => 'bottom' as const,
    }),
    trapFocus: S.optionalWith(S.Boolean, { default: () => true }),
    zIndex: S.optionalWith(pipe(S.Number, S.int(), S.between(0, 9999)), { default: () => 50 as never }),
});

const FeedbackSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('feedback'), { default: () => 'feedback' as const }),
    autoDismiss: S.optionalWith(S.Boolean, { default: () => true }),
    dismissible: S.optionalWith(S.Boolean, { default: () => true }),
    duration: S.optionalWith(PositiveSchema, { default: () => 5000 as never }),
});

const AnimationSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('animation'), { default: () => 'animation' as const }),
    delay: S.optionalWith(NonNegativeIntSchema, { default: () => 0 as never }),
    duration: S.optionalWith(NonNegativeIntSchema, { default: () => 200 as never }),
    easing: S.optionalWith(S.String, { default: () => 'ease-out' as never }),
    enabled: S.optionalWith(S.Boolean, { default: () => true }),
});

// --- Schema Dispatch Table --------------------------------------------------

const Schemas = {
    animation: AnimationSchema,
    behavior: BehaviorSchema,
    feedback: FeedbackSchema,
    overlay: OverlaySchema,
    scale: ScaleSchema,
} as const;

type SchemaKey = keyof typeof Schemas;
type Resolved = { readonly [K in SchemaKey]: S.Schema.Type<(typeof Schemas)[K]> };
type Inputs = { readonly [K in SchemaKey]: S.Schema.Encoded<(typeof Schemas)[K]> };

// --- Type Definitions (Export-friendly aliases) -----------------------------

type Scale = Resolved['scale'];
type Behavior = Resolved['behavior'];
type Overlay = Resolved['overlay'];
type Feedback = Resolved['feedback'];
type Animation = Resolved['animation'];
type ScaleInput = Inputs['scale'];
type BehaviorInput = Inputs['behavior'];
type OverlayInput = Inputs['overlay'];
type FeedbackInput = Inputs['feedback'];
type AnimationInput = Inputs['animation'];
type Computed = {
    readonly [K in
        | 'badgePaddingX'
        | 'badgePaddingY'
        | 'dialogMaxWidth'
        | 'dropdownGap'
        | 'dropdownMaxHeight'
        | 'ellipsisPadding'
        | 'fontSize'
        | 'gap'
        | 'height'
        | 'iconSize'
        | 'itemHeight'
        | 'itemPaddingX'
        | 'itemPaddingY'
        | 'listSpacing'
        | 'minButtonWidth'
        | 'modalMaxWidth'
        | 'paddingX'
        | 'paddingY'
        | 'popoverOffset'
        | 'progressHeight'
        | 'radius'
        | 'separatorSpacing'
        | 'skeletonSpacing'
        | 'smallFontSize'
        | 'tooltipOffset'
        | 'triggerMinWidth'
        | 'xsFontSize']: string;
};

// --- Constants (Single Unified B - ALL Component Tuning) --------------------

const B = Object.freeze({
    algo: {
        badgePxMul: 0.4,
        badgePyMul: 0.1,
        dialogMaxMul: 28,
        dropdownGapMul: 0.4,
        ellipsisPxMul: 0.1,
        fontBase: 0.75,
        fontStep: 0.125,
        gapMul: 1,
        hBase: 1.5,
        hStep: 0.5,
        iconRatio: 0.6,
        listSpMul: 0.2,
        minBtnWMul: 1.6,
        modalMaxMul: 32,
        popoverOffMul: 0.1,
        progressHMul: 0.4,
        pxMul: 2,
        pyMul: 0.5,
        rMax: 9999,
        skeletonSpMul: 0.4,
        switchThumbInsetPx: 4,
        switchWidthRatio: 1.75,
        tooltipOffMul: 0.35,
    },
    ctrl: {
        state: {
            disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
            loading: 'cursor-wait',
            readonly: 'cursor-default',
        },
        switch: {
            thumb: 'absolute top-0.5 left-0.5 rounded-full bg-white shadow transition-transform',
            thumbOn: 'translate-x-full',
            track: 'relative inline-flex shrink-0 cursor-pointer rounded-full bg-current/20 transition-colors',
            trackOn: 'bg-current',
        },
        var: {
            base: 'inline-flex items-center justify-center font-medium transition-all duration-150',
            fs: 'text-[length:var(--ctrl-font-size)]',
            g: 'gap-[var(--ctrl-gap)]',
            h: 'h-[var(--ctrl-height)]',
            px: 'px-[var(--ctrl-padding-x)]',
            py: 'py-[var(--ctrl-padding-y)]',
            r: 'rounded-[var(--ctrl-radius)]',
        },
        variant: {
            default: '',
            destructive: 'bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500',
            ghost: 'bg-transparent hover:bg-current/10',
            link: 'bg-transparent underline-offset-4 hover:underline',
            outline: 'border border-current/20 bg-transparent hover:bg-current/5',
            primary: 'bg-current text-white hover:opacity-90',
            secondary: 'bg-current/10 hover:bg-current/20',
        } as {
            readonly [K in 'default' | 'destructive' | 'ghost' | 'link' | 'outline' | 'primary' | 'secondary']: string;
        },
    },
    data: {
        state: { disabled: 'opacity-50 pointer-events-none', loading: 'animate-pulse' },
        table: {
            cell: { focus: 'outline-none ring-1 ring-inset ring-current/20' },
            header: {
                sortable: 'cursor-pointer select-none hover:bg-current/5',
                sortIcon: 'ml-1 inline-block text-xs',
            },
            row: {
                focus: 'outline-none ring-1 ring-inset ring-current/20',
                hover: 'hover:bg-current/5',
                selected: 'bg-current/10',
            },
            sort: { asc: '\u2191', desc: '\u2193', none: '\u2195' } as {
                readonly [K in 'asc' | 'desc' | 'none']: string;
            },
        },
        var: {
            badgePx: 'px-[var(--data-badge-padding-x)]',
            badgePy: 'py-[var(--data-badge-padding-y)]',
            g: 'gap-[var(--data-gap)]',
            listSp: 'gap-y-[var(--data-list-spacing)]',
            px: 'px-[var(--data-padding-x)]',
            py: 'py-[var(--data-padding-y)]',
            r: 'rounded-[var(--data-radius)]',
            smFs: 'text-[length:var(--data-small-font-size)]',
            xsFs: 'text-[length:var(--data-xs-font-size)]',
        },
    },
    el: {
        flex: {
            align: 'items-',
            dir: 'flex-',
            justify: 'justify-',
            wrap: { false: 'flex-nowrap', true: 'flex-wrap' } as { readonly [K in 'false' | 'true']: string },
        },
        grid: { autoFlow: { col: 'grid-flow-col', row: 'grid-flow-row' } as { readonly [K in 'col' | 'row']: string } },
        separator: {
            base: 'shrink-0 bg-current/20',
            horizontal: 'h-px w-full',
            vertical: 'h-full w-px',
        } as { readonly [K in 'base' | 'horizontal' | 'vertical']: string },
        var: {
            gap: 'gap-[var(--el-gap)]',
            px: 'px-[var(--el-padding-x)]',
            py: 'py-[var(--el-padding-y)]',
            r: 'rounded-[var(--el-radius)]',
        },
    },
    fb: {
        anim: {
            enter: 'animate-in fade-in slide-in-from-top-2',
            exit: 'animate-out fade-out slide-out-to-top-2',
        },
        var: {
            fs: 'text-[length:var(--fb-font-size)]',
            g: 'gap-[var(--fb-gap)]',
            progressH: 'h-[var(--fb-progress-height)]',
            px: 'px-[var(--fb-padding-x)]',
            py: 'py-[var(--fb-padding-y)]',
            r: 'rounded-[var(--fb-radius)]',
            skeletonSp: 'gap-y-[var(--fb-skeleton-spacing)]',
        },
    },
    icon: {
        stroke: { base: 2.5, factor: 0.15, max: 3, min: 1 },
    },
    menu: {
        item: {
            base: 'flex items-center cursor-pointer outline-none transition-colors',
            disabled: 'opacity-50 cursor-not-allowed pointer-events-none',
            focus: 'ring-1 ring-inset ring-current/20',
            hover: 'bg-current/5',
            selected: 'bg-current/10 font-medium',
        },
        section: {
            header: 'text-xs font-semibold uppercase tracking-wide opacity-60',
            separator: 'h-px bg-current/10',
        },
        state: {
            disabled: 'opacity-50 pointer-events-none',
            loading: 'cursor-wait animate-pulse',
        },
        trigger: {
            base: 'inline-flex items-center justify-between',
            indicator: 'ml-2 opacity-60 transition-transform data-[state=open]:rotate-180',
        },
        var: {
            dropdownMaxH: 'max-h-[var(--menu-dropdown-max-height)]',
            itemH: 'h-[var(--menu-item-height)]',
            itemPx: 'px-[var(--menu-item-padding-x)]',
            itemPy: 'py-[var(--menu-item-padding-y)]',
            separatorSp: 'my-[var(--menu-separator-spacing)]',
            triggerMinW: 'min-w-[var(--menu-trigger-min-width)]',
        },
    },
    nav: {
        state: {
            active: 'data-[selected]:font-semibold',
            disabled: 'opacity-50 pointer-events-none',
        },
        tabs: {
            orientation: {
                horizontal: {
                    container: 'flex-col',
                    list: 'flex border-b',
                    tab: 'border-b-2 border-transparent',
                    tabSelected: 'border-current',
                },
                vertical: {
                    container: 'flex-row',
                    list: 'flex flex-col border-r',
                    tab: 'border-r-2 border-transparent',
                    tabSelected: 'border-current',
                },
            } as {
                readonly [K in 'horizontal' | 'vertical']: {
                    readonly container: string;
                    readonly list: string;
                    readonly tab: string;
                    readonly tabSelected: string;
                };
            },
            tab: {
                base: 'cursor-pointer transition-colors outline-none',
                disabled: 'opacity-50 cursor-not-allowed',
                focus: 'ring-2 ring-current/20',
                selected: 'font-semibold',
            },
        },
        var: {
            ellipsisPx: 'px-[var(--nav-ellipsis-padding)]',
            fs: 'text-[length:var(--nav-font-size)]',
            g: 'gap-[var(--nav-gap)]',
            h: 'h-[var(--nav-height)]',
            minW: 'min-w-[var(--nav-min-button-width)]',
            px: 'px-[var(--nav-padding-x)]',
            py: 'py-[var(--nav-padding-y)]',
            r: 'rounded-[var(--nav-radius)]',
        },
    },
    ov: {
        backdrop: 'bg-black/50',
        pos: {
            bottom: 'inset-x-0 bottom-0',
            left: 'inset-y-0 left-0',
            right: 'inset-y-0 right-0',
            top: 'inset-x-0 top-0',
        } as { readonly [K in 'bottom' | 'left' | 'right' | 'top']: string },
        size: {
            '2xl': 'max-w-2xl',
            full: 'max-w-full mx-4',
            lg: 'max-w-lg',
            md: 'max-w-md',
            sm: 'max-w-sm',
            xl: 'max-w-xl',
        } as { readonly [K in '2xl' | 'full' | 'lg' | 'md' | 'sm' | 'xl']: string },
        var: {
            dialogMaxW: 'max-w-[var(--ov-dialog-max-width)]',
            modalMaxW: 'max-w-[var(--ov-modal-max-width)]',
            popoverOff: 'var(--ov-popover-offset)',
            px: 'px-[var(--ov-padding-x)]',
            py: 'py-[var(--ov-padding-y)]',
            r: 'rounded-[var(--ov-radius)]',
            tooltipOff: 'var(--ov-tooltip-offset)',
        },
    },
    util: {
        dir: {
            both: 'overflow-auto',
            horizontal: 'overflow-x-auto overflow-y-hidden',
            vertical: 'overflow-x-hidden overflow-y-auto',
        } as { readonly [K in 'both' | 'horizontal' | 'vertical']: string },
        scrollbar: { hidden: 'scrollbar-none', visible: 'scrollbar-thin' },
        var: {
            h: 'h-[var(--util-height)]',
            maxH: 'max-h-[var(--util-height)]',
            px: 'px-[var(--util-padding-x)]',
            py: 'py-[var(--util-padding-y)]',
            r: 'rounded-[var(--util-radius)]',
        },
    },
} as const);

// --- Dispatch Tables --------------------------------------------------------

const compute: { readonly [K in keyof Computed]: (c: Scale) => string } = {
    badgePaddingX: (c) => `${(c.scale * B.algo.badgePxMul * c.density * c.baseUnit).toFixed(3)}rem`,
    badgePaddingY: (c) => `${(c.scale * B.algo.badgePyMul * c.density * c.baseUnit).toFixed(3)}rem`,
    dialogMaxWidth: (c) => `${(B.algo.dialogMaxMul * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    dropdownGap: (c) => `${(c.scale * B.algo.dropdownGapMul * c.density * c.baseUnit).toFixed(3)}rem`,
    dropdownMaxHeight: (c) => `${(c.scale * 12 * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    ellipsisPadding: (c) => `${(c.scale * B.algo.ellipsisPxMul * c.density * c.baseUnit).toFixed(3)}rem`,
    fontSize: (c) => `${(B.algo.fontBase + c.scale * B.algo.fontStep).toFixed(3)}rem`,
    gap: (c) => `${(c.scale * B.algo.gapMul * c.density * c.baseUnit).toFixed(3)}rem`,
    height: (c) => `${((B.algo.hBase + c.scale * B.algo.hStep) * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    iconSize: (c) =>
        `${((B.algo.fontBase + c.scale * B.algo.fontStep) * B.algo.iconRatio * c.baseUnit * 4).toFixed(3)}rem`,
    itemHeight: (c) => `${((B.algo.hBase + c.scale * B.algo.hStep * 0.8) * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    itemPaddingX: (c) => `${(c.scale * B.algo.pxMul * 0.75 * c.density * c.baseUnit).toFixed(3)}rem`,
    itemPaddingY: (c) => `${(c.scale * B.algo.pyMul * 0.5 * c.density * c.baseUnit).toFixed(3)}rem`,
    listSpacing: (c) => `${(c.scale * B.algo.listSpMul * c.density * c.baseUnit).toFixed(3)}rem`,
    minButtonWidth: (c) => `${(c.scale * B.algo.minBtnWMul * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    modalMaxWidth: (c) => `${(B.algo.modalMaxMul * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    paddingX: (c) => `${(c.scale * B.algo.pxMul * c.density * c.baseUnit).toFixed(3)}rem`,
    paddingY: (c) => `${(c.scale * B.algo.pyMul * c.density * c.baseUnit).toFixed(3)}rem`,
    popoverOffset: (c) => `${(c.scale * B.algo.popoverOffMul * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    progressHeight: (c) => `${(c.scale * B.algo.progressHMul * c.density * c.baseUnit).toFixed(3)}rem`,
    radius: (c) =>
        c.radiusMultiplier >= 1
            ? `${B.algo.rMax}px`
            : `${(c.scale * c.radiusMultiplier * 2 * c.baseUnit).toFixed(3)}rem`,
    separatorSpacing: (c) => `${(c.scale * 0.25 * c.density * c.baseUnit).toFixed(3)}rem`,
    skeletonSpacing: (c) => `${(c.scale * B.algo.skeletonSpMul * c.density * c.baseUnit).toFixed(3)}rem`,
    smallFontSize: (c) => `${(B.algo.fontBase + (c.scale - 1) * B.algo.fontStep).toFixed(3)}rem`,
    tooltipOffset: (c) => `${(c.scale * B.algo.tooltipOffMul * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    triggerMinWidth: (c) => `${(c.scale * 8 * c.density * c.baseUnit * 4).toFixed(3)}rem`,
    xsFontSize: (c) => `${(B.algo.fontBase + Math.max(1, c.scale - 2) * B.algo.fontStep).toFixed(3)}rem`,
};

// --- Pure Utility Functions -------------------------------------------------

const cls = (...inputs: ReadonlyArray<string | false | undefined>): string => twMerge(clsx(inputs));
const strokeWidth = (scale: number): number =>
    Math.max(B.icon.stroke.min, Math.min(B.icon.stroke.max, B.icon.stroke.base - scale * B.icon.stroke.factor));
const cssVars = (d: Computed, prefix: string): Record<string, string> =>
    Object.fromEntries(
        Object.entries(d).map(([k, v]) => [`--${prefix}-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v]),
    );
const computeScale = (s: Scale): Computed =>
    Object.fromEntries(
        (Object.keys(compute) as ReadonlyArray<keyof Computed>).map((k) => [k, compute[k](s)]),
    ) as Computed;

// --- State Class Dispatch (Unified for all component categories) ------------

type StateKey = 'ctrl' | 'data' | 'el' | 'fb' | 'menu' | 'nav' | 'ov';
const stateCls: { readonly [K in StateKey]: (b: Behavior) => string } = {
    ctrl: (b) =>
        cls(
            b.disabled ? B.ctrl.state.disabled : undefined,
            b.loading ? B.ctrl.state.loading : undefined,
            b.readonly ? B.ctrl.state.readonly : undefined,
        ),
    data: (b) => cls(b.disabled ? B.data.state.disabled : undefined, b.loading ? B.data.state.loading : undefined),
    el: (b) => cls(b.disabled ? 'pointer-events-none opacity-50' : undefined, b.loading ? 'animate-pulse' : undefined),
    fb: (b) => cls(b.disabled ? 'pointer-events-none opacity-50' : undefined),
    menu: (b) => cls(b.disabled ? B.menu.state.disabled : undefined, b.loading ? B.menu.state.loading : undefined),
    nav: (b) => cls(b.disabled ? B.nav.state.disabled : undefined),
    ov: (b) => cls(b.disabled ? 'pointer-events-none' : undefined, b.loading ? 'cursor-wait' : undefined),
};

// --- useForwardedRef Hook (Eliminates 20+ Boilerplate Instances) ------------

const useForwardedRef = <T extends HTMLElement | SVGElement>(fRef: ForwardedRef<T>): RefObject<T> => {
    const intRef = useRef<T>(null);
    return (fRef ?? intRef) as RefObject<T>;
};

// --- useCollectionEl Hook (Collection Components: Table, Tabs, List) --------

type CollectionElResult<T extends HTMLElement> = {
    readonly focusProps: ReturnType<typeof useFocusRing>['focusProps'];
    readonly isFocusVisible: boolean;
    readonly merge: <P>(
        ariaProps: P,
        ...classes: ReadonlyArray<string | false | undefined>
    ) => P & {
        readonly className: string;
        readonly ref: RefObject<T | null>;
    };
    readonly ref: RefObject<T | null>;
};

const useCollectionEl = <T extends HTMLElement>(focusClass?: string): CollectionElResult<T> => {
    const ref = useRef<T>(null);
    const { focusProps, isFocusVisible } = useFocusRing();
    return {
        focusProps,
        isFocusVisible,
        merge: <P>(ariaProps: P, ...classes: ReadonlyArray<string | false | undefined>) => ({
            ...ariaProps,
            ...focusProps,
            className: cls(
                ...classes.filter((c): c is string => typeof c === 'string'),
                isFocusVisible ? focusClass : undefined,
            ),
            ref,
        }),
        ref,
    };
};

// --- Polymorphic Resolver (Single Entry Point for All Schemas) --------------

const resolve = <K extends SchemaKey>(key: K, input?: Inputs[K]): Resolved[K] =>
    S.decodeUnknownSync(Schemas[key] as unknown as S.Schema<Resolved[K], Inputs[K]>)(input ?? {});

const merge = <T extends Record<string, unknown>>(a?: T, b?: T): T | undefined =>
    a || b ? ({ ...a, ...b } as T) : undefined;

// --- Factory Tuning System (Single Source of Truth) -------------------------

type TuningConfig = {
    readonly animation?: AnimationInput | undefined;
    readonly behavior?: BehaviorInput | undefined;
    readonly feedback?: FeedbackInput | undefined;
    readonly overlay?: OverlayInput | undefined;
    readonly scale?: ScaleInput | undefined;
};
type TuningKey = keyof TuningConfig;
type CtrlTuning = Pick<TuningConfig, 'behavior' | 'scale'>;
type DataTuning = Pick<TuningConfig, 'behavior' | 'scale'>;
type ElTuning = Pick<TuningConfig, 'behavior' | 'scale'>;
type FbTuning = Pick<TuningConfig, 'animation' | 'feedback' | 'scale'>;
type MenuTuning = Pick<TuningConfig, 'animation' | 'behavior' | 'overlay' | 'scale'>;
type NavTuning = Pick<TuningConfig, 'animation' | 'behavior' | 'scale'>;
type OvTuning = Pick<TuningConfig, 'animation' | 'overlay' | 'scale'>;
type UtilTuning = Pick<TuningConfig, 'scale'>;

const pick = <K extends TuningKey>(t: TuningConfig | undefined, keys: ReadonlyArray<K>): Pick<TuningConfig, K> =>
    t
        ? (Object.fromEntries(keys.filter((k) => t[k]).map((k) => [k, t[k]])) as Pick<TuningConfig, K>)
        : ({} as Pick<TuningConfig, K>);

const merged = <K extends TuningKey>(
    t: TuningConfig | undefined,
    i: TuningConfig,
    keys: ReadonlyArray<K>,
): Pick<TuningConfig, K> =>
    Object.fromEntries(keys.map((k) => [k, merge(t?.[k], i[k])]).filter(([, v]) => v)) as Pick<TuningConfig, K>;

const animStyle = (a: Animation): CSSProperties =>
    a.enabled
        ? { transition: `all ${a.duration}ms ${a.easing}`, transitionDelay: a.delay ? `${a.delay}ms` : undefined }
        : {};

type ResolvedContext<R extends SchemaKey> = {
    readonly computed: Computed;
    readonly scale: Scale;
    readonly vars: Record<string, string>;
} & { readonly [K in R]: Resolved[K] };

const createBuilderContext = <K extends string, R extends SchemaKey>(
    cssPrefix: K,
    resolvers: ReadonlyArray<R>,
    input: Partial<TuningConfig>,
): ResolvedContext<R> => {
    const s = resolve('scale', input.scale);
    const c = computeScale(s);
    const resolved = Object.fromEntries(
        resolvers.map((k) => [k, resolve(k, input[k as keyof TuningConfig] as never)]),
    ) as { readonly [K in R]: Resolved[K] };
    return { ...resolved, computed: c, scale: s, vars: cssVars(c, cssPrefix) };
};

// --- Export -----------------------------------------------------------------

export {
    animStyle,
    AnimationSchema,
    B,
    BehaviorSchema,
    cls,
    compute,
    computeScale,
    createBuilderContext,
    cssVars,
    FeedbackSchema,
    merge,
    merged,
    OverlaySchema,
    pick,
    resolve,
    ScaleSchema,
    stateCls,
    strokeWidth,
    useCollectionEl,
    useForwardedRef,
};
export type {
    Animation,
    AnimationInput,
    Behavior,
    BehaviorInput,
    CollectionElResult,
    Computed,
    CtrlTuning,
    DataTuning,
    ElTuning,
    FbTuning,
    Feedback,
    FeedbackInput,
    MenuTuning,
    NavTuning,
    Overlay,
    OverlayInput,
    OvTuning,
    ResolvedContext,
    Scale,
    ScaleInput,
    SchemaKey,
    TuningConfig,
    UtilTuning,
};
