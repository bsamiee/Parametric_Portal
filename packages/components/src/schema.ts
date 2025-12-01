import { Schema as S } from '@effect/schema';
import { clsx } from 'clsx';
import { pipe } from 'effect';
import type { CSSProperties, ForwardedRef, RefObject } from 'react';
import { useRef } from 'react';
import { useFocusRing } from 'react-aria';
import { twMerge } from 'tailwind-merge';

// --- Helpers (Hoisted) ------------------------------------------------------

const rem = (v: number): string => `${v.toFixed(3)}rem`;
const optBool = (d: boolean) => S.optionalWith(S.Boolean, { default: () => d });
const DIS = 'pointer-events-none opacity-50';
const LOAD = 'animate-pulse';
const cv = <P extends string, K extends string>(p: P, k: K, u: string) => `${u}[var(--${p}-${k})]` as const;
const coreVars = <P extends string>(p: P) =>
    ({ px: cv(p, 'padding-x', 'px-'), py: cv(p, 'padding-y', 'py-'), r: cv(p, 'radius', 'rounded-') }) as const;
type Sc = { readonly scale: number; readonly density: number; readonly baseUnit: number };
const mul = (c: Sc, f: number, m = 1): number => c.scale * f * c.density * c.baseUnit * m;
const add = (c: Sc, b: number, s: number, m = 1): number => (b + c.scale * s) * c.density * c.baseUnit * m;

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
    asChild: optBool(false),
    disabled: optBool(false),
    focusable: optBool(true),
    interactive: optBool(true),
    loading: optBool(false),
    readonly: optBool(false),
});

const OverlaySchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('overlay'), { default: () => 'overlay' as const }),
    backdrop: optBool(true),
    closeOnEscape: optBool(true),
    closeOnOutsideClick: optBool(true),
    modal: optBool(true),
    position: S.optionalWith(S.Union(S.Literal('top'), S.Literal('bottom'), S.Literal('left'), S.Literal('right')), {
        default: () => 'bottom' as const,
    }),
    trapFocus: optBool(true),
    zIndex: S.optionalWith(pipe(S.Number, S.int(), S.between(0, 9999)), { default: () => 50 as never }),
});

const FeedbackSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('feedback'), { default: () => 'feedback' as const }),
    autoDismiss: optBool(true),
    dismissible: optBool(true),
    duration: S.optionalWith(PositiveSchema, { default: () => 5000 as never }),
});

const AnimationSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Effect Schema discriminant convention
    _tag: S.optionalWith(S.Literal('animation'), { default: () => 'animation' as const }),
    delay: S.optionalWith(NonNegativeIntSchema, { default: () => 0 as never }),
    duration: S.optionalWith(NonNegativeIntSchema, { default: () => 200 as never }),
    easing: S.optionalWith(S.String, { default: () => 'ease-out' as never }),
    enabled: optBool(true),
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

// --- Dispatch Tables --------------------------------------------------------

const compute = {
    badgePaddingX: (c: Resolved['scale']) => rem(mul(c, B.algo.badgePxMul)),
    badgePaddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.badgePyMul)),
    cmdEmptyPaddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdEmptyPyMul)),
    cmdHeadingPaddingX: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdHeadingPxMul)),
    cmdHeadingPaddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdHeadingPyMul)),
    cmdInputHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdInputHMul)),
    cmdItemHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdItemHMul)),
    cmdListMaxHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdListMaxMul)),
    cmdListMinHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdListMinMul)),
    cmdShortcutPaddingX: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdShortcutPxMul)),
    cmdShortcutPaddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.cmdShortcutPyMul)),
    dialogMaxWidth: (c: Resolved['scale']) => rem(B.algo.dialogMaxMul * c.density * c.baseUnit * 4),
    dropdownGap: (c: Resolved['scale']) => rem(mul(c, B.algo.dropdownGapMul)),
    dropdownMaxHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.dropdownMaxMul, 4)),
    ellipsisPadding: (c: Resolved['scale']) => rem(mul(c, B.algo.ellipsisPxMul)),
    fontSize: (c: Resolved['scale']) => rem(B.algo.fontBase + c.scale * B.algo.fontStep),
    gap: (c: Resolved['scale']) => rem(mul(c, B.algo.gapMul)),
    height: (c: Resolved['scale']) => rem(add(c, B.algo.hBase, B.algo.hStep, 4)),
    iconSize: (c: Resolved['scale']) =>
        rem((B.algo.fontBase + c.scale * B.algo.fontStep) * B.algo.iconRatio * c.baseUnit * 4),
    itemHeight: (c: Resolved['scale']) => rem(add(c, B.algo.hBase, B.algo.hStep * 0.8, 4)),
    itemPaddingX: (c: Resolved['scale']) => rem(mul(c, B.algo.pxMul * 0.75)),
    itemPaddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.pyMul * 0.5)),
    listSpacing: (c: Resolved['scale']) => rem(mul(c, B.algo.listSpMul)),
    minButtonWidth: (c: Resolved['scale']) => rem(mul(c, B.algo.minBtnWMul, 4)),
    modalMaxWidth: (c: Resolved['scale']) => rem(B.algo.modalMaxMul * c.density * c.baseUnit * 4),
    paddingX: (c: Resolved['scale']) => rem(mul(c, B.algo.pxMul)),
    paddingY: (c: Resolved['scale']) => rem(mul(c, B.algo.pyMul)),
    popoverOffset: (c: Resolved['scale']) => rem(mul(c, B.algo.popoverOffMul, 4)),
    progressHeight: (c: Resolved['scale']) => rem(mul(c, B.algo.progressHMul)),
    radius: (c: Resolved['scale']) =>
        c.radiusMultiplier >= 1 ? `${B.algo.rMax}px` : rem(c.scale * c.radiusMultiplier * 2 * c.baseUnit),
    separatorSpacing: (c: Resolved['scale']) => rem(mul(c, B.algo.separatorMul)),
    skeletonSpacing: (c: Resolved['scale']) => rem(mul(c, B.algo.skeletonSpMul)),
    smallFontSize: (c: Resolved['scale']) => rem(B.algo.fontBase + (c.scale - 1) * B.algo.fontStep),
    tooltipOffset: (c: Resolved['scale']) => rem(mul(c, B.algo.tooltipOffMul, 4)),
    triggerMinWidth: (c: Resolved['scale']) => rem(mul(c, B.algo.triggerMinWMul, 4)),
    xsFontSize: (c: Resolved['scale']) => rem(B.algo.fontBase + Math.max(1, c.scale - 2) * B.algo.fontStep),
} as const;

type Computed = { readonly [K in keyof typeof compute]: string };

// --- Constants (Single Unified B - ALL Component Tuning) --------------------

const B = Object.freeze({
    algo: {
        badgePxMul: 0.4,
        badgePyMul: 0.1,
        cmdEmptyPyMul: 1.5,
        cmdHeadingPxMul: 0.5,
        cmdHeadingPyMul: 0.375,
        cmdInputHMul: 2.5,
        cmdItemHMul: 2,
        cmdListMaxMul: 16,
        cmdListMinMul: 8,
        cmdLoop: true,
        cmdShortcutPxMul: 0.25,
        cmdShortcutPyMul: 0.125,
        cmdShouldFilter: true,
        dialogMaxMul: 28,
        dropdownGapMul: 0.4,
        dropdownMaxMul: 12,
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
        separatorMul: 0.25,
        skeletonSpMul: 0.4,
        switchThumbInsetPx: 4,
        switchWidthRatio: 1.75,
        tooltipOffMul: 0.35,
        triggerMinWMul: 8,
    },
    cmd: {
        defaults: {
            dialog: { placeholder: 'Type a command or search...', useNav: true },
            inline: { placeholder: 'Search...', useNav: false },
            palette: { placeholder: 'Type a command or search...', useNav: true },
        } as {
            readonly [K in 'dialog' | 'inline' | 'palette']: { readonly placeholder: string; readonly useNav: boolean };
        },
        dialog: { content: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg shadow-2xl' },
        empty: { base: 'flex items-center justify-center opacity-50' },
        group: { base: 'overflow-hidden', heading: { base: 'font-medium opacity-50' } },
        initialPage: 'home',
        input: {
            base: 'flex w-full border-b bg-transparent outline-none placeholder:opacity-50',
            icon: 'mr-2 shrink-0 opacity-50',
        },
        item: {
            base: 'relative flex cursor-pointer select-none items-center outline-none transition-colors',
            disabled: DIS,
            icon: 'mr-2 shrink-0',
            selected: 'data-[selected=true]:bg-current/10',
            shortcut: { base: 'ml-auto tracking-widest opacity-60', key: 'rounded bg-current/10' },
        },
        label: 'Command Menu',
        list: { base: 'overflow-y-auto overflow-x-hidden', heightVar: '--cmdk-list-height' },
        loading: { base: 'flex items-center justify-center' },
        root: 'flex flex-col overflow-hidden rounded-lg border shadow-lg',
        separator: 'h-px bg-current/10',
        state: { disabled: DIS, loading: `${LOAD} cursor-wait` },
        var: {
            ...coreVars('cmd'),
            emptyPy: cv('cmd', 'empty-padding-y', 'py-'),
            fs: cv('cmd', 'font-size', 'text-[length:'),
            g: cv('cmd', 'gap', 'gap-'),
            headingPx: cv('cmd', 'heading-padding-x', 'px-'),
            headingPy: cv('cmd', 'heading-padding-y', 'py-'),
            inputH: cv('cmd', 'input-height', 'h-'),
            itemH: cv('cmd', 'item-height', 'h-'),
            listMaxH: cv('cmd', 'list-max-height', 'max-h-'),
            listMinH: cv('cmd', 'list-min-height', 'min-h-'),
            shortcutPx: cv('cmd', 'shortcut-padding-x', 'px-'),
            shortcutPy: cv('cmd', 'shortcut-padding-y', 'py-'),
            smFs: cv('cmd', 'small-font-size', 'text-[length:'),
            xsFs: cv('cmd', 'xs-font-size', 'text-[length:'),
        },
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
            ...coreVars('ctrl'),
            base: 'inline-flex items-center justify-center font-medium transition-all duration-150',
            fs: cv('ctrl', 'font-size', 'text-[length:'),
            g: cv('ctrl', 'gap', 'gap-'),
            h: cv('ctrl', 'height', 'h-'),
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
            ...coreVars('data'),
            badgePx: cv('data', 'badge-padding-x', 'px-'),
            badgePy: cv('data', 'badge-padding-y', 'py-'),
            g: cv('data', 'gap', 'gap-'),
            listSp: cv('data', 'list-spacing', 'gap-y-'),
            smFs: cv('data', 'small-font-size', 'text-[length:'),
            xsFs: cv('data', 'xs-font-size', 'text-[length:'),
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
        var: { ...coreVars('el'), gap: cv('el', 'gap', 'gap-') },
    },
    fb: {
        anim: {
            enter: 'animate-in fade-in slide-in-from-top-2',
            exit: 'animate-out fade-out slide-out-to-top-2',
        },
        var: {
            ...coreVars('fb'),
            fs: cv('fb', 'font-size', 'text-[length:'),
            g: cv('fb', 'gap', 'gap-'),
            progressH: cv('fb', 'progress-height', 'h-'),
            skeletonSp: cv('fb', 'skeleton-spacing', 'gap-y-'),
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
            ...coreVars('nav'),
            ellipsisPx: cv('nav', 'ellipsis-padding', 'px-'),
            fs: cv('nav', 'font-size', 'text-[length:'),
            g: cv('nav', 'gap', 'gap-'),
            h: cv('nav', 'height', 'h-'),
            minW: cv('nav', 'min-button-width', 'min-w-'),
        },
    },
    ov: {
        backdrop: 'bg-black/50',
        pos: {
            bottom: 'inset-x-0 bottom-0',
            fixed: 'fixed inset-0',
            left: 'inset-y-0 left-0',
            right: 'inset-y-0 right-0',
            top: 'inset-x-0 top-0',
        } as { readonly [K in 'bottom' | 'fixed' | 'left' | 'right' | 'top']: string },
        size: {
            '2xl': 'max-w-2xl',
            full: 'max-w-full mx-4',
            lg: 'max-w-lg',
            md: 'max-w-md',
            sm: 'max-w-sm',
            xl: 'max-w-xl',
        } as { readonly [K in '2xl' | 'full' | 'lg' | 'md' | 'sm' | 'xl']: string },
        var: {
            ...coreVars('ov'),
            dialogMaxW: cv('ov', 'dialog-max-width', 'max-w-'),
            modalMaxW: cv('ov', 'modal-max-width', 'max-w-'),
            popoverOff: 'var(--ov-popover-offset)',
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
        var: { ...coreVars('util'), h: cv('util', 'height', 'h-'), maxH: cv('util', 'height', 'max-h-') },
    },
} as const);

// --- Unified fn Object (Consolidated Helpers) -------------------------------

const fn = {
    cls: (...inputs: ReadonlyArray<string | false | undefined>): string => twMerge(clsx(inputs)),
    computeScale: (s: Resolved['scale']): Computed =>
        Object.fromEntries(
            (Object.keys(compute) as ReadonlyArray<keyof Computed>).map((k) => [k, compute[k](s)]),
        ) as Computed,
    cssVars: (d: Computed, prefix: string): Record<string, string> =>
        Object.fromEntries(
            Object.entries(d).map(([k, x]) => [`--${prefix}-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, x]),
        ),
    merge: <T extends Record<string, unknown>>(a?: T, b?: T): T | undefined =>
        a || b ? ({ ...a, ...b } as T) : undefined,
    optProps: <T extends Record<string, unknown>>(obj: T): Partial<T> =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>,
    strokeWidth: (n: number): number =>
        Math.max(B.icon.stroke.min, Math.min(B.icon.stroke.max, B.icon.stroke.base - n * B.icon.stroke.factor)),
    zStyle: (o: Resolved['overlay'], isUnderlay = false): CSSProperties => ({
        zIndex: isUnderlay ? o.zIndex - 10 : o.zIndex,
    }),
} as const;

// --- State Class Dispatch (Unified for all component categories) ------------

type StateKey = 'cmd' | 'ctrl' | 'data' | 'el' | 'fb' | 'menu' | 'nav' | 'ov';
const stateCls: { readonly [K in StateKey]: (b: Resolved['behavior']) => string } = {
    cmd: (b) => fn.cls(b.disabled ? B.cmd.state.disabled : undefined, b.loading ? B.cmd.state.loading : undefined),
    ctrl: (b) =>
        fn.cls(
            b.disabled ? B.ctrl.state.disabled : undefined,
            b.loading ? B.ctrl.state.loading : undefined,
            b.readonly ? B.ctrl.state.readonly : undefined,
        ),
    data: (b) => fn.cls(b.disabled ? B.data.state.disabled : undefined, b.loading ? B.data.state.loading : undefined),
    el: (b) => fn.cls(b.disabled ? DIS : undefined, b.loading ? LOAD : undefined),
    fb: (b) => fn.cls(b.disabled ? DIS : undefined),
    menu: (b) => fn.cls(b.disabled ? B.menu.state.disabled : undefined, b.loading ? B.menu.state.loading : undefined),
    nav: (b) => fn.cls(b.disabled ? B.nav.state.disabled : undefined),
    ov: (b) => fn.cls(b.disabled ? 'pointer-events-none' : undefined, b.loading ? 'cursor-wait' : undefined),
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
            className: fn.cls(
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

// --- Factory Tuning System (Single Source of Truth) -------------------------

type TuningConfig = { readonly [K in SchemaKey]?: Inputs[K] | undefined };
type TuningKey = keyof TuningConfig;
const TUNING_KEYS = {
    cmd: ['animation', 'behavior', 'overlay', 'scale'],
    ctrl: ['behavior', 'scale'],
    data: ['behavior', 'scale'],
    el: ['behavior', 'scale'],
    fb: ['animation', 'feedback', 'scale'],
    menu: ['animation', 'behavior', 'overlay', 'scale'],
    nav: ['animation', 'behavior', 'scale'],
    ov: ['animation', 'overlay', 'scale'],
    util: ['scale'],
} as const;
type TuningFor<K extends keyof typeof TUNING_KEYS> = Pick<TuningConfig, (typeof TUNING_KEYS)[K][number]>;

const pick = <K extends TuningKey>(t: TuningConfig | undefined, keys: ReadonlyArray<K>): Pick<TuningConfig, K> =>
    t
        ? (Object.fromEntries(keys.filter((k) => t[k]).map((k) => [k, t[k]])) as Pick<TuningConfig, K>)
        : ({} as Pick<TuningConfig, K>);

const merged = <K extends TuningKey>(
    t: TuningConfig | undefined,
    i: TuningConfig,
    keys: ReadonlyArray<K>,
): Pick<TuningConfig, K> =>
    Object.fromEntries(keys.map((k) => [k, fn.merge(t?.[k], i[k])]).filter(([, x]) => x)) as Pick<TuningConfig, K>;

const animStyle = (a: Resolved['animation']): CSSProperties =>
    a.enabled
        ? { transition: `all ${a.duration}ms ${a.easing}`, transitionDelay: a.delay ? `${a.delay}ms` : undefined }
        : {};

type ResolvedContext<R extends SchemaKey> = {
    readonly computed: Computed;
    readonly scale: Resolved['scale'];
    readonly vars: Record<string, string>;
} & { readonly [K in R]: Resolved[K] };

const createBuilderContext = <K extends string, R extends SchemaKey>(
    cssPrefix: K,
    resolvers: ReadonlyArray<R>,
    input: Partial<TuningConfig>,
): ResolvedContext<R> => {
    const s = resolve('scale', input.scale);
    const c = fn.computeScale(s);
    const resolved = Object.fromEntries(
        resolvers.map((k) => [k, resolve(k, input[k as keyof TuningConfig] as never)]),
    ) as { readonly [K in R]: Resolved[K] };
    return { ...resolved, computed: c, scale: s, vars: fn.cssVars(c, cssPrefix) };
};

// --- Export -----------------------------------------------------------------

export {
    animStyle,
    AnimationSchema,
    B,
    BehaviorSchema,
    compute,
    createBuilderContext,
    FeedbackSchema,
    fn,
    merged,
    OverlaySchema,
    pick,
    resolve,
    ScaleSchema,
    stateCls,
    TUNING_KEYS,
    useCollectionEl,
    useForwardedRef,
};
export type { CollectionElResult, Computed, Inputs, Resolved, ResolvedContext, SchemaKey, TuningConfig, TuningFor };
