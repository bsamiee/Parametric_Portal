/**
 * Core utilities: CSS class merging, RAC render-props composition, slot resolution.
 * SlotInput accepts LucideIcon, ReactElement, or SlotDef for async-aware rendering.
 */

import { AsyncState } from '@parametric-portal/types/async';
import { type ClassValue, clsx } from 'clsx';
import { Match, Option, pipe, Predicate } from 'effect';
import type { LucideIcon } from 'lucide-react';
import { cloneElement, createElement, isValidElement, useLayoutEffect, useState, type ReactElement, type ReactNode } from 'react';
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
type BadgeValue = { readonly current: number; readonly max?: number };

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	badgeCap: '+',
	badgeRadix: 10,
	badgeZero: 0,
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const cn = (...inputs: readonly ClassValue[]): string => twMerge(clsx(inputs));
const composeTailwindRenderProps = <T,>(className: RenderPropsClassName<T>, tailwind: ClassNameValue): ((value: T) => string) | string => composeRenderProps(className, (prev) => twMerge(tailwind, prev));
const isExternalHref = (href: string | undefined): boolean => href?.startsWith('http') ? !(globalThis.location && href.startsWith(globalThis.location.origin)) : false;
/** Filter object to entries where value is not undefined. Optional mapper transforms values. */
function defined<T extends Record<string, unknown>>(obj: T): { [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined> };
function defined<T extends Record<string, unknown>, R>(obj: T, map: (v: Exclude<T[keyof T], undefined>) => R): { [K in keyof T as T[K] extends undefined ? never : K]: R };
function defined<T extends Record<string, unknown>, R>(obj: T, map?: (value: Exclude<T[keyof T], undefined>) => R) {
	return Object.fromEntries(
		Object.entries(obj)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, map ? map(value as Exclude<T[keyof T], undefined>) : value]),
	) as never;
}
const badgeLabel = (value: BadgeValue | undefined, cssVar: string): string | null =>
	value === undefined
		? null
		: (() => {
			const root = globalThis.document?.documentElement;
			const raw = root ? getComputedStyle(root).getPropertyValue(cssVar).trim() : '';
			const parsed = Number.parseInt(raw, _B.badgeRadix);
			const cssMax = Number.isNaN(parsed) ? _B.badgeZero : parsed;
			const max = value.max ?? (cssMax > _B.badgeZero ? cssMax : undefined);
			return max !== undefined && value.current > max ? `${max}${_B.badgeCap}` : String(value.current);
		})();

// --- [SLOT] ------------------------------------------------------------------

const isLucide = (value: unknown): value is LucideIcon =>
	value != null &&
	((typeof value === 'function' &&
		typeof (value as { displayName?: unknown }).displayName === 'string' &&
		typeof (value as { render?: unknown }).render === 'function') ||
	(typeof value === 'object' &&
		(value as { $$typeof?: symbol }).$$typeof === Symbol['for']('react.forward_ref') &&
		typeof (value as { render?: unknown }).render === 'function'));
const isSlotDef = <T extends Renderable>(value: unknown): value is SlotDef<T> =>
	value != null &&
	typeof value === 'object' &&
	!isValidElement(value) &&
	!isLucide(value) &&
	('default' in value || 'idle' in value || 'loading' in value || 'success' in value || 'failure' in value);
const normalize = <T extends Renderable>(input: SlotInput<T> | undefined): SlotDef<T> | undefined =>
    pipe(Option.fromNullable(input), Option.map((val) => isSlotDef<T>(val) ? val : { default: val } as SlotDef<T>), Option.getOrUndefined);
const content = (slotContent: Renderable | null | undefined, className?: string): ReactNode =>
	Match.value(slotContent).pipe(
		Match.when(Predicate.isNullable, () => null),
		Match.when(isLucide, (Icon) => createElement(Icon, { className })),
		Match.when(isValidElement<{ className?: string }>, (element) => cloneElement(element, { className: cn(element.props.className, className) })),
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
		pending: state != null && AsyncState.$is('Loading')(state),
		render: (input: SlotInput | undefined, className?: string) => render(input, state, className),
		resolve: <T extends Renderable>(input: SlotInput<T> | undefined) => resolve(input, state),
	});
const Slot = Object.freeze({ bind, content, isSlotDef, normalize, render, resolve });

// --- [HOOKS] -----------------------------------------------------------------

const useBadgeLabel = (value: BadgeValue | undefined, cssVar: string): string | null => {
	const [label, setLabel] = useState<string | null>(() => badgeLabel(value, cssVar));
	useLayoutEffect(() => {
		const next = badgeLabel(value, cssVar);
		setLabel((prev) => (prev === next ? prev : next));
	}, [value, cssVar]);
	return label;
};
const Badge = Object.freeze({ useLabel: useBadgeLabel });

// --- [EXPORT] ----------------------------------------------------------------

export { Badge, cn, composeTailwindRenderProps, defined, isExternalHref, Slot };
export type { BadgeValue, SlotDef, SlotInput };
