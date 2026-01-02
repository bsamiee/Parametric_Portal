/** Exclusive prop utilities for controlled/uncontrolled component patterns. */
import type { XOR as XORBase } from 'ts-essentials';
import type { A } from 'ts-toolbelt';
import type { LiteralUnion } from 'type-fest';

// --- [TYPES] -----------------------------------------------------------------

type XOR<A, B> = XORBase<A, B>
type Literal<T extends string, Base extends string = string> = LiteralUnion<T, Base>
type Flatten<T> = A.Compute<T>
type ControlledProps<T> = { readonly value: T; readonly onChange: (value: T) => void }
type UncontrolledProps<T> = { readonly defaultValue?: T }
type ControlledMode<T> = XOR<ControlledProps<T>, UncontrolledProps<T>>
type SelectionControlled<K> = { readonly selectedKey: K; readonly onSelectionChange: (key: K) => void }
type SelectionUncontrolled<K> = { readonly defaultSelectedKey?: K }
type SelectionMode<K> = XOR<SelectionControlled<K>, SelectionUncontrolled<K>>

// --- [ENTRY_POINT] -----------------------------------------------------------

const Controlled = Object.freeze({
	is: <T>(props: object): props is ControlledProps<T> => 'value' in props && 'onChange' in props,
	resolve: <T>(props: ControlledMode<T>, fallback: T): T =>
		'value' in props ? (props as ControlledProps<T>).value : (props.defaultValue ?? fallback),
});

const Selection = Object.freeze({
	is: <K>(props: object): props is SelectionControlled<K> =>
		'selectedKey' in props && 'onSelectionChange' in props,
	resolve: <K>(props: SelectionMode<K>, fallback: K): K =>
		'selectedKey' in props ? (props as SelectionControlled<K>).selectedKey : (props.defaultSelectedKey ?? fallback),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Controlled, Selection };
export type { ControlledMode, ControlledProps, Flatten, Literal, SelectionMode, UncontrolledProps, XOR };
