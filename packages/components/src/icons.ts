import type { LucideIcon, LucideProps } from 'lucide-react';
import { icons } from 'lucide-react';
import type { CSSProperties, ForwardedRef, SVGAttributes } from 'react';
import { createElement, forwardRef, memo, useMemo } from 'react';
import type { Inputs } from './schema.ts';
import { fn, merged, resolve } from './schema.ts';

// --- Type Definitions -------------------------------------------------------
// Icons has unique strokeWidth tuning (primitive, not schema-based)
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

// --- Constants --------------------------------------------------------------

const iconNames = Object.freeze(Object.keys(icons) as ReadonlyArray<IconName>);
const getIcon = (name: IconName): LucideIcon => icons[name];

// --- Component Factory ------------------------------------------------------

const createIcon = (i: IconInput) => {
    const Icon = getIcon(i.name);
    const Comp = forwardRef((props: IconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const { className, scale: ps, strokeWidth: sw, style, ...rest } = props;
        const { size, stroke } = useMemo(() => {
            const base = i.scale ?? {};
            const props = ps ?? {};
            const s = resolve('scale', { ...base, ...props });
            const c = fn.computeScale(s);
            return { size: c.iconSize, stroke: sw ?? i.strokeWidth ?? fn.strokeWidth(s.scale) };
        }, [ps, sw, i.scale, i.strokeWidth]);
        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined,
            className: fn.cls('inline-block flex-shrink-0', i.className, className),
            height: size,
            ref,
            strokeWidth: stroke,
            style: { '--icon-size': size, ...style } as CSSProperties,
            width: size,
        };
        return createElement(Icon, iconProps);
    });
    Comp.displayName = `Icon(${i.name})`;
    return memo(Comp);
};

const DynamicIcon = memo(
    forwardRef((props: DynamicIconProps, ref: ForwardedRef<SVGSVGElement>) => {
        const { className, name, scale: ps, strokeWidth: sw, style, ...rest } = props;
        const Icon = getIcon(name);
        const { size, stroke } = useMemo(() => {
            const s = resolve('scale', ps);
            const c = fn.computeScale(s);
            return { size: c.iconSize, stroke: sw ?? fn.strokeWidth(s.scale) };
        }, [ps, sw]);
        const iconProps: LucideProps = {
            ...rest,
            'aria-hidden': rest['aria-label'] === undefined,
            className: fn.cls('inline-block flex-shrink-0', className),
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

// --- Factory ----------------------------------------------------------------

const createIcons = (tuning?: IconTuning) =>
    Object.freeze({
        create: (i: IconInput) =>
            createIcon({
                ...i,
                ...merged(tuning, i, ['scale']),
                ...((i.strokeWidth ?? tuning?.strokeWidth)
                    ? { strokeWidth: i.strokeWidth ?? tuning?.strokeWidth }
                    : {}),
            }),
        get: getIcon,
        Icon: DynamicIcon,
        names: iconNames,
    });

// --- Export -----------------------------------------------------------------

export { createIcons, iconNames };
export type { DynamicIconProps, IconInput, IconName, IconProps };
