/**
 * Slot utilities for icon/content injection in components.
 * Detects LucideIcon vs ReactNode; applies className accordingly.
 * Includes async-aware slot derivation for stateful components.
 */

import { AsyncState } from '@parametric-portal/types/async';
import { Match, Predicate } from 'effect';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { cn } from './css-slots';

// --- [TYPES] -----------------------------------------------------------------

type SlotInput = LucideIcon | ReactNode;
type NamedSlots<T extends string> = { readonly [K in T]?: ReactNode };
type IconRenderProps = Omit<LucideProps, 'ref'> & { readonly className?: string };
type AsyncSlotConfig<T = SlotInput> = {
	readonly idle?: T;
	readonly loading?: T;
	readonly success?: T;
	readonly failure?: T;
};

// --- [CONSTANTS] -------------------------------------------------------------

const FORWARD_REF_SYMBOL = Symbol['for']('react.forward_ref');

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isLucideIcon = (v: unknown): v is LucideIcon =>
	v != null &&
	typeof v === 'object' &&
	(v as { $$typeof?: symbol }).$$typeof === FORWARD_REF_SYMBOL &&
	'displayName' in v;
const renderSlotContent = (input: SlotInput | undefined, className?: string): ReactNode =>
	Match.type<SlotInput | undefined>().pipe(
		Match.when(Predicate.isNullable, () => null),
		Match.when(isLucideIcon, (Icon) => createElement(Icon, { className })),
		Match.when(isValidElement, (el) => cloneElement(el as ReactElement<{ className?: string }>, {
			className: cn((el as ReactElement<{ className?: string }>).props.className, className),
		})),
		Match.orElse((v) => v as ReactNode),
	)(input);
const deriveAsyncSlot = <T,>(
	defaultSlot: T | undefined,
	asyncConfig: AsyncSlotConfig<T> | undefined,
	asyncState: AsyncState<unknown, unknown> | undefined,
): T | undefined =>
	asyncConfig == null || asyncState == null
		? defaultSlot
		: (AsyncState.$match(asyncState, {
				Failure: () => asyncConfig.failure ?? defaultSlot,
				Idle: () => asyncConfig.idle ?? defaultSlot,
				Loading: () => asyncConfig.loading ?? defaultSlot,
				Success: () => asyncConfig.success ?? defaultSlot,
			}) as T | undefined);

// --- [EXPORT] ----------------------------------------------------------------

export { deriveAsyncSlot, isLucideIcon, renderSlotContent };
export type { AsyncSlotConfig, IconRenderProps, NamedSlots, SlotInput };
