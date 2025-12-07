/**
 * Icon components: render Lucide icons with scale and strokeWidth tuning.
 * Uses utilities, resolve from schema.ts with memoized dynamic icon loading.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';
import type { CSSProperties, ForwardedRef, SVGAttributes } from 'react';
import { createElement, forwardRef, memo, useMemo } from 'react';
import type { Inputs } from './schema.ts';
import { merged, resolve, utilities } from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type IconTuning = { readonly scale?: Inputs['scale'] | undefined; readonly strokeWidth?: number | undefined };
type IconName = keyof typeof icons;
type IconProps = SVGAttributes<SVGElement> & {
    readonly scale?: Inputs['scale'] | undefined;
    readonly strokeWidth?: number;
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
        const { className, scale: propScale, strokeWidth: propStrokeWidth, style, ...rest } = props;
        const { size, stroke } = useMemo(() => {
            const base = input.scale ?? {};
            const scaleProps = propScale ?? {};
            const scale = resolve('scale', { ...base, ...scaleProps });
            const computed = utilities.computeScale(scale);
            return {
                size: computed.iconSize,
                stroke: propStrokeWidth ?? input.strokeWidth ?? utilities.strokeWidth(scale.scale),
            };
        }, [propScale, propStrokeWidth, input.scale, input.strokeWidth]);
        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined,
            className: utilities.cls('inline-block flex-shrink-0', input.className, className),
            height: size,
            ref,
            strokeWidth: stroke,
            style: { '--icon-size': size, ...style } as CSSProperties,
            width: size,
        };
        return createElement(Icon, iconProps);
    });
    Component.displayName = `Icon(${input.name})`;
    return memo(Component);
};

const DynamicIcon = memo(
    forwardRef((props: DynamicIconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const { className, name, scale: propScale, strokeWidth: propStrokeWidth, style, ...rest } = props;
        const Icon = getIcon(name);
        const { size, stroke } = useMemo(() => {
            const scale = resolve('scale', propScale);
            const computed = utilities.computeScale(scale);
            return { size: computed.iconSize, stroke: propStrokeWidth ?? utilities.strokeWidth(scale.scale) };
        }, [propScale, propStrokeWidth]);
        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined,
            className: utilities.cls('inline-block flex-shrink-0', className),
            height: size,
            ref,
            strokeWidth: stroke,
            style: { '--icon-size': size, ...style } as CSSProperties,
            width: size,
        };
        return createElement(Icon, iconProps);
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
