/**
 * Discriminate controlled/uncontrolled component prop patterns via XOR types.
 * Enables compile-time enforcement of mutually exclusive prop combinations.
 */
import type { XOR as XORBase } from 'ts-essentials';
import type { LiteralUnion, Paths, Simplify } from 'type-fest';

// --- [TYPES] -----------------------------------------------------------------

type XOR<A, B> = XORBase<A, B>
type Literal<T extends string, Base extends string = string> = LiteralUnion<T, Base>
type Flatten<T> = Simplify<T>
type ControlledProps<T> = { readonly value: T; readonly onChange: (value: T) => void }
type UncontrolledProps<T> = { readonly defaultValue?: T }
type ControlledMode<T> = XOR<ControlledProps<T>, UncontrolledProps<T>>
type SelectionControlled<K> = { readonly selectedKey: K; readonly onSelectionChange: (key: K) => void }
type SelectionUncontrolled<K> = { readonly defaultSelectedKey?: K }
type SelectionMode<K> = XOR<SelectionControlled<K>, SelectionUncontrolled<K>>
type DeepPath<T, MaxDepth extends number = 4> = Paths<T, { maxRecursionDepth: MaxDepth }>

// --- [DISPATCH_TABLES] -------------------------------------------------------

const Controlled = Object.freeze({
	is: <T>(props: object): props is ControlledProps<T> => 'value' in props && 'onChange' in props,
	resolve: <T>(props: ControlledMode<T>, fallback: T): T => 'value' in props ? (props as ControlledProps<T>).value : (props.defaultValue ?? fallback),
});
const Selection = Object.freeze({
	is: <K>(props: object): props is SelectionControlled<K> => 'selectedKey' in props && 'onSelectionChange' in props,
	resolve: <K>(props: SelectionMode<K>, fallback: K): K => 'selectedKey' in props ? (props as SelectionControlled<K>).selectedKey : (props.defaultSelectedKey ?? fallback),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Controlled, Selection };
export type { ControlledMode, ControlledProps, DeepPath, Flatten, Literal, SelectionMode, UncontrolledProps, XOR };
