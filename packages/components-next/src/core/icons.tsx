/**
 * Wrap Lucide icons with CSS variable slots for sizing/animation.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import type { FC } from 'react';
import { cn } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type IconProps = Omit<LucideProps, 'size'> & {
    readonly icon: LucideIcon;
    readonly sizeClass?: string;
    readonly animationClass?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const DEFAULT_SIZE_CLASS = 'size-(--icon-size)';

// --- [COMPONENTS] ------------------------------------------------------------

const Icon: FC<IconProps> = ({
    icon: IconComponent,
    sizeClass = DEFAULT_SIZE_CLASS,
    animationClass,
    className,
    ...props
}) => <IconComponent {...props} className={cn(sizeClass, animationClass, className)} />;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isLucideIcon = (value: unknown): value is LucideIcon => typeof value === 'function' && 'displayName' in value;

// --- [EXPORT] ----------------------------------------------------------------

export { DEFAULT_SIZE_CLASS, Icon, isLucideIcon };
export type { IconProps };
