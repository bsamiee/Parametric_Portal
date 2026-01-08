/**
 * Core utilities for component development.
 * CSS class merging, RAC render-props composition, slot resolution and rendering.
 */

import { AsyncState } from '@parametric-portal/types/async';
import { type ClassValue, clsx } from 'clsx';
import { Match, Predicate } from 'effect';
import type { LucideIcon } from 'lucide-react';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { composeRenderProps } from 'react-aria-components';
import { type ClassNameValue, twMerge } from 'tailwind-merge';

// --- [TYPES] -----------------------------------------------------------------

type RenderPropsClassName<T> = ((state: T) => string) | string | undefined;
type Renderable = LucideIcon | ReactElement | ReactNode;
type SlotDef<T extends Renderable = Renderable> = {
	readonly default?: T;
	readonly idle?: T;
	readonly loading?: T;
	readonly success?: T;
	readonly failure?: T;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs));
const composeTailwindRenderProps = <T,>(cls: RenderPropsClassName<T>, tw: ClassNameValue): ((v: T) => string) | string =>
	composeRenderProps(cls, (prev) => twMerge(tw, prev));
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
	typeof v === 'function' &&
	typeof (v as { displayName?: unknown }).displayName === 'string' &&
	typeof (v as { render?: unknown }).render === 'function';

const resolve = <T extends Renderable>(
	def: SlotDef<T> | undefined,
	state: AsyncState<unknown, unknown> | undefined,
): T | undefined => {
	const key = (state?._tag.toLowerCase() ?? 'default') as keyof SlotDef;
	return def === undefined ? undefined : (def[key] ?? def.default);
};

const content = (slotContent: Renderable | null | undefined, className?: string): ReactNode =>
	Match.value(slotContent).pipe(
		Match.when(Predicate.isNullable, () => null),
		Match.when(isLucide, (Icon) => createElement(Icon, { className })),
		Match.when(isValidElement<{ className?: string }>, (el) => cloneElement(el, { className: cn(el.props.className, className) })),
		Match.orElse((node) => node),
	);

const render = (
	def: SlotDef | undefined,
	state: AsyncState<unknown, unknown> | undefined,
	className?: string,
): ReactNode => content(resolve(def, state), className);

const bind = (state: AsyncState<unknown, unknown> | undefined) =>
	Object.freeze({
		attr: AsyncState.toAttr(state),
		content,
		pending: AsyncState.isPending(state),
		render: (def: SlotDef | undefined, className?: string) => render(def, state, className),
		resolve: <T extends Renderable>(def: SlotDef<T> | undefined) => resolve(def, state),
	});

/** Slot namespace for resolving and rendering async-aware slot content */
const Slot = Object.freeze({ bind, content, render, resolve });

// --- [EXPORT] ----------------------------------------------------------------

export { cn, composeTailwindRenderProps, defined, Slot };
export type { RenderPropsClassName, SlotDef };
