/**
 * Configure component schema: establish B constant, scale system, state classes, utilities.
 * Exports B, utilities, animStyle, stateCls, resolve, createBuilderContext, useCollectionEl, useForwardedRef.
 */
import { Schema as S } from '@effect/schema';
import { clsx } from 'clsx';
import { pipe } from 'effect';
import type { CSSProperties, ForwardedRef, RefObject } from 'react';
import { useRef } from 'react';
import { useFocusRing } from 'react-aria';
import { twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type ScaleComputed = { readonly scale: number; readonly density: number; readonly baseUnit: number };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const DISABLED_CLASS = 'pointer-events-none opacity-50';
const LOADING_CLASS = 'animate-pulse';

const toRem = (value: number): string => `${value.toFixed(3)}rem`;
const optionalBoolean = (defaultValue: boolean) => S.optionalWith(S.Boolean, { default: () => defaultValue });
const generateCSSVariable = <P extends string, K extends string>(prefix: P, key: K, utility: string) =>
    `${utility}[var(--${prefix}-${key})]` as const;
const coreCSSVariables = <P extends string>(prefix: P) =>
    ({
        px: generateCSSVariable(prefix, 'padding-x', 'px-'),
        py: generateCSSVariable(prefix, 'padding-y', 'py-'),
        r: generateCSSVariable(prefix, 'radius', 'rounded-'),
    }) as const;
const multiplyScale = (computed: ScaleComputed, factor: number, multiplier = 1): number =>
    computed.scale * factor * computed.density * computed.baseUnit * multiplier;
const addScaleOffset = (computed: ScaleComputed, base: number, step: number, multiplier = 1): number =>
    (base + computed.scale * step) * computed.density * computed.baseUnit * multiplier;

// --- [SCHEMA] ----------------------------------------------------------------

const PositiveSchema = pipe(S.Number, S.positive());
const NonNegativeIntSchema = pipe(S.Number, S.int(), S.nonNegative());

const ScaleSchema = S.Struct({
    _tag: S.optionalWith(S.Literal('scale'), { default: () => 'scale' as const }),
    baseUnit: S.optionalWith(pipe(PositiveSchema, S.brand('Unit')), { default: () => 0.25 as never }),
    density: S.optionalWith(pipe(S.Number, S.between(0.5, 2), S.brand('Density')), { default: () => 1 as never }),
    radiusMultiplier: S.optionalWith(pipe(S.Number, S.between(0, 1), S.brand('Radius')), {
        default: () => 0.25 as never,
    }),
    scale: S.optionalWith(pipe(S.Number, S.between(1, 10), S.brand('Scale')), { default: () => 5 as never }),
});

const BehaviorSchema = S.Struct({
    _tag: S.optionalWith(S.Literal('behavior'), { default: () => 'behavior' as const }),
    asChild: optionalBoolean(false),
    disabled: optionalBoolean(false),
    focusable: optionalBoolean(true),
    interactive: optionalBoolean(true),
    loading: optionalBoolean(false),
    readonly: optionalBoolean(false),
});

const OverlaySchema = S.Struct({
    _tag: S.optionalWith(S.Literal('overlay'), { default: () => 'overlay' as const }),
    backdrop: optionalBoolean(true),
    closeOnEscape: optionalBoolean(true),
    closeOnOutsideClick: optionalBoolean(true),
    modal: optionalBoolean(true),
    position: S.optionalWith(S.Union(S.Literal('top'), S.Literal('bottom'), S.Literal('left'), S.Literal('right')), {
        default: () => 'bottom' as const,
    }),
    trapFocus: optionalBoolean(true),
    zIndex: S.optionalWith(pipe(S.Number, S.int(), S.between(0, 9999)), { default: () => 50 as never }),
});

const FeedbackSchema = S.Struct({
    _tag: S.optionalWith(S.Literal('feedback'), { default: () => 'feedback' as const }),
    autoDismiss: optionalBoolean(true),
    dismissible: optionalBoolean(true),
    duration: S.optionalWith(PositiveSchema, { default: () => 5000 as never }),
});

const AnimationSchema = S.Struct({
    _tag: S.optionalWith(S.Literal('animation'), { default: () => 'animation' as const }),
    delay: S.optionalWith(NonNegativeIntSchema, { default: () => 0 as never }),
    duration: S.optionalWith(NonNegativeIntSchema, { default: () => 200 as never }),
    easing: S.optionalWith(S.String, { default: () => 'ease-out' as never }),
    enabled: optionalBoolean(true),
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

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

const compute = {
    badgePaddingX: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.badgePxMul)),
    badgePaddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.badgePyMul)),
    cmdEmptyPaddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdEmptyPyMul)),
    cmdHeadingPaddingX: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdHeadingPxMul)),
    cmdHeadingPaddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdHeadingPyMul)),
    cmdInputHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdInputHMul)),
    cmdItemHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdItemHMul)),
    cmdListMaxHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdListMaxMul, 4)),
    cmdListMinHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdListMinMul, 4)),
    cmdShortcutPaddingX: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdShortcutPxMul)),
    cmdShortcutPaddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.cmdShortcutPyMul)),
    dialogMaxWidth: (computed: Resolved['scale']) =>
        toRem(B.algo.dialogMaxMul * computed.density * computed.baseUnit * 4),
    dropdownGap: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.dropdownGapMul)),
    dropdownMaxHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.dropdownMaxMul, 4)),
    ellipsisPadding: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.ellipsisPxMul)),
    fontSize: (computed: Resolved['scale']) => toRem(B.algo.fontBase + computed.scale * B.algo.fontStep),
    gap: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.gapMul)),
    height: (computed: Resolved['scale']) => toRem(addScaleOffset(computed, B.algo.hBase, B.algo.hStep, 4)),
    iconSize: (computed: Resolved['scale']) =>
        toRem((B.algo.fontBase + computed.scale * B.algo.fontStep) * B.algo.iconRatio * computed.baseUnit * 4),
    itemHeight: (computed: Resolved['scale']) => toRem(addScaleOffset(computed, B.algo.hBase, B.algo.hStep * 0.8, 4)),
    itemPaddingX: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.pxMul * 0.75)),
    itemPaddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.pyMul * 0.5)),
    listSpacing: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.listSpMul)),
    minButtonWidth: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.minBtnWMul, 4)),
    modalMaxWidth: (computed: Resolved['scale']) =>
        toRem(B.algo.modalMaxMul * computed.density * computed.baseUnit * 4),
    paddingX: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.pxMul)),
    paddingY: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.pyMul)),
    popoverOffset: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.popoverOffMul, 4)),
    progressHeight: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.progressHMul)),
    radius: (computed: Resolved['scale']) =>
        computed.radiusMultiplier >= 1
            ? `${B.algo.rMax}px`
            : toRem(computed.scale * computed.radiusMultiplier * 2 * computed.baseUnit),
    separatorSpacing: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.separatorMul)),
    skeletonSpacing: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.skeletonSpMul)),
    smallFontSize: (computed: Resolved['scale']) => toRem(B.algo.fontBase + (computed.scale - 1) * B.algo.fontStep),
    tooltipOffset: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.tooltipOffMul, 4)),
    triggerMinWidth: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.triggerMinWMul, 4)),
    xsFontSize: (computed: Resolved['scale']) =>
        toRem(B.algo.fontBase + Math.max(1, computed.scale - 2) * B.algo.fontStep),
} as const;

type Computed = { readonly [K in keyof typeof compute]: string };

// --- [CONSTANTS] -------------------------------------------------------------

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
            disabled: DISABLED_CLASS,
            icon: 'mr-2 shrink-0',
            selected: 'data-[selected=true]:bg-current/10',
            shortcut: { base: 'ml-auto tracking-widest opacity-60', key: 'rounded bg-current/10' },
        },
        label: 'Command Menu',
        list: { base: 'overflow-y-auto overflow-x-hidden', heightVar: '--cmdk-list-height' },
        loading: { base: 'flex items-center justify-center' },
        root: 'flex flex-col overflow-hidden rounded-lg border shadow-lg',
        separator: 'h-px bg-current/10',
        state: { disabled: DISABLED_CLASS, loading: `${LOADING_CLASS} cursor-wait` },
        var: {
            ...coreCSSVariables('cmd'),
            emptyPy: generateCSSVariable('cmd', 'empty-padding-y', 'py-'),
            fs: generateCSSVariable('cmd', 'font-size', 'text-[length:'),
            g: generateCSSVariable('cmd', 'gap', 'gap-'),
            headingPx: generateCSSVariable('cmd', 'heading-padding-x', 'px-'),
            headingPy: generateCSSVariable('cmd', 'heading-padding-y', 'py-'),
            inputH: generateCSSVariable('cmd', 'input-height', 'h-'),
            itemH: generateCSSVariable('cmd', 'item-height', 'h-'),
            listMaxH: generateCSSVariable('cmd', 'list-max-height', 'max-h-'),
            listMinH: generateCSSVariable('cmd', 'list-min-height', 'min-h-'),
            shortcutPx: generateCSSVariable('cmd', 'shortcut-padding-x', 'px-'),
            shortcutPy: generateCSSVariable('cmd', 'shortcut-padding-y', 'py-'),
            smFs: generateCSSVariable('cmd', 'small-font-size', 'text-[length:'),
            xsFs: generateCSSVariable('cmd', 'xs-font-size', 'text-[length:'),
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
            ...coreCSSVariables('ctrl'),
            base: 'inline-flex items-center justify-center font-medium transition-all duration-150',
            fs: generateCSSVariable('ctrl', 'font-size', 'text-[length:'),
            g: generateCSSVariable('ctrl', 'gap', 'gap-'),
            h: generateCSSVariable('ctrl', 'height', 'h-'),
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
            ...coreCSSVariables('data'),
            badgePx: generateCSSVariable('data', 'badge-padding-x', 'px-'),
            badgePy: generateCSSVariable('data', 'badge-padding-y', 'py-'),
            g: generateCSSVariable('data', 'gap', 'gap-'),
            listSp: generateCSSVariable('data', 'list-spacing', 'gap-y-'),
            smFs: generateCSSVariable('data', 'small-font-size', 'text-[length:'),
            xsFs: generateCSSVariable('data', 'xs-font-size', 'text-[length:'),
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
        var: { ...coreCSSVariables('el'), gap: generateCSSVariable('el', 'gap', 'gap-') },
    },
    fb: {
        anim: {
            enter: 'animate-in fade-in slide-in-from-top-2',
            exit: 'animate-out fade-out slide-out-to-top-2',
        },
        var: {
            ...coreCSSVariables('fb'),
            fs: generateCSSVariable('fb', 'font-size', 'text-[length:'),
            g: generateCSSVariable('fb', 'gap', 'gap-'),
            progressH: generateCSSVariable('fb', 'progress-height', 'h-'),
            skeletonSp: generateCSSVariable('fb', 'skeleton-spacing', 'gap-y-'),
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
            ...coreCSSVariables('nav'),
            ellipsisPx: generateCSSVariable('nav', 'ellipsis-padding', 'px-'),
            fs: generateCSSVariable('nav', 'font-size', 'text-[length:'),
            g: generateCSSVariable('nav', 'gap', 'gap-'),
            h: generateCSSVariable('nav', 'height', 'h-'),
            minW: generateCSSVariable('nav', 'min-button-width', 'min-w-'),
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
            ...coreCSSVariables('ov'),
            dialogMaxW: generateCSSVariable('ov', 'dialog-max-width', 'max-w-'),
            modalMaxW: generateCSSVariable('ov', 'modal-max-width', 'max-w-'),
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
        var: {
            ...coreCSSVariables('util'),
            h: generateCSSVariable('util', 'height', 'h-'),
            maxH: generateCSSVariable('util', 'height', 'max-h-'),
        },
    },
} as const);

const utilities = {
    cls: (...inputs: ReadonlyArray<string | false | undefined>): string => twMerge(clsx(inputs)),
    computeScale: (scale: Resolved['scale']): Computed =>
        Object.fromEntries(
            (Object.keys(compute) as ReadonlyArray<keyof Computed>).map((key) => [key, compute[key](scale)]),
        ) as Computed,
    cssVars: (computed: Computed, prefix: string): Record<string, string> =>
        Object.fromEntries(
            Object.entries(computed).map(([key, value]) => [
                `--${prefix}-${key.replaceAll(/([A-Z])/g, '-$1').toLowerCase()}`,
                value,
            ]),
        ),
    merge: <T extends Record<string, unknown>>(first?: T, second?: T): T | undefined =>
        first || second ? ({ ...first, ...second } as T) : undefined,
    optProps: <T extends Record<string, unknown>>(obj: T): Partial<T> =>
        Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>,
    strokeWidth: (scale: number): number =>
        Math.max(B.icon.stroke.min, Math.min(B.icon.stroke.max, B.icon.stroke.base - scale * B.icon.stroke.factor)),
    zStyle: (overlay: Resolved['overlay'], isUnderlay = false): CSSProperties => ({
        zIndex: isUnderlay ? overlay.zIndex - 10 : overlay.zIndex,
    }),
} as const;

type StateKey = 'cmd' | 'ctrl' | 'data' | 'el' | 'fb' | 'menu' | 'nav' | 'ov';
const stateCls: { readonly [K in StateKey]: (behavior: Resolved['behavior']) => string } = {
    cmd: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.cmd.state.disabled : undefined,
            behavior.loading ? B.cmd.state.loading : undefined,
        ),
    ctrl: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.ctrl.state.disabled : undefined,
            behavior.loading ? B.ctrl.state.loading : undefined,
            behavior.readonly ? B.ctrl.state.readonly : undefined,
        ),
    data: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.data.state.disabled : undefined,
            behavior.loading ? B.data.state.loading : undefined,
        ),
    el: (behavior) =>
        utilities.cls(behavior.disabled ? DISABLED_CLASS : undefined, behavior.loading ? LOADING_CLASS : undefined),
    fb: (behavior) => utilities.cls(behavior.disabled ? DISABLED_CLASS : undefined),
    menu: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.menu.state.disabled : undefined,
            behavior.loading ? B.menu.state.loading : undefined,
        ),
    nav: (behavior) => utilities.cls(behavior.disabled ? B.nav.state.disabled : undefined),
    ov: (behavior) =>
        utilities.cls(
            behavior.disabled ? 'pointer-events-none' : undefined,
            behavior.loading ? 'cursor-wait' : undefined,
        ),
};

const useForwardedRef = <T extends HTMLElement | SVGElement>(forwardedRef: ForwardedRef<T>): RefObject<T> => {
    const internalRef = useRef<T>(null);
    return (forwardedRef ?? internalRef) as RefObject<T>;
};

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
            className: utilities.cls(
                ...classes.filter((classValue): classValue is string => typeof classValue === 'string'),
                isFocusVisible ? focusClass : undefined,
            ),
            ref,
        }),
        ref,
    };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const resolve = <K extends SchemaKey>(key: K, input?: Inputs[K]): Resolved[K] =>
    S.decodeUnknownSync(Schemas[key] as unknown as S.Schema<Resolved[K], Inputs[K]>)(input ?? {});

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

const pick = <K extends TuningKey>(
    tuningConfig: TuningConfig | undefined,
    keys: ReadonlyArray<K>,
): Pick<TuningConfig, K> =>
    tuningConfig
        ? (Object.fromEntries(keys.filter((key) => tuningConfig[key]).map((key) => [key, tuningConfig[key]])) as Pick<
              TuningConfig,
              K
          >)
        : ({} as Pick<TuningConfig, K>);

const merged = <K extends TuningKey>(
    tuningConfig: TuningConfig | undefined,
    input: TuningConfig,
    keys: ReadonlyArray<K>,
): Pick<TuningConfig, K> =>
    Object.fromEntries(
        keys.map((key) => [key, utilities.merge(tuningConfig?.[key], input[key])]).filter(([, value]) => value),
    ) as Pick<TuningConfig, K>;

const animStyle = (animation: Resolved['animation']): CSSProperties =>
    animation.enabled
        ? {
              transition: `all ${animation.duration}ms ${animation.easing}`,
              transitionDelay: animation.delay ? `${animation.delay}ms` : undefined,
          }
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
    const scale = resolve('scale', input.scale);
    const computed = utilities.computeScale(scale);
    const resolved = Object.fromEntries(
        resolvers.map((key) => [key, resolve(key, input[key] as Inputs[typeof key] | undefined)]),
    ) as { readonly [K in R]: Resolved[K] };
    return { ...resolved, computed, scale, vars: utilities.cssVars(computed, cssPrefix) };
};

// --- [EXPORT] ----------------------------------------------------------------

export {
    animStyle,
    AnimationSchema,
    B,
    BehaviorSchema,
    compute,
    createBuilderContext,
    FeedbackSchema,
    merged,
    OverlaySchema,
    pick,
    resolve,
    ScaleSchema,
    stateCls,
    TUNING_KEYS,
    useCollectionEl,
    useForwardedRef,
    utilities,
};
export type { CollectionElResult, Computed, Inputs, Resolved, ResolvedContext, SchemaKey, TuningConfig, TuningFor };
