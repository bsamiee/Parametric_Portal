/**
 * Type-safe CSS variable slot definitions.
 * Grounding: Contract between components and theme package.
 */

// --- [TYPES] -----------------------------------------------------------------

type ThemeSlot = ColorSlot | CtrlSlot | InputSlot | SelectSlot;
type CtrlSlot =
    | 'ctrl-destructive-bg'
    | 'ctrl-destructive-hover'
    | 'ctrl-destructive-text'
    | 'ctrl-ghost-hover'
    | 'ctrl-outline-border'
    | 'ctrl-outline-hover'
    | 'ctrl-primary-bg'
    | 'ctrl-primary-hover'
    | 'ctrl-primary-text'
    | 'ctrl-secondary-bg'
    | 'ctrl-secondary-hover'
    | 'ctrl-secondary-text';
type InputSlot =
    | 'input-bg'
    | 'input-border'
    | 'input-disabled-bg'
    | 'input-disabled-text'
    | 'input-error-border'
    | 'input-focus-border'
    | 'input-focus-ring'
    | 'input-placeholder'
    | 'input-text';
type SelectSlot =
    | 'select-content-bg'
    | 'select-content-border'
    | 'select-content-shadow'
    | 'select-item-focus-bg'
    | 'select-item-selected-bg'
    | 'select-item-text'
    | 'select-trigger-bg'
    | 'select-trigger-border';
type ColorSlot =
    | 'color-accent-200'
    | 'color-accent-hover'
    | 'color-border-100'
    | 'color-border-200'
    | 'color-destructive-200'
    | 'color-destructive-hover'
    | 'color-muted-200'
    | 'color-muted-hover'
    | 'color-success-200'
    | 'color-success-hover'
    | 'color-surface-50'
    | 'color-surface-100'
    | 'color-surface-200'
    | 'color-surface-300'
    | 'color-text-100'
    | 'color-text-200'
    | 'color-warning-200'
    | 'color-warning-hover';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const slot = <S extends ThemeSlot>(name: S): `var(--${S})` => `var(--${name})` as const;
const slotClass = <S extends ThemeSlot>(property: string, name: S): string => `${property}-[var(--${name})]`;
const bgSlot = <S extends ThemeSlot>(name: S): string => `bg-[var(--${name})]`;
const textSlot = <S extends ThemeSlot>(name: S): string => `text-[var(--${name})]`;
const borderSlot = <S extends ThemeSlot>(name: S): string => `border-[var(--${name})]`;
const ringSlot = <S extends ThemeSlot>(name: S): string => `ring-[var(--${name})]`;

// --- [EXPORT] ----------------------------------------------------------------

export { bgSlot, borderSlot, ringSlot, slot, slotClass, textSlot };
export type { ColorSlot, CtrlSlot, InputSlot, SelectSlot, ThemeSlot };
