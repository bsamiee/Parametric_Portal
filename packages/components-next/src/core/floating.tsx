/**
 * Tooltip hook with @floating-ui/react integration and delay group coordination.
 * CSS variable driven defaults in B constant; props override for escape hatch.
 */
import {
    arrow, autoUpdate, flip, hide, offset, type Placement, safePolygon, shift, type Strategy, FloatingArrow, FloatingNode, FloatingPortal,
    useClick, useDelayGroup, useDismiss, useFloating, useFloatingNodeId, useFocus, useHover, useInteractions, useMergeRefs, useRole, useTransitionStatus,
} from '@floating-ui/react';
import { readCssMs, readCssPx, readCssVar } from '@parametric-portal/runtime/runtime';
import type { ReactNode, Ref, RefObject } from 'react';
import { useId, useMemo, useRef, useState } from 'react';
import { cn, defined } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type ArrowConfig = {
    readonly color?: string; readonly d?: string; readonly height?: number | string; readonly staticOffset?: number | string;
    readonly stroke?: string; readonly strokeWidth?: number; readonly tipRadius?: number; readonly width?: number | string;
};
type TooltipConfig = {
    readonly anchor?: RefObject<HTMLElement | null>;
    readonly arrow?: ArrowConfig;
    readonly arrowPadding?: number;
    readonly boundary?: Element | 'clippingAncestors';
    readonly content: ReactNode;
    readonly delay?: { readonly close?: number; readonly open?: number };
    readonly fallbackPlacements?: readonly Placement[];
    readonly interactions?: { readonly click?: boolean; readonly dismissOnEscape?: boolean; readonly dismissOnOutsidePress?: boolean; };
    readonly offset?: number;
    readonly onOpenChange?: (open: boolean) => void;
    readonly open?: boolean;
    readonly placement?: Placement;
    readonly portalRoot?: HTMLElement | null;
    readonly shiftPadding?: number;
    readonly strategy?: Strategy;
    readonly style?: string;
    readonly transitionDuration?: number;
};
type TooltipResult<P extends object = object> = {
    readonly isOpen: boolean;
    readonly props: P & { readonly ref: Ref<HTMLElement> };
    readonly ref: RefObject<HTMLElement | null>;
    readonly render: (() => ReactNode) | null;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    behavior: {
        placement: 'top' as Placement,
        strategy: 'absolute' as Strategy,
    },
    cssVars: {
        arrowPadding: '--tooltip-arrow-padding',
        arrowPath: '--tooltip-arrow-path',
        arrowTipRadius: '--tooltip-arrow-tip-radius',
        boundary: '--tooltip-boundary',
        offset: '--tooltip-offset',
        shiftPadding: '--tooltip-shift-padding',
        transitionDuration: '--tooltip-transition-duration',
    },
    defaults: {
        arrowPadding: 4,
        offset: 8,
        shiftPadding: 10,
        transitionDuration: 200,
    },
    slot: {
        arrow: cn(
            'fill-(--tooltip-arrow-color)',
            '[width:var(--tooltip-arrow-width)]',
            '[height:var(--tooltip-arrow-height)]',
            '[stroke:var(--tooltip-arrow-stroke)]',
            '[stroke-width:var(--tooltip-arrow-stroke-width)]',
        ),
        content: cn(
            'bg-(--tooltip-bg) text-(--tooltip-fg)',
            'rounded-(--tooltip-radius) shadow-(--tooltip-shadow)',
            'border-(--tooltip-border-width) border-(--tooltip-border-color)',
            'px-(--tooltip-padding-x) py-(--tooltip-padding-y)',
            'text-(--tooltip-font-size) max-w-(--tooltip-max-width)',
            'z-(--tooltip-z-index)',
            '[transition-property:opacity,transform]',
            'duration-(--tooltip-transition-duration)',
            'ease-(--tooltip-transition-easing)',
        ),
    },
} as const;

// --- [HOOK] ------------------------------------------------------------------

const useTooltip = <P extends object = object>( config: TooltipConfig | undefined, baseRef?: Ref<HTMLElement>, baseProps?: P, ): TooltipResult<P> => {
    const id = useId();
    const has = config?.content != null;
    const nodeId = useFloatingNodeId();
    const [internalOpen, setInternalOpen] = useState(false);
    const arrowRef = useRef<SVGSVGElement>(null);
    const resolvedConfig = useMemo(() => ({
        arrowPadding: config?.arrowPadding ?? (readCssPx(_B.cssVars.arrowPadding) || _B.defaults.arrowPadding),
        offset: config?.offset ?? (readCssPx(_B.cssVars.offset) || _B.defaults.offset),
        shiftPadding: config?.shiftPadding ?? (readCssPx(_B.cssVars.shiftPadding) || _B.defaults.shiftPadding),
        transitionDuration: config?.transitionDuration ?? (readCssMs(_B.cssVars.transitionDuration) || _B.defaults.transitionDuration),
    }), [config?.offset, config?.arrowPadding, config?.shiftPadding, config?.transitionDuration]);
    const placement = config?.placement ?? _B.behavior.placement;
    const strategy = config?.strategy ?? _B.behavior.strategy;
    const isOpen = config?.open ?? internalOpen;
    const readBoundary = (): Element | 'clippingAncestors' => {
        const cssValue = globalThis.document?.documentElement
            ? getComputedStyle(globalThis.document.documentElement).getPropertyValue(_B.cssVars.boundary).trim()
            : '';
        return cssValue === 'viewport' ? globalThis.document?.body ?? 'clippingAncestors' : 'clippingAncestors';
    };
    const resolvedBoundary = config?.boundary ?? readBoundary();
    const shiftPad = { padding: resolvedConfig.shiftPadding };
    const middleware = has && [
        offset(resolvedConfig.offset),
        flip({
            ...shiftPad,
            boundary: resolvedBoundary,
            ...(config?.fallbackPlacements && { fallbackPlacements: [...config.fallbackPlacements] }),
        }),
        shift({ ...shiftPad, boundary: resolvedBoundary, crossAxis: true }),
        arrow({ element: arrowRef as RefObject<SVGSVGElement>, padding: resolvedConfig.arrowPadding }),
        hide({ strategy: 'referenceHidden' }),
    ];
    const { context, floatingStyles, refs } = useFloating({
        ...(config?.anchor && { elements: { reference: config.anchor.current } }),
        middleware: middleware || [],
        ...(nodeId && { nodeId }),
        onOpenChange: (open: boolean) => {
            setInternalOpen(open);
            config?.onOpenChange?.(open);
        },
        open: isOpen,
        placement,
        strategy,
        whileElementsMounted: (reference, floating, update) => autoUpdate(reference, floating, update, { ancestorResize: true, ancestorScroll: true, elementResize: true }),
    });
    const { delay: groupDelay, isInstantPhase, currentId } = useDelayGroup(context, { id });
    const { click = false, dismissOnEscape = true, dismissOnOutsidePress = true } = config?.interactions ?? {};
    const hasExternalAnchor = config?.anchor !== undefined;
    const isControlled = config?.open !== undefined;
    const { getFloatingProps, getReferenceProps } = useInteractions([
        useHover(context, { delay: config?.delay ?? groupDelay, enabled: has && !isControlled, handleClose: safePolygon({ blockPointerEvents: true }) }),
        useFocus(context, { enabled: has && !isControlled }),
        useClick(context, { enabled: click && !isControlled }),
        useDismiss(context, { escapeKey: dismissOnEscape, outsidePress: dismissOnOutsidePress }),
        useRole(context, { role: 'tooltip' }),
    ]);
    const dur = has ? resolvedConfig.transitionDuration : 0;
    const instantDur = has ? { close: currentId === context.floatingId ? resolvedConfig.transitionDuration : 0, open: 0 } : 0;
    const { isMounted, status } = useTransitionStatus(context, { duration: isInstantPhase ? instantDur : dur });
    const arrowProps = useMemo(() => {
        const cssPath = readCssVar(_B.cssVars.arrowPath);
        const cssTipRadiusRaw = readCssVar(_B.cssVars.arrowTipRadius);
        const cssTipRadius = cssTipRadiusRaw ? Number.parseFloat(cssTipRadiusRaw) : Number.NaN;
        const cssProps = defined({
            d: cssPath || undefined,
            tipRadius: cssTipRadiusRaw && Number.isFinite(cssTipRadius) ? cssTipRadius : undefined,
        });
        const cssOnlyProps = Object.keys(cssProps).length > 0 ? cssProps : undefined;
        return config?.arrow
            ? (() => {
                  const { height, staticOffset, tipRadius, width, ...rest } = config.arrow;
                  return {
                      ...cssProps,
                      ...defined(rest),
                      ...(width !== undefined && { width: typeof width === 'string' ? Number.parseFloat(width) : width }),
                      ...(height !== undefined && { height: typeof height === 'string' ? Number.parseFloat(height) : height }),
                      ...(tipRadius !== undefined && { tipRadius: typeof tipRadius === 'string' ? Number.parseFloat(tipRadius) : tipRadius }),
                      ...(staticOffset !== undefined && { staticOffset: typeof staticOffset === 'string' ? Number.parseFloat(staticOffset) : staticOffset }),
                  };
              })()
            : cssOnlyProps;
    }, [config?.arrow]);
    const mergedRef = useMergeRefs([baseRef, has && !hasExternalAnchor ? refs.setReference : undefined]);
    const mergedProps = {
        ...(baseProps ?? ({} as P)),
        ...(has && !isControlled && getReferenceProps()),
        ...(has && isOpen && { 'aria-describedby': id }),
        ref: mergedRef,
    } as P & { ref: Ref<HTMLElement> };
    return {
        isOpen: has && isOpen,
        props: mergedProps,
        ref: refs.domReference as RefObject<HTMLElement | null>,
        render: (has && isMounted && (() => (
            <FloatingNode id={nodeId}>
                <FloatingPortal root={config.portalRoot ?? null}>
                    <div
                        {...getFloatingProps()}
                        className={_B.slot.content}
                        data-slot='tooltip'
                        data-status={status}
                        data-style={config.style}
                        id={id}
                        ref={refs.setFloating}
                        style={floatingStyles}
                    >
                        {config.content}
                        <FloatingArrow
                            {...arrowProps}
                            className={_B.slot.arrow}
                            context={context}
                            ref={arrowRef}
                        />
                    </div>
                </FloatingPortal>
            </FloatingNode>
        ))) || null,
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { useTooltip };
export type { TooltipConfig, TooltipResult };
