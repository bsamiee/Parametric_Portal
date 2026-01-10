/**
 * Core utilities for component development.
 * CSS class merging, RAC render-props composition, slot resolution and rendering.
 * SlotInput accepts raw values (LucideIcon, ReactElement) OR SlotDef for async-aware slots.
 * SlotDef keys map 1:1 to AsyncState._tag values (Idle, Loading, Success, Failure).
 */

import { AsyncState } from '@parametric-portal/types/async';
import { type ClassValue, clsx } from 'clsx';
import { Match, Option, pipe, Predicate } from 'effect';
import type { LucideIcon } from 'lucide-react';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { composeRenderProps } from 'react-aria-components';
import { type ClassNameValue, twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type Renderable = LucideIcon | ReactElement | ReactNode;
type SlotInput<T extends Renderable = Renderable> = T | SlotDef<T>;
type RenderPropsClassName<T> = ((state: T) => string) | string | undefined;
type SlotDef<T extends Renderable = Renderable> = {
	readonly default?: T;
	readonly idle?: T;
	readonly loading?: T;
	readonly success?: T;
	readonly failure?: T;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs));
const composeTailwindRenderProps = <T,>(cls: RenderPropsClassName<T>, tw: ClassNameValue): ((v: T) => string) | string => composeRenderProps(cls, (prev) => twMerge(tw, prev));
const isExternalHref = (href: string | undefined): boolean => href?.startsWith('http') ? !(globalThis.location && href.startsWith(globalThis.location.origin)) : false;
/** Filter object to entries where value is not undefined. Optional mapper transforms values. */
function defined<T extends Record<string, unknown>>(obj: T): { [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined> };
function defined<T extends Record<string, unknown>, R>(obj: T, map: (v: Exclude<T[keyof T], undefined>) => R): { [K in keyof T as T[K] extends undefined ? never : K]: R };
function defined<T extends Record<string, unknown>, R>(obj: T, map?: (v: Exclude<T[keyof T], undefined>) => R) {
	return Object.fromEntries(
		Object.entries(obj)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [k, map ? map(v as Exclude<T[keyof T], undefined>) : v]),
	) as never;
}

// --- [SLOT] ------------------------------------------------------------------

const isLucide = (v: unknown): v is LucideIcon =>
	v != null &&
	((typeof v === 'function' &&
		typeof (v as { displayName?: unknown }).displayName === 'string' &&
		typeof (v as { render?: unknown }).render === 'function') ||
	(typeof v === 'object' &&
		(v as { $$typeof?: symbol }).$$typeof === Symbol['for']('react.forward_ref') &&
		typeof (v as { render?: unknown }).render === 'function'));
const isSlotDef = <T extends Renderable>(v: unknown): v is SlotDef<T> =>
	v != null &&
	typeof v === 'object' &&
	!isValidElement(v) &&
	!isLucide(v) &&
	('default' in v || 'idle' in v || 'loading' in v || 'success' in v || 'failure' in v);
const normalize = <T extends Renderable>(input: SlotInput<T> | undefined): SlotDef<T> | undefined =>
    pipe(Option.fromNullable(input), Option.map((v) => isSlotDef<T>(v) ? v : { default: v } as SlotDef<T>), Option.getOrUndefined);
const content = (slotContent: Renderable | null | undefined, className?: string): ReactNode =>
	Match.value(slotContent).pipe(
		Match.when(Predicate.isNullable, () => null),
		Match.when(isLucide, (Icon) => createElement(Icon, { className })),
		Match.when(isValidElement<{ className?: string }>, (el) => cloneElement(el, { className: cn(el.props.className, className) })),
		Match.orElse((node) => node),
	);
const resolve = <T extends Renderable>(
	input: SlotInput<T> | undefined,
	state: AsyncState<unknown, unknown> | undefined, ): T | undefined => {
	const def = normalize(input);
	const key = (state?._tag.toLowerCase() ?? 'default') as keyof SlotDef;
	return def ? (def[key] ?? def.default) : undefined;
};
const render = (
	input: SlotInput | undefined,
	state: AsyncState<unknown, unknown> | undefined,
	className?: string,
): ReactNode => content(resolve(input, state), className);
const bind = (state: AsyncState<unknown, unknown> | undefined) =>
	Object.freeze({
		attr: AsyncState.toAttr(state),
		content,
		pending: AsyncState.isPending(state),
		render: (input: SlotInput | undefined, className?: string) => render(input, state, className),
		resolve: <T extends Renderable>(input: SlotInput<T> | undefined) => resolve(input, state),
	});
const Slot = Object.freeze({ bind, content, isSlotDef, normalize, render, resolve });

// --- [EXPORT] ----------------------------------------------------------------

export { cn, composeTailwindRenderProps, defined, isExternalHref, Slot };
export type { SlotDef, SlotInput };
