/**
 * Provide typed utilities for asChild pattern via @radix-ui/react-slot.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cloneElement, type FC, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type AsChildProps<D> = ({ readonly asChild?: false } & D) | { readonly asChild: true; readonly children: ReactNode };
type SlotInput = LucideIcon | ReactNode;
type NamedSlots<T extends string> = { readonly [K in T]?: ReactNode };
type IconRenderProps = Omit<LucideProps, 'ref'> & { readonly className?: string };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isLucideIcon = (v: unknown): v is LucideIcon =>
    typeof v === 'function' && 'displayName' in v && typeof (v as { displayName?: unknown }).displayName === 'string';
const renderSlotContent = (input: SlotInput | undefined, className?: string): ReactNode =>
    input == null
        ? null
        : isLucideIcon(input)
          ? (() => {
                const Icon = input;
                return <Icon className={className} />;
            })()
          : isValidElement(input)
            ? className === undefined
                ? input
                : cloneElement(input as ReactElement<{ className?: string }>, {
                      className: cn((input as ReactElement<{ className?: string }>).props.className, className),
                  })
            : (input as ReactNode);
const createIconRenderer = (cls: string) => (input: SlotInput | undefined): ReactNode => renderSlotContent(input, cls);

// --- [COMPONENTS] ------------------------------------------------------------

const SlotWrapper: FC<{
    readonly input: SlotInput | undefined;
    readonly className?: string;
    readonly 'data-slot'?: string;
}> = ({ input, className, 'data-slot': ds }) =>
    input == null ? null : isLucideIcon(input) ? (
        (() => {
            const Icon = input;
            return <Icon className={className} data-slot={ds} />;
        })()
    ) : isValidElement(input) ? (
        cloneElement(
            input as ReactElement<{ className?: string; 'data-slot'?: string }>,
            ds === undefined
                ? { className: cn((input as ReactElement<{ className?: string }>).props.className, className) }
                : {
                      className: cn((input as ReactElement<{ className?: string }>).props.className, className),
                      'data-slot': ds,
                  },
        )
    ) : (
        <span className={className} data-slot={ds}>
            {input}
        </span>
    );

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/performance/noBarrelFile: Re-exporting core slot primitives is intentional API surface
export { Slot, type SlotProps, Slottable } from '@radix-ui/react-slot';
export { createIconRenderer, isLucideIcon, renderSlotContent, SlotWrapper };
export type { AsChildProps, IconRenderProps, NamedSlots, SlotInput };
