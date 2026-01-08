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
    readonly wrap?: boolean;
};
type FocusResult = {
    readonly Zone?: FC<{ readonly children: ReactNode }> | undefined;
    readonly containerProps?: { readonly onKeyDown: (e: React.KeyboardEvent) => void; readonly role: 'toolbar' } | undefined;
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

// --- [ENTRY_POINT] -----------------------------------------------------------

const useFocus = (config: FocusConfig = {}): FocusResult => {
    const { autoFocus, contain, count, floatingContext, isTextInput, orientation = 'horizontal', restoreFocus = true, wrap = true } = config;
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
    return count === undefined
        ? { isFocusVisible, Zone }
        : {
                containerProps: {
                    onKeyDown: (e: React.KeyboardEvent) =>
                        pipe(
                            Option.liftPredicate(e.key, (k): k is keyof typeof B.keyActions => B.orientationKeys[orientation].has(k)),
                            Option.map((k) => B.keyActions[k]),
                            Option.match({
                                onNone: () => undefined,
                                onSome: (action) => {
                                    e.preventDefault();
                                    setFocusedIndex((f) => action(f, count, wrap));
                                },
                            }),
                        ),
                    role: 'toolbar' as const,
                },
                focusedIndex,
                getItemProps: (i: number) => ({ onFocus: () => setFocusedIndex(i), tabIndex: i === focusedIndex ? 0 : -1 }),
                isFocusVisible,
                Zone,
            };
};

// --- [EXPORT] ----------------------------------------------------------------

export { useFocus };
export type { FocusConfig, FocusResult };
