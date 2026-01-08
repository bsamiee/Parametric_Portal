/**
 * Gesture feedback utilities for extended press interactions.
 * RAF-based progress animation + haptic feedback + automatic cleanup.
 */
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useLongPress } from 'react-aria';

// --- [TYPES] -----------------------------------------------------------------

type GestureEvent = Parameters<NonNullable<Parameters<typeof useLongPress>[0]['onLongPress']>>[0];
type LongPressResult = { readonly props: ReturnType<typeof useLongPress>['longPressProps'] };
type LongPressProps = {			/** Public props for long-press gesture - used by component consumers. */
	readonly accessibilityDescription?: string;
	readonly onLongPress: () => void;
	readonly onLongPressEnd?: (e: GestureEvent) => void;
	readonly onLongPressStart?: (e: GestureEvent) => void;
	readonly threshold?: number;
};
type LongPressHookParams = {	/** Hook params - combines user props with internal configuration. */
	readonly cssVar: string;
	readonly defaultThresholdMs: number;
	readonly hapticMs: number;
	readonly isDisabled?: boolean;
	readonly props: LongPressProps | undefined;
	readonly ref: RefObject<HTMLElement | null>;
};

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const setProgress = (el: HTMLElement | null, cssVar: string, progress: number): void => {
	el?.setAttribute('data-longpress-progress', String(progress));
	el?.style.setProperty(cssVar, String(progress));
};
const clearProgress = (el: HTMLElement | null, cssVar: string): void => {
	el?.removeAttribute('data-longpress-progress');
	el?.style.removeProperty(cssVar);
};
const vibrate = (durationMs: number): void => {
	'vibrate' in (navigator ?? {}) && navigator.vibrate(durationMs);
};

// --- [HOOK] ------------------------------------------------------------------

const useLongPressGesture = (params: LongPressHookParams): LongPressResult => {
	const { cssVar, defaultThresholdMs, hapticMs, isDisabled = false, props, ref } = params;
	const effectiveDisabled = !props || isDisabled;
	const thresholdMs = props?.threshold ?? defaultThresholdMs;
	const rafRef = useRef<number | null>(null);
	const handleStart = useCallback(
		(e: GestureEvent) => {
			const start = Date.now();
			const animate = (): void => {
				const progress = Math.min((Date.now() - start) / thresholdMs, 1);
				setProgress(ref.current, cssVar, progress);
				rafRef.current = progress < 1 ? requestAnimationFrame(animate) : null;
			};
			rafRef.current = requestAnimationFrame(animate);
			props?.onLongPressStart?.(e);
		},
		[cssVar, props, ref, thresholdMs],
	);
	const handleEnd = useCallback(
		(e: GestureEvent) => {
			rafRef.current !== null && cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			clearProgress(ref.current, cssVar);
			props?.onLongPressEnd?.(e);
		},
		[cssVar, props, ref],
	);
	const handleComplete = useCallback(
		() => {
			vibrate(hapticMs);
			props?.onLongPress();
		},
		[hapticMs, props],
	);
	useEffect(() => () => { rafRef.current !== null && cancelAnimationFrame(rafRef.current); }, []);
	const { longPressProps } = useLongPress({
		...(props?.accessibilityDescription && { accessibilityDescription: props.accessibilityDescription }),
		isDisabled: effectiveDisabled,
		onLongPress: handleComplete,
		onLongPressEnd: handleEnd,
		onLongPressStart: handleStart,
		threshold: thresholdMs,
	});
	return { props: longPressProps };
};

// --- [EXPORT] ----------------------------------------------------------------

export { useLongPressGesture };
export type { GestureEvent, LongPressProps, LongPressResult };
