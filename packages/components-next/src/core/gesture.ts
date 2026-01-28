/**
 * Unified gesture system wrapping @use-gesture/react and react-aria useLongPress.
 * ADT discriminant enables exhaustive matching; FullGestureState exposed via accessors.
 */
import { useGesture as useGestureLib, type CoordinatesConfig, type DragConfig, type FullGestureState, type HoverConfig, type MoveConfig, type PinchConfig, } from '@use-gesture/react';
import { Data, Match, Option, pipe } from 'effect';
import { clamp, readCssMs, readCssPx, readCssVar } from '@parametric-portal/runtime/runtime';
import type { DOMAttributes, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLongPress, type LongPressProps as RACLongPressProps } from 'react-aria';
import type { DeepReadonly, XOR } from 'ts-essentials';
import type { SimplifyDeep } from 'type-fest';
import { defined } from './utils';

// --- [TYPES] -----------------------------------------------------------------

type V2 = readonly [number, number];
type SwipeDir = 'down' | 'left' | 'right' | 'up';
type Phase = 'end' | 'move' | 'start';
type PointerType = 'keyboard' | 'mouse' | 'pen' | 'touch';
type GestureKind = 'drag' | 'hover' | 'move' | 'pinch' | 'scroll' | 'wheel';
type GestureEventTag = GestureEventDef['_tag'];
type HasState = Exclude<GestureEventDef, { _tag: 'LongPress' }>;
type V2Bounds = DeepReadonly<{ min: V2; max: V2 }>;
type SnapAxis = DeepReadonly<{ points: readonly number[]; threshold?: number }>;
type SnapConfig = SimplifyDeep<XOR<{ readonly x: SnapAxis; readonly y: SnapAxis }, { readonly unified: SnapAxis }> & { readonly snapOnRelease?: boolean }>;
type DecayConfig = DeepReadonly<{ power: number; restDelta: number }>;
type PhysicsConfig = SimplifyDeep<{ readonly decay: DecayConfig } & { readonly velocityMultiplier?: number }>;
type BoundsConfig = DeepReadonly<{ movement?: V2Bounds & { rubberband?: { factor: number } }; scale?: { min: number; max: number }; angle?: { min: number; max: number } }>;
type MobileConfig = DeepReadonly<{ filterTaps?: boolean; preventScroll?: boolean; preventScrollAxis?: 'lock' | 'x' | 'y' }>;
type GestureConfig = GestureProps & { readonly ref: RefObject<HTMLElement | null>; readonly isDisabled?: boolean; readonly prefix?: string };
type GestureResult = { readonly props: DOMAttributes<Element> & { readonly style?: { touchAction?: string } }; readonly state: Partial<Record<Lowercase<GestureEventTag>, GestureEventDef>> };
type LongPressConfig = {
	readonly threshold?: number; readonly haptic?: boolean; readonly cancelOnMove?: boolean;
	readonly repeatInterval?: number; readonly accessibilityDescription?: string;
};
type CssVarConfig = {
	readonly x?: string; readonly y?: string; readonly scale?: string; readonly angle?: string; readonly progress?: string;
	readonly velocityX?: string; readonly velocityY?: string; readonly deltaX?: string; readonly deltaY?: string; readonly momentum?: string;
};
type GestureEventDef = Data.TaggedEnum<{
	Drag: { readonly state: FullGestureState<'drag'>; readonly swipe: SwipeDir | null };
	Hover: { readonly state: FullGestureState<'hover'> };
	LongPress: { readonly progress: number; readonly pointerType: PointerType };
	Move: { readonly state: FullGestureState<'move'> };
	Pinch: { readonly state: FullGestureState<'pinch'> };
	Scroll: { readonly state: FullGestureState<'scroll'> };
	Wheel: { readonly state: FullGestureState<'wheel'> };
}>;
type GestureProps = SimplifyDeep<{
	readonly drag?: DragConfig;
	readonly pinch?: PinchConfig;
	readonly scroll?: CoordinatesConfig<'scroll'>;
	readonly wheel?: CoordinatesConfig<'wheel'>;
	readonly move?: MoveConfig;
	readonly hover?: HoverConfig;
	readonly longPress?: LongPressConfig;
	readonly cssVars?: CssVarConfig;
	readonly transform?: (v: [number, number]) => [number, number];
	readonly eventOptions?: AddEventListenerOptions;
	readonly onGesture?: (event: GestureEventDef, phase: Phase) => void;
	readonly onSwipe?: (dir: SwipeDir) => void;
	readonly onDrag?: (e: Extract<GestureEventDef, { _tag: 'Drag' }>, phase: Phase) => void;
	readonly onPinch?: (e: Extract<GestureEventDef, { _tag: 'Pinch' }>, phase: Phase) => void;
	readonly onScroll?: (e: Extract<GestureEventDef, { _tag: 'Scroll' }>, phase: Phase) => void;
	readonly onWheel?: (e: Extract<GestureEventDef, { _tag: 'Wheel' }>, phase: Phase) => void;
	readonly onMove?: (e: Extract<GestureEventDef, { _tag: 'Move' }>, phase: Phase) => void;
	readonly onHover?: (e: Extract<GestureEventDef, { _tag: 'Hover' }>, phase: Phase) => void;
	readonly onLongPress?: (e: Extract<GestureEventDef, { _tag: 'LongPress' }>, phase: Phase) => void;
	readonly bounds?: BoundsConfig;
	readonly snap?: SnapConfig;
	readonly physics?: PhysicsConfig;
	readonly mobile?: MobileConfig;
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
	cssVars: {
		interactionHaptic: '--interaction-haptic-duration',
		interactionLongPressThreshold: '--interaction-long-press-threshold',
		longPressCancelDistance: '--gesture-longpress-cancel-distance',
		longPressHaptic: '--gesture-longpress-haptic',
		longPressThreshold: '--gesture-longpress-threshold',
		swipeDistance: '--gesture-swipe-distance',
		swipeDuration: '--gesture-swipe-duration',
		swipeVelocity: '--gesture-swipe-velocity',
	},
	cssVarsFor: {
		drag: (prefix: string): Partial<CssVarConfig> => ({ deltaX: `--${prefix}-drag-delta-x`, deltaY: `--${prefix}-drag-delta-y`, momentum: `--${prefix}-drag-momentum`, velocityX: `--${prefix}-drag-velocity-x`, velocityY: `--${prefix}-drag-velocity-y`, x: `--${prefix}-drag-x`, y: `--${prefix}-drag-y` }),
		longPress: (prefix: string): Partial<CssVarConfig> => ({ progress: `--${prefix}-longpress-progress` }),
		move: (prefix: string): Partial<CssVarConfig> => ({ x: `--${prefix}-move-x`, y: `--${prefix}-move-y` }),
		pinch: (prefix: string): Partial<CssVarConfig> => ({ angle: `--${prefix}-pinch-angle`, scale: `--${prefix}-pinch-scale` }),
		scroll: (prefix: string): Partial<CssVarConfig> => ({ x: `--${prefix}-scroll-x`, y: `--${prefix}-scroll-y` }),
		wheel: (prefix: string): Partial<CssVarConfig> => ({ x: `--${prefix}-wheel-x`, y: `--${prefix}-wheel-y` }),
	},
	defaults: { decayPower: 0.95, decayRestDelta: 0.5, rubberbandFactor: 0.2, snapThreshold: 50, snapVelocity: 0.5 },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const { $is, $match, Drag, Hover, LongPress, Move, Pinch, Scroll, Wheel } = Data.taggedEnum<GestureEventDef>();

const generateCssVars = (prefix: string, config: GestureProps): CssVarConfig => ({
	...(config.drag && _B.cssVarsFor.drag(prefix)),
	...(config.longPress && _B.cssVarsFor.longPress(prefix)),
	...(config.move && _B.cssVarsFor.move(prefix)),
	...(config.pinch && _B.cssVarsFor.pinch(prefix)),
	...(config.scroll && _B.cssVarsFor.scroll(prefix)),
	...(config.wheel && _B.cssVarsFor.wheel(prefix)),
});
// Side-effectful CSS sync - uses plain guards since Option.gen is for pure transformations
const syncCssVars = (ref: RefObject<HTMLElement | null>, evt: GestureEventDef, varConfig: CssVarConfig | undefined): void => {
	const el = ref.current;
	(el && varConfig) && (() => {
		const set = (key: string | undefined, val: string): void => { key && el.style.setProperty(key, val); };
		$match(evt, {
			Drag: ({ state: { offset, velocity, delta } }) => {
				set(varConfig.x, `${offset[0]}px`); set(varConfig.y, `${offset[1]}px`);
				set(varConfig.velocityX, String(velocity[0])); set(varConfig.velocityY, String(velocity[1]));
				set(varConfig.deltaX, `${delta[0]}px`); set(varConfig.deltaY, `${delta[1]}px`);
				set(varConfig.momentum, String(Math.hypot(velocity[0], velocity[1])));
			},
			Hover: () => {},
			LongPress: () => {},
			Move: ({ state }) => { set(varConfig.x, `${state.offset[0]}px`); set(varConfig.y, `${state.offset[1]}px`); },
			Pinch: ({ state }) => { set(varConfig.scale, String(state.offset[0])); set(varConfig.angle, `${state.offset[1]}deg`); },
			Scroll: ({ state }) => { set(varConfig.x, `${state.offset[0]}px`); set(varConfig.y, `${state.offset[1]}px`); },
			Wheel: ({ state }) => { set(varConfig.x, `${state.offset[0]}px`); set(varConfig.y, `${state.offset[1]}px`); },
		});
	})();
};
const V2 = Object.freeze({
	clamp: (vec: V2, bounds: V2Bounds): V2 => V2.map(vec, (coord, idx) => clamp(coord, bounds.min[idx], bounds.max[idx])),
	from: (vec: [number, number]): V2 => [vec[0], vec[1]] as const,
	magnitude: (vec: V2): number => Math.hypot(vec[0], vec[1]),
	map: (vec: V2, mapper: (coord: number, idx: 0 | 1) => number): V2 => [mapper(vec[0], 0), mapper(vec[1], 1)] as const,
	rubberband: (vec: V2, bounds: V2Bounds, factor: number): V2 => {
		const rb = (coord: number, min: number, max: number): number =>
			Match.value(coord).pipe(
				Match.when((n) => n < min, (n) => min + (n - min) * factor),
				Match.when((n) => n > max, (n) => max + (n - max) * factor),
				Match.orElse((n) => n),
			);
		return V2.map(vec, (coord, idx) => rb(coord, bounds.min[idx], bounds.max[idx]));
	},
	snap: (vec: V2, snap: SnapConfig, threshold: number): V2 => {
		const nearest = (coord: number, points: readonly number[], th: number): number => {
			const best = points.reduce((prev, pt) => Math.abs(pt - coord) < Math.abs(prev - coord) ? pt : prev, points[0] ?? 0);
			return Math.abs(best - coord) < th ? best : coord;
		};
		return 'unified' in snap && snap.unified
			? V2.map(vec, (coord) => nearest(coord, snap.unified.points, snap.unified.threshold ?? threshold))
			: [nearest(vec[0], snap.x.points, snap.x.threshold ?? threshold), nearest(vec[1], snap.y.points, snap.y.threshold ?? threshold)] as const;
	},
});
const applyMovementBounds = (vec: V2, movement: V2Bounds & { rubberband?: { factor: number } } | undefined): V2 =>
	pipe(
		Option.fromNullable(movement),
		Option.map((mv) => mv.rubberband ? V2.rubberband(vec, mv, mv.rubberband.factor ?? _B.defaults.rubberbandFactor) : V2.clamp(vec, mv)),
		Option.getOrElse(() => vec),
	);
const swipeFrom = (vec: [number, number]): SwipeDir | null => ({ '-1,0': 'left', '0,-1': 'up', '0,1': 'down', '1,0': 'right' } as Record<string, SwipeDir>)[`${vec[0]},${vec[1]}`] ?? null;
const touchAction = (gestureConfig: GestureConfig): string => !gestureConfig.drag && !gestureConfig.pinch && !gestureConfig.scroll ? 'auto' : ({ x: 'pan-y', y: 'pan-x' } as Record<string, string>)[gestureConfig.drag?.axis ?? ''] ?? 'none';
const vibrate = (ms: number): void => { 'vibrate' in (navigator ?? {}) && navigator.vibrate(ms); };
const phaseOf = <K extends GestureKind>(g: FullGestureState<K>): Phase => (g.first && 'start') || (g.last && 'end') || 'move';
const hasState = (e: GestureEventDef): e is HasState => e._tag !== 'LongPress';
const resolveMs = (primary: string, fallback: string): number => readCssVar(primary) ? readCssMs(primary) : readCssMs(fallback);
// Predicates
const isDrag = $is('Drag'), isHover = $is('Hover'), isLongPress = $is('LongPress'), isMove = $is('Move'), isPinch = $is('Pinch'), isScroll = $is('Scroll'), isWheel = $is('Wheel');
const isCoordinates = (e: GestureEventDef | undefined): boolean => e != null && ['Drag', 'Hover', 'Move', 'Scroll', 'Wheel'].includes(e._tag);
// Accessors
const stateField = <T>(evt: GestureEventDef, get: (gestureState: FullGestureState<GestureKind>) => T): Option.Option<T> => pipe(Option.some(evt), Option.filter(hasState), Option.map((ev) => get(ev.state as FullGestureState<GestureKind>)));
const v2Field = (key: keyof FullGestureState<GestureKind>) => (evt: GestureEventDef): Option.Option<V2> => stateField(evt, (gestureState) => V2.from(gestureState[key] as [number, number]));
const getOffset = v2Field('offset'), getMovement = v2Field('movement'), getDelta = v2Field('delta'), getVelocity = v2Field('velocity');
const getDirection = v2Field('direction'), getDistance = v2Field('distance'), getInitial = v2Field('initial'), getOverflow = v2Field('overflow');
const getXY = (evt: GestureEventDef): Option.Option<V2> => pipe(Option.some(evt), Option.filter(hasState), Option.filter((ev) => 'xy' in ev.state), Option.map((ev) => V2.from((ev.state as { xy: [number, number] }).xy)));
const getOrigin = (evt: GestureEventDef): Option.Option<V2> => pipe(Option.some(evt), Option.filter(isPinch), Option.map((pinchEvt) => V2.from(pinchEvt.state.origin)));
const getDA = (evt: GestureEventDef): Option.Option<V2> => pipe(Option.some(evt), Option.filter(isPinch), Option.map((pinchEvt) => V2.from(pinchEvt.state.da)));
const getTurns = (evt: GestureEventDef): Option.Option<number> => pipe(Option.some(evt), Option.filter(isPinch), Option.map((pinchEvt) => pinchEvt.state.turns));
const getTap = (evt: GestureEventDef): Option.Option<boolean> => pipe(Option.some(evt), Option.filter(isDrag), Option.map((dragEvt) => dragEvt.state.tap));
const getSwipe = (evt: GestureEventDef): Option.Option<SwipeDir | null> => pipe(Option.some(evt), Option.filter(isDrag), Option.map((dragEvt) => dragEvt.swipe));
const getElapsedTime = (evt: GestureEventDef): Option.Option<number> => stateField(evt, (gestureState) => gestureState.elapsedTime);
const getAxis = (evt: GestureEventDef): Option.Option<string | undefined> => stateField(evt, (gestureState) => gestureState.axis);
const isActive = (evt: GestureEventDef): boolean => evt._tag === 'LongPress' ? evt.progress > 0 && evt.progress < 1 : hasState(evt) && evt.state.active;
const isFirst = (evt: GestureEventDef): boolean => evt._tag === 'LongPress' ? evt.progress === 0 : hasState(evt) && evt.state.first;
const isLast = (evt: GestureEventDef): boolean => evt._tag === 'LongPress' ? evt.progress >= 1 : hasState(evt) && evt.state.last;
const isCanceled = (evt: GestureEventDef): boolean => evt._tag === 'LongPress' ? false : hasState(evt) && 'canceled' in evt.state && Boolean(evt.state.canceled);
const isIntentional = (evt: GestureEventDef): boolean => evt._tag === 'LongPress' ? true : hasState(evt) && evt.state.intentional;

// --- [ENTRY_POINT] -----------------------------------------------------------

const useGesture = (config: GestureConfig): GestureResult => {
	const {
		bounds, cssVars: cssVarsExplicit, drag, eventOptions, hover, isDisabled = false, longPress, mobile, move,
		onDrag: onDragCb, onGesture, onHover: onHoverCb, onLongPress, onMove: onMoveCb,
		onPinch: onPinchCb, onScroll: onScrollCb, onSwipe, onWheel: onWheelCb,
		physics, pinch, prefix, ref, scroll, snap, transform, wheel,
	} = config;
	// Auto-generate CSS vars from prefix if provided; explicit cssVars override generated ones
	const cssVars = useMemo(() => prefix ? { ...generateCssVars(prefix, config), ...cssVarsExplicit } : cssVarsExplicit, [config, cssVarsExplicit, prefix]);
	const [state, setState] = useState<Partial<Record<Lowercase<GestureEventTag>, GestureEventDef>>>({});
	const enabled = !isDisabled;
	const swipeCfg = useMemo(() => ({ distance: readCssPx(_B.cssVars.swipeDistance), duration: readCssMs(_B.cssVars.swipeDuration), velocity: readCssPx(_B.cssVars.swipeVelocity) / 1000 }), []);
	const inertiaRef = useRef<{ active: boolean; position: V2; velocity: V2 }>({ active: false, position: [0, 0], velocity: [0, 0] });
	const physicsRafRef = useRef<number | null>(null);
	const typedCallbacks = useMemo(() => ({ drag: onDragCb, hover: onHoverCb, longpress: onLongPress, move: onMoveCb, pinch: onPinchCb, scroll: onScrollCb, wheel: onWheelCb }) as const, [onDragCb, onHoverCb, onLongPress, onMoveCb, onPinchCb, onScrollCb, onWheelCb]);
	// RAF required for frame-synced animations in React hooks (Effect.repeatWhile incompatible with React render cycle)
	const startInertia = useCallback((startPos: V2, startVel: V2): void => {
		const decay = physics?.decay;
		decay && (() => {
			const { power = _B.defaults.decayPower, restDelta = _B.defaults.decayRestDelta } = decay;
			inertiaRef.current = { active: true, position: startPos, velocity: startVel };
			const tick = (): void => {
				const ir = inertiaRef.current;
				ir.active && (() => {
					const newVel: V2 = [ir.velocity[0] * power, ir.velocity[1] * power];
					const newPos: V2 = [ir.position[0] + newVel[0], ir.position[1] + newVel[1]];
					const done = V2.magnitude(newVel) < restDelta;
					inertiaRef.current = { active: !done, position: newPos, velocity: newVel };
				const finalPos = snap && V2.magnitude(newVel) < _B.defaults.snapVelocity ? V2.snap(newPos, snap, _B.defaults.snapThreshold) : newPos;
					cssVars?.x && ref.current?.style.setProperty(cssVars.x, `${finalPos[0]}px`);
					cssVars?.y && ref.current?.style.setProperty(cssVars.y, `${finalPos[1]}px`);
					physicsRafRef.current = done ? null : requestAnimationFrame(tick);
				})();
			};
			physicsRafRef.current = requestAnimationFrame(tick);
		})();
	}, [cssVars?.x, cssVars?.y, physics?.decay, ref, snap]);
	const handler = useCallback(<K extends GestureKind>(kind: Lowercase<GestureEventTag>, factory: (gestureState: FullGestureState<K>) => GestureEventDef) => (gestureState: FullGestureState<K>): void => {
		const offset = pipe(
			V2.from(gestureState.offset),
			(vec) => applyMovementBounds(vec, bounds?.movement),
			(vec) => snap && gestureState.last && !physics ? V2.snap(vec, snap, _B.defaults.snapThreshold) : vec,
		);
		const evt = factory({ ...gestureState, offset } as FullGestureState<K>);
		setState((prev) => ({ ...prev, [kind]: evt }));
		ref.current?.setAttribute(`data-${kind}-state`, gestureState.active ? 'active' : 'idle');
		syncCssVars(ref, evt, cssVars);
		typedCallbacks[kind]?.(evt as never, phaseOf(gestureState));
		onGesture?.(evt, phaseOf(gestureState));
		$is('Drag')(evt) && gestureState.last && evt.swipe && onSwipe?.(evt.swipe);
		kind === 'drag' && gestureState.last && physics && startInertia(offset, V2.from(gestureState.velocity));
	}, [bounds, cssVars, onGesture, onSwipe, physics, ref, snap, startInertia, typedCallbacks]);
	const handlers = useMemo(() => ({
		...(drag && { onDrag: handler<'drag'>('drag', (g) => Drag({ state: g, swipe: swipeFrom(g.swipe) })) }),
		...(pinch && { onPinch: handler<'pinch'>('pinch', (g) => Pinch({ state: g })) }),
		...(scroll && { onScroll: handler<'scroll'>('scroll', (g) => Scroll({ state: g })) }),
		...(wheel && { onWheel: handler<'wheel'>('wheel', (g) => Wheel({ state: g })) }),
		...(move && { onMove: handler<'move'>('move', (g) => Move({ state: g })) }),
		...(hover && { onHover: handler<'hover'>('hover', (g) => Hover({ state: g })) }),
	}), [drag, handler, hover, move, pinch, scroll, wheel]);
	const gestureConfig = useMemo(() => ({
		enabled,
		...defined({ eventOptions, transform }),
		...(drag && { drag: { ...drag, swipe: swipeCfg, ...defined({ filterTaps: mobile?.filterTaps, preventScroll: mobile?.preventScroll, preventScrollAxis: mobile?.preventScrollAxis }) } }),
		...defined({ hover, move, pinch, scroll, wheel }),
	}), [drag, enabled, eventOptions, hover, mobile, move, pinch, scroll, swipeCfg, transform, wheel]);
	const bind = useGestureLib(handlers, gestureConfig as Parameters<typeof useGestureLib>[1]);
	const lpConfig = useMemo(() => ({
		cancelDist: readCssPx(_B.cssVars.longPressCancelDistance),
		hapticMs: longPress?.haptic ? resolveMs(_B.cssVars.longPressHaptic, _B.cssVars.interactionHaptic) : 0,
		threshold: longPress?.threshold ?? resolveMs(_B.cssVars.longPressThreshold, _B.cssVars.interactionLongPressThreshold),
	}), [longPress?.threshold, longPress?.haptic]);
	const rafRef = useRef<number | null>(null);
	const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const startPos = useRef<{ x: number; y: number } | null>(null);
	const pointerTypeRef = useRef<PointerType>('mouse');
	// RAF required for progress animation in React hooks (Effect.repeatWhile incompatible with React render cycle)
	const lpStart = useCallback((event: Parameters<NonNullable<RACLongPressProps['onLongPressStart']>>[0]) => {
		const t0 = Date.now();
		pointerTypeRef.current = event.pointerType as PointerType;
		startPos.current = 'clientX' in event ? { x: (event as unknown as PointerEvent).clientX, y: (event as unknown as PointerEvent).clientY } : null;
		const tick = (): void => {
			const progress = Math.min((Date.now() - t0) / lpConfig.threshold, 1);
			cssVars?.progress && ref.current?.style.setProperty(cssVars.progress, String(progress));
			ref.current?.setAttribute('data-longpress-progress', String(progress));
			rafRef.current = progress < 1 ? requestAnimationFrame(tick) : null;
		};
		rafRef.current = requestAnimationFrame(tick);
		const evt = LongPress({ pointerType: pointerTypeRef.current, progress: 0 });
		setState((s) => ({ ...s, longpress: evt }));
		onLongPress?.(evt, 'start');
		onGesture?.(evt, 'start');
	}, [cssVars?.progress, lpConfig, onGesture, onLongPress, ref]);
	const lpEnd = useCallback(() => {
		rafRef.current !== null && cancelAnimationFrame(rafRef.current);
		repeatRef.current !== null && clearInterval(repeatRef.current);
		rafRef.current = null; repeatRef.current = null; startPos.current = null;
		cssVars?.progress && ref.current?.style.removeProperty(cssVars.progress);
		ref.current?.removeAttribute('data-longpress-progress');
		const evt = LongPress({ pointerType: pointerTypeRef.current, progress: 1 });
		setState((s) => ({ ...s, longpress: evt }));
		onLongPress?.(evt, 'end');
		onGesture?.(evt, 'end');
	}, [cssVars?.progress, onGesture, onLongPress, ref]);
	const lpComplete = useCallback(() => {
		lpConfig.hapticMs > 0 && vibrate(lpConfig.hapticMs);
		const evt = LongPress({ pointerType: pointerTypeRef.current, progress: 1 });
		onLongPress?.(evt, 'move');
		onGesture?.(evt, 'move');
		const interval = longPress?.repeatInterval && longPress.repeatInterval > 0
			? setInterval(() => { lpConfig.hapticMs > 0 && vibrate(lpConfig.hapticMs); onLongPress?.(evt, 'move'); onGesture?.(evt, 'move'); }, longPress.repeatInterval)
			: null;
		repeatRef.current = interval;
	}, [longPress?.repeatInterval, lpConfig, onGesture, onLongPress]);
	useEffect(() => longPress?.cancelOnMove
		? (() => {
			const onMove = (pointerEvent: PointerEvent): void => {
				const pos = startPos.current;
				const exceeds = pos && Math.hypot(pointerEvent.clientX - pos.x, pointerEvent.clientY - pos.y) > lpConfig.cancelDist;
				exceeds && rafRef.current !== null && cancelAnimationFrame(rafRef.current);
				exceeds && cssVars?.progress && ref.current?.style.removeProperty(cssVars.progress);
			};
			document.addEventListener('pointermove', onMove);
			return () => document.removeEventListener('pointermove', onMove);
		})()
		: undefined, [longPress?.cancelOnMove, lpConfig, cssVars?.progress, ref]);
	useEffect(() => () => {
		rafRef.current !== null && cancelAnimationFrame(rafRef.current);
		repeatRef.current !== null && clearInterval(repeatRef.current);
		physicsRafRef.current !== null && cancelAnimationFrame(physicsRafRef.current);
	}, []);
	const { longPressProps } = useLongPress({
		...defined({ accessibilityDescription: longPress?.accessibilityDescription }),
		isDisabled: isDisabled || !longPress,
		onLongPress: lpComplete,
		onLongPressEnd: lpEnd,
		onLongPressStart: lpStart,
		threshold: lpConfig.threshold,
	});
	return { props: { ...(enabled ? bind() : {}), ...(longPress && enabled ? longPressProps : {}), style: { touchAction: touchAction(config) } }, state };
};

// biome-ignore assist/source/useSortedKeys: categorical grouping (type system, constructors, predicates, accessors, lifecycle)
const GestureEvent = Object.freeze({
	$is, $match, Drag, Hover, LongPress, Move, Pinch, Scroll, Wheel,
	isDrag, isPinch, isScroll, isWheel, isMove, isHover, isLongPress, isCoordinates,
	getOffset, getMovement, getDelta, getVelocity, getDirection, getDistance, getInitial, getOverflow, getXY, getOrigin, getDA, getTurns, getTap, getSwipe, getElapsedTime, getAxis,
	isActive, isFirst, isLast, isCanceled, isIntentional,
});

// --- [EXPORT] ----------------------------------------------------------------

export { GestureEvent, useGesture };
export type { GestureProps };
