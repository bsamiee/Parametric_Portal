/**
 * Focus: Single useFocus hook for all focus management.
 * Auto-detects: group (roving tabindex) vs zone (containment) vs floating (overlay).
 * RAC collection components handle focus internally - use this for custom components.
 */
import { FloatingFocusManager, type FloatingContext } from '@floating-ui/react';
import { Option, pipe } from 'effect';
import { type FC, type ReactNode, useMemo, useState } from 'react';
import { FocusScope, useFocusVisible } from 'react-aria';

// --- [TYPES] -----------------------------------------------------------------

type Orientation = NonNullable<FocusConfig['orientation']>;
type KeyAction = (f: number, count: number, wrap: boolean) => number;
type FocusConfig = {
    readonly autoFocus?: boolean | 'first' | 'last';
    readonly contain?: boolean;
    readonly count?: number;
    readonly floatingContext?: FloatingContext;
    readonly isTextInput?: boolean;
    readonly orientation?: 'both' | 'horizontal' | 'vertical';
    readonly restoreFocus?: boolean;
    readonly shortcuts?: Readonly<Record<string, () => void>>;
    readonly wrap?: boolean;
};
type FocusResult = {
    readonly Zone?: FC<{ readonly children: ReactNode }> | undefined;
    readonly containerProps?: { readonly onKeyDown: (e: React.KeyboardEvent) => void; readonly role?: 'toolbar' } | undefined;
    readonly focusedIndex?: number | undefined;
    readonly getItemProps?: ((index: number) => { readonly onFocus: () => void; readonly tabIndex: -1 | 0 }) | undefined;
    readonly isFocusVisible: boolean;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    keyActions: Object.freeze({
        ArrowDown: (f, c, w) => (w ? (f + 1) % c : Math.min(f + 1, c - 1)),
        ArrowLeft: (f, c, w) => (w ? (f - 1 + c) % c : Math.max(f - 1, 0)),
        ArrowRight: (f, c, w) => (w ? (f + 1) % c : Math.min(f + 1, c - 1)),
        ArrowUp: (f, c, w) => (w ? (f - 1 + c) % c : Math.max(f - 1, 0)),
        End: (_f, c) => c - 1,
        Home: () => 0,
    }) satisfies Record<string, KeyAction>,
    orientationKeys: Object.freeze({
        both: new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']),
        horizontal: new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End']),
        vertical: new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']),
    }) satisfies Record<Orientation, Set<string>>,
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const matchShortcut = (e: KeyboardEvent, pattern: string): boolean => {
    const parts = pattern.toLowerCase().split('+');
    const key = parts.at(-1) ?? '';
    const mods = new Set(parts.slice(0, -1));
    return e.key.toLowerCase() === key &&
        mods.has('cmd') === e.metaKey && mods.has('ctrl') === e.ctrlKey &&
        mods.has('alt') === e.altKey && mods.has('shift') === e.shiftKey;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFocus = (config: FocusConfig = {}): FocusResult => {
    const { autoFocus, contain, count, floatingContext, isTextInput, orientation = 'horizontal', restoreFocus = true, shortcuts, wrap = true } = config;
    const [focusedIndex, setFocusedIndex] = useState(0);
    const { isFocusVisible } = useFocusVisible(isTextInput === undefined ? {} : { isTextInput });
    const Zone = useMemo(
        () =>
            contain === true
                ? (({ children }: { readonly children: ReactNode }) =>
                        floatingContext === undefined ? (
                            <FocusScope autoFocus={autoFocus === true || autoFocus === 'first'} contain restoreFocus={restoreFocus}>
                                {children}
                            </FocusScope>
                        ) : (
                            <FloatingFocusManager context={floatingContext} modal returnFocus={restoreFocus}>
                                {children as React.JSX.Element}
                            </FloatingFocusManager>
                        )) as FC<{ readonly children: ReactNode }>
                : undefined,
        [autoFocus, contain, floatingContext, restoreFocus],
    );
    const onKeyDown = useMemo(() => (e: React.KeyboardEvent) => {
        const c = count ?? 0;
        const navAction = pipe(
            Option.liftPredicate(e.key, (k): k is keyof typeof B.keyActions => count !== undefined && B.orientationKeys[orientation].has(k)),
            Option.map((k) => B.keyActions[k]),
            Option.getOrUndefined,
        );
        navAction && (() => { e.preventDefault(); setFocusedIndex((f) => navAction(f, c, wrap)); })();
        const shortcutMatch = !navAction && shortcuts && Object.entries(shortcuts).find(([p]) => matchShortcut(e.nativeEvent, p));
        shortcutMatch && (() => { e.preventDefault(); shortcutMatch[1](); })();
    }, [count, orientation, wrap, shortcuts]);
    const mode = pipe(
        Option.fromNullable(count),
        Option.map(() => 'nav' as const),
        Option.orElse(() => pipe(Option.fromNullable(shortcuts), Option.map(() => 'shortcuts' as const))),
        Option.getOrElse(() => 'zone' as const),
    );
    return mode === 'zone'
        ? { isFocusVisible, Zone }
        : {
                containerProps: { onKeyDown, ...(mode === 'nav' && { role: 'toolbar' as const }) },
                ...(mode === 'nav' && {
                    focusedIndex,
                    getItemProps: (i: number) => ({ onFocus: () => setFocusedIndex(i), tabIndex: i === focusedIndex ? 0 : -1 }),
                }),
                isFocusVisible,
                Zone,
            };
};

// --- [EXPORT] ----------------------------------------------------------------

export { useFocus };
export type { FocusConfig, FocusResult };
