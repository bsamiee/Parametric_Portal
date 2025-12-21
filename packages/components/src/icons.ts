/**
 * Icon components: render Lucide icons with scale and strokeWidth tuning.
 * Uses utilities, resolve from schema.ts with memoized dynamic icon loading.
 * Tooltips use unified useTooltipState + renderTooltipPortal from schema.ts.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';
import type { CSSProperties, ForwardedRef, SVGAttributes } from 'react';
import { createElement, forwardRef, memo, useMemo, useRef } from 'react';
import type { Inputs, TooltipSide } from './schema.ts';
import { B, computeOffsetPx, merged, renderTooltipPortal, resolve, useTooltipState, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type IconTuning = { readonly scale?: Inputs['scale'] | undefined; readonly strokeWidth?: number | undefined };
type IconName = keyof typeof icons;
type IconProps = SVGAttributes<SVGElement> &
    IconTuning & {
        readonly tooltip?: string | undefined;
        readonly tooltipSide?: TooltipSide | undefined;
    };
type IconInput = {
    readonly className?: string;
    readonly name: IconName;
    readonly scale?: Inputs['scale'] | undefined;
    readonly strokeWidth?: number | undefined;
};
type DynamicIconProps = IconProps & { readonly name: IconName };

// --- [CONSTANTS] -------------------------------------------------------------

const iconNames = Object.freeze(Object.keys(icons) as ReadonlyArray<IconName>);
const getIcon = (name: IconName): LucideIcon => icons[name];

const createIconComponent = (input: IconInput) => {
    const Icon = getIcon(input.name);
    const Component = forwardRef((props: IconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const {
            className,
            scale: propScale,
            strokeWidth: propStrokeWidth,
            style,
            tooltip,
            tooltipSide = 'top',
            ...rest
        } = props;
        const wrapperRef = useRef<HTMLSpanElement>(null);
        const { size, stroke, scale } = useMemo(() => {
            const base = input.scale ?? {};
            const scaleProps = propScale ?? {};
            const resolvedScale = resolve('scale', { ...base, ...scaleProps });
            const computed = utilities.computeScale(resolvedScale);
            return {
                scale: resolvedScale,
                size: computed.iconSize,
                stroke: propStrokeWidth ?? input.strokeWidth ?? utilities.strokeWidth(resolvedScale.scale),
            };
        }, [propScale, propStrokeWidth, input.scale, input.strokeWidth]);

        const tooltipOffsetPx = computeOffsetPx(scale, B.algo.tooltipOffMul);
        const tooltipState = useTooltipState(wrapperRef, {
            ...(tooltip !== undefined && { content: tooltip }),
            offsetPx: tooltipOffsetPx,
            side: tooltipSide,
        });

        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined && !tooltip,
            className: utilities.cls('inline-block flex-shrink-0', input.className, className),
            height: size,
            ref,
            strokeWidth: stroke,
            style: { '--icon-size': size, ...style } as CSSProperties,
            width: size,
        };

        const iconEl = createElement(Icon, iconProps);

        return tooltip
            ? createElement(
                  'span',
                  {
                      ...tooltipState.triggerProps,
                      className: 'inline-flex',
                      ref: (node: HTMLSpanElement | null) => {
                          (wrapperRef as { current: HTMLSpanElement | null }).current = node;
                          tooltipState.refs.setReference(node);
                      },
                  },
                  iconEl,
                  renderTooltipPortal(tooltipState),
              )
            : iconEl;
    });
    Component.displayName = `Icon(${input.name})`;
    return memo(Component);
};

const DynamicIcon = memo(
    forwardRef((props: DynamicIconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const {
            className,
            name,
            scale: propScale,
            strokeWidth: propStrokeWidth,
            style,
            tooltip,
            tooltipSide = 'top',
            ...rest
        } = props;
        const wrapperRef = useRef<HTMLSpanElement>(null);
        const Icon = getIcon(name);
        const { size, stroke, scale } = useMemo(() => {
            const resolvedScale = resolve('scale', propScale);
            const computed = utilities.computeScale(resolvedScale);
            return {
                scale: resolvedScale,
                size: computed.iconSize,
                stroke: propStrokeWidth ?? utilities.strokeWidth(resolvedScale.scale),
            };
        }, [propScale, propStrokeWidth]);

        const tooltipOffsetPx = computeOffsetPx(scale, B.algo.tooltipOffMul);
        const tooltipState = useTooltipState(wrapperRef, {
            ...(tooltip !== undefined && { content: tooltip }),
            offsetPx: tooltipOffsetPx,
            side: tooltipSide,
        });

        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined && !tooltip,
            className: utilities.cls('inline-block flex-shrink-0', className),
            height: size,
            ref,
            strokeWidth: stroke,
            style: { '--icon-size': size, ...style } as CSSProperties,
            width: size,
        };

        const iconEl = createElement(Icon, iconProps);

        return tooltip
            ? createElement(
                  'span',
                  {
                      ...tooltipState.triggerProps,
                      className: 'inline-flex',
                      ref: (node: HTMLSpanElement | null) => {
                          (wrapperRef as { current: HTMLSpanElement | null }).current = node;
                          tooltipState.refs.setReference(node);
                      },
                  },
                  iconEl,
                  renderTooltipPortal(tooltipState),
              )
            : iconEl;
    }),
);
DynamicIcon.displayName = 'DynamicIcon';

// --- [ENTRY_POINT] -----------------------------------------------------------

const createIcons = (tuning?: IconTuning) =>
    Object.freeze({
        create: (input: IconInput) =>
            createIconComponent({
                ...input,
                ...merged(tuning, input, ['scale']),
                ...((input.strokeWidth ?? tuning?.strokeWidth)
                    ? { strokeWidth: input.strokeWidth ?? tuning?.strokeWidth }
                    : {}),
            }),
        get: getIcon,
        Icon: DynamicIcon,
        names: iconNames,
    });

// --- [EXPORT] ----------------------------------------------------------------

export { createIcons, iconNames };
export type { DynamicIconProps, IconInput, IconName, IconProps };
