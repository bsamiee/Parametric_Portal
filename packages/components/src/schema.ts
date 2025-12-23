/**
 * Configure component schema: establish B constant, scale system, state classes, utilities.
 * Exports B, utilities, animStyle, stateCls, resolve, createBuilderContext, useCollectionEl, useForwardedRef.
 * Tooltip infrastructure: useTooltipState, useTooltipPosition, tooltipCls, renderTooltipPortal.
 */

import type { Placement } from '@floating-ui/react-dom';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { clsx } from 'clsx';
import { pipe, Schema as S } from 'effect';
import type { CSSProperties, ForwardedRef, ReactNode, RefObject } from 'react';
import { createElement, useRef } from 'react';
import { useFocusRing, useTooltip, useTooltipTrigger } from 'react-aria';
import { createPortal } from 'react-dom';
import { useTooltipTriggerState } from 'react-stately';
import { twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type ScaleComputed = { readonly scale: number; readonly density: number; readonly baseUnit: number };
type TooltipSide = 'bottom' | 'left' | 'right' | 'top';
type TooltipPositionResult = {
    readonly floatingStyles: CSSProperties;
    readonly placement: Placement;
    readonly refs: {
        readonly setFloating: (node: HTMLElement | null) => void;
        readonly setReference: (node: HTMLElement | null) => void;
    };
};
type TooltipStateOptions = {
    readonly content?: string | undefined;
    readonly isDisabled?: boolean | undefined;
    readonly offsetPx?: number | undefined;
    readonly side?: TooltipSide | undefined;
};
type TooltipState = TooltipPositionResult & {
    readonly content: string | undefined;
    readonly isOpen: boolean;
    readonly tooltipAriaProps: object;
    readonly triggerProps: object;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toRem = (value: number): string => `${value.toFixed(3)}rem`;
const optionalBoolean = (defaultValue: boolean) => S.optionalWith(S.Boolean, { default: () => defaultValue });
const generateCSSVariable = <P extends string, K extends string>(prefix: P, key: K, utility: string) =>
    `${utility}(--${prefix}-${key})` as const;
const coreCSSVariables = <P extends string>(prefix: P) =>
    ({
        px: generateCSSVariable(prefix, 'padding-x', 'px-'),
        py: generateCSSVariable(prefix, 'padding-y', 'py-'),
        r: generateCSSVariable(prefix, 'radius', 'rounded-'),
    }) as const;
const multiplyScale = (computed: ScaleComputed, factor: number, multiplier = 1): number =>
    computed.scale * factor * computed.density * computed.baseUnit * multiplier;
const computeOffsetPx = (scale: ScaleComputed, factor: number): number =>
    Math.round(scale.scale * factor * scale.density * scale.baseUnit * 4 * 16);
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
    iconGap: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.iconGapMul)),
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
    submitPadding: (computed: Resolved['scale']) => toRem(multiplyScale(computed, B.algo.barSubmitPadMul)),
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
        barIconMul: 0.6,
        barSubmitPadMul: 0.5,
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
        iconGapMul: 1,
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
        tooltipDelayMs: 300,
        tooltipOffMul: 0.1,
        triggerMinWMul: 8,
    },
    bar: {
        icon: 'shrink-0 opacity-(--bar-icon-opacity)',
        input: 'flex-1 bg-transparent outline-none placeholder:opacity-(--bar-placeholder-opacity)',
        root: 'flex items-center border bg-transparent transition-colors',
        spinner: 'animate-(--bar-spinner-animation)',
        state: {
            disabled: 'pointer-events-none opacity-(--bar-disabled-opacity)',
            loading: 'cursor-(--bar-loading-cursor)',
        },
        style: {
            fontSize: 'var(--bar-font-size)',
            iconSize: 'var(--bar-icon-size)',
            radius: 'var(--bar-radius)',
        },
        submit: 'inline-flex items-center justify-center shrink-0 transition-colors',
        var: {
            ...coreCSSVariables('bar'),
            fs: generateCSSVariable('bar', 'font-size', 'text-[length:'),
            g: generateCSSVariable('bar', 'gap', 'gap-'),
            h: generateCSSVariable('bar', 'height', 'h-'),
            iconSize: generateCSSVariable('bar', 'icon-size', 'size-'),
            submitPad: generateCSSVariable('bar', 'submit-padding', 'p-'),
        },
    },
    cmd: {
        defaults: {
            dialog: { globalShortcut: 'k', placeholder: 'Type a command or search...', useNav: true },
            inline: { globalShortcut: undefined, placeholder: 'Search...', useNav: false },
            palette: { globalShortcut: undefined, placeholder: 'Type a command or search...', useNav: true },
        } as {
            readonly [K in 'dialog' | 'inline' | 'palette']: {
                readonly globalShortcut: string | undefined;
                readonly placeholder: string;
                readonly useNav: boolean;
            };
        },
        dialog: {
            content:
                'fixed inset-(--cmd-dialog-inset) translate-(--cmd-dialog-translate) w-full max-w-(--cmd-dialog-max-width) shadow-(--cmd-dialog-shadow)',
        },
        empty: { base: 'flex items-center justify-center opacity-(--cmd-empty-opacity)' },
        group: {
            base: 'overflow-hidden',
            heading: { base: 'font-(--cmd-heading-weight) opacity-(--cmd-heading-opacity)' },
        },
        initialPage: 'home',
        input: {
            base: 'flex w-full border-b-(--cmd-input-border) bg-transparent outline-none placeholder:opacity-(--cmd-placeholder-opacity)',
            icon: 'mr-(--cmd-input-icon-margin) shrink-0 opacity-(--cmd-input-icon-opacity)',
        },
        item: {
            base: 'relative flex cursor-(--cmd-item-cursor) select-none items-center outline-none transition-colors',
            disabled: 'pointer-events-none opacity-(--cmd-item-disabled-opacity)',
            icon: 'mr-(--cmd-item-icon-margin) shrink-0',
            selected: 'data-[selected=true]:bg-(--cmd-item-selected-bg)',
            shortcut: {
                base: 'ml-auto tracking-(--cmd-shortcut-tracking) opacity-(--cmd-shortcut-opacity)',
                key: 'rounded-(--cmd-shortcut-radius) bg-(--cmd-shortcut-bg)',
            },
        },
        label: 'Command Menu',
        list: { base: 'overflow-y-auto overflow-x-hidden', heightVar: '--cmdk-list-height' },
        loading: { base: 'flex items-center justify-center' },
        root: 'flex flex-col overflow-hidden rounded-(--cmd-radius) border shadow-(--cmd-shadow)',
        separator: 'h-(--cmd-separator-height) bg-(--cmd-separator-bg)',
        state: {
            disabled: 'pointer-events-none opacity-(--cmd-disabled-opacity)',
            loading: 'animate-(--cmd-loading-animation) cursor-(--cmd-loading-cursor)',
        },
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
            disabled: 'opacity-(--ctrl-disabled-opacity) cursor-(--ctrl-disabled-cursor) pointer-events-none',
            loading: 'cursor-(--ctrl-loading-cursor)',
            readonly: 'cursor-(--ctrl-readonly-cursor)',
        },
        switch: {
            thumb: 'absolute inset-(--ctrl-switch-thumb-inset) rounded-(--ctrl-switch-thumb-radius) shadow-(--ctrl-switch-thumb-shadow) transition-transform bg-[var(--ctrl-switch-thumb)]',
            thumbOn: 'translate-x-(--ctrl-switch-thumb-translate)',
            track: 'relative inline-flex shrink-0 cursor-(--ctrl-switch-cursor) rounded-(--ctrl-switch-track-radius) transition-colors bg-[var(--ctrl-switch-track)]',
            trackOn: 'bg-[var(--ctrl-switch-track-on)]',
        },
        var: {
            ...coreCSSVariables('ctrl'),
            base: 'inline-flex items-center justify-center font-(--ctrl-font-weight) transition-all duration-(--ctrl-transition-duration)',
            fs: generateCSSVariable('ctrl', 'font-size', 'text-[length:'),
            g: generateCSSVariable('ctrl', 'gap', 'gap-'),
            h: generateCSSVariable('ctrl', 'height', 'h-'),
            inputBorder: 'border border-[var(--ctrl-input-border)] bg-transparent',
            variantDestructiveBg: 'bg-[var(--ctrl-destructive-bg)]',
            variantDestructiveHover: 'hover:bg-[var(--ctrl-destructive-hover)]',
            variantDestructiveRing: 'focus-visible:ring-[var(--ctrl-destructive-ring)]',
            variantDestructiveText: 'text-[var(--ctrl-destructive-text)]',
            variantGhostBg: 'bg-transparent',
            variantGhostHover: 'hover:bg-[var(--ctrl-ghost-hover)]',
            variantOutlineBorder: 'border border-[var(--ctrl-outline-border)]',
            variantOutlineHover: 'hover:bg-[var(--ctrl-outline-hover)]',
            variantPressedBg: 'aria-[pressed=true]:bg-[var(--ctrl-pressed-bg)]',
            variantPressedBorder: 'aria-[pressed=true]:border aria-[pressed=true]:border-[var(--ctrl-pressed-border)]',
            variantPressedText: 'aria-[pressed=true]:text-[var(--ctrl-pressed-text)]',
            variantPrimaryBg: 'bg-[var(--ctrl-primary-bg)]',
            variantPrimaryHover: 'hover:opacity-(--ctrl-primary-hover-opacity)',
            variantPrimaryText: 'text-[var(--ctrl-primary-text)]',
            variantSecondaryBg: 'bg-[var(--ctrl-secondary-bg)]',
            variantSecondaryHover: 'hover:bg-[var(--ctrl-secondary-hover)]',
            wAuto: 'w-(--ctrl-auto-width)',
            wFull: 'w-(--ctrl-full-width)',
        },
        variant: {
            default: '',
            destructive:
                'bg-[var(--ctrl-destructive-bg)] text-[var(--ctrl-destructive-text)] hover:bg-[var(--ctrl-destructive-hover)] focus-visible:ring-[var(--ctrl-destructive-ring)]',
            ghost: 'bg-transparent hover:bg-[var(--ctrl-ghost-hover)] aria-[pressed=true]:bg-[var(--ctrl-pressed-bg)] aria-[pressed=true]:border aria-[pressed=true]:border-[var(--ctrl-pressed-border)] aria-[pressed=true]:text-[var(--ctrl-pressed-text)]',
            link: 'bg-transparent underline-offset-(--ctrl-link-underline-offset) hover:underline',
            outline: 'border border-[var(--ctrl-outline-border)] bg-transparent hover:bg-[var(--ctrl-outline-hover)]',
            primary:
                'bg-[var(--ctrl-primary-bg)] text-[var(--ctrl-primary-text)] hover:opacity-(--ctrl-primary-hover-opacity)',
            secondary: 'bg-[var(--ctrl-secondary-bg)] hover:bg-[var(--ctrl-secondary-hover)]',
            solid: 'bg-[var(--ctrl-solid-bg)] text-[var(--ctrl-solid-text)] hover:bg-[var(--ctrl-solid-hover)]',
        } as {
            readonly [K in
                | 'default'
                | 'destructive'
                | 'ghost'
                | 'link'
                | 'outline'
                | 'primary'
                | 'secondary'
                | 'solid']: string;
        },
    },
    data: {
        avatar: {
            base: 'inline-flex items-center justify-center overflow-hidden rounded-(--data-avatar-radius) bg-(--data-avatar-bg)',
            fallback: 'text-(--data-avatar-fallback-size) font-(--data-avatar-fallback-weight)',
            image: 'h-full w-full object-cover',
        },
        badge: {
            base: 'inline-flex items-center rounded-(--data-badge-radius) text-(--data-badge-size) font-(--data-badge-weight)',
        },
        card: {
            base: 'overflow-hidden border-[var(--data-card-border)] bg-[var(--data-card-bg)]',
            heading: 'font-(--data-card-heading-weight)',
        },
        listItem: {
            action: 'shrink-0 flex flex-col items-end justify-between',
            base: 'group flex items-stretch cursor-pointer transition-colors rounded-(--data-listitem-radius)',
            content: 'flex-1 min-w-0 overflow-hidden text-left',
            hover: 'hover:bg-(--data-listitem-hover-bg)',
            selected: 'bg-(--data-listitem-selected-bg)',
            thumb: 'shrink-0 overflow-hidden rounded-(--data-listitem-thumb-radius) bg-(--data-listitem-thumb-bg) p-(--data-listitem-thumb-padding)',
        },
        state: {
            disabled: 'opacity-(--data-disabled-opacity) pointer-events-none',
            loading: 'animate-(--data-loading-animation)',
        },
        table: {
            cell: { focus: 'outline-none ring-(--data-cell-ring-width) ring-inset ring-(--data-cell-ring-color)' },
            header: {
                base: 'text-left font-(--data-cell-heading-weight)',
                sortable: 'cursor-(--data-header-cursor) select-none hover:bg-(--data-header-hover-bg)',
                sortIcon: 'ml-(--data-sort-icon-margin) inline-block text-(--data-sort-icon-size)',
            },
            row: {
                focus: 'outline-none ring-(--data-row-ring-width) ring-inset ring-(--data-row-ring-color)',
                hover: 'hover:bg-(--data-row-hover-bg)',
                selected: 'bg-(--data-row-selected-bg)',
            },
            sort: { asc: '\u2191', desc: '\u2193', none: '\u2195' } as {
                readonly [K in 'asc' | 'desc' | 'none']: string;
            },
        },
        thumb: {
            action: 'absolute -top-1 -right-1 w-4 h-4 rounded-full bg-(--data-thumb-action-bg) border border-(--data-thumb-action-border) text-(--data-thumb-action-color) flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer hover:bg-(--data-thumb-action-hover-bg) hover:border-(--data-thumb-action-hover-border) hover:text-(--data-thumb-action-hover-color)',
            base: 'relative inline-flex group',
            content: 'w-full h-full rounded-(--data-thumb-radius) bg-(--data-thumb-bg) overflow-hidden',
        },
        var: {
            ...coreCSSVariables('data'),
            badgePx: generateCSSVariable('data', 'badge-padding-x', 'px-'),
            badgePy: generateCSSVariable('data', 'badge-padding-y', 'py-'),
            g: generateCSSVariable('data', 'gap', 'gap-'),
            listItemG: generateCSSVariable('data', 'listitem-gap', 'gap-'),
            listItemPx: generateCSSVariable('data', 'listitem-padding-x', 'px-'),
            listItemPy: generateCSSVariable('data', 'listitem-padding-y', 'py-'),
            listItemThumbSize: generateCSSVariable('data', 'listitem-thumb-size', 'size-'),
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
            base: 'shrink-0 bg-(--el-separator-bg)',
            horizontal: 'h-(--el-separator-thickness) w-full',
            vertical: 'h-full w-(--el-separator-thickness)',
        } as { readonly [K in 'base' | 'horizontal' | 'vertical']: string },
        var: { ...coreCSSVariables('el'), gap: generateCSSVariable('el', 'gap', 'gap-') },
    },
    fb: {
        action: {
            base: 'rounded-(--fb-action-radius) border border-(--fb-action-border) hover:opacity-(--fb-action-hover-opacity) transition-opacity',
            mt: 'mt-(--fb-action-margin-top)',
            px: 'px-(--fb-action-padding-x)',
            py: 'py-(--fb-action-padding-y)',
        },
        anim: {
            enter: 'animate-(--fb-enter-animation)',
            exit: 'animate-(--fb-exit-animation)',
        },
        dismiss: {
            base: 'ml-auto opacity-(--fb-dismiss-opacity) hover:opacity-(--fb-dismiss-hover-opacity)',
        },
        empty: {
            descFs: 'text-(length:--fb-empty-desc-font-size)',
            descOpacity: 'opacity-(--fb-empty-desc-opacity)',
            iconOpacity: 'opacity-(--fb-empty-icon-opacity)',
        },
        spinner: {
            anim: 'animate-(--fb-spinner-animation)',
        },
        toast: {
            shadow: 'shadow-(--fb-toast-shadow)',
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
            base: 'flex items-center cursor-(--menu-item-cursor) outline-none transition-colors',
            disabled: 'opacity-(--menu-item-disabled-opacity) cursor-(--menu-item-disabled-cursor) pointer-events-none',
            focus: 'ring-(--menu-item-focus-ring-width) ring-inset ring-(--menu-item-focus-ring-color)',
        },
        section: {
            header: '',
            separator: 'h-(--menu-section-separator-height)',
        },
        state: {
            disabled: 'opacity-(--menu-disabled-opacity) pointer-events-none',
            loading: 'cursor-(--menu-loading-cursor) animate-(--menu-loading-animation)',
        },
        trigger: {
            base: 'inline-flex items-center justify-between',
            indicator:
                'ml-(--menu-trigger-indicator-margin) text-[length:var(--menu-trigger-indicator-size)] opacity-(--menu-trigger-indicator-opacity) transition-transform data-[state=open]:rotate-(--menu-trigger-indicator-rotation)',
        },
        var: {
            checkColor: 'text-[var(--menu-check-color)]',
            checkSize: 'size-[var(--menu-check-size)]',
            dropdownBg: 'bg-[var(--menu-dropdown-bg)]',
            dropdownGap: 'mt-[var(--menu-dropdown-gap)]',
            dropdownMaxH: 'max-h-[var(--menu-dropdown-max-height)]',
            dropdownPad: 'p-[var(--menu-dropdown-padding)]',
            dropdownPos: 'left-[var(--menu-dropdown-left)]',
            dropdownR: 'rounded-[var(--menu-dropdown-radius)]',
            dropdownShadow: 'shadow-[var(--menu-dropdown-shadow)]',
            headerColor: 'text-[var(--menu-header-color)]',
            headerFs: 'text-[length:var(--menu-header-font-size)]',
            headerPx: 'px-[var(--menu-header-padding-x)]',
            headerPy: 'py-[var(--menu-header-padding-y)]',
            itemFocusedBg: 'data-[focused=true]:bg-[var(--menu-item-hover-bg)]',
            itemFs: 'text-[length:var(--menu-item-font-size)]',
            itemG: 'gap-[var(--menu-item-gap)]',
            itemH: 'h-[var(--menu-item-height)]',
            itemIconG: 'gap-[var(--menu-item-icon-gap)]',
            itemPx: 'px-[var(--menu-item-padding-x)]',
            itemPy: 'py-[var(--menu-item-padding-y)]',
            itemR: 'rounded-[var(--menu-item-radius)]',
            itemSelectedBg: 'data-[selected=true]:bg-[var(--menu-item-selected-bg)]',
            itemSelectedText: 'data-[selected=true]:text-[var(--menu-item-selected-text)]',
            itemText: 'text-[var(--menu-item-text)]',
            labelFs: 'text-[length:var(--menu-label-font-size)]',
            labelFw: 'font-[var(--menu-label-font-weight)]',
            labelMb: 'mb-[var(--menu-label-margin-bottom)]',
            separatorBg: 'bg-[var(--menu-separator-bg)]',
            separatorSp: 'my-[var(--menu-separator-spacing)]',
            triggerLabelColor: 'text-[var(--menu-trigger-label)]',
            triggerMinW: 'min-w-[var(--menu-trigger-min-width)]',
            triggerR: 'rounded-[var(--menu-trigger-radius)]',
            triggerValueColor: 'text-[var(--menu-trigger-value)]',
        },
    },
    nav: {
        carousel: {
            counter: 'absolute bottom-(--nav-carousel-counter-bottom) left-(--nav-carousel-counter-left)',
            disabledOpacity: 'opacity-(--nav-carousel-disabled-opacity)',
            next: 'absolute right-(--nav-carousel-next-right) top-(--nav-carousel-next-top) -translate-y-1/2',
            prev: 'absolute left-(--nav-carousel-prev-left) top-(--nav-carousel-prev-top) -translate-y-1/2',
            subdued: 'opacity-(--nav-carousel-subdued-opacity)',
        },
        state: {
            active: 'data-[selected]:font-(--nav-active-font-weight)',
            disabled: 'opacity-(--nav-disabled-opacity) pointer-events-none',
        },
        tabs: {
            orientation: {
                horizontal: {
                    container: 'flex-col',
                    list: 'flex border-b-(--nav-tabs-border)',
                    tab: 'border-b-(--nav-tab-border-width) border-transparent',
                    tabSelected: 'border-(--nav-tab-selected-border)',
                },
                vertical: {
                    container: 'flex-row',
                    list: 'flex flex-col border-r-(--nav-tabs-border)',
                    tab: 'border-r-(--nav-tab-border-width) border-transparent',
                    tabSelected: 'border-(--nav-tab-selected-border)',
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
                base: 'cursor-(--nav-tab-cursor) transition-colors outline-none',
                disabled: 'opacity-(--nav-tab-disabled-opacity) cursor-(--nav-tab-disabled-cursor)',
                focus: 'ring-(--nav-tab-focus-ring-width) ring-(--nav-tab-focus-ring-color)',
                selected: 'font-(--nav-tab-selected-font-weight)',
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
        backdrop: 'bg-(--ov-backdrop-bg)',
        dialog: {
            footer: 'border-t-(--ov-footer-border) flex justify-end gap-(--ov-footer-gap)',
            pos: 'fixed left-(--ov-dialog-left) top-(--ov-dialog-top) translate-(--ov-dialog-translate) overflow-hidden',
        },
        modal: {
            content: 'w-full overflow-y-auto',
            maxH: 'max-h-(--ov-modal-max-height)',
            shadow: 'shadow-(--ov-modal-shadow)',
            underlay: 'fixed inset-(--ov-underlay-inset) flex items-center justify-center',
        },
        popover: {
            base: 'overflow-hidden',
            border: 'border-(--ov-popover-border)',
            shadow: 'shadow-(--ov-popover-shadow)',
        },
        pos: {
            bottom: 'inset-x-(--ov-pos-inset-x) bottom-(--ov-pos-bottom)',
            fixed: 'fixed inset-(--ov-pos-inset)',
            left: 'inset-y-(--ov-pos-inset-y) left-(--ov-pos-left)',
            right: 'inset-y-(--ov-pos-inset-y) right-(--ov-pos-right)',
            top: 'inset-x-(--ov-pos-inset-x) top-(--ov-pos-top)',
        } as { readonly [K in 'bottom' | 'fixed' | 'left' | 'right' | 'top']: string },
        size: {
            '2xl': 'max-w-(--ov-size-2xl)',
            full: 'max-w-(--ov-size-full) mx-(--ov-size-full-margin)',
            lg: 'max-w-(--ov-size-lg)',
            md: 'max-w-(--ov-size-md)',
            sm: 'max-w-(--ov-size-sm)',
            xl: 'max-w-(--ov-size-xl)',
        } as { readonly [K in '2xl' | 'full' | 'lg' | 'md' | 'sm' | 'xl']: string },
        style: { radius: 'var(--ov-radius)' },
        title: {
            base: 'border-b-(--ov-title-border)',
            font: 'font-(--ov-title-weight) text-(--ov-title-size)',
        },
        tooltip: {
            base: 'fixed font-(--ov-tooltip-font-family) text-(--ov-tooltip-font-size) font-(--ov-tooltip-font-weight) shadow-(--ov-tooltip-shadow) pointer-events-none whitespace-nowrap rounded-(--ov-tooltip-radius) min-h-(--ov-tooltip-min-height) flex items-center justify-center z-(--ov-tooltip-z-index)',
            var: {
                bg: 'bg-[var(--ov-tooltip-bg)]',
                px: 'px-[var(--ov-tooltip-padding-x)]',
                py: 'py-[var(--ov-tooltip-padding-y)]',
                text: 'text-[var(--ov-tooltip-text)]',
            },
        },
        var: {
            ...coreCSSVariables('ov'),
            dialogMaxW: generateCSSVariable('ov', 'dialog-max-width', 'max-w-'),
            modalMaxW: generateCSSVariable('ov', 'modal-max-width', 'max-w-'),
            popoverOff: 'var(--ov-popover-offset)',
        },
    },
    util: {
        dir: {
            both: 'overflow-(--util-overflow-both)',
            horizontal: 'overflow-x-(--util-overflow-x) overflow-y-(--util-overflow-y-hidden)',
            vertical: 'overflow-x-(--util-overflow-x-hidden) overflow-y-(--util-overflow-y)',
        } as { readonly [K in 'both' | 'horizontal' | 'vertical']: string },
        scrollbar: {
            hidden: 'scrollbar-(--util-scrollbar-hidden)',
            visible: 'scrollbar-(--util-scrollbar-visible)',
        },
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

type StateKey = 'bar' | 'cmd' | 'ctrl' | 'data' | 'el' | 'fb' | 'menu' | 'nav' | 'ov';
const stateCls: { readonly [K in StateKey]: (behavior: Resolved['behavior']) => string } = {
    bar: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.bar.state.disabled : undefined,
            behavior.loading ? B.bar.state.loading : undefined,
        ),
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
        utilities.cls(
            behavior.disabled ? B.ctrl.state.disabled : undefined,
            behavior.loading ? B.data.state.loading : undefined,
        ),
    fb: (behavior) => utilities.cls(behavior.disabled ? B.ctrl.state.disabled : undefined),
    menu: (behavior) =>
        utilities.cls(
            behavior.disabled ? B.menu.state.disabled : undefined,
            behavior.loading ? B.menu.state.loading : undefined,
        ),
    nav: (behavior) => utilities.cls(behavior.disabled ? B.nav.state.disabled : undefined),
    ov: (behavior) =>
        utilities.cls(
            behavior.disabled ? 'pointer-events-none' : undefined,
            behavior.loading ? B.ctrl.state.loading : undefined,
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

const placementMap = {
    bottom: 'bottom',
    left: 'left',
    right: 'right',
    top: 'top',
} as const satisfies Record<TooltipSide, Placement>;

/** Floating UI positioning hook with flip/shift collision handling. Grounding: offset -> flip -> shift middleware order. */
const useTooltipPosition = (isOpen: boolean, side: TooltipSide = 'top', offsetPx = 8): TooltipPositionResult => {
    const { refs, floatingStyles, placement } = useFloating({
        middleware: [offset(offsetPx), flip(), shift({ padding: 8 })],
        open: isOpen,
        placement: placementMap[side],
        whileElementsMounted: autoUpdate,
    });
    return { floatingStyles, placement, refs };
};

/** Unified tooltip class string using B.ov.tooltip infrastructure. */
const tooltipCls = twMerge(
    clsx(B.ov.tooltip.base, B.ov.tooltip.var.px, B.ov.tooltip.var.py, B.ov.tooltip.var.bg, B.ov.tooltip.var.text),
);

/** Unified tooltip state hook combining React Aria state/accessibility with Floating UI positioning. */
const useTooltipState = (
    triggerRef: RefObject<HTMLElement | null>,
    options: TooltipStateOptions = {},
): TooltipState => {
    const { content, side = 'top', isDisabled = false, offsetPx = 8 } = options;
    const hasContent = !!content;
    const state = useTooltipTriggerState({ delay: B.algo.tooltipDelayMs, isDisabled: isDisabled || !hasContent });
    const { triggerProps, tooltipProps: ariaProps } = useTooltipTrigger({ isDisabled: !hasContent }, state, triggerRef);
    const { tooltipProps } = useTooltip({}, state);
    const position = useTooltipPosition(state.isOpen, side, offsetPx);
    return {
        content,
        isOpen: state.isOpen && hasContent,
        tooltipAriaProps: { ...tooltipProps, ...ariaProps },
        triggerProps,
        ...position,
    };
};

/** Render tooltip portal to document.body with Floating UI positioning. */
const renderTooltipPortal = (tooltip: TooltipState): ReactNode =>
    tooltip.isOpen && tooltip.content
        ? createPortal(
              createElement(
                  'div',
                  {
                      ...tooltip.tooltipAriaProps,
                      className: tooltipCls,
                      ref: tooltip.refs.setFloating,
                      style: tooltip.floatingStyles,
                  },
                  tooltip.content,
              ),
              document.body,
          )
        : null;

// --- [ENTRY_POINT] -----------------------------------------------------------

const resolve = <K extends SchemaKey>(key: K, input?: Inputs[K]): Resolved[K] =>
    S.decodeUnknownSync(Schemas[key] as unknown as S.Schema<Resolved[K], Inputs[K]>)(input ?? {});

type TuningConfig = { readonly [K in SchemaKey]?: Inputs[K] | undefined };
type TuningKey = keyof TuningConfig;
const TUNING_KEYS = {
    bar: ['behavior', 'scale'],
    cmd: ['animation', 'behavior', 'overlay', 'scale'],
    ctrl: ['behavior', 'scale'],
    data: ['behavior', 'scale'],
    el: ['behavior', 'scale'],
    fb: ['animation', 'feedback', 'scale'],
    menu: ['animation', 'behavior', 'overlay', 'scale'],
    nav: ['animation', 'behavior', 'scale'],
    ov: ['animation', 'overlay', 'scale'],
    util: ['scale'],
} as const satisfies Record<string, ReadonlyArray<SchemaKey>>;
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
    computeOffsetPx,
    createBuilderContext,
    FeedbackSchema,
    merged,
    OverlaySchema,
    pick,
    renderTooltipPortal,
    resolve,
    ScaleSchema,
    stateCls,
    tooltipCls,
    TUNING_KEYS,
    useCollectionEl,
    useForwardedRef,
    useTooltipPosition,
    useTooltipState,
    utilities,
};
export type {
    CollectionElResult,
    Computed,
    Inputs,
    Resolved,
    ResolvedContext,
    SchemaKey,
    TooltipPositionResult,
    TooltipSide,
    TooltipState,
    TooltipStateOptions,
    TuningConfig,
    TuningFor,
};
