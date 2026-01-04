/**
 * Polymorphic factory for semantic layout containers.
 * Scope: article, aside, div, footer, header, main, nav, section.
 * Interactive elements (buttons, links, inputs) use RAC instead.
 */
import { type ComponentPropsWithoutRef, createElement, type ReactElement, type Ref } from 'react';
import { cn } from './css-slots';

// --- [TYPES] -----------------------------------------------------------------

type LayoutTag = 'article' | 'aside' | 'div' | 'footer' | 'header' | 'main' | 'nav' | 'section';
type LayoutProps<T extends LayoutTag, P extends object = object> = P &
    Omit<ComponentPropsWithoutRef<T>, keyof P | 'as' | 'ref'> & {
        readonly as?: T | undefined;
        readonly className?: string | undefined;
        readonly ref?: Ref<HTMLElementTagNameMap[T]> | undefined;
    };
type LayoutFactory<D extends LayoutTag, P extends object = object> = <T extends LayoutTag = D>(
    props: LayoutProps<T, P>,
) => ReactElement | null;

// --- [FACTORY] ---------------------------------------------------------------

const createLayout =
    <D extends LayoutTag, P extends object = object>(tag: D, base?: string): LayoutFactory<D, P> =>
    <T extends LayoutTag = D>({ as, ref, className, ...rest }: LayoutProps<T, P>) =>
        createElement(as ?? tag, { ...rest, className: cn(base, className), ref });

// --- [EXPORT] ----------------------------------------------------------------

export { createLayout };
export type { LayoutFactory, LayoutProps, LayoutTag };
