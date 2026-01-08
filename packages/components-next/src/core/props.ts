/**
 * Centralized prop composition system for component library.
 * Define once via PROP_SCHEMAS, select via COMPONENT_FEATURES dispatch table,
 * extract via S.Schema.Type. Handler schemas in H constant for DRY composition.
 */
import type { AsyncState } from '@parametric-portal/types/async';
import type { Flatten } from '@parametric-portal/types/props';
import { Schema as S } from 'effect';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref, RefObject } from 'react';
import type { Key } from 'react-aria-components';
import type { TooltipConfig } from './floating';
import type { SlotDef } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type FocusHandler = (e: React.FocusEvent<Element>) => void;
type KeyHandler = (e: React.KeyboardEvent) => void;
type BoolHandler = (value: boolean) => void;
type PressHandler = (e: import('react-aria-components').PressEvent) => void;
type HoverHandler = (e: { type: string; target: Element; pointerType: 'mouse' | 'pen' }) => void;

// --- [SCHEMA] ----------------------------------------------------------------

type FocusStrategy = 'first' | 'last';
type CloseHandler = () => void;

const H = Object.freeze({
	async: S.optional(S.Any as S.Schema<AsyncState<unknown, unknown>>),
	autoFocusStrategy: S.optional(S.Any as S.Schema<boolean | FocusStrategy>),
	badge: S.optional(S.Any as S.Schema<ReactNode | number | string>),
	bool: S.optional(S.Any as S.Schema<BoolHandler>),
	close: S.optional(S.Any as S.Schema<CloseHandler>),
	disabledKeys: S.optional(S.Any as S.Schema<Iterable<Key>>),
	focus: S.optional(S.Any as S.Schema<FocusHandler>),
	hover: S.optional(S.Any as S.Schema<HoverHandler>),
	iconLucide: S.optional(S.Any as S.Schema<LucideIcon | ReactNode>),
	iconLucideReq: S.Any as S.Schema<LucideIcon | ReactNode>,
	iconSlot: S.optional(S.Any as S.Schema<SlotDef>),
	id: S.optional(S.Any as S.Schema<Key>),
	inputRef: S.optional(S.Any as S.Schema<RefObject<HTMLInputElement | null>>),
	key: S.optional(S.Any as S.Schema<KeyHandler>),
	press: S.optional(S.Any as S.Schema<PressHandler>),
	ref: S.optional(S.Any as S.Schema<Ref<HTMLElement>>),
	tooltip: S.optional(S.Any as S.Schema<TooltipConfig>),
});
const PROP_SCHEMAS = Object.freeze({
	accessibility: S.Struct({
		'aria-describedby': S.optional(S.String), 'aria-details': S.optional(S.String),
		'aria-label': S.optional(S.String), 'aria-labelledby': S.optional(S.String),
	}),
	accessibilityExtended: S.Struct({
		'aria-controls': S.optional(S.String),
		'aria-current': S.optional(S.Union(S.Boolean, S.Literal('date', 'location', 'page', 'step', 'time'))),
		'aria-errormessage': S.optional(S.String),
		'aria-expanded': S.optional(S.Union(S.Boolean, S.Literal('true', 'false'))),
		'aria-haspopup': S.optional(S.Union(S.Boolean, S.Literal('dialog', 'grid', 'listbox', 'menu', 'tree'))),
		'aria-pressed': S.optional(S.Union(S.Boolean, S.Literal('true', 'false', 'mixed'))),
	}),
	async: S.Struct({ asyncState: H.async }),
	badge: S.Struct({ badge: H.badge }),
	disabledKeys: S.Struct({ disabledKeys: H.disabledKeys }),
	focusWrap: S.Struct({ shouldFocusWrap: S.optional(S.Boolean) }),
	form: S.Struct({
		form: S.optional(S.String), isDisabled: S.optional(S.Boolean), isInvalid: S.optional(S.Boolean),
		isReadOnly: S.optional(S.Boolean), isRequired: S.optional(S.Boolean), name: S.optional(S.String),
	}),
	formField: S.Struct({ autoFocus: S.optional(S.Boolean), excludeFromTabOrder: S.optional(S.Boolean) }),
	formFieldFocus: S.Struct({ autoFocus: H.autoFocusStrategy, excludeFromTabOrder: S.optional(S.Boolean) }),
	hover: S.Struct({ onHoverEnd: H.hover, onHoverStart: H.hover }),
	iconLucide: S.Struct({ icon: H.iconLucide }),
	iconLucideReq: S.Struct({ icon: H.iconLucideReq }),
	iconSlot: S.Struct({ icon: H.iconSlot }),
	id: S.Struct({ id: H.id }),
	inputRef: S.Struct({ inputRef: H.inputRef }),
	interactions: S.Struct({
		onBlur: H.focus, onFocus: H.focus, onFocusChange: H.bool,
		onHoverChange: H.bool, onKeyDown: H.key, onKeyUp: H.key,
	}),
	link: S.Struct({
		download: S.optional(S.Union(S.Boolean, S.String)),
		href: S.optional(S.String),
		rel: S.optional(S.String),
		target: S.optional(S.Literal('_blank', '_parent', '_self', '_top')),
	}),
	orientation: S.Struct({ orientation: S.optional(S.Literal('horizontal', 'vertical')) }),
	overlay: S.Struct({ onClose: H.close, onOpenChange: H.bool }),
	press: S.Struct({
		onPress: H.press, onPressChange: H.bool, onPressEnd: H.press,
		onPressStart: H.press, onPressUp: H.press,
	}),
	refs: S.Struct({ ref: H.ref }),
	slot: S.Struct({ slot: S.optional(S.NullOr(S.String)) }),
	theme: S.Struct({ color: S.String, size: S.String, variant: S.optional(S.String) }),
	themeOptional: S.Struct({ color: S.optional(S.String), size: S.optional(S.String), variant: S.optional(S.String) }),
	tooltip: S.Struct({ tooltip: H.tooltip }),
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const COMPONENT_FEATURES = Object.freeze({
	button: ['async', 'interactions', 'hover', 'press', 'theme', 'accessibility', 'accessibilityExtended', 'form', 'formField', 'link', 'refs', 'slot', 'tooltip'] as const,
	checkbox: ['async', 'interactions', 'hover', 'press', 'themeOptional', 'accessibility', 'accessibilityExtended', 'form', 'formField', 'inputRef', 'refs', 'slot', 'tooltip', 'iconLucideReq'] as const,
	checkboxGroup: ['interactions', 'themeOptional', 'accessibility', 'form', 'refs', 'slot', 'orientation'] as const,
	confirmDialog: ['accessibility', 'refs'] as const,
	filePreview: ['refs', 'iconLucide'] as const,
	fileUpload: ['async', 'form', 'refs'] as const,
	menu: ['interactions', 'theme', 'accessibility', 'formFieldFocus', 'overlay', 'focusWrap', 'refs', 'slot', 'disabledKeys'] as const,
	menuItem: ['async', 'interactions', 'hover', 'press', 'accessibility', 'link', 'refs', 'slot', 'tooltip', 'iconSlot', 'id', 'badge'] as const,
	menuSection: ['accessibility', 'slot', 'id', 'disabledKeys'] as const,
	radio: ['async', 'interactions', 'hover', 'press', 'themeOptional', 'accessibility', 'form', 'formField', 'inputRef', 'refs', 'slot', 'tooltip', 'iconLucideReq'] as const,
	radioGroup: ['interactions', 'theme', 'accessibility', 'form', 'refs', 'slot', 'orientation'] as const,
	select: ['async', 'interactions', 'theme', 'accessibility', 'form', 'formField', 'overlay', 'focusWrap', 'refs', 'slot', 'tooltip', 'disabledKeys'] as const,
	selectItem: ['interactions', 'hover', 'press', 'accessibility', 'link', 'refs', 'slot', 'iconLucide', 'id'] as const,
	switch: ['async', 'interactions', 'hover', 'theme', 'accessibility', 'accessibilityExtended', 'form', 'formField', 'inputRef', 'refs', 'slot', 'tooltip'] as const,
	tab: ['async', 'interactions', 'hover', 'press', 'accessibility', 'link', 'refs', 'slot', 'tooltip', 'iconSlot', 'id', 'badge'] as const,
	tabList: ['accessibility', 'slot'] as const,
	tabPanel: ['refs', 'slot', 'id'] as const,
	tabs: ['theme', 'accessibility', 'focusWrap', 'refs', 'slot', 'orientation', 'disabledKeys'] as const,
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

type PropKey = keyof typeof PROP_SCHEMAS;
type ComponentKey = keyof typeof COMPONENT_FEATURES;
type SchemaFor<K extends PropKey> = (typeof PROP_SCHEMAS)[K];
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type PropsFor<Keys extends readonly PropKey[]> = UnionToIntersection<S.Schema.Type<SchemaFor<Keys[number]>>>;

// --- [ENTRY_POINT] -----------------------------------------------------------

type BasePropsFor<C extends ComponentKey> = Flatten<PropsFor<(typeof COMPONENT_FEATURES)[C]>>;

// --- [EXPORT] ----------------------------------------------------------------

export { COMPONENT_FEATURES, PROP_SCHEMAS };
export type { BasePropsFor, ComponentKey, FocusStrategy, PropKey, PropsFor };
